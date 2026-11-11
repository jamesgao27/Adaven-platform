// Create/confirm an Auth user for a pending space invitation without a second email OTP.
// Body: email, password, invitationId, name?, kind?: 'space' | 'workspace'
// Requires Authorization Bearer (optional for anonymous invitees) — invitation proof is the gate.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type InviteKind = 'space' | 'workspace';

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

function jsonResponse(req: Request, payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeadersForRequest(req), 'Content-Type': 'application/json' },
  });
}

async function findAuthUserIdByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('not found') || msg.includes('unable to find')) return null;
    // generateLink may succeed even when we only need the user id
  }
  const id = data?.user?.id;
  return typeof id === 'string' ? id : null;
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
    const body = await req.json().catch(() => ({}));
    const {
      email,
      password,
      invitationId,
      name,
      kind: rawKind,
    } = body ?? {};

    const kind: InviteKind = rawKind === 'workspace' ? 'workspace' : 'space';

    if (typeof email !== 'string' || !email.trim()) {
      return jsonResponse(req, { success: false, error: 'email is required' }, 400);
    }
    if (typeof password !== 'string' || password.length < 6) {
      return jsonResponse(req, { success: false, error: 'password must be at least 6 characters' }, 400);
    }
    if (typeof invitationId !== 'string' || !invitationId.trim()) {
      return jsonResponse(req, { success: false, error: 'invitationId is required' }, 400);
    }

    const normalizedEmail = email.toLowerCase().trim();
    const displayName =
      typeof name === 'string' && name.trim() ? name.trim() : normalizedEmail.split('@')[0] || 'User';

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(req, { success: false, error: 'Server misconfigured.' }, 503);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let emailMatches = false;
    let statusPending = false;

    if (kind === 'workspace') {
      const { data: row, error: rowErr } = await admin
        .from('workspace_invitations')
        .select('id, invited_email, status')
        .eq('id', invitationId.trim())
        .maybeSingle();
      if (rowErr) {
        return jsonResponse(req, { success: false, error: 'Invitation lookup failed' }, 500);
      }
      if (!row) {
        return jsonResponse(req, { success: false, error: 'Invitation not found' }, 403);
      }
      emailMatches = String(row.invited_email || '').toLowerCase().trim() === normalizedEmail;
      statusPending = String(row.status) === 'pending';
    } else {
      const { data: row, error: rowErr } = await admin
        .from('space_invitations')
        .select('id, invitee_email, status')
        .eq('id', invitationId.trim())
        .maybeSingle();
      if (rowErr) {
        return jsonResponse(req, { success: false, error: 'Invitation lookup failed' }, 500);
      }
      if (!row) {
        return jsonResponse(req, { success: false, error: 'Invitation not found' }, 403);
      }
      emailMatches = String(row.invitee_email || '').toLowerCase().trim() === normalizedEmail;
      statusPending = String(row.status) === 'pending';
    }

    if (!emailMatches) {
      return jsonResponse(req, { success: false, error: 'Email does not match invitation' }, 403);
    }
    if (!statusPending) {
      return jsonResponse(req, { success: false, error: 'Invitation is not pending' }, 403);
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { name: displayName },
    });

    if (createErr) {
      const msg = (createErr.message || '').toLowerCase();
      const already =
        msg.includes('already') || msg.includes('registered') || msg.includes('exists');
      if (!already) {
        console.error('createUser failed:', createErr.message);
        return jsonResponse(req, { success: false, error: createErr.message }, 400);
      }

      const existingId = await findAuthUserIdByEmail(admin, normalizedEmail);
      if (!existingId) {
        return jsonResponse(
          req,
          { success: false, error: 'Account already exists but could not be updated.' },
          400,
        );
      }

      const { error: updateErr } = await admin.auth.admin.updateUserById(existingId, {
        password,
        email_confirm: true,
        user_metadata: { name: displayName },
      });
      if (updateErr) {
        console.error('updateUserById failed:', updateErr.message);
        return jsonResponse(req, { success: false, error: updateErr.message }, 400);
      }

      return jsonResponse(req, { success: true, userId: existingId, created: false });
    }

    return jsonResponse(req, {
      success: true,
      userId: created.user?.id ?? null,
      created: true,
    });
  } catch (e) {
    return jsonResponse(req, { error: String((e as Error)?.message ?? e) }, 500);
  }
});
