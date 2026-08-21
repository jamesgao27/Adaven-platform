-- firm_orders_select OR-ed "client_space member can SELECT order". Firm-side users who are also
-- members of a client org space therefore saw every engagement for that client, even when
-- can_access_order was false (e.g. another user is order manager and caller has no roles).
-- Tighten: if the caller is in user_spaces for the order's firm_space_id, only allow this client_space
-- bypass when they are the order_managers row for that order (so managers without a permission role
-- still see their own engagements; firm members who are not that order's manager do not).

SET search_path = public, firm;

DROP POLICY IF EXISTS firm_orders_select ON firm.orders;

CREATE POLICY firm_orders_select ON firm.orders
  FOR SELECT TO authenticated
  USING (
    firm.can_access_order(auth.uid(), firm.orders.id, false)
    OR EXISTS (
      SELECT 1 FROM firm.order_managers om
      WHERE om.order_id = firm.orders.id
        AND om.firm_space_id = firm.orders.firm_space_id
        AND om.manager_user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.user_spaces us
          WHERE us.space_id = firm.orders.firm_space_id
            AND us.user_id = auth.uid()
        )
    )
    OR (
      firm.orders.client_space_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.user_spaces us
        WHERE us.space_id = firm.orders.client_space_id
          AND us.user_id = auth.uid()
      )
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.user_spaces us_firm
          WHERE us_firm.space_id = firm.orders.firm_space_id
            AND us_firm.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM firm.order_managers om
          WHERE om.order_id = firm.orders.id
            AND om.firm_space_id = firm.orders.firm_space_id
            AND om.manager_user_id = auth.uid()
        )
      )
    )
  );

COMMENT ON POLICY firm_orders_select ON firm.orders IS
  'SELECT via can_access_order; or firm member listed as this order''s manager; or client_space bypass (non-firm client, or firm member only when manager on this order). SELECT for assigned manager does not require permission_role (writes still use can_access_order).';

--------------------------------------------------------------------------------
-- Match firm_orders_select (282300 single-arg helper).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION firm.auth_user_can_select_order(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, firm
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM firm.orders o
      WHERE o.id = p_order_id
        AND (
          firm.can_access_order(auth.uid(), o.id, false)
          OR EXISTS (
            SELECT 1 FROM firm.order_managers om
            WHERE om.order_id = o.id
              AND om.firm_space_id = o.firm_space_id
              AND om.manager_user_id = auth.uid()
              AND EXISTS (
                SELECT 1 FROM public.user_spaces us
                WHERE us.space_id = o.firm_space_id
                  AND us.user_id = auth.uid()
              )
          )
          OR (
            o.client_space_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.user_spaces us
              WHERE us.space_id = o.client_space_id
                AND us.user_id = auth.uid()
            )
            AND (
              NOT EXISTS (
                SELECT 1 FROM public.user_spaces us_firm
                WHERE us_firm.space_id = o.firm_space_id
                  AND us_firm.user_id = auth.uid()
              )
              OR EXISTS (
                SELECT 1 FROM firm.order_managers om
                WHERE om.order_id = o.id
                  AND om.firm_space_id = o.firm_space_id
                  AND om.manager_user_id = auth.uid()
              )
            )
          )
        )
    );
$$;

COMMENT ON FUNCTION firm.auth_user_can_select_order(uuid) IS
  'True if auth.uid() may SELECT this order (firm_orders_select); keep in sync with policy.';

--------------------------------------------------------------------------------
-- Same leak for projects: client_space OR without excluding firm members.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS public_projects_select ON public.projects;

CREATE POLICY public_projects_select ON public.projects
  FOR SELECT TO authenticated
  USING (
    (
      public.projects.order_id IS NOT NULL
      AND firm.can_access_order(auth.uid(), public.projects.order_id, false)
    )
    OR (
      public.projects.order_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM firm.order_managers om
        WHERE om.order_id = public.projects.order_id
          AND om.manager_user_id = auth.uid()
          AND EXISTS (
            SELECT 1 FROM public.user_spaces us
            WHERE us.space_id = om.firm_space_id
              AND us.user_id = auth.uid()
          )
      )
    )
    OR (
      EXISTS (
        SELECT 1 FROM public.user_spaces us
        WHERE us.space_id = public.projects.client_space_id
          AND us.user_id = auth.uid()
      )
      AND (
        NOT EXISTS (
          SELECT 1 FROM firm.orders o
          WHERE o.id = public.projects.order_id
            AND EXISTS (
              SELECT 1 FROM public.user_spaces us_firm
              WHERE us_firm.space_id = o.firm_space_id
                AND us_firm.user_id = auth.uid()
            )
        )
        OR EXISTS (
          SELECT 1 FROM firm.order_managers om
          WHERE om.order_id = public.projects.order_id
            AND om.manager_user_id = auth.uid()
        )
      )
    )
  );

COMMENT ON POLICY public_projects_select ON public.projects IS
  'Project SELECT: can_access_order, or client_space path with same firm-member / order-manager exception as firm.orders.';
