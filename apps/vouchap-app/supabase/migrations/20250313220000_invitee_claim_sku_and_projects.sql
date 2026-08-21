-- Invitee 认领：get_pending_invitees 返回 sku_id 供前端 SKU 预览；invitee_claim 内联迁移 orders 并更新 projects.client_space_id
-- （migrate_pending_orders_to_client_space 要求 caller 为 firm 成员，client 认领时改由 invitee_claim_engagement 内联更新）
SET search_path = public, firm;

-- 1) get_pending_invitees_for_email: 增加 sku_id（取该 invitee 任一 pending order 的 sku_id）
--    返回类型变化必须先 DROP 再 CREATE
DROP FUNCTION IF EXISTS public.get_pending_invitees_for_email(text);

CREATE OR REPLACE FUNCTION public.get_pending_invitees_for_email(p_email text)
RETURNS TABLE (
  firm_space_id uuid,
  firm_name text,
  invitee_client_id uuid,
  invitee_client_name text,
  invitee_contact_email text,
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
    ic.invitee_contact_email,
    (SELECT o.sku_id FROM firm.orders o
     WHERE o.firm_space_id = ic.firm_space_id
       AND o.invitee_client_id = ic.id
       AND o.client_space_id IS NULL
     LIMIT 1) AS sku_id
  FROM firm.invitee_clients ic
  JOIN public.spaces s ON s.id = ic.firm_space_id
  WHERE LOWER(TRIM(COALESCE(ic.invitee_contact_email, ''))) = LOWER(TRIM(COALESCE(p_email, '')))
    AND EXISTS (
      SELECT 1 FROM firm.orders o
      WHERE o.firm_space_id = ic.firm_space_id
        AND o.invitee_client_id = ic.id
        AND o.client_space_id IS NULL
    );
$$;

COMMENT ON FUNCTION public.get_pending_invitees_for_email(text) IS
  'Client 按邮箱查询可认领的 engagement（invitee 且有 pending order）；返回 sku_id 供 SKU 预览';

-- 2) invitee_claim_engagement: 内联更新 orders 与 projects（不调用 migrate，因 migrate 仅允许 firm 成员）
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

  IF NOT EXISTS (
    SELECT 1 FROM firm.orders o
    WHERE o.firm_space_id = v_firm_space_id AND o.invitee_client_id = p_invitee_client_id AND o.client_space_id IS NULL
  ) THEN
    RAISE EXCEPTION 'No pending orders to claim';
  END IF;

  INSERT INTO firm.clients (firm_space_id, client_space_id, status)
  VALUES (v_firm_space_id, p_client_space_id, 'active')
  ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key DO NOTHING;

  -- 内联迁移 pending orders（不调用 migrate_pending_orders_to_client_space，因该函数要求 caller 为 firm 成员）
  UPDATE firm.orders o
  SET client_space_id = p_client_space_id, updated_at = now()
  WHERE o.firm_space_id = v_firm_space_id
    AND o.invitee_client_id = p_invitee_client_id
    AND o.client_space_id IS NULL;

  -- 同步更新 public.projects：将已绑定到该 client_space 的订单对应的 project 的 client_space_id 设为 p_client_space_id
  -- 使用表别名 o 限定列名，避免与 RETURNS TABLE 的 firm_space_id 歧义
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
  'Client 认领 engagement：校验邮箱、写入 firm.clients、迁移 pending orders、更新 projects.client_space_id、将当前用户加入 client space';
