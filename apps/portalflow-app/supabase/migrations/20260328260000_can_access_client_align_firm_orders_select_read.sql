-- firm.can_access_client (read) only checked firm.can_access_order. Assigned order managers without a
-- permission role can still SELECT orders (firm_orders_select manager branch) but can_access_order is
-- false, so they lost firm.clients and public.spaces visibility for that client — Engagements showed
-- client_space_id instead of space name when all their orders were terminal (still readable as manager).
-- For p_for_write = false, use the same OR branches as firm_orders_select / auth_user_can_select_order.
-- Writes stay can_access_order-only.

SET search_path = public, firm;

CREATE OR REPLACE FUNCTION firm.can_access_client(
  p_user_id uuid,
  p_firm_space_id uuid,
  p_client_space_id uuid,
  p_for_write boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, firm
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM firm.orders o
    WHERE o.firm_space_id = p_firm_space_id
      AND o.client_space_id = p_client_space_id
      AND (
        (p_for_write AND firm.can_access_order(p_user_id, o.id, true))
        OR (
          NOT p_for_write
          AND (
            firm.can_access_order(p_user_id, o.id, false)
            OR EXISTS (
              SELECT 1 FROM firm.order_managers om
              WHERE om.order_id = o.id
                AND om.firm_space_id = o.firm_space_id
                AND om.manager_user_id = p_user_id
                AND EXISTS (
                  SELECT 1 FROM public.user_spaces us
                  WHERE us.space_id = o.firm_space_id
                    AND us.user_id = p_user_id
                )
            )
            OR (
              o.client_space_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM public.user_spaces us
                WHERE us.space_id = o.client_space_id
                  AND us.user_id = p_user_id
              )
              AND (
                NOT EXISTS (
                  SELECT 1 FROM public.user_spaces us_firm
                  WHERE us_firm.space_id = o.firm_space_id
                    AND us_firm.user_id = p_user_id
                )
                OR EXISTS (
                  SELECT 1 FROM firm.order_managers om
                  WHERE om.order_id = o.id
                    AND om.firm_space_id = o.firm_space_id
                    AND om.manager_user_id = p_user_id
                )
              )
            )
          )
        )
      )
  )
  OR EXISTS (
    SELECT 1
    FROM firm.orders o
    JOIN firm.clients c ON c.id = o.client_id
    WHERE o.firm_space_id = p_firm_space_id
      AND o.client_id IS NOT NULL
      AND c.client_space_id IS NOT NULL
      AND c.client_space_id = p_client_space_id
      AND (
        (p_for_write AND firm.can_access_order(p_user_id, o.id, true))
        OR (
          NOT p_for_write
          AND (
            firm.can_access_order(p_user_id, o.id, false)
            OR EXISTS (
              SELECT 1 FROM firm.order_managers om
              WHERE om.order_id = o.id
                AND om.firm_space_id = o.firm_space_id
                AND om.manager_user_id = p_user_id
                AND EXISTS (
                  SELECT 1 FROM public.user_spaces us
                  WHERE us.space_id = o.firm_space_id
                    AND us.user_id = p_user_id
                )
            )
            OR (
              o.client_space_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM public.user_spaces us
                WHERE us.space_id = o.client_space_id
                  AND us.user_id = p_user_id
              )
              AND (
                NOT EXISTS (
                  SELECT 1 FROM public.user_spaces us_firm
                  WHERE us_firm.space_id = o.firm_space_id
                    AND us_firm.user_id = p_user_id
                )
                OR EXISTS (
                  SELECT 1 FROM firm.order_managers om
                  WHERE om.order_id = o.id
                    AND om.firm_space_id = o.firm_space_id
                    AND om.manager_user_id = p_user_id
                )
              )
            )
          )
        )
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN firm.orders o ON o.id = p.order_id
    WHERE p.client_space_id = p_client_space_id
      AND o.firm_space_id = p_firm_space_id
      AND p.order_id IS NOT NULL
      AND (
        (p_for_write AND firm.can_access_order(p_user_id, o.id, true))
        OR (
          NOT p_for_write
          AND (
            firm.can_access_order(p_user_id, o.id, false)
            OR EXISTS (
              SELECT 1 FROM firm.order_managers om
              WHERE om.order_id = o.id
                AND om.firm_space_id = o.firm_space_id
                AND om.manager_user_id = p_user_id
                AND EXISTS (
                  SELECT 1 FROM public.user_spaces us
                  WHERE us.space_id = o.firm_space_id
                    AND us.user_id = p_user_id
                )
            )
            OR (
              o.client_space_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM public.user_spaces us
                WHERE us.space_id = o.client_space_id
                  AND us.user_id = p_user_id
              )
              AND (
                NOT EXISTS (
                  SELECT 1 FROM public.user_spaces us_firm
                  WHERE us_firm.space_id = o.firm_space_id
                    AND us_firm.user_id = p_user_id
                )
                OR EXISTS (
                  SELECT 1 FROM firm.order_managers om
                  WHERE om.order_id = o.id
                    AND om.firm_space_id = o.firm_space_id
                    AND om.manager_user_id = p_user_id
                )
              )
            )
          )
        )
      )
  );
$$;

COMMENT ON FUNCTION firm.can_access_client(uuid, uuid, uuid, boolean) IS
  'READ: any order for this client that satisfies can_access_order OR firm_orders_select read (manager / client-space branch). WRITE: can_access_order only.';
