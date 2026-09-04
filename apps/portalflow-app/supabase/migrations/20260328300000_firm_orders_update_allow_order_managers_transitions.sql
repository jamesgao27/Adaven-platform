-- Additional fix: allow order_managers to start (onboarding -> processing/cancelled)
-- even when they don't have permission_role write capability.
-- This specifically unblocks firm start and client accept (both end with updateOrderStatus()).

SET search_path = public, firm;

DROP POLICY IF EXISTS firm_orders_update ON firm.orders;

CREATE POLICY firm_orders_update ON firm.orders
  FOR UPDATE TO authenticated
  USING (
    -- 1) Firm writers (permission roles) OR creator can always write
    firm.can_access_order(auth.uid(), firm.orders.id, true)
    OR (firm.orders.created_by IS NOT NULL AND firm.orders.created_by = auth.uid())
    -- 2) Assigned order manager can start their own onboarding orders
    OR (
      firm.orders.status = 'onboarding'
      AND EXISTS (
        SELECT 1
        FROM firm.order_managers om
        WHERE om.order_id = firm.orders.id
          AND om.manager_user_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1
        FROM public.user_spaces us
        WHERE us.space_id = firm.orders.firm_space_id
          AND us.user_id = auth.uid()
      )
    )
    -- 3) Client_space members confirm onboarding orders
    OR (
      firm.orders.client_space_id IS NOT NULL
      AND firm.orders.status = 'onboarding'
      AND EXISTS (
        SELECT 1
        FROM public.user_spaces us
        WHERE us.space_id = firm.orders.client_space_id
          AND us.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    -- New row status for transitions is restricted; keep it narrow for safety.
    firm.can_access_order(auth.uid(), firm.orders.id, true)
    OR (firm.orders.created_by IS NOT NULL AND firm.orders.created_by = auth.uid())
    OR (
      firm.orders.status IN ('processing', 'cancelled')
      AND EXISTS (
        SELECT 1
        FROM firm.order_managers om
        WHERE om.order_id = firm.orders.id
          AND om.manager_user_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1
        FROM public.user_spaces us
        WHERE us.space_id = firm.orders.firm_space_id
          AND us.user_id = auth.uid()
      )
    )
    OR (
      firm.orders.client_space_id IS NOT NULL
      AND firm.orders.status IN ('processing', 'cancelled')
      AND EXISTS (
        SELECT 1
        FROM public.user_spaces us
        WHERE us.space_id = firm.orders.client_space_id
          AND us.user_id = auth.uid()
      )
    )
  );

COMMENT ON POLICY firm_orders_update ON firm.orders IS
  'Allow onboarding -> processing/cancelled by permission-role writers, created_by, assigned order_managers (no role required), or client_space members confirmation.';

