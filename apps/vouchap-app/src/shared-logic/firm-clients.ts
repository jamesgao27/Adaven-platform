import { supabase } from './supabase';
import Constants from 'expo-constants';

export interface FirmClientInviteInfo {
  firmSpaceId: string;
  firmName?: string;
  inviterUserId: string;
  skuId: string;
  tokenId: string;
}

export interface FirmClientAcceptResult {
  firmSpaceId: string;
  clientSpaceId: string;
  inviterUserId: string;
  skuId: string;
}

export interface FirmClientInviteToken {
  id: string;
  token: string;
  firmSpaceId: string;
  inviterUserId: string;
  inviterName?: string | null;
  inviterEmail?: string | null;
  skuId: string;
  createdAt: string;
  expiresAt: string | null;
  isActive: boolean;
  maxClients: number | null;
  /** Rows in firm.clients with invite_token_id = this token (see firm_open_invite_joined_counts). */
  currentClients: number;
}

const CLIENT_JOIN_BASE_URL =
  (Constants.expoConfig?.extra as any)?.clientJoinBaseUrl ||
  process.env.EXPO_PUBLIC_CLIENT_JOIN_URL ||
  'https://vouchap.com/client-join';

/** 根据 token 构造发给 Client 的邀请链接。firmName 为 firm space 名称，落地页将直接展示 */
export function buildFirmClientInviteUrl(token: string, firmName?: string | null): string {
  const base = (CLIENT_JOIN_BASE_URL || '').replace(/\/$/, '');
  if (!token) return base || '';
  const params = new URLSearchParams();
  params.set('token', token);
  if (firmName != null && String(firmName).trim()) {
    params.set('firmName', String(firmName).trim());
  }
  return `${base}?${params.toString()}`;
}

function generateClientInviteToken(): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 12);
  return `fc_${time}_${rand}`;
}

/** Firm 端：为当前 firm_space + 选定 SKU 创建一条开放邀请 token，并返回可分享链接
 *  @param expiresInDays 可选：邀请有效期（天）；为 null/undefined 表示长期有效
 */
export async function createFirmClientInviteToken(
  firmSpaceId: string,
  skuId: string,
  expiresInDays?: number | null
): Promise<{ token: string | null; url: string | null; error: Error | null }> {
  try {
    if (!firmSpaceId || !skuId) {
      return { token: null, url: null, error: new Error('firmSpaceId and skuId are required') };
    }

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr) {
      return { token: null, url: null, error: new Error(userErr.message || 'Failed to get current user') };
    }
    const inviterId = userRes.user?.id;
    if (!inviterId) {
      return { token: null, url: null, error: new Error('Not authenticated') };
    }

    const token = generateClientInviteToken();

    let expiresAt: string | null = null;
    if (typeof expiresInDays === 'number' && expiresInDays > 0) {
      const ms = expiresInDays * 24 * 60 * 60 * 1000;
      expiresAt = new Date(Date.now() + ms).toISOString();
    }

    const payload: any = {
      firm_space_id: firmSpaceId,
      token,
      inviter_user_id: inviterId,
      sku_id: skuId,
    };
    if (expiresAt) {
      payload.expires_at = expiresAt;
    }

    const { data, error } = await supabase
      .schema('firm')
      .from('client_invite_tokens')
      .insert(payload)
      .select('id, token')
      .single();

    if (error) {
      return { token: null, url: null, error: new Error(error.message || 'Failed to create invite token') };
    }

    const finalToken = (data as any)?.token ?? token;
    // 每条邀请都对应 firm space，查 space 名称并写入链接供落地页展示
    const { data: spaceRow } = await supabase.from('spaces').select('name').eq('id', firmSpaceId).maybeSingle();
    const firmName = (spaceRow as { name?: string } | null)?.name ?? null;
    const url = buildFirmClientInviteUrl(finalToken, firmName);
    return { token: finalToken, url, error: null };
  } catch (e) {
    return {
      token: null,
      url: null,
      error: e instanceof Error ? e : new Error('Failed to create firm client invite token'),
    };
  }
}

/** Firm 端：获取某个 firm_space 下的开放邀请 token 列表（用于展示邀请历史） */
export async function getFirmClientInviteHistory(
  firmSpaceId: string
): Promise<{ invites: FirmClientInviteToken[]; error: Error | null }> {
  try {
    if (!firmSpaceId) {
      return { invites: [], error: new Error('firmSpaceId is required') };
    }
    const [tokensRes, countsRes] = await Promise.all([
      supabase
        .schema('firm')
        .from('client_invite_tokens')
        .select('id, token, firm_space_id, inviter_user_id, sku_id, created_at, expires_at, is_active, max_clients')
        .eq('firm_space_id', firmSpaceId)
        .order('created_at', { ascending: false }),
      supabase.rpc('firm_open_invite_joined_counts', { p_firm_space_id: firmSpaceId }),
    ]);

    if (tokensRes.error) {
      return { invites: [], error: new Error(tokensRes.error.message || 'Failed to load invite history') };
    }
    if (countsRes.error) {
      return { invites: [], error: new Error(countsRes.error.message || 'Failed to load joined counts') };
    }

    const rows = (tokensRes.data || []) as any[];
    const countByTokenId = new Map<string, number>();
    for (const r of (countsRes.data || []) as { invite_token_id?: string; joined_count?: number | string }[]) {
      const tid = r.invite_token_id;
      if (tid) {
        countByTokenId.set(tid, Number(r.joined_count ?? 0));
      }
    }

    // 加载创建人信息，用于在 UI 中显示名称/邮箱
    const inviterIds = Array.from(
      new Set(rows.map((r) => r.inviter_user_id).filter(Boolean))
    ) as string[];
    let inviterMap: Record<string, { name: string | null; email: string }> = {};
    if (inviterIds.length > 0) {
      const { data: users, error: usersErr } = await supabase
        .from('users')
        .select('id, name, email')
        .in('id', inviterIds);
      if (usersErr) {
        console.error('getFirmClientInviteHistory users:', usersErr);
      } else {
        inviterMap = {};
        (users || []).forEach((u: any) => {
          inviterMap[u.id] = { name: u.name ?? null, email: u.email || '' };
        });
      }
    }

    const invites: FirmClientInviteToken[] = rows.map((row) => {
      const inviter = inviterMap[row.inviter_user_id] ?? null;
      return {
        id: row.id,
        token: row.token,
        firmSpaceId: row.firm_space_id,
        inviterUserId: row.inviter_user_id,
        inviterName: inviter?.name ?? null,
        inviterEmail: inviter?.email ?? null,
        skuId: row.sku_id,
        createdAt: row.created_at,
        expiresAt: row.expires_at ?? null,
        isActive: row.is_active ?? true,
        maxClients: row.max_clients ?? null,
        currentClients: countByTokenId.get(row.id) ?? 0,
      };
    });
    return { invites, error: null };
  } catch (e) {
    return {
      invites: [],
      error: e instanceof Error ? e : new Error('Failed to load invite history'),
    };
  }
}

/** 手动开启/关闭某个开放邀请 token 的 active 状态 */
export async function setFirmClientInviteActive(
  id: string,
  isActive: boolean
): Promise<{ error: Error | null }> {
  try {
    if (!id) {
      return { error: new Error('id is required') };
    }
    const { error } = await supabase
      .schema('firm')
      .from('client_invite_tokens')
      .update({ is_active: isActive })
      .eq('id', id);
    if (error) {
      return { error: new Error(error.message || 'Failed to update invite active status') };
    }
    return { error: null };
  } catch (e) {
    return {
      error: e instanceof Error ? e : new Error('Failed to update invite active status'),
    };
  }
}

/** Firm 端：删除一条开放邀请 token（RLS 允许同 space 成员 DELETE） */
export async function deleteFirmClientInviteToken(id: string): Promise<{ error: Error | null }> {
  try {
    if (!id) {
      return { error: new Error('id is required') };
    }
    const { error } = await supabase
      .schema('firm')
      .from('client_invite_tokens')
      .delete()
      .eq('id', id);
    if (error) {
      return { error: new Error(error.message || 'Failed to delete invite') };
    }
    return { error: null };
  } catch (e) {
    return {
      error: e instanceof Error ? e : new Error('Failed to delete invite'),
    };
  }
}

/** 获取开放邀请 token 的基础信息（用于 App/Web 内展示 firm 信息） */
export async function getFirmClientInviteInfo(
  token: string
): Promise<{ info: FirmClientInviteInfo | null; error: Error | null }> {
  try {
    if (!token) {
      return { info: null, error: new Error('Token is required') };
    }

    const { data, error } = await supabase.rpc('firm_get_client_invite_info', {
      p_token: token,
    });

    if (error) {
      return { info: null, error: new Error(error.message || 'Failed to load invite info') };
    }

    // RPC 返回 SETOF 时为数组，取首行
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return { info: null, error: null };
    }

    // 约定 RPC 返回字段名：firm_space_id, firm_name, inviter_user_id, sku_id, token_id
    return {
      info: {
        firmSpaceId: row.firm_space_id,
        firmName: row.firm_name ?? undefined,
        inviterUserId: row.inviter_user_id,
        skuId: row.sku_id,
        tokenId: row.token_id ?? row.id ?? '',
      },
      error: null,
    };
  } catch (e) {
    return {
      info: null,
      error: e instanceof Error ? e : new Error('Failed to load invite info'),
    };
  }
}

/** 消费开放邀请 token：将选定的 client_space 绑定为该 firm 的 client，并创建订单 */
export async function acceptFirmClientInvite(
  token: string,
  clientSpaceId: string,
  clientUserId: string
): Promise<{ result: FirmClientAcceptResult | null; error: Error | null }> {
  try {
    if (!token || !clientSpaceId || !clientUserId) {
      return { result: null, error: new Error('Token, clientSpaceId and clientUserId are required') };
    }

    const { data, error } = await supabase.rpc('firm_accept_client_invite_token', {
      p_token: token,
      p_client_space_id: clientSpaceId,
      p_client_user_id: clientUserId,
    });

    if (error) {
      const msg = [error.message, (error as any).details, (error as any).hint].filter(Boolean).join(' ');
      if (process.env.NODE_ENV !== 'production') {
        console.error('[acceptFirmClientInvite] RPC error:', error);
      }
      return { result: null, error: new Error(msg || 'Failed to accept firm client invite') };
    }

    if (!data || !Array.isArray(data) || data.length === 0) {
      return { result: null, error: null };
    }

    const row = data[0];
    return {
      result: {
        firmSpaceId: row.firm_space_id,
        clientSpaceId: row.client_space_id,
        inviterUserId: row.inviter_user_id,
        skuId: row.sku_id,
      },
      error: null,
    };
  } catch (e) {
    return {
      result: null,
      error: e instanceof Error ? e : new Error('Failed to accept firm client invite'),
    };
  }
}

export interface CreateClientOnBehalfResult {
  clientSpaceId: string;
  invitationId: string | null;
  spaceName: string;
  inviteeEmail: string;
}

/**
 * Firm 代建 client：创建 client 空间、关联 firm.clients、当前用户为 member、
 * 创建空间邀请（客户接受后为 admin），可选创建 onboarding 订单。
 * 调用后由前端负责发送邀请邮件（sendInvitationEmailForId）。
 */
export async function createClientOnBehalf(
  firmSpaceId: string,
  params: {
    clientName: string;
    contactName: string;
    contactEmail: string;
    skuId?: string | null;
    /** When false, only create space + client + order; do not create invitation. Contact email optional. */
    createInvitation?: boolean;
  }
): Promise<{ result: CreateClientOnBehalfResult | null; error: Error | null }> {
  try {
    const createInvitation = params.createInvitation !== false;
    const { data, error } = await supabase.rpc('firm_create_client_on_behalf', {
      p_firm_space_id: firmSpaceId,
      p_client_name: (params.clientName || '').trim(),
      p_contact_name: (params.contactName || '').trim(),
      p_contact_email: (params.contactEmail || '').trim(),
      p_sku_id: params.skuId ?? null,
      p_create_invitation: createInvitation,
    });
    if (error) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[createClientOnBehalf] RPC error object:', error);
      }
      const err = error as { message?: string; details?: string; hint?: string; code?: string };
      const parts = [err.message, err.details, err.hint].filter(Boolean);
      const msg = parts.length ? parts.join(' ') : 'Failed to create client on behalf';
      return { result: null, error: new Error(msg) };
    }
    const row = Array.isArray(data) ? data[0] : data;
    // RPC returns out_* columns to avoid PL/pgSQL ambiguity; support both for backwards compatibility
    const clientSpaceId = row?.out_client_space_id ?? row?.client_space_id;
    if (!clientSpaceId) {
      return { result: null, error: new Error('Unexpected response from server') };
    }
    return {
      result: {
        clientSpaceId,
        invitationId: row?.out_invitation_id ?? row?.invitation_id ?? null,
        spaceName: row?.out_space_name ?? row?.space_name ?? '',
        inviteeEmail: row?.out_invitee_email ?? row?.invitee_email ?? '',
      },
      error: null,
    };
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.error('[createClientOnBehalf] catch:', e);
    }
    const msg =
      e instanceof Error
        ? e.message
        : typeof (e as { message?: string })?.message === 'string'
          ? (e as { message: string }).message
          : 'Failed to create client on behalf';
    return { result: null, error: new Error(msg) };
  }
}

// ---------------- Migration-mode helpers: pending orders on single firm.orders table ----------------

export interface CreatePendingOrderForInviteeResult {
  orderId: string;
  firmSpaceId: string;
  firmClientId: string;
  inviteeEmail: string;
}

export interface CreateInviteeOnlyResult {
  firmClientId: string;
  inviteeEmail: string;
}

/** Firm: create/update invitee_client only (no order). Client can later link space with empty SKU preview. */
export async function createInviteeOnly(
  firmSpaceId: string,
  params: {
    clientName: string;
    contactName: string;
    contactEmail: string;
  }
): Promise<{ result: CreateInviteeOnlyResult | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('firm_create_invitee_only', {
      p_firm_space_id: firmSpaceId,
      p_client_name: (params.clientName || '').trim(),
      p_contact_name: (params.contactName || '').trim(),
      p_contact_email: (params.contactEmail || '').trim(),
    });
    if (error) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[createInviteeOnly] RPC error object:', error);
      }
      const err = error as { message?: string; details?: string; hint?: string };
      const parts = [err.message, err.details, err.hint].filter(Boolean);
      const msg = parts.length ? parts.join(' ') : 'Failed to save invitee';
      return { result: null, error: new Error(msg) };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const firmClientId = row?.firm_client_id;
    if (!firmClientId) {
      return { result: null, error: new Error('Unexpected response from server') };
    }
    return {
      result: {
        firmClientId,
        inviteeEmail: row?.invitee_email ?? params.contactEmail,
      },
      error: null,
    };
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.error('[createInviteeOnly] catch:', e);
    }
    const msg =
      e instanceof Error
        ? e.message
        : typeof (e as { message?: string })?.message === 'string'
          ? (e as { message: string }).message
          : 'Failed to save invitee';
    return { result: null, error: new Error(msg) };
  }
}

/** Firm 迁移模式：为某 invitee 创建 pending order（不创建 client space，仅 firm 可见） */
export async function createPendingOrderForInvitee(
  firmSpaceId: string,
  params: {
    clientName: string;
    contactName: string;
    contactEmail: string;
    skuId: string;
  }
): Promise<{ result: CreatePendingOrderForInviteeResult | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('firm_create_pending_order_for_invitee', {
      p_firm_space_id: firmSpaceId,
      p_client_name: (params.clientName || '').trim(),
      p_contact_name: (params.contactName || '').trim(),
      p_contact_email: (params.contactEmail || '').trim(),
      p_sku_id: params.skuId,
    });
    if (error) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[createPendingOrderForInvitee] RPC error object:', error);
      }
      const err = error as { message?: string; details?: string; hint?: string; code?: string };
      const parts = [err.message, err.details, err.hint].filter(Boolean);
      const msg = parts.length ? parts.join(' ') : 'Failed to create pending order for invitee';
      return { result: null, error: new Error(msg) };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const orderId = row?.out_order_id ?? row?.order_id;
    if (!orderId) {
      return { result: null, error: new Error('Unexpected response from server for pending order') };
    }
    return {
      result: {
        orderId,
        firmSpaceId: row?.out_firm_space_id ?? row?.firm_space_id ?? '',
        firmClientId: row?.firm_client_id ?? row?.out_firm_client_id ?? '',
        inviteeEmail: row?.out_invitee_email ?? row?.invitee_email ?? '',
      },
      error: null,
    };
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.error('[createPendingOrderForInvitee] catch:', e);
    }
    const msg =
      e instanceof Error
        ? e.message
        : typeof (e as { message?: string })?.message === 'string'
          ? (e as { message: string }).message
          : 'Failed to create pending order for invitee';
    return { result: null, error: new Error(msg) };
  }
}

/** Firm 迁移模式：将某 invitee 的所有 pending orders 绑定到指定 client_space_id（原地更新 firm.orders） */
export async function migratePendingOrdersToClientSpace(
  firmSpaceId: string,
  firmClientId: string,
  clientSpaceId: string
): Promise<{ migratedOrderIds: string[]; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('migrate_pending_orders_to_client_space', {
      p_firm_space_id: firmSpaceId,
      p_firm_client_id: firmClientId,
      p_client_space_id: clientSpaceId,
    });
    if (error) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[migratePendingOrdersToClientSpace] RPC error object:', error);
      }
      const err = error as { message?: string; details?: string; hint?: string; code?: string };
      const parts = [err.message, err.details, err.hint].filter(Boolean);
      const msg = parts.length ? parts.join(' ') : 'Failed to migrate pending orders';
      return { migratedOrderIds: [], error: new Error(msg) };
    }
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    const ids = rows.map((r: any) => r.order_id as string).filter(Boolean);
    return { migratedOrderIds: ids, error: null };
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.error('[migratePendingOrdersToClientSpace] catch:', e);
    }
    const msg =
      e instanceof Error
        ? e.message
        : typeof (e as { message?: string })?.message === 'string'
          ? (e as { message: string }).message
          : 'Failed to migrate pending orders';
    return { migratedOrderIds: [], error: new Error(msg) };
  }
}

// ---------------- Client 认领（invitee 无 token 时按邮箱认领） ----------------

export interface PendingInviteeForClaim {
  firmSpaceId: string;
  firmName: string;
  /** firm.clients row id (pending: client_space_id is null) */
  firmClientId: string;
  inviteeClientName: string | null;
  inviteeContactEmail: string | null;
  /** SKU id for the engagement (for preview); from first pending order */
  skuId: string | null;
  /** First pending order id (for order-scoped SKU RPC after user joins client space) */
  orderId: string | null;
}

/** Pending engagements for email via public.get_pending_invitees_for_email (firm.clients pending rows). */
export async function getPendingInviteesForEmail(
  email: string
): Promise<{ list: PendingInviteeForClaim[]; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('get_pending_invitees_for_email', {
      p_email: email || '',
    });
    if (error) {
      return { list: [], error: new Error(error.message || 'Failed to load pending invitees') };
    }
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    const list = rows.map((r: any) => ({
      firmSpaceId: r.firm_space_id,
      firmName: r.firm_name ?? '',
      firmClientId: r.firm_client_id,
      inviteeClientName: r.invitee_client_name ?? null,
      inviteeContactEmail: r.invitee_email ?? null,
      skuId: r.sku_id ?? null,
      orderId: r.order_id ?? null,
    }));
    return { list, error: null };
  } catch (e) {
    return {
      list: [],
      error: e instanceof Error ? e : new Error('Failed to load pending invitees'),
    };
  }
}

/** Client 认领 engagement：创建/绑定 client space，迁移 pending orders，加入 space */
export async function inviteeClaimEngagement(
  firmClientId: string,
  clientSpaceId: string
): Promise<{ result: { clientSpaceId: string; firmSpaceId: string } | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('invitee_claim_engagement', {
      p_firm_client_id: firmClientId,
      p_client_space_id: clientSpaceId,
    });
    if (error) {
      const msg = [error.message, (error as any).details, (error as any).hint].filter(Boolean).join(' ');
      return { result: null, error: new Error(msg || 'Failed to claim engagement') };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.client_space_id) return { result: null, error: null };
    return {
      result: { clientSpaceId: row.client_space_id, firmSpaceId: row.firm_space_id },
      error: null,
    };
  } catch (e) {
    return {
      result: null,
      error: e instanceof Error ? e : new Error('Failed to claim engagement'),
    };
  }
}

