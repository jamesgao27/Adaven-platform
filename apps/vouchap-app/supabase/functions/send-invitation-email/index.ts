// Sends invitation email using Supabase Auth (SMTP + templates).
// Requires Authorization: Bearer <user JWT>. Verifies space_invitations row: inviter_id = caller, pending, invitee email match.
// Body: email, inviteUrl, invitationId (optional if inviteUrl contains /invite/{uuid}), spaceName, inviterName, isExistingUser.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function parseAllowedOrigins(): string[] | null {
  const raw = Deno.env.get('INVITE_EMAIL_ALLOWED_ORIGINS')?.trim();
  if (!raw) return null;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeadersForRequest(req: Request): Record<string, string> {
  const allowed = parseAllowedOrigins();
  const origin = req.headers.get('Origin') || '';
  const allowOrigin =
    allowed == null || allowed.length === 0
      ? '*'
      : !origin
        ? '*'
        : allowed.includes(origin)
          ? origin
          : 'null';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function extractInvitationId(inviteUrl: unknown, bodyId: unknown): string | null {
  if (typeof bodyId === 'string') {
    const t = bodyId.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return t;
  }
  if (typeof inviteUrl !== 'string' || !inviteUrl.trim()) return null;
  const m = inviteUrl.match(/\/invite\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m?.[1] ?? null;
}

function jsonResponse(req: Request, payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeadersForRequest(req), 'Content-Type': 'application/json' },
  });
}

async function requireUserId(req: Request): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse(req, { success: false, error: 'Unauthorized' }, 401);
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return jsonResponse(req, { success: false, error: 'Server misconfigured.' }, 503);
  }
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id) {
    return jsonResponse(req, { success: false, error: 'Unauthorized' }, 401);
  }
  return { userId: user.id };
}

Deno.serve(async (req) => {
  const cors = corsHeadersForRequest(req);
  const allowed = parseAllowedOrigins();
  const origin = req.headers.get('Origin') || '';
  if (allowed && allowed.length > 0 && origin && !allowed.includes(origin)) {
    return jsonResponse(req, { success: false, error: 'Forbidden origin' }, 403);
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const auth = await requireUserId(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const {
      email,
      inviteUrl,
      invitationId: bodyInvitationId,
      spaceName,
      inviterName,
      isExistingUser,
    } = body ?? {};

    if (typeof email !== 'string' || !email.trim()) {
      return jsonResponse(req, { success: false, error: 'email is required' }, 400);
    }
    const normalizedEmail = email.toLowerCase().trim();

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        req,
        { success: false, error: 'Supabase service role not available.' },
        503,
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (isExistingUser === true) {
      return jsonResponse(req, { success: true, emailSent: false });
    }

    const invitationId = extractInvitationId(inviteUrl, bodyInvitationId);
    if (!invitationId) {
      return jsonResponse(req, { success: false, error: 'invitationId or inviteUrl with /invite/{id} is required' }, 400);
    }

    const { data: row, error: rowErr } = await admin
      .from('space_invitations')
      .select('id, inviter_id, invitee_email, status')
      .eq('id', invitationId)
      .maybeSingle();

    if (rowErr) {
      console.error('space_invitations select failed:', rowErr.message);
      return jsonResponse(req, { success: false, error: 'Invitation lookup failed' }, 500);
    }
    if (!row) {
      return jsonResponse(req, { success: false, error: 'Invitation not found' }, 403);
    }
    if (row.inviter_id !== auth.userId) {
      return jsonResponse(req, { success: false, error: 'Forbidden' }, 403);
    }
    if (String(row.status) !== 'pending') {
      return jsonResponse(req, { success: false, error: 'Invitation is not pending' }, 403);
    }
    if (String(row.invitee_email || '').toLowerCase().trim() !== normalizedEmail) {
      return jsonResponse(req, { success: false, error: 'Email does not match invitation' }, 403);
    }

    const space = spaceName || 'a space';
    const inviter = inviterName || 'Someone';
    const redirectTo = typeof inviteUrl === 'string' ? inviteUrl.trim() || undefined : undefined;

    const { error } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo,
      data: { space_name: space, inviter_name: inviter },
    });

    if (error) {
      console.error('inviteUserByEmail failed:', error.message);
      if (error.message?.toLowerCase().includes('already') || error.message?.toLowerCase().includes('registered')) {
        return jsonResponse(req, { success: true, emailSent: false });
      }
      return jsonResponse(req, { success: false, error: error.message }, 400);
    }

    return jsonResponse(req, { success: true, emailSent: true });
  } catch (e) {
    return jsonResponse(req, { error: String(e?.message ?? e) }, 500);
  }
});
