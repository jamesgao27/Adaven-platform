-- Phase B-2: ensure new orders (and projects via order linkage) carry invitee_client_id
-- for both:
--   - public.firm_create_client_on_behalf (代建路径)
--   - firm.accept_client_invite_token      (开放邀请路径)
--
-- Existing behaviour (space/client/order creation) is preserved; we only:
--   - look up / upsert firm.invitee_clients
--   - set orders.invitee_client_id when inserting new orders

SET search_path = public, firm;

-- 1) public.firm_create_client_on_behalf: write orders.invitee_client_id
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

  -- Fetch invitee_client_id for use on orders
  SELECT id INTO v_invitee_id
  FROM firm.invitee_clients
  WHERE firm_space_id = p_firm_space_id
    AND invitee_email = v_created_contact_email
  LIMIT 1;

  INSERT INTO firm.member_clients (firm_space_id, user_id, client_space_id, created_at)
  VALUES (p_firm_space_id, v_caller_id, v_client_space_id, v_now)
  ON CONFLICT ON CONSTRAINT member_clients_firm_space_id_user_id_client_space_id_key DO NOTHING;

  IF p_sku_id IS NOT NULL THEN
    INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by, invitee_client_id)
    VALUES (p_firm_space_id, v_client_space_id, p_sku_id, 'onboarding', NULL, v_now, v_now, v_caller_id, v_invitee_id)
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
  'Firm 代建 client 空间：同一 firm 同一组织名复用已有 client space；写入 created_client_name/created_contact_* 与 invitee_clients，并为新订单设置 invitee_client_id。';


-- 2) firm.accept_client_invite_token: write orders.invitee_client_id based on accepter email
SET search_path = firm, public;

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

  SELECT *
  INTO v_token_record
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

  IF v_token_record.expires_at IS NOT NULL
     AND v_token_record.expires_at <= v_now THEN
    RAISE EXCEPTION 'Client invite token has expired'
      USING ERRCODE = '22023';
  END IF;

  IF v_token_record.max_clients IS NOT NULL
     AND v_token_record.current_clients >= v_token_record.max_clients THEN
    RAISE EXCEPTION 'Client invite token has reached its maximum usage'
      USING ERRCODE = '22023';
  END IF;

  -- Client self-set name: space name or accepter name
  SELECT COALESCE(
    NULLIF(TRIM((SELECT s.name FROM public.spaces s WHERE s.id = p_client_space_id)), ''),
    NULLIF(TRIM((SELECT u.name FROM public.users u WHERE u.id = p_client_user_id)), '')
  ) INTO v_client_name;

  -- Upsert clients as before
  INSERT INTO firm.clients (firm_space_id, client_space_id, status, created_client_name)
  VALUES (
    v_token_record.firm_space_id,
    p_client_space_id,
    'active',
    v_client_name
  )
  ON CONFLICT (firm_space_id, client_space_id)
  DO UPDATE SET
    status = 'active',
    created_client_name = COALESCE(NULLIF(TRIM(firm.clients.created_client_name), ''), EXCLUDED.created_client_name);

  INSERT INTO firm.member_clients (firm_space_id, user_id, client_space_id, created_at)
  VALUES (
    v_token_record.firm_space_id,
    v_token_record.inviter_user_id,
    p_client_space_id,
    v_now
  )
  ON CONFLICT (firm_space_id, user_id, client_space_id)
  DO NOTHING;

  -- Derive invitee_email from accepter and upsert invitee_clients
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
      invitee_contact_name,
      invitee_contact_email
    )
    VALUES (
      v_token_record.firm_space_id,
      v_invitee_email,
      v_client_name,
      NULL,
      v_invitee_email
    )
    ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET
      invitee_client_name   = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
      invitee_contact_name  = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
      invitee_contact_email = COALESCE(EXCLUDED.invitee_contact_email, firm.invitee_clients.invitee_contact_email),
      updated_at            = v_now;

    SELECT id INTO v_invitee_id
    FROM firm.invitee_clients
    WHERE firm_space_id = v_token_record.firm_space_id
      AND invitee_email = v_invitee_email
    LIMIT 1;
  ELSE
    v_invitee_id := NULL;
  END IF;

  -- Create onboarding order (with invitee_client_id) as before
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

COMMENT ON FUNCTION firm.accept_client_invite_token(text, uuid, uuid) IS
  '开放邀请：消费 client_invite token，为指定 client_space 建立 firm.clients + firm.orders 记录，并在 orders.invitee_client_id 关联 invitee_clients。';

