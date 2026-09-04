-- invitee_clients: 只保留 invitee_email，删除重复列 invitee_contact_email；新增 clients_space_id 用于认领时记录真实 client space。
SET search_path = public, firm;

-- 1) 新增 clients_space_id：客户认领时填入认领的 client space id，便于后续查对
ALTER TABLE firm.invitee_clients
  ADD COLUMN IF NOT EXISTS clients_space_id UUID;

COMMENT ON COLUMN firm.invitee_clients.clients_space_id IS
  'When client claims: the claimed client space id; for later lookup/verification.';

-- 2) 删除重复列 invitee_contact_email（与 invitee_email 重复，仅保留 invitee_email）
ALTER TABLE firm.invitee_clients
  DROP COLUMN IF EXISTS invitee_contact_email;

--------------------------------------------------------------------------------
-- 3) 重写依赖 invitee_contact_email 的函数，统一使用 invitee_email；认领时写入 clients_space_id
--------------------------------------------------------------------------------

-- get_pending_invitees_for_email: 返回类型变更，需先 DROP 再 CREATE
DROP FUNCTION IF EXISTS public.get_pending_invitees_for_email(text);

CREATE OR REPLACE FUNCTION public.get_pending_invitees_for_email(p_email text)
RETURNS TABLE (
  firm_space_id uuid,
  firm_name text,
  invitee_client_id uuid,
  invitee_client_name text,
  invitee_email text,
  sku_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, firm
STABLE
AS $$
  SELECT
    ic.firm_space_id,
    s.name AS firm_name,
    ic.id AS invitee_client_id,
    ic.invitee_client_name,
    ic.invitee_email,
    (SELECT o.sku_id FROM firm.orders o
     WHERE o.firm_space_id = ic.firm_space_id
       AND o.invitee_client_id = ic.id
       AND o.client_space_id IS NULL
     LIMIT 1) AS sku_id
  FROM firm.invitee_clients ic
  JOIN public.spaces s ON s.id = ic.firm_space_id
  WHERE LOWER(TRIM(COALESCE(ic.invitee_email, ''))) = LOWER(TRIM(COALESCE(p_email, '')))
    AND (
      EXISTS (
        SELECT 1 FROM firm.orders o
        WHERE o.firm_space_id = ic.firm_space_id
          AND o.invitee_client_id = ic.id
          AND o.client_space_id IS NULL
      )
      OR NOT EXISTS (
        SELECT 1 FROM firm.orders o
        WHERE o.firm_space_id = ic.firm_space_id
          AND o.invitee_client_id = ic.id
      )
    );
$$;

COMMENT ON FUNCTION public.get_pending_invitees_for_email(text) IS
  'Client by email: pending invitees (with or without pending orders). With orders: sku_id for preview; without: sku_id null, still show "link space with [Firm]".';

-- invitee_claim_engagement: 使用 invitee_email 校验；认领成功后更新 invitee_clients.clients_space_id
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

  INSERT INTO firm.clients (firm_space_id, client_space_id, status)
  VALUES (v_firm_space_id, p_client_space_id, 'active')
  ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key DO NOTHING;

  -- 认领时记录真实 client space 到 invitee_clients，便于后续查对
  UPDATE firm.invitee_clients
  SET clients_space_id = p_client_space_id, updated_at = now()
  WHERE id = p_invitee_client_id;

  -- 将 clients_assignee 中该 invitee 行改为 client 行（assignee 迁移）
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
  'Client claim: link space to firm. Writes invitee_clients.clients_space_id, migrates assignee and orders.';

-- firm_create_invitee_only: 不再写入 invitee_contact_email，返回 invitee_email
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

-- firm_create_pending_order_for_invitee: 不再写入 invitee_contact_email
CREATE OR REPLACE FUNCTION public.firm_create_pending_order_for_invitee(
  p_firm_space_id UUID,
  p_client_name   TEXT,
  p_contact_name  TEXT,
  p_contact_email TEXT,
  p_sku_id        UUID
)
RETURNS TABLE (
  order_id         UUID,
  firm_space_id    UUID,
  invitee_client_id UUID,
  invitee_email    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id UUID;
  v_client_name   TEXT;
  v_contact_name  TEXT;
  v_contact_email TEXT;
  v_invitee_id    UUID;
  v_now           TIMESTAMPTZ := now();
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
  FROM firm.invitee_clients
  WHERE firm_space_id = p_firm_space_id AND invitee_email = v_contact_email
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

-- firm.accept_client_invite_token: invitee_clients 只写 invitee_email，不写 invitee_contact_email
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

-- public.firm_create_client_on_behalf: invitee_clients 只写 invitee_email（返回类型未变，但 OUT 行类型可能被判定不同，先 DROP）
DROP FUNCTION IF EXISTS public.firm_create_client_on_behalf(uuid, text, text, text, uuid);

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

  -- Upsert invitee_clients for this firm + invitee_email (no invitee_contact_email column)
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

  -- Member mapping (clients_assignee) and order creation
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
