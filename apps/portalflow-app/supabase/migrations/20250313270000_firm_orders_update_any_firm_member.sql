-- Allow any firm space member to UPDATE orders (e.g. Complete/Terminate).
-- Previously only firm space admin OR member_clients could update; when RLS blocked,
-- Supabase returned success with 0 rows and the UI stayed "collecting".
SET search_path = public, firm;

DROP POLICY IF EXISTS firm_orders_update ON firm.orders;

CREATE POLICY firm_orders_update ON firm.orders
  FOR UPDATE TO authenticated
  USING (
    -- Any member of the order's firm space (not only admin)
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.orders.firm_space_id
        AND us.user_id = auth.uid()
    )
    OR
    -- Or linked via member_clients (kept for consistency with SELECT)
    EXISTS (
      SELECT 1 FROM firm.member_clients mc
      WHERE mc.firm_space_id = firm.orders.firm_space_id
        AND mc.client_space_id = firm.orders.client_space_id
        AND mc.user_id = auth.uid()
    )
  );
