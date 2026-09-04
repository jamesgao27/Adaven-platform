-- 代建模式：firm 代建 client 空间并发送空间成员邀请，客户接受后为 admin，firm 为 member
-- 1. space_invitations 增加 invite_as_admin，接受邀请时可加入为空间管理员
-- 2. public.firm_create_client_on_behalf：创建 client 空间、firm.clients、member_clients、空间邀请

SET search_path = public, firm;

-- =============================================================================
-- 1. space_invitations 增加 invite_as_admin（若表存在）
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'space_invitations') THEN
    ALTER TABLE public.space_invitations ADD COLUMN IF NOT EXISTS invite_as_admin BOOLEAN NOT NULL DEFAULT false;
    COMMENT ON COLUMN public.space_invitations.invite_as_admin IS 'Accept invitation as space admin (e.g. firm-created client space)';
    ALTER TABLE public.space_invitations ADD COLUMN IF NOT EXISTS inviter_name TEXT;
    COMMENT ON COLUMN public.space_invitations.inviter_name IS 'Inviter display name (e.g. firm operator name for client invite)';
  END IF;
END $$;

-- =============================================================================
-- 2. firm_create_client_on_behalf：代建 client 空间 + 关联 clients + 创建空间邀请
-- 调用方：当前用户须为 firm_space_id 的成员；必填 client 名称、联系人邮箱
-- 行为：创建 kind=client 的 space，当前用户以 member 加入，插入 firm.clients 与 member_clients，
--       插入 space_invitations（invite_as_admin=true），客户接受后成为该空间 admin
-- 返回：client_space_id, invitation_id, space_name, invitee_email
-- =============================================================================
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
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 校验：调用方必须是该 firm 的成员
  IF NOT EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.space_id = p_firm_space_id AND us.user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Only firm members can create clients on behalf';
  END IF;

  -- 必填：客户名称、联系人邮箱
  v_space_name := COALESCE(NULLIF(TRIM(p_client_name), ''), NULLIF(TRIM(p_contact_name), ''), 'Client Space');
  IF NULLIF(TRIM(LOWER(p_contact_email)), '') IS NULL THEN
    RAISE EXCEPTION 'Contact email is required';
  END IF;

  -- 创建 client 空间（不加入 firm 操作者为 member；客户接受邀请后为 admin）
  INSERT INTO public.spaces (name, address, kind)
  VALUES (v_space_name, NULL, 'client')
  RETURNING id INTO v_client_space_id;

  -- 关联为当前 firm 的 client（firm 不加入该 space 的 user_spaces）
  INSERT INTO firm.clients (firm_space_id, client_space_id, status, display_name)
  VALUES (
    p_firm_space_id,
    v_client_space_id,
    'active',
    COALESCE(NULLIF(TRIM(p_client_name), ''), NULLIF(TRIM(p_contact_name), ''), v_space_name)
  )
  ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key
  DO UPDATE SET
    display_name = COALESCE(NULLIF(TRIM(EXCLUDED.display_name), ''), firm.clients.display_name),
    status = 'active',
    updated_at = v_now;

  -- 负责人：当前用户
  INSERT INTO firm.member_clients (firm_space_id, user_id, client_space_id, created_at)
  VALUES (p_firm_space_id, v_caller_id, v_client_space_id, v_now)
  ON CONFLICT ON CONSTRAINT member_clients_firm_space_id_user_id_client_space_id_key DO NOTHING;

  -- 可选：创建订单 onboarding（启动报税项目）
  IF p_sku_id IS NOT NULL THEN
    INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by)
    VALUES (p_firm_space_id, v_client_space_id, p_sku_id, 'onboarding', NULL, v_now, v_now, v_caller_id);
  END IF;

  -- 邀请人 name、email（用于 space_invitations，firm 操作者信息存于邀请记录）
  SELECT u.name, COALESCE(u.email, (SELECT email FROM auth.users WHERE id = v_caller_id LIMIT 1))
  INTO v_inviter_name, v_inviter_email
  FROM public.users u
  WHERE u.id = v_caller_id
  LIMIT 1;
  v_inviter_email := COALESCE(v_inviter_email, '');
  v_inviter_name  := NULLIF(TRIM(v_inviter_name), '');

  -- 创建空间成员邀请（invite_as_admin=true，客户接受后为该空间 admin；含 inviter name/email）
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'space_invitations') THEN
    INSERT INTO public.space_invitations (
      space_id,
      inviter_id,
      inviter_email,
      invitee_email,
      space_name,
      status,
      created_at,
      invite_as_admin,
      inviter_name
    )
    VALUES (
      v_client_space_id,
      v_caller_id,
      v_inviter_email,
      LOWER(TRIM(p_contact_email)),
      v_space_name,
      'pending',
      v_now,
      true,
      v_inviter_name
    )
    RETURNING id INTO v_invitation_id;
  ELSE
    v_invitation_id := NULL;
  END IF;

  -- Return single row (RETURN QUERY SELECT avoids ambiguous column "client_space_id" with firm.clients)
  RETURN QUERY SELECT v_client_space_id, v_invitation_id, v_space_name, LOWER(TRIM(p_contact_email));
END;
$$;

COMMENT ON FUNCTION public.firm_create_client_on_behalf(UUID, TEXT, TEXT, TEXT, UUID) IS
  'Firm 代建 client 空间：创建 space、firm.clients、member_clients、空间邀请（invite_as_admin），可选创建 onboarding 订单';
