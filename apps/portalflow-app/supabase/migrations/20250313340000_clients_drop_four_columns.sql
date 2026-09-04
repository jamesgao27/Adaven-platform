-- Drop firm.clients columns: created_client_name, created_contact_name, created_contact_email, status.
-- 代建已取消，客户信息来自 invitee_clients 或 space；先重写引用这些列的 RPC，再删列。
SET search_path = public, firm;

-- 1) invitee_claim_engagement: INSERT clients 仅 (firm_space_id, client_space_id)
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
    AND o.invitee_client_id = p_invitee_client_id;

  RETURN QUERY SELECT p_client_space_id, v_firm_space_id;
END;
$$;

-- 2) firm.accept_client_invite_token: INSERT clients 仅 (firm_space_id, client_space_id)，其余逻辑同前
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
  v_client_name text;
  v_out_firm_space_id uuid;
  v_out_client_space_id uuid;
  v_out_inviter_user_id uuid;
  v_out_sku_id uuid;
  v_invitee_email text;
  v_invitee_id uuid;
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

  IF v_token_record.max_clients IS NOT NULL
     AND v_token_record.current_clients >= v_token_record.max_clients THEN
    RAISE EXCEPTION 'Client invite token has reached its maximum usage'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    NULLIF(TRIM((SELECT s.name FROM public.spaces s WHERE s.id = p_client_space_id)), ''),
    NULLIF(TRIM((SELECT u.name FROM public.users u WHERE u.id = p_client_user_id)), '')
  ) INTO v_client_name;

  INSERT INTO firm.clients (firm_space_id, client_space_id)
  VALUES (v_token_record.firm_space_id, p_client_space_id)
  ON CONFLICT (firm_space_id, client_space_id) DO NOTHING;

  INSERT INTO firm.clients_assignee (firm_space_id, user_id, client_space_id, created_at)
  VALUES (
    v_token_record.firm_space_id,
    v_token_record.inviter_user_id,
    p_client_space_id,
    v_now
  )
  ON CONFLICT (firm_space_id, user_id, client_space_id) WHERE (client_space_id IS NOT NULL)
  DO NOTHING;

  SELECT LOWER(TRIM(COALESCE(u.email, au.email)))
  INTO v_invitee_email
  FROM public.users u
  LEFT JOIN auth.users au ON au.id = u.id
  WHERE u.id = p_client_user_id
  LIMIT 1;

  IF v_invitee_email IS NOT NULL AND v_invitee_email <> '' THEN
    INSERT INTO firm.invitee_clients (
      firm_space_id,
      invitee_email,
      invitee_client_name,
      invitee_contact_name
    )
    VALUES (
      v_token_record.firm_space_id,
      v_invitee_email,
      v_client_name,
      NULL
    )
    ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET
      invitee_client_name   = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
      invitee_contact_name  = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
      updated_at            = v_now;

    SELECT id INTO v_invitee_id
    FROM firm.invitee_clients
    WHERE firm_space_id = v_token_record.firm_space_id AND invitee_email = v_invitee_email
    LIMIT 1;

    IF v_invitee_id IS NOT NULL THEN
      INSERT INTO firm.clients_assignee (firm_space_id, user_id, invitee_client_id)
      VALUES (v_token_record.firm_space_id, v_token_record.inviter_user_id, v_invitee_id)
      ON CONFLICT (firm_space_id, invitee_client_id) WHERE (invitee_client_id IS NOT NULL)
      DO UPDATE SET user_id = v_token_record.inviter_user_id;
    END IF;
  ELSE
    v_invitee_id := NULL;
  END IF;

  BEGIN
    INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by, invitee_client_id)
    VALUES (
      v_token_record.firm_space_id,
      p_client_space_id,
      v_token_record.sku_id,
      'onboarding',
      NULL,
      v_now,
      v_now,
      p_client_user_id,
      v_invitee_id
    )
    ON CONFLICT (firm_space_id, client_space_id, sku_id, status)
    DO NOTHING;
  EXCEPTION
    WHEN SQLSTATE '42P10' THEN
      BEGIN
        INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by, invitee_client_id)
        VALUES (
          v_token_record.firm_space_id,
          p_client_space_id,
          v_token_record.sku_id,
          'onboarding',
          NULL,
          v_now,
          v_now,
          p_client_user_id,
          v_invitee_id
        );
      EXCEPTION
        WHEN unique_violation THEN
          NULL;
      END;
  END;

  UPDATE firm.client_invite_tokens cit
  SET current_clients = cit.current_clients + 1,
      is_active = CASE
        WHEN cit.max_clients IS NOT NULL AND cit.current_clients + 1 >= cit.max_clients THEN FALSE
        ELSE cit.is_active
      END
  WHERE cit.id = v_token_record.id;

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

-- 3) firm_create_client_on_behalf: 查找/创建 client 行仅 (firm_space_id, client_space_id)，名称存 space + invitee_clients
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

  -- Find existing client by space name (spaces.name) under this firm
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
    WHERE firm_space_id = p_firm_space_id AND client_space_id = v_client_space_id;
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
  'Firm create client space and link; name/contact from space + invitee_clients.';

-- 4) Drop columns
ALTER TABLE firm.clients DROP COLUMN IF EXISTS created_client_name;
ALTER TABLE firm.clients DROP COLUMN IF EXISTS created_contact_name;
ALTER TABLE firm.clients DROP COLUMN IF EXISTS created_contact_email;
ALTER TABLE firm.clients DROP COLUMN IF EXISTS status;
