-- Assignee 统一用 firm.clients_assignee（表由 member_clients 重命名）：client 用 client_space_id，invitee 用 invitee_client_id
-- 规则：手动添加 assignee=操作者；开放邀请 assignee=token 创建者；认领时该行 client_space_id 填入、invitee_client_id 置空
SET search_path = public, firm;

-- 1) 若之前建过 invitee_assignees，删除（合并到 clients_assignee）
DROP TABLE IF EXISTS firm.invitee_assignees CASCADE;

-- 2) 若之前加过 assignee_id 列，删除
ALTER TABLE firm.invitee_clients DROP COLUMN IF EXISTS assignee_id;

-- 3) 表重命名：member_clients -> clients_assignee
ALTER TABLE firm.member_clients RENAME TO clients_assignee;

COMMENT ON TABLE firm.clients_assignee IS 'Firm 端：客户/Invitee 负责人关系（client 行用 client_space_id，invitee 行用 invitee_client_id，认领时同一行迁移）';

-- 4) 扩展 clients_assignee：支持 invitee（client_space_id 为空时用 invitee_client_id）
ALTER TABLE firm.clients_assignee
  ADD COLUMN IF NOT EXISTS invitee_client_id UUID REFERENCES firm.invitee_clients(id) ON DELETE CASCADE;

ALTER TABLE firm.clients_assignee
  ALTER COLUMN client_space_id DROP NOT NULL;

ALTER TABLE firm.clients_assignee
  ADD CONSTRAINT clients_assignee_client_or_invitee CHECK (
    (client_space_id IS NOT NULL AND invitee_client_id IS NULL)
    OR (client_space_id IS NULL AND invitee_client_id IS NOT NULL)
  );

COMMENT ON COLUMN firm.clients_assignee.invitee_client_id IS 'Invitee 负责人：仅当 client_space_id 为空时使用；认领后迁移为 client_space_id 并置空';

-- 原唯一约束（client 行）；改为部分唯一索引以便与 invitee 行共存
ALTER TABLE firm.clients_assignee DROP CONSTRAINT IF EXISTS member_clients_firm_space_id_user_id_client_space_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS clients_assignee_client_key
  ON firm.clients_assignee (firm_space_id, user_id, client_space_id)
  WHERE client_space_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS clients_assignee_invitee_key
  ON firm.clients_assignee (firm_space_id, invitee_client_id)
  WHERE invitee_client_id IS NOT NULL;

--------------------------------------------------------------------------------
-- 5) firm_create_invitee_only: 写入 clients_assignee（firm_space_id, user_id, invitee_client_id）
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
    invitee_contact_name,
    invitee_contact_email
  )
  VALUES (
    p_firm_space_id,
    v_contact_email,
    COALESCE(NULLIF(TRIM(p_client_name), ''), NULLIF(TRIM(p_contact_name), ''), 'Client'),
    NULLIF(TRIM(COALESCE(p_contact_name, '')), ''),
    v_contact_email
  )
  ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET
    invitee_client_name   = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
    invitee_contact_name  = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
    invitee_contact_email = COALESCE(EXCLUDED.invitee_contact_email, firm.invitee_clients.invitee_contact_email),
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
  SELECT ic.id, ic.invitee_contact_email
  FROM firm.invitee_clients ic
  WHERE ic.firm_space_id = p_firm_space_id AND ic.invitee_email = v_contact_email
  LIMIT 1;
END;
$$;

--------------------------------------------------------------------------------
-- 6) firm_create_pending_order_for_invitee: 写入 clients_assignee（invitee 负责人）
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.firm_create_pending_order_for_invitee(uuid, text, text, text, uuid);

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
    invitee_contact_name,
    invitee_contact_email
  )
  VALUES (
    p_firm_space_id,
    v_contact_email,
    COALESCE(v_client_name, v_contact_name, 'Client'),
    v_contact_name,
    v_contact_email
  )
  ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET
    invitee_client_name   = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
    invitee_contact_name  = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
    invitee_contact_email = COALESCE(EXCLUDED.invitee_contact_email, firm.invitee_clients.invitee_contact_email),
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

--------------------------------------------------------------------------------
-- 7) firm.accept_client_invite_token: 写入 clients_assignee（client 行 + invitee 行）
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

--------------------------------------------------------------------------------
-- 8) invitee_claim_engagement: 将 clients_assignee 中该 invitee 行迁移为 client 行（同一条记录）
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

  SELECT ic.firm_space_id, LOWER(TRIM(COALESCE(ic.invitee_contact_email, '')))
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
  'Client claim: link space to firm. Migrates assignee by updating clients_assignee row from invitee_client_id to client_space_id.';

--------------------------------------------------------------------------------
-- 9) firm.orders RLS：原策略引用 firm.member_clients，改为 firm.clients_assignee
--------------------------------------------------------------------------------

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
        AND ca.client_space_id = firm.orders.client_space_id
        AND ca.user_id = auth.uid()
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
    )
    OR
    EXISTS (
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.orders.firm_space_id
        AND ca.client_space_id = firm.orders.client_space_id
        AND ca.user_id = auth.uid()
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
        AND ca.client_space_id = firm.orders.client_space_id
        AND ca.user_id = auth.uid()
    )
  );
