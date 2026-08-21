-- Firm 端权限细化：区分 admin 与 member 对 clients / orders 的可见与操作范围
-- 约定：
--   - admin：public.user_spaces.is_admin = true 且 space_id = firm_space_id
--   - member：同一 firm_space 的其他成员（is_admin = false）
-- 行为：
--   - firm.clients：
--       * admin：可查看 / 更新 / 删除 所有该 firm_space 下的 clients
--       * member：仅可查看 / 更新 / 删除 自己被分配的 clients（member_clients 表）
--   - firm.orders：
--       * admin：可查看 / 更新 / 删除 所有该 firm_space 下的 orders
--       * member：仅可查看 / 更新 / 删除 client_space_id 属于自己管理的 clients 的 orders

-- 先移除旧策略，避免冲突
DROP POLICY IF EXISTS firm_clients_select ON firm.clients;
DROP POLICY IF EXISTS firm_clients_update ON firm.clients;
DROP POLICY IF EXISTS firm_clients_delete ON firm.clients;

-- SELECT：admin 或与 member_clients 关联
CREATE POLICY firm_clients_select ON firm.clients
  FOR SELECT TO authenticated
  USING (
    -- admin: public.user_spaces 中 is_admin = true
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR
    -- member: 通过 member_clients 被分配到该 client
    EXISTS (
      SELECT 1 FROM firm.member_clients mc
      WHERE mc.firm_space_id = firm.clients.firm_space_id
        AND mc.client_space_id = firm.clients.client_space_id
        AND mc.user_id = auth.uid()
    )
  );

-- UPDATE：同上
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
      SELECT 1 FROM firm.member_clients mc
      WHERE mc.firm_space_id = firm.clients.firm_space_id
        AND mc.client_space_id = firm.clients.client_space_id
        AND mc.user_id = auth.uid()
    )
  );

-- DELETE：同上
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
      SELECT 1 FROM firm.member_clients mc
      WHERE mc.firm_space_id = firm.clients.firm_space_id
        AND mc.client_space_id = firm.clients.client_space_id
        AND mc.user_id = auth.uid()
    )
  );

-- firm.orders RLS：需要先启用 RLS（若尚未启用）
ALTER TABLE firm.orders ENABLE ROW LEVEL SECURITY;

-- 删除旧策略以便重建（若存在）
DROP POLICY IF EXISTS firm_orders_select ON firm.orders;
DROP POLICY IF EXISTS firm_orders_update ON firm.orders;
DROP POLICY IF EXISTS firm_orders_delete ON firm.orders;

-- SELECT：admin 可看全部；member 仅可看自己负责的 clients 的订单
CREATE POLICY firm_orders_select ON firm.orders
  FOR SELECT TO authenticated
  USING (
    -- admin：该 firm_space 的 is_admin = true
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.orders.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR
    -- member：auth 用户在 member_clients 中与该订单 client_space_id 关联
    EXISTS (
      SELECT 1 FROM firm.member_clients mc
      WHERE mc.firm_space_id = firm.orders.firm_space_id
        AND mc.client_space_id = firm.orders.client_space_id
        AND mc.user_id = auth.uid()
    )
  );

-- UPDATE：同上
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
      SELECT 1 FROM firm.member_clients mc
      WHERE mc.firm_space_id = firm.orders.firm_space_id
        AND mc.client_space_id = firm.orders.client_space_id
        AND mc.user_id = auth.uid()
    )
  );

-- DELETE：同上
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
      SELECT 1 FROM firm.member_clients mc
      WHERE mc.firm_space_id = firm.orders.firm_space_id
        AND mc.client_space_id = firm.orders.client_space_id
        AND mc.user_id = auth.uid()
    )
  );

