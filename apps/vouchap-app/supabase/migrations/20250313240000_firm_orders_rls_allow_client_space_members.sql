-- Allow client-space members to see their orders (invitee claim flow).
-- Previously only firm admin or firm.member_clients could SELECT; client who claimed
-- is in user_spaces for client_space_id but not in member_clients, so they saw no orders.
SET search_path = public, firm;

DROP POLICY IF EXISTS firm_orders_select ON firm.orders;
DROP POLICY IF EXISTS firm_orders_update ON firm.orders;
DROP POLICY IF EXISTS firm_orders_delete ON firm.orders;

-- SELECT: admin, firm member (member_clients), or client-space member (user_spaces for client_space_id)
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
      SELECT 1 FROM firm.member_clients mc
      WHERE mc.firm_space_id = firm.orders.firm_space_id
        AND mc.client_space_id = firm.orders.client_space_id
        AND mc.user_id = auth.uid()
    )
    OR
    -- client: user is member of the order's client space (e.g. after invitee claim)
    (firm.orders.client_space_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.orders.client_space_id
        AND us.user_id = auth.uid()
    ))
  );

-- UPDATE: same as before (firm only; client updates order status via RPC if needed)
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

-- DELETE: firm only
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
