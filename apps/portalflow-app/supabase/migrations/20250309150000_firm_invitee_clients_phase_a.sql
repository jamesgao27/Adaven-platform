-- Phase A: introduce firm.invitee_clients as the canonical place to store
-- invitee-level metadata (name/email) per firm, without changing existing
-- firm.clients / orders / projects behaviour.
--
-- 1) Create firm.invitee_clients
-- 2) Backfill from existing firm.clients.created_* fields
-- 3) Update firm_create_client_on_behalf to upsert invitee_clients
-- 4) Update firm.accept_client_invite_token to upsert invitee_clients

SET search_path = firm, public;

-- 1) Table: firm.invitee_clients
CREATE TABLE IF NOT EXISTS firm.invitee_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_space_id UUID NOT NULL,
  -- invitee identity (unique per firm before client space exists)
  invitee_email TEXT NOT NULL,
  invitee_client_name TEXT,
  invitee_contact_name TEXT,
  invitee_contact_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- simple uniqueness: one invitee email per firm; we always lower/trim on write
CREATE UNIQUE INDEX IF NOT EXISTS invitee_clients_firm_email_key
  ON firm.invitee_clients (firm_space_id, invitee_email);

COMMENT ON TABLE firm.invitee_clients IS
  'Per-firm invitee (client/contact) identity before/alongside client spaces; keyed by (firm_space_id, invitee_email).';

COMMENT ON COLUMN firm.invitee_clients.invitee_client_name IS
  'Client/org name as entered when creating (was firm.clients.created_client_name).';

COMMENT ON COLUMN firm.invitee_clients.invitee_contact_name IS
  'Contact name as entered when creating (was firm.clients.created_contact_name).';

COMMENT ON COLUMN firm.invitee_clients.invitee_contact_email IS
  'Contact email as entered when creating (was firm.clients.created_contact_email).';

ALTER TABLE firm.invitee_clients ENABLE ROW LEVEL SECURITY;

-- Firm members of the firm_space may see/update their own invitee_clients rows.
CREATE POLICY invitee_clients_select_firm_members ON firm.invitee_clients
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid() AND us.space_id = firm.invitee_clients.firm_space_id
    )
  );

CREATE POLICY invitee_clients_insert_firm_members ON firm.invitee_clients
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid() AND us.space_id = firm.invitee_clients.firm_space_id
    )
  );

CREATE POLICY invitee_clients_update_firm_members ON firm.invitee_clients
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid() AND us.space_id = firm.invitee_clients.firm_space_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid() AND us.space_id = firm.invitee_clients.firm_space_id
    )
  );

COMMENT ON POLICY invitee_clients_select_firm_members ON firm.invitee_clients IS
  'Firm members of firm_space_id can read their invitee_clients rows.';

COMMENT ON POLICY invitee_clients_insert_firm_members ON firm.invitee_clients IS
  'Firm members of firm_space_id can insert invitee_clients rows.';

COMMENT ON POLICY invitee_clients_update_firm_members ON firm.invitee_clients IS
  'Firm members of firm_space_id can update their invitee_clients rows.';

GRANT SELECT, INSERT, UPDATE ON firm.invitee_clients TO authenticated;

-- 2) Backfill from existing firm.clients.*created_* (idempotent upsert)
INSERT INTO firm.invitee_clients (
  firm_space_id,
  invitee_email,
  invitee_client_name,
  invitee_contact_name,
  invitee_contact_email
)
SELECT
  c.firm_space_id,
  LOWER(TRIM(c.created_contact_email)) AS invitee_email,
  c.created_client_name AS invitee_client_name,
  c.created_contact_name AS invitee_contact_name,
  c.created_contact_email AS invitee_contact_email
FROM firm.clients c
WHERE c.created_contact_email IS NOT NULL
  AND TRIM(c.created_contact_email) <> ''
ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET
  invitee_client_name   = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
  invitee_contact_name  = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
  invitee_contact_email = COALESCE(EXCLUDED.invitee_contact_email, firm.invitee_clients.invitee_contact_email),
  updated_at            = now();


-- 3) Update public.firm_create_client_on_behalf to also upsert invitee_clients
SET search_path = public, firm;

CREATE OR REPLACE FUNCTION public.firm_create_client_on_behalf(
  p_firm_space_id UUID,
  p_client_name TEXT,
  p_contact_name TEXT,
  p_contact_email TEXT,
  p_sku_id UUID DEFAULT NULL
)
RETURNS TABLE (
  client_space_id UUID,
  invitation_id UUID,
  space_name TEXT,
  invitee_email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id UUID;
  v_space_name TEXT;
  v_client_space_id UUID;
  v_invitation_id UUID;
  v_inviter_email TEXT;
  v_inviter_name TEXT;
  v_now TIMESTAMPTZ := now();
  v_normalized_name TEXT;
  v_existing_space_id UUID;
  v_existing_invitation_id UUID;
  v_created_contact_name TEXT := NULLIF(TRIM(p_contact_name), '');
  v_created_contact_email TEXT := NULLIF(LOWER(TRIM(p_contact_email)), '');
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
    AND LOWER(TRIM(COALESCE(c.created_client_name, ''))) = v_normalized_name
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

    UPDATE firm.clients
    SET created_client_name = COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, created_client_name),
        created_contact_name = COALESCE(v_created_contact_name, created_contact_name),
        created_contact_email = COALESCE(v_created_contact_email, created_contact_email),
        updated_at = v_now
    WHERE firm_space_id = p_firm_space_id AND client_space_id = v_client_space_id;
  ELSE
    INSERT INTO public.spaces (name, address, kind)
    VALUES (v_space_name, NULL, 'client')
    RETURNING id INTO v_client_space_id;

    INSERT INTO firm.clients (firm_space_id, client_space_id, status, created_client_name, created_contact_name, created_contact_email)
    VALUES (
      p_firm_space_id,
      v_client_space_id,
      'active',
      COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, v_space_name),
      v_created_contact_name,
      v_created_contact_email
    )
    ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key
    DO UPDATE SET
      created_client_name = COALESCE(NULLIF(TRIM(EXCLUDED.created_client_name), ''), firm.clients.created_client_name),
      created_contact_name = COALESCE(EXCLUDED.created_contact_name, firm.clients.created_contact_name),
      created_contact_email = COALESCE(EXCLUDED.created_contact_email, firm.clients.created_contact_email),
      status = 'active',
      updated_at = v_now;
  END IF;

  -- Upsert invitee_clients for this firm + invitee_email
  INSERT INTO firm.invitee_clients (
    firm_space_id,
    invitee_email,
    invitee_client_name,
    invitee_contact_name,
    invitee_contact_email
  )
  VALUES (
    p_firm_space_id,
    v_created_contact_email,
    COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, v_space_name),
    v_created_contact_name,
    v_created_contact_email
  )
  ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET
    invitee_client_name   = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
    invitee_contact_name  = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
    invitee_contact_email = COALESCE(EXCLUDED.invitee_contact_email, firm.invitee_clients.invitee_contact_email),
    updated_at            = v_now;

  -- Member mapping and order creation remain unchanged
  INSERT INTO firm.member_clients (firm_space_id, user_id, client_space_id, created_at)
  VALUES (p_firm_space_id, v_caller_id, v_client_space_id, v_now)
  ON CONFLICT ON CONSTRAINT member_clients_firm_space_id_user_id_client_space_id_key DO NOTHING;

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
    ELSE
      INSERT INTO public.space_invitations (
        space_id, inviter_id, inviter_email, invitee_email, space_name, status, created_at, invite_as_admin, inviter_name
      )
      VALUES (
        v_client_space_id, v_caller_id, v_inviter_email, v_created_contact_email, v_space_name,
        'pending', v_now, true, v_inviter_name
      )
      RETURNING id INTO v_invitation_id;
    END IF;
  ELSE
    v_invitation_id := NULL;
  END IF;

  RETURN QUERY SELECT v_client_space_id, v_invitation_id, v_space_name, v_created_contact_email;
END;
$$;

COMMENT ON FUNCTION public.firm_create_client_on_behalf(UUID, TEXT, TEXT, TEXT, UUID) IS
  'Firm 代建 client 空间：同一 firm 同一组织名复用已有 client space；写入 created_client_name/created_contact_* 与 invitee_clients 供列表与后续迁移使用';


