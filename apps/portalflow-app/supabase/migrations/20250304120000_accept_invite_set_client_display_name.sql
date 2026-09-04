-- 接受邀请时为 firm.clients 写入 display_name（空间名或接受人姓名），便于 firm 侧客户列表显示正确名称
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
  v_display_name text;
  v_out_firm_space_id uuid;
  v_out_client_space_id uuid;
  v_out_inviter_user_id uuid;
  v_out_sku_id uuid;
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

  -- 用于列表显示：优先用 client 空间名称，否则用接受人姓名
  SELECT COALESCE(
    NULLIF(TRIM((SELECT s.name FROM public.spaces s WHERE s.id = p_client_space_id)), ''),
    NULLIF(TRIM((SELECT u.name FROM public.users u WHERE u.id = p_client_user_id)), '')
  ) INTO v_display_name;

  INSERT INTO firm.clients (firm_space_id, client_space_id, status, display_name)
  VALUES (
    v_token_record.firm_space_id,
    p_client_space_id,
    'active',
    v_display_name
  )
  ON CONFLICT (firm_space_id, client_space_id)
  DO UPDATE SET
    status = 'active',
    display_name = COALESCE(NULLIF(TRIM(firm.clients.display_name), ''), EXCLUDED.display_name);

  INSERT INTO firm.member_clients (firm_space_id, user_id, client_space_id, created_at)
  VALUES (
    v_token_record.firm_space_id,
    v_token_record.inviter_user_id,
    p_client_space_id,
    v_now
  )
  ON CONFLICT (firm_space_id, user_id, client_space_id)
  DO NOTHING;

  -- 订单阶段使用 onboarding（启动/契约建立）
  BEGIN
    INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by)
    VALUES (
      v_token_record.firm_space_id,
      p_client_space_id,
      v_token_record.sku_id,
      'onboarding',
      NULL,
      v_now,
      v_now,
      p_client_user_id
    )
    ON CONFLICT (firm_space_id, client_space_id, sku_id, status)
    DO NOTHING;
  EXCEPTION
    WHEN SQLSTATE '42P10' THEN
      BEGIN
        INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by)
        VALUES (
          v_token_record.firm_space_id,
          p_client_space_id,
          v_token_record.sku_id,
          'onboarding',
          NULL,
          v_now,
          v_now,
          p_client_user_id
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
  '开放邀请：消费 token，建立 clients（含 display_name）+ orders（status=onboarding）';
