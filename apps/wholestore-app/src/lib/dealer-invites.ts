import { getPlatformClient } from '@adaven/platform-core';

export type DealerInviteToken = {
  id: string;
  token: string;
  providerSpaceId: string;
  inviterUserId: string;
  inviterName?: string | null;
  inviterEmail?: string | null;
  posterId: string;
  createdAt: string;
  expiresAt: string | null;
  isActive: boolean;
  maxDealers: number | null;
  currentDealers: number;
};

export type DealerInviteInfo = {
  providerSpaceId: string;
  factoryName?: string;
  inviterUserId: string;
  posterId: string;
  posterName?: string;
  posterDescription?: string;
  skuSummary?: string;
  tokenId: string;
};

function client() {
  return getPlatformClient();
}

function provider() {
  return client().schema('provider');
}

export function buildDealerInviteUrl(token: string, factoryName?: string | null): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://wholestore.app';
  const params = new URLSearchParams();
  params.set('token', token);
  if (factoryName && factoryName.trim()) params.set('factoryName', factoryName.trim());
  return `${origin.replace(/\/$/, '')}/dealer-join?${params.toString()}`;
}

function generateToken(): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 12);
  return `wd_${time}_${rand}`;
}

export async function createDealerInviteToken(
  providerSpaceId: string,
  posterId: string,
  expiresInDays?: number | null
): Promise<{ token: string | null; url: string | null; error: Error | null }> {
  try {
    if (!providerSpaceId || !posterId) {
      return { token: null, url: null, error: new Error('Factory and poster are required') };
    }
    const { data: userRes, error: userErr } = await client().auth.getUser();
    if (userErr) return { token: null, url: null, error: new Error(userErr.message) };
    const inviterId = userRes.user?.id;
    if (!inviterId) return { token: null, url: null, error: new Error('Not authenticated') };

    const payload: Record<string, unknown> = {
      provider_space_id: providerSpaceId,
      token: generateToken(),
      inviter_user_id: inviterId,
      poster_id: posterId,
    };
    if (typeof expiresInDays === 'number' && expiresInDays > 0) {
      payload.expires_at = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    }

    const { data, error } = await provider()
      .from('consumer_invite_tokens')
      .insert(payload)
      .select('id, token')
      .single();
    if (error) return { token: null, url: null, error: new Error(error.message) };

    const token = (data as { token?: string })?.token ?? String(payload.token);
    const { data: spaceRow } = await client().from('spaces').select('name').eq('id', providerSpaceId).maybeSingle();
    const factoryName = (spaceRow as { name?: string } | null)?.name ?? null;
    return { token, url: buildDealerInviteUrl(token, factoryName), error: null };
  } catch (e) {
    return { token: null, url: null, error: e instanceof Error ? e : new Error('Failed to create invite') };
  }
}

export async function getDealerInviteHistory(
  providerSpaceId: string
): Promise<{ invites: DealerInviteToken[]; error: Error | null }> {
  try {
    const [tokensRes, countsRes] = await Promise.all([
      provider()
        .from('consumer_invite_tokens')
        .select('id, token, provider_space_id, inviter_user_id, poster_id, created_at, expires_at, is_active, max_consumers')
        .eq('provider_space_id', providerSpaceId)
        .order('created_at', { ascending: false }),
      client().rpc('provider_open_invite_joined_counts', { p_provider_space_id: providerSpaceId }),
    ]);
    if (tokensRes.error) return { invites: [], error: new Error(tokensRes.error.message) };
    if (countsRes.error) return { invites: [], error: new Error(countsRes.error.message) };

    const rows = (tokensRes.data || []) as Record<string, any>[];
    const countByTokenId = new Map<string, number>();
    for (const r of (countsRes.data || []) as { invite_token_id?: string; joined_count?: number }[]) {
      if (r.invite_token_id) countByTokenId.set(r.invite_token_id, Number(r.joined_count ?? 0));
    }

    const inviterIds = [...new Set(rows.map((r) => r.inviter_user_id).filter(Boolean))];
    const inviterMap: Record<string, { name: string | null; email: string }> = {};
    if (inviterIds.length) {
      const { data: users } = await client().from('users').select('id, name, email').in('id', inviterIds);
      for (const u of users ?? []) {
        inviterMap[u.id] = { name: (u as any).name ?? null, email: (u as any).email || '' };
      }
    }

    return {
      invites: rows.map((row) => {
        const inviter = inviterMap[row.inviter_user_id];
        return {
          id: row.id,
          token: row.token,
          providerSpaceId: row.provider_space_id,
          inviterUserId: row.inviter_user_id,
          inviterName: inviter?.name ?? null,
          inviterEmail: inviter?.email ?? null,
          posterId: row.poster_id,
          createdAt: row.created_at,
          expiresAt: row.expires_at ?? null,
          isActive: row.is_active ?? true,
          maxDealers: row.max_consumers ?? null,
          currentDealers: countByTokenId.get(row.id) ?? 0,
        };
      }),
      error: null,
    };
  } catch (e) {
    return { invites: [], error: e instanceof Error ? e : new Error('Failed to load invite history') };
  }
}

export async function setDealerInviteActive(id: string, isActive: boolean): Promise<{ error: Error | null }> {
  const { error } = await provider().from('consumer_invite_tokens').update({ is_active: isActive }).eq('id', id);
  return { error: error ? new Error(error.message) : null };
}

export async function deleteDealerInviteToken(id: string): Promise<{ error: Error | null }> {
  const { error } = await provider().from('consumer_invite_tokens').delete().eq('id', id);
  return { error: error ? new Error(error.message) : null };
}

export async function getDealerInviteInfo(
  token: string
): Promise<{ info: DealerInviteInfo | null; error: Error | null }> {
  try {
    const { data, error } = await client().rpc('provider_get_consumer_invite_info', { p_token: token });
    if (error) return { info: null, error: new Error(error.message) };
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { info: null, error: null };
    return {
      info: {
        providerSpaceId: row.provider_space_id,
        factoryName: row.provider_name ?? row.factory_name ?? undefined,
        inviterUserId: row.inviter_user_id,
        posterId: row.poster_id,
        posterName: row.poster_name ?? undefined,
        posterDescription: row.poster_description ?? undefined,
        skuSummary: row.sku_summary ?? undefined,
        tokenId: row.token_id ?? row.id ?? '',
      },
      error: null,
    };
  } catch (e) {
    return { info: null, error: e instanceof Error ? e : new Error('Failed to load invite') };
  }
}

export async function acceptDealerInvite(
  token: string,
  consumerSpaceId: string
): Promise<{ enrollmentId: string | null; error: Error | null }> {
  try {
    const { data, error } = await client().rpc('provider_accept_consumer_invite_token', {
      p_token: token,
      p_consumer_space_id: consumerSpaceId,
    });
    if (error) {
      const msg = [error.message, (error as any).details, (error as any).hint].filter(Boolean).join(' ');
      return { enrollmentId: null, error: new Error(msg || 'Failed to accept invite') };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return { enrollmentId: row?.enrollment_id ?? null, error: null };
  } catch (e) {
    return { enrollmentId: null, error: e instanceof Error ? e : new Error('Failed to accept invite') };
  }
}
