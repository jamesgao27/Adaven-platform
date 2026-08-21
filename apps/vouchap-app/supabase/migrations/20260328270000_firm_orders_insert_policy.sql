-- Order-manager RLS migration (20260323154000) replaced SELECT/UPDATE/DELETE on firm.orders
-- but never recreated firm_orders_insert. Authenticated INSERT then fails with:
--   new row violates row-level security policy for table "orders"
-- Restore INSERT and align with firm membership + permission roles that grant order write.

SET search_path = public, firm;

DROP POLICY IF EXISTS firm_orders_insert ON firm.orders;

CREATE POLICY firm_orders_insert ON firm.orders
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id
        AND us.user_id = auth.uid()
    )
    OR firm.user_has_any_order_permission_in_space(auth.uid(), firm_space_id, true)
  );

COMMENT ON POLICY firm_orders_insert ON firm.orders IS
  'INSERT when user is a member of the firm space, or has a permission role with order write in that firm.';
