-- Rollback: reverse migration 20260323120000_firm_tag_groups.sql (tag-based groups).
--
-- Run manually against the DB where that migration was applied (e.g. Supabase SQL Editor).
-- WARNING: Drops firm.groups / group_members / group_clients / group_invitees and all data in them.
-- After success, remove the migration row if you use Supabase migration history:
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260323120000';
-- (Table name may be `schema_migrations` in `supabase_migrations` schema depending on CLI version.)
--
-- Restores: RLS + RPC bodies to the state from earlier repo migrations (see comments per section).
--
-- After invitee→client merge (20260325140000+), RPC bodies in this rollback for invitee_claim_engagement /
-- firm_create_* / invitee_clients are OUT OF DATE. Do not run those sections against production without
-- reconciling with current migrations.

SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) Triggers & publication (depend on group tables)
--------------------------------------------------------------------------------

DROP TRIGGER IF EXISTS tr_user_spaces_promote_firm_admin ON public.user_spaces;
DROP TRIGGER IF EXISTS tr_groups_prevent_delete_admin ON firm.groups;
DROP TRIGGER IF EXISTS tr_group_members_prevent_admin_creator_remove ON firm.group_members;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'firm' AND tablename = 'group_clients'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE firm.group_clients;
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 2) Drop group tables (FK order: children first)
--------------------------------------------------------------------------------

DROP TABLE IF EXISTS firm.group_invitees CASCADE;
DROP TABLE IF EXISTS firm.group_clients CASCADE;
DROP TABLE IF EXISTS firm.group_members CASCADE;
DROP TABLE IF EXISTS firm.groups CASCADE;

--------------------------------------------------------------------------------
-- 3) Drop functions introduced only for tag groups
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS firm.on_user_spaces_promote_firm_admin() CASCADE;
DROP FUNCTION IF EXISTS firm.prevent_delete_system_admin_group() CASCADE;
DROP FUNCTION IF EXISTS firm.prevent_remove_admin_creator_from_group() CASCADE;
DROP FUNCTION IF EXISTS firm.link_client_to_user_groups(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS firm.link_invitee_to_user_groups(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.firm_bootstrap_admin_group(uuid, uuid);

--------------------------------------------------------------------------------
-- 4) firm.clients / firm.orders RLS — restore assignee-only (20250313342000_firm_clients_orders_rls_by_assignee)
--------------------------------------------------------------------------------

ALTER TABLE firm.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS firm_clients_select ON firm.clients;
DROP POLICY IF EXISTS firm_clients_update ON firm.clients;
DROP POLICY IF EXISTS firm_clients_delete ON firm.clients;

CREATE POLICY firm_clients_select ON firm.clients
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR
    EXISTS (
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.clients.firm_space_id
        AND ca.client_space_id = firm.clients.client_space_id
        AND ca.user_id = auth.uid()
    )
  );

CREATE POLICY firm_clients_update ON firm.clients
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR
    EXISTS (
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.clients.firm_space_id
        AND ca.client_space_id = firm.clients.client_space_id
        AND ca.user_id = auth.uid()
    )
  );

CREATE POLICY firm_clients_delete ON firm.clients
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR
    EXISTS (
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.clients.firm_space_id
        AND ca.client_space_id = firm.clients.client_space_id
        AND ca.user_id = auth.uid()
    )
  );

COMMENT ON POLICY firm_clients_select ON firm.clients IS 'Admin sees all clients; member sees only clients where they are assignee.';
COMMENT ON POLICY firm_clients_update ON firm.clients IS 'Same as SELECT.';
COMMENT ON POLICY firm_clients_delete ON firm.clients IS 'Same as SELECT.';

DROP POLICY IF EXISTS firm_orders_select ON firm.orders;
DROP POLICY IF EXISTS firm_orders_update ON firm.orders;
DROP POLICY IF EXISTS firm_orders_delete ON firm.orders;

CREATE POLICY firm_orders_select ON firm.orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.orders.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR
    EXISTS (
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.orders.firm_space_id
        AND ca.user_id = auth.uid()
        AND (
          (firm.orders.client_space_id IS NOT NULL AND ca.client_space_id = firm.orders.client_space_id)
          OR (firm.orders.invitee_client_id IS NOT NULL AND ca.invitee_client_id = firm.orders.invitee_client_id)
        )
    )
    OR
    (firm.orders.client_space_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.orders.client_space_id
        AND us.user_id = auth.uid()
    ))
  );

CREATE POLICY firm_orders_update ON firm.orders
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.orders.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR
    EXISTS (
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.orders.firm_space_id
        AND ca.user_id = auth.uid()
        AND (
          (firm.orders.client_space_id IS NOT NULL AND ca.client_space_id = firm.orders.client_space_id)
          OR (firm.orders.invitee_client_id IS NOT NULL AND ca.invitee_client_id = firm.orders.invitee_client_id)
        )
    )
  );

CREATE POLICY firm_orders_delete ON firm.orders
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.orders.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR
    EXISTS (
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.orders.firm_space_id
        AND ca.user_id = auth.uid()
        AND (
          (firm.orders.client_space_id IS NOT NULL AND ca.client_space_id = firm.orders.client_space_id)
          OR (firm.orders.invitee_client_id IS NOT NULL AND ca.invitee_client_id = firm.orders.invitee_client_id)
        )
    )
  );

COMMENT ON POLICY firm_orders_select ON firm.orders IS 'Engagement visibility by client assignee: admin all; member only orders for clients they assign; client sees own.';
COMMENT ON POLICY firm_orders_update ON firm.orders IS 'Same as SELECT (created_by not used for permission).';
COMMENT ON POLICY firm_orders_delete ON firm.orders IS 'Same as SELECT.';

-- firm.orders RLS was enabled in earlier migrations; keep enabled if already on.
ALTER TABLE firm.orders ENABLE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- 5) firm.clients_assignee RLS — same as 20250313320000 (tag migration only refreshed these)
--------------------------------------------------------------------------------

ALTER TABLE firm.clients_assignee ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clients_assignee_select_firm_members ON firm.clients_assignee;
DROP POLICY IF EXISTS clients_assignee_insert_firm_admin ON firm.clients_assignee;
DROP POLICY IF EXISTS clients_assignee_update_firm_admin ON firm.clients_assignee;
DROP POLICY IF EXISTS clients_assignee_delete_firm_admin ON firm.clients_assignee;

CREATE POLICY clients_assignee_select_firm_members ON firm.clients_assignee
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients_assignee.firm_space_id AND us.user_id = auth.uid()
    )
  );

CREATE POLICY clients_assignee_insert_firm_admin ON firm.clients_assignee
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients_assignee.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

CREATE POLICY clients_assignee_update_firm_admin ON firm.clients_assignee
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients_assignee.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients_assignee.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

CREATE POLICY clients_assignee_delete_firm_admin ON firm.clients_assignee
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients_assignee.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

--------------------------------------------------------------------------------
-- 6) firm.accept_client_invite_token — 20260322140000_clients_invite_token_id_drop_current_clients.sql
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION firm.accept_client_invite_token(
  p_token text,
  p_client_space_id uuid,
  p_client_user_id uuid
)
RETURNS TABLE (
  firm_space_id uuid,
  client_space_id uuid,
  inviter_user_id uuid,
  sku_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = firm, public
AS $$
#variable_conflict use_column
DECLARE
  v_token_record firm.client_invite_tokens%ROWTYPE;
  v_now timestamptz := now();
  v_out_firm_space_id uuid;
  v_out_client_space_id uuid;
  v_out_inviter_user_id uuid;
  v_out_sku_id uuid;
  v_joined bigint;
BEGIN
  IF p_token IS NULL OR p_client_space_id IS NULL OR p_client_user_id IS NULL THEN
    RAISE EXCEPTION 'token, client_space_id and client_user_id are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_token_record
  FROM firm.client_invite_tokens
  WHERE token = p_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid client invite token'
      USING ERRCODE = '22023';
  END IF;

  IF v_token_record.is_active IS FALSE THEN
    RAISE EXCEPTION 'Client invite token is inactive'
      USING ERRCODE = '22023';
  END IF;

  IF v_token_record.expires_at IS NOT NULL AND v_token_record.expires_at <= v_now THEN
    RAISE EXCEPTION 'Client invite token has expired'
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::bigint INTO v_joined
  FROM firm.clients c
  WHERE c.invite_token_id = v_token_record.id;

  IF v_token_record.max_clients IS NOT NULL AND v_joined >= v_token_record.max_clients THEN
    RAISE EXCEPTION 'Client invite token has reached its maximum usage'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO firm.clients (firm_space_id, client_space_id, invite_token_id)
  VALUES (v_token_record.firm_space_id, p_client_space_id, v_token_record.id)
  ON CONFLICT (firm_space_id, client_space_id)
  DO UPDATE SET
    invite_token_id = COALESCE(firm.clients.invite_token_id, EXCLUDED.invite_token_id);

  INSERT INTO firm.clients_assignee (firm_space_id, user_id, client_space_id, created_at)
  VALUES (
    v_token_record.firm_space_id,
    v_token_record.inviter_user_id,
    p_client_space_id,
    v_now
  )
  ON CONFLICT (firm_space_id, user_id, client_space_id) WHERE (client_space_id IS NOT NULL)
  DO NOTHING;

  BEGIN
    INSERT INTO firm.orders (
      firm_space_id,
      client_space_id,
      sku_id,
      status,
      due_at,
      created_at,
      updated_at,
      created_by,
      invitee_client_id
    )
    VALUES (
      v_token_record.firm_space_id,
      p_client_space_id,
      v_token_record.sku_id,
      'onboarding',
      NULL,
      v_now,
      v_now,
      p_client_user_id,
      NULL
    )
    ON CONFLICT (firm_space_id, client_space_id, sku_id, status)
    DO NOTHING;
  EXCEPTION
    WHEN SQLSTATE '42P10' THEN
      BEGIN
        INSERT INTO firm.orders (
          firm_space_id,
          client_space_id,
          sku_id,
          status,
          due_at,
          created_at,
          updated_at,
          created_by,
          invitee_client_id
        )
        VALUES (
          v_token_record.firm_space_id,
          p_client_space_id,
          v_token_record.sku_id,
          'onboarding',
          NULL,
          v_now,
          v_now,
          p_client_user_id,
          NULL
        );
      EXCEPTION
        WHEN unique_violation THEN
          NULL;
      END;
  END;

  SELECT COUNT(*)::bigint INTO v_joined
  FROM firm.clients c
  WHERE c.invite_token_id = v_token_record.id;

  IF v_token_record.max_clients IS NOT NULL AND v_joined >= v_token_record.max_clients THEN
    UPDATE firm.client_invite_tokens t
    SET is_active = false
    WHERE t.id = v_token_record.id;
  END IF;

  v_out_firm_space_id  := v_token_record.firm_space_id;
  v_out_client_space_id := p_client_space_id;
  v_out_inviter_user_id := v_token_record.inviter_user_id;
  v_out_sku_id          := v_token_record.sku_id;
  firm_space_id         := v_out_firm_space_id;
  client_space_id       := v_out_client_space_id;
  inviter_user_id       := v_out_inviter_user_id;
  sku_id                := v_out_sku_id;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION firm.accept_client_invite_token(text, uuid, uuid) IS
  'Open invite: firm.clients (invite_token_id set), assignee, onboarding order; caps via COUNT(clients); may set token inactive.';

--------------------------------------------------------------------------------
-- 7) public.invitee_claim_engagement — 20260322120000_open_invite_skip_invitee_clients.sql
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.invitee_claim_engagement(
  p_invitee_client_id uuid,
  p_client_space_id uuid
)
RETURNS TABLE (client_space_id uuid, firm_space_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_uid uuid;
  v_email text;
  v_invitee_email text;
  v_firm_space_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT ic.firm_space_id, LOWER(TRIM(COALESCE(ic.invitee_email, '')))
  INTO v_firm_space_id, v_invitee_email
  FROM firm.invitee_clients ic
  WHERE ic.id = p_invitee_client_id;

  IF v_firm_space_id IS NULL THEN
    RAISE EXCEPTION 'Invitee not found';
  END IF;

  SELECT LOWER(TRIM(COALESCE(u.email, (SELECT email FROM auth.users WHERE id = v_uid LIMIT 1), '')))
  INTO v_email
  FROM public.users u
  WHERE u.id = v_uid
  LIMIT 1;
  v_email := COALESCE(v_email, '');

  IF v_email <> v_invitee_email THEN
    RAISE EXCEPTION 'This engagement is for a different email address';
  END IF;

  INSERT INTO firm.clients (firm_space_id, client_space_id)
  VALUES (v_firm_space_id, p_client_space_id)
  ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key DO NOTHING;

  UPDATE firm.invitee_clients
  SET clients_space_id = p_client_space_id, updated_at = now()
  WHERE id = p_invitee_client_id;

  UPDATE firm.clients_assignee
  SET client_space_id = p_client_space_id,
      invitee_client_id = NULL
  WHERE invitee_client_id = p_invitee_client_id;

  UPDATE firm.orders o
  SET client_space_id = p_client_space_id, updated_at = now()
  WHERE o.firm_space_id = v_firm_space_id
    AND o.invitee_client_id = p_invitee_client_id
    AND o.client_space_id IS NULL;

  UPDATE public.projects pr
  SET client_space_id = p_client_space_id, updated_at = now()
  WHERE pr.order_id IN (
    SELECT o.id FROM firm.orders o
    WHERE o.firm_space_id = v_firm_space_id
      AND o.invitee_client_id = p_invitee_client_id
      AND o.client_space_id = p_client_space_id
  );

  INSERT INTO public.user_spaces (space_id, user_id, is_admin)
  VALUES (p_client_space_id, v_uid, true)
  ON CONFLICT (space_id, user_id) DO UPDATE SET is_admin = true;

  RETURN QUERY SELECT p_client_space_id, v_firm_space_id;
END;
$$;

COMMENT ON FUNCTION public.invitee_claim_engagement(uuid, uuid) IS
  'Firm-created invitee: link client space, update invitee_clients.clients_space_id, migrate orders/projects, add user to client space.';

--------------------------------------------------------------------------------
-- 8) firm_create_client_on_behalf + firm_create_pending_order_for_invitee — 20250313341000
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.firm_create_client_on_behalf(uuid, text, text, text, uuid, boolean);

CREATE OR REPLACE FUNCTION public.firm_create_client_on_behalf(
  p_firm_space_id uuid,
  p_client_name text,
  p_contact_name text,
  p_contact_email text,
  p_sku_id uuid DEFAULT NULL,
  p_create_invitation boolean DEFAULT true
)
RETURNS TABLE (
  out_client_space_id uuid,
  out_invitation_id uuid,
  out_space_name text,
  out_invitee_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
#variable_conflict use_column
DECLARE
  v_caller_id uuid;
  v_space_name text;
  v_client_space_id uuid;
  v_invitation_id uuid;
  v_inviter_email text;
  v_inviter_name text;
  v_now timestamptz := now();
  v_normalized_name text;
  v_existing_space_id uuid;
  v_existing_invitation_id uuid;
  v_created_contact_name text := NULLIF(TRIM(p_contact_name), '');
  v_created_contact_email text := NULLIF(LOWER(TRIM(p_contact_email)), '');
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.space_id = p_firm_space_id AND us.user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Only firm members can create clients on behalf';
  END IF;

  v_space_name := COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, 'Client Space');
  v_normalized_name := LOWER(v_space_name);
  IF v_created_contact_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required';
  END IF;

  SELECT c.client_space_id INTO v_existing_space_id
  FROM firm.clients c
  JOIN public.spaces s ON s.id = c.client_space_id AND s.kind = 'consumer'
  WHERE c.firm_space_id = p_firm_space_id
    AND LOWER(TRIM(COALESCE(s.name, ''))) = v_normalized_name
  ORDER BY
    CASE WHEN EXISTS (
      SELECT 1 FROM public.space_invitations si
      WHERE si.space_id = c.client_space_id
        AND si.invitee_email = v_created_contact_email
        AND si.status = 'pending'
    ) THEN 0 ELSE 1 END,
    (SELECT COUNT(*) FROM public.user_spaces us WHERE us.space_id = c.client_space_id) ASC,
    c.created_at DESC
  LIMIT 1;

  IF v_existing_space_id IS NOT NULL THEN
    v_client_space_id := v_existing_space_id;
    UPDATE public.spaces SET name = v_space_name WHERE id = v_client_space_id;
    UPDATE firm.clients SET updated_at = v_now
    WHERE firm.clients.firm_space_id = p_firm_space_id AND firm.clients.client_space_id = v_client_space_id;
  ELSE
    INSERT INTO public.spaces (name, address, kind)
    VALUES (v_space_name, NULL, 'client')
    RETURNING id INTO v_client_space_id;

    INSERT INTO firm.clients (firm_space_id, client_space_id)
    VALUES (p_firm_space_id, v_client_space_id)
    ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key
    DO UPDATE SET updated_at = v_now;
  END IF;

  INSERT INTO firm.invitee_clients (
    firm_space_id,
    invitee_email,
    invitee_client_name,
    invitee_contact_name
  )
  VALUES (
    p_firm_space_id,
    v_created_contact_email,
    COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, v_space_name),
    v_created_contact_name
  )
  ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET
    invitee_client_name   = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
    invitee_contact_name  = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
    updated_at            = v_now;

  INSERT INTO firm.clients_assignee (firm_space_id, user_id, client_space_id, created_at)
  VALUES (p_firm_space_id, v_caller_id, v_client_space_id, v_now)
  ON CONFLICT (firm_space_id, user_id, client_space_id) WHERE (client_space_id IS NOT NULL) DO NOTHING;

  IF p_sku_id IS NOT NULL THEN
    INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by)
    VALUES (p_firm_space_id, v_client_space_id, p_sku_id, 'onboarding', NULL, v_now, v_now, v_caller_id)
    ON CONFLICT (firm_space_id, client_space_id, sku_id, status) DO NOTHING;
  END IF;

  SELECT u.name, COALESCE(u.email, (SELECT email FROM auth.users WHERE id = v_caller_id LIMIT 1))
  INTO v_inviter_name, v_inviter_email
  FROM public.users u
  WHERE u.id = v_caller_id
  LIMIT 1;
  v_inviter_email := COALESCE(v_inviter_email, '');
  v_inviter_name  := NULLIF(TRIM(v_inviter_name), '');

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'space_invitations') THEN
    SELECT si.id INTO v_existing_invitation_id
    FROM public.space_invitations si
    WHERE si.space_id = v_client_space_id
      AND si.invitee_email = v_created_contact_email
      AND si.status = 'pending'
    ORDER BY si.created_at DESC
    LIMIT 1;

    IF v_existing_invitation_id IS NOT NULL THEN
      v_invitation_id := v_existing_invitation_id;
    ELSIF p_create_invitation THEN
      INSERT INTO public.space_invitations (
        space_id, inviter_id, inviter_email, invitee_email, space_name, status, created_at, invite_as_admin, inviter_name
      )
      VALUES (
        v_client_space_id, v_caller_id, v_inviter_email, v_created_contact_email, v_space_name,
        'pending', v_now, true, v_inviter_name
      )
      RETURNING id INTO v_invitation_id;
    ELSE
      v_invitation_id := NULL;
    END IF;
  ELSE
    v_invitation_id := NULL;
  END IF;

  RETURN QUERY SELECT v_client_space_id, v_invitation_id, v_space_name, v_created_contact_email;
END;
$$;

COMMENT ON FUNCTION public.firm_create_client_on_behalf(uuid, text, text, text, uuid, boolean) IS
  'Firm create client space and link; name/contact from space + invitee_clients. Returns out_* columns to avoid PL/pgSQL ambiguity.';

DROP FUNCTION IF EXISTS public.firm_create_pending_order_for_invitee(uuid, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.firm_create_pending_order_for_invitee(
  p_firm_space_id uuid,
  p_client_name   text,
  p_contact_name  text,
  p_contact_email text,
  p_sku_id        uuid
)
RETURNS TABLE (
  out_order_id          uuid,
  out_firm_space_id      uuid,
  out_invitee_client_id uuid,
  out_invitee_email     text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
#variable_conflict use_column
DECLARE
  v_caller_id uuid;
  v_client_name   text;
  v_contact_name  text;
  v_contact_email text;
  v_invitee_id    uuid;
  v_now           timestamptz := now();
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.space_id = p_firm_space_id AND us.user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Only firm members can create pending orders';
  END IF;

  v_client_name   := NULLIF(TRIM(p_client_name), '');
  v_contact_name  := NULLIF(TRIM(p_contact_name), '');
  v_contact_email := NULLIF(LOWER(TRIM(p_contact_email)), '');

  IF v_contact_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required for pending orders';
  END IF;

  INSERT INTO firm.invitee_clients (
    firm_space_id,
    invitee_email,
    invitee_client_name,
    invitee_contact_name
  )
  VALUES (
    p_firm_space_id,
    v_contact_email,
    COALESCE(v_client_name, v_contact_name, 'Client'),
    v_contact_name
  )
  ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET
    invitee_client_name   = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
    invitee_contact_name  = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
    updated_at            = v_now;

  SELECT id INTO v_invitee_id
  FROM firm.invitee_clients ic
  WHERE ic.firm_space_id = p_firm_space_id AND ic.invitee_email = v_contact_email
  LIMIT 1;

  INSERT INTO firm.clients_assignee (firm_space_id, user_id, invitee_client_id)
  VALUES (p_firm_space_id, v_caller_id, v_invitee_id)
  ON CONFLICT (firm_space_id, invitee_client_id) WHERE (invitee_client_id IS NOT NULL)
  DO UPDATE SET user_id = v_caller_id;

  INSERT INTO firm.orders (
    firm_space_id,
    client_space_id,
    sku_id,
    status,
    due_at,
    created_at,
    updated_at,
    created_by,
    invitee_client_id
  )
  VALUES (
    p_firm_space_id,
    NULL,
    p_sku_id,
    'onboarding',
    NULL,
    v_now,
    v_now,
    v_caller_id,
    v_invitee_id
  );

  RETURN QUERY
  SELECT o.id, p_firm_space_id, v_invitee_id, v_contact_email
  FROM firm.orders o
  WHERE o.firm_space_id = p_firm_space_id
    AND o.invitee_client_id = v_invitee_id
    AND o.client_space_id IS NULL
  ORDER BY o.created_at DESC
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.firm_create_pending_order_for_invitee(uuid, text, text, text, uuid) IS
  'Firm: create pending order for invitee (Add client with template). Returns out_* to avoid firm_space_id ambiguity.';

--------------------------------------------------------------------------------
-- 9) public.firm_create_invitee_only — 20250313330000_invitee_clients_single_email_and_clients_space_id.sql
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.firm_create_invitee_only(
  p_firm_space_id   UUID,
  p_client_name    TEXT,
  p_contact_name   TEXT,
  p_contact_email  TEXT
)
RETURNS TABLE (invitee_client_id UUID, invitee_email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id UUID;
  v_contact_email TEXT;
  v_now TIMESTAMPTZ := now();
  v_invitee_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.space_id = p_firm_space_id AND us.user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Only firm members can add invitees';
  END IF;

  v_contact_email := NULLIF(LOWER(TRIM(COALESCE(p_contact_email, ''))), '');
  IF v_contact_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required';
  END IF;

  INSERT INTO firm.invitee_clients (
    firm_space_id,
    invitee_email,
    invitee_client_name,
    invitee_contact_name
  )
  VALUES (
    p_firm_space_id,
    v_contact_email,
    COALESCE(NULLIF(TRIM(p_client_name), ''), NULLIF(TRIM(p_contact_name), ''), 'Client'),
    NULLIF(TRIM(COALESCE(p_contact_name, '')), '')
  )
  ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET
    invitee_client_name   = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
    invitee_contact_name  = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
    updated_at            = v_now;

  SELECT ic.id INTO v_invitee_id
  FROM firm.invitee_clients ic
  WHERE ic.firm_space_id = p_firm_space_id AND ic.invitee_email = v_contact_email
  LIMIT 1;

  INSERT INTO firm.clients_assignee (firm_space_id, user_id, invitee_client_id)
  VALUES (p_firm_space_id, v_caller_id, v_invitee_id)
  ON CONFLICT (firm_space_id, invitee_client_id) WHERE (invitee_client_id IS NOT NULL)
  DO UPDATE SET user_id = EXCLUDED.user_id;

  RETURN QUERY
  SELECT ic.id, ic.invitee_email
  FROM firm.invitee_clients ic
  WHERE ic.firm_space_id = p_firm_space_id AND ic.invitee_email = v_contact_email
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.firm_create_invitee_only(UUID, TEXT, TEXT, TEXT) IS
  'Firm: create/update invitee_client only (no order). Used when Add client without SKU; client can later link space with empty SKU preview.';

--------------------------------------------------------------------------------
-- 10) public.create_space_with_user — 20250307000000_firm_firms_schema_and_migrate.sql (no Admin group bootstrap)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_space_with_user(
  p_space_name TEXT,
  p_space_address TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_kind TEXT DEFAULT 'consumer',
  p_firm_verification_url TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_user_id UUID;
  v_space_id UUID;
  v_kind TEXT;
  v_verification_url TEXT;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_kind := COALESCE(NULLIF(TRIM(LOWER(p_kind)), ''), 'client');
  IF v_kind NOT IN ('consumer', 'provider') THEN
    RAISE EXCEPTION 'kind must be consumer or provider';
  END IF;

  IF v_kind = 'provider' THEN
    IF p_firm_verification_url IS NULL OR TRIM(p_firm_verification_url) = '' THEN
      RAISE EXCEPTION 'Firm registration requires verification attachment URL';
    END IF;
    v_verification_url := TRIM(p_firm_verification_url);
  ELSE
    v_verification_url := NULL;
  END IF;

  INSERT INTO public.spaces (name, address, kind)
  VALUES (
    p_space_name,
    NULLIF(TRIM(p_space_address), ''),
    v_kind
  )
  RETURNING id INTO v_space_id;

  IF v_kind = 'provider' THEN
    INSERT INTO firm.firms (space_id, status, verification_attachment_url)
    VALUES (v_space_id, 'pending', v_verification_url);
  END IF;

  INSERT INTO public.user_spaces (user_id, space_id, is_admin)
  VALUES (v_user_id, v_space_id, true)
  ON CONFLICT DO NOTHING;

  UPDATE public.users
  SET current_space_id = v_space_id
  WHERE id = v_user_id;

  IF v_kind = 'provider' THEN
    PERFORM firm.apply_preset_skus_to_firm(v_space_id);
  END IF;

  RETURN v_space_id;
END;
$$;

COMMENT ON FUNCTION public.create_space_with_user(TEXT, TEXT, UUID, TEXT, TEXT) IS
  '创建空间并加入当前用户为管理员。kind=firm 时必传 p_firm_verification_url，写入 firm.firms 并复制 preset_skus';
