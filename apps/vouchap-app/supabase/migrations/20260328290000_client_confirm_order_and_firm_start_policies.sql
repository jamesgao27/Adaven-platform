-- Fix: orders can be created but cannot be started/accepted.
--
-- 1) Client accept (confirmOrderAndCreateProjectTodos in app code) inserts into public.projects and then
--    updates firm.orders.status to 'processing'. After 20260323154000, public_projects_insert required
--    firm.can_access_order(..., true) which pure clients don't have. firm_orders_update also required
--    can_access_order(..., true), blocking client confirm.
--
-- 2) Firm start often updates order status too. If the creator is not covered by can_access_order write,
--    allow created_by to update their own orders.
--
-- This migration:
-- - Allows client_space members to INSERT public.projects only for their own order/client_space_id.
-- - Allows client_space members to UPDATE firm.orders only when confirming onboarding -> processing/cancelled.
-- - Allows created_by to UPDATE their own orders (firm-side start).

SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) public.projects INSERT: allow client-space confirmation path
--------------------------------------------------------------------------------

DROP POLICY IF EXISTS public_projects_insert ON public.projects;

CREATE POLICY public_projects_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (
    public.projects.order_id IS NOT NULL
    AND (
      -- Firm-side write path (unchanged)
      firm.can_access_order(auth.uid(), public.projects.order_id, true)
      -- Client-side confirmation: must be a member of the client space and the order must belong to it
      OR (
        public.projects.client_space_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.user_spaces us
          WHERE us.space_id = public.projects.client_space_id
            AND us.user_id = auth.uid()
        )
        AND EXISTS (
          SELECT 1
          FROM firm.orders o
          WHERE o.id = public.projects.order_id
            AND o.client_space_id = public.projects.client_space_id
        )
      )
    )
  );

COMMENT ON POLICY public_projects_insert ON public.projects IS
  'INSERT by firm writers (can_access_order write) OR by client_space members when order_id belongs to that client_space (confirmation).';

--------------------------------------------------------------------------------
-- 2) firm.orders UPDATE: allow client confirmation + created_by start
--------------------------------------------------------------------------------

DROP POLICY IF EXISTS firm_orders_update ON firm.orders;

CREATE POLICY firm_orders_update ON firm.orders
  FOR UPDATE TO authenticated
  USING (
    -- Firm-side: can_access_order write (roles/admin) OR creator of the order
    firm.can_access_order(auth.uid(), firm.orders.id, true)
    OR (firm.orders.created_by IS NOT NULL AND firm.orders.created_by = auth.uid())
    -- Client-side: can only update during onboarding confirmation
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
    firm.can_access_order(auth.uid(), firm.orders.id, true)
    OR (firm.orders.created_by IS NOT NULL AND firm.orders.created_by = auth.uid())
    OR (
      firm.orders.client_space_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.user_spaces us
        WHERE us.space_id = firm.orders.client_space_id
          AND us.user_id = auth.uid()
      )
      AND firm.orders.status IN ('processing', 'cancelled')
    )
  );

COMMENT ON POLICY firm_orders_update ON firm.orders IS
  'UPDATE by can_access_order write, or created_by for firm-side start. Client_space members may only change onboarding orders to processing/cancelled (confirmation).';

