-- firm.clients.creator_user_id: who added the client; open-invite path = token inviter.
SET search_path = public, firm;

ALTER TABLE firm.clients
  ADD COLUMN IF NOT EXISTS creator_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN firm.clients.creator_user_id IS
  'User who created this client row. Open invite (invite_token_id): firm.client_invite_tokens.inviter_user_id. On-behalf / invitee-only / pending order: auth user who performed the RPC.';

CREATE INDEX IF NOT EXISTS idx_firm_clients_creator_user_id
  ON firm.clients (creator_user_id)
  WHERE creator_user_id IS NOT NULL;

UPDATE firm.clients c
SET creator_user_id = t.inviter_user_id
FROM firm.client_invite_tokens t
WHERE c.invite_token_id = t.id
  AND c.creator_user_id IS NULL;

--------------------------------------------------------------------------------
-- firm.accept_client_invite_token: set creator_user_id from token inviter
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
  v_order_id uuid;
  v_joined bigint;
BEGIN
  IF p_token IS NULL OR p_client_space_id IS NULL OR p_client_user_id IS NULL THEN
    RAISE EXCEPTION 'token, client_space_id and client_user_id are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_token_record
  FROM firm.client_invite_tokens
  WHERE token = p_token;

  IF NOT FOUND OR v_token_record.is_active IS FALSE THEN
    RAISE EXCEPTION 'Invalid or inactive client invite token' USING ERRCODE = '22023';
  END IF;

  IF v_token_record.expires_at IS NOT NULL AND v_token_record.expires_at <= v_now THEN
    RAISE EXCEPTION 'Client invite token has expired' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::bigint INTO v_joined
  FROM firm.clients c
  WHERE c.invite_token_id = v_token_record.id;

  IF v_token_record.max_clients IS NOT NULL AND v_joined >= v_token_record.max_clients THEN
    RAISE EXCEPTION 'Client invite token has reached its maximum usage' USING ERRCODE = '22023';
  END IF;

  INSERT INTO firm.clients (firm_space_id, client_space_id, invite_token_id, creator_user_id)
  VALUES (v_token_record.firm_space_id, p_client_space_id, v_token_record.id, v_token_record.inviter_user_id)
  ON CONFLICT (firm_space_id, client_space_id)
  DO UPDATE SET
    invite_token_id = COALESCE(firm.clients.invite_token_id, EXCLUDED.invite_token_id),
    creator_user_id = COALESCE(firm.clients.creator_user_id, EXCLUDED.creator_user_id);

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
  DO UPDATE SET updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_order_id;

  INSERT INTO firm.order_managers (firm_space_id, manager_user_id, order_id, created_at)
  VALUES (v_token_record.firm_space_id, v_token_record.inviter_user_id, v_order_id, v_now)
  ON CONFLICT (order_id) DO UPDATE
  SET manager_user_id = EXCLUDED.manager_user_id;

  SELECT COUNT(*)::bigint INTO v_joined
  FROM firm.clients c
  WHERE c.invite_token_id = v_token_record.id;

  IF v_token_record.max_clients IS NOT NULL AND v_joined >= v_token_record.max_clients THEN
    UPDATE firm.client_invite_tokens t
    SET is_active = false
    WHERE t.id = v_token_record.id;
  END IF;

  RETURN QUERY
  SELECT v_token_record.firm_space_id, p_client_space_id, v_token_record.inviter_user_id, v_token_record.sku_id;
END;
$$;

--------------------------------------------------------------------------------
-- firm_create_invitee_only
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.firm_create_invitee_only(
  p_firm_space_id uuid,
  p_client_name text,
  p_contact_name text,
  p_contact_email text
)
RETURNS TABLE (invitee_client_id uuid, invitee_email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id uuid;
  v_contact_email text;
  v_now timestamptz := now();
  v_id uuid;
  v_name text;
  v_contact text;
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

  v_name := COALESCE(NULLIF(TRIM(p_client_name), ''), NULLIF(TRIM(p_contact_name), ''), 'Client');
  v_contact := NULLIF(TRIM(COALESCE(p_contact_name, '')), '');

  SELECT c.id INTO v_id
  FROM firm.clients c
  WHERE c.firm_space_id = p_firm_space_id
    AND c.client_space_id IS NULL
    AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = v_contact_email
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO firm.clients (
      firm_space_id,
      client_space_id,
      invitee_email,
      invitee_client_name,
      invitee_contact_name,
      creator_user_id,
      created_at,
      updated_at
    )
    VALUES (
      p_firm_space_id,
      NULL,
      v_contact_email,
      v_name,
      v_contact,
      v_caller_id,
      v_now,
      v_now
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE firm.clients
    SET
      invitee_client_name = COALESCE(v_name, invitee_client_name),
      invitee_contact_name = COALESCE(v_contact, invitee_contact_name),
      updated_at = v_now
    WHERE id = v_id;
  END IF;

  RETURN QUERY
  SELECT v_id, v_contact_email::text;
END;
$$;

--------------------------------------------------------------------------------
-- firm_create_pending_order_for_invitee
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.firm_create_pending_order_for_invitee(
  p_firm_space_id uuid,
  p_client_name text,
  p_contact_name text,
  p_contact_email text,
  p_sku_id uuid
)
RETURNS TABLE (
  order_id uuid,
  firm_space_id uuid,
  invitee_client_id uuid,
  invitee_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id uuid;
  v_client_name text;
  v_contact_name text;
  v_contact_email text;
  v_invitee_id uuid;
  v_order_id uuid;
  v_now timestamptz := now();
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

  v_client_name := NULLIF(TRIM(p_client_name), '');
  v_contact_name := NULLIF(TRIM(p_contact_name), '');
  v_contact_email := NULLIF(LOWER(TRIM(p_contact_email)), '');
  IF v_contact_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required for pending orders';
  END IF;

  SELECT c.id INTO v_invitee_id
  FROM firm.clients c
  WHERE c.firm_space_id = p_firm_space_id
    AND c.client_space_id IS NULL
    AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = v_contact_email
  LIMIT 1;

  IF v_invitee_id IS NULL THEN
    INSERT INTO firm.clients (
      firm_space_id,
      client_space_id,
      invitee_email,
      invitee_client_name,
      invitee_contact_name,
      creator_user_id,
      created_at,
      updated_at
    )
    VALUES (
      p_firm_space_id,
      NULL,
      v_contact_email,
      COALESCE(v_client_name, v_contact_name, 'Client'),
      v_contact_name,
      v_caller_id,
      v_now,
      v_now
    )
    RETURNING id INTO v_invitee_id;
  ELSE
    UPDATE firm.clients
    SET
      invitee_client_name = COALESCE(v_client_name, invitee_client_name),
      invitee_contact_name = COALESCE(v_contact_name, invitee_contact_name),
      updated_at = v_now
    WHERE id = v_invitee_id;
  END IF;

  INSERT INTO firm.orders (
    firm_space_id,
    client_space_id,
    sku_id,
    status,
    due_at,
    created_at,
    updated_at,
    created_by,
    invitee_client_id,
    client_id
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
    v_invitee_id,
    v_invitee_id
  )
  RETURNING id INTO v_order_id;

  RETURN QUERY
  SELECT v_order_id, p_firm_space_id, v_invitee_id, v_contact_email;
END;
$$;

--------------------------------------------------------------------------------
-- firm_create_client_on_behalf
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.firm_create_client_on_behalf(
  p_firm_space_id uuid,
  p_client_name text,
  p_contact_name text,
  p_contact_email text,
  p_sku_id uuid DEFAULT NULL,
  p_create_invitation boolean DEFAULT true
)
RETURNS TABLE (
  client_space_id uuid,
  invitation_id uuid,
  space_name text,
  invitee_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id uuid;
  v_space_name text;
  v_client_space_id uuid;
  v_invitation_id uuid;
  v_inviter_email text;
  v_inviter_name text;
  v_now timestamptz := now();
  v_created_contact_name text := NULLIF(TRIM(p_contact_name), '');
  v_created_contact_email text := NULLIF(LOWER(TRIM(p_contact_email)), '');
  v_order_id uuid;
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

  IF v_created_contact_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required';
  END IF;

  v_space_name := COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, 'Client Space');

  INSERT INTO public.spaces (name, address, kind)
  VALUES (v_space_name, NULL, 'client')
  RETURNING id INTO v_client_space_id;

  INSERT INTO firm.clients (
    firm_space_id,
    client_space_id,
    invitee_email,
    invitee_client_name,
    invitee_contact_name,
    creator_user_id,
    created_at,
    updated_at
  )
  VALUES (
    p_firm_space_id,
    v_client_space_id,
    v_created_contact_email,
    COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, v_space_name),
    v_created_contact_name,
    v_caller_id,
    v_now,
    v_now
  )
  ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key DO UPDATE SET
    invitee_email = COALESCE(EXCLUDED.invitee_email, firm.clients.invitee_email),
    invitee_client_name = COALESCE(EXCLUDED.invitee_client_name, firm.clients.invitee_client_name),
    invitee_contact_name = COALESCE(EXCLUDED.invitee_contact_name, firm.clients.invitee_contact_name),
    creator_user_id = COALESCE(firm.clients.creator_user_id, EXCLUDED.creator_user_id),
    updated_at = v_now;

  IF p_sku_id IS NOT NULL THEN
    INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by)
    VALUES (p_firm_space_id, v_client_space_id, p_sku_id, 'onboarding', NULL, v_now, v_now, v_caller_id)
    ON CONFLICT (firm_space_id, client_space_id, sku_id, status)
    DO UPDATE SET updated_at = EXCLUDED.updated_at
    RETURNING id INTO v_order_id;

    INSERT INTO firm.order_managers (firm_space_id, manager_user_id, order_id, created_at)
    VALUES (p_firm_space_id, v_caller_id, v_order_id, v_now)
    ON CONFLICT (order_id) DO NOTHING;
  END IF;

  SELECT u.name, COALESCE(u.email, (SELECT email FROM auth.users WHERE id = v_caller_id LIMIT 1))
  INTO v_inviter_name, v_inviter_email
  FROM public.users u
  WHERE u.id = v_caller_id
  LIMIT 1;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'space_invitations'
  ) AND p_create_invitation THEN
    INSERT INTO public.space_invitations (
      space_id, inviter_id, inviter_email, invitee_email, space_name, status, created_at, invite_as_admin, inviter_name
    )
    VALUES (
      v_client_space_id, v_caller_id, COALESCE(v_inviter_email, ''), v_created_contact_email, v_space_name,
      'pending', v_now, true, NULLIF(TRIM(v_inviter_name), '')
    )
    RETURNING id INTO v_invitation_id;
  ELSE
    v_invitation_id := NULL;
  END IF;

  RETURN QUERY SELECT v_client_space_id, v_invitation_id, v_space_name, v_created_contact_email;
END;
$$;
