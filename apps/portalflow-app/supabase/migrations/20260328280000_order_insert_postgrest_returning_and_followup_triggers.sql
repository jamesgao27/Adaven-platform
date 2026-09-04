-- PostgREST: insert(..., { returning: 'representation' }) runs SELECT on the new row.
-- firm_orders_select often fails right after INSERT because:
--   - tr_ensure_order_manager_after_insert may assign a different user as manager than created_by, OR
--   - the inserter has order role (INSERT policy) but no user_spaces row, so they are not the manager branch.
-- Then the API surfaces "new row violates row-level security policy for table orders".
--
-- Also: on_order_insert_follow_up / on_order_update_follow_up were SECURITY INVOKER, so touch_client +
-- client_follow_ups INSERT ran under the caller and could fail firm.clients UPDATE / follow-up INSERT RLS,
-- aborting the whole order INSERT transaction.

SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) SELECT: creator may read the row they just inserted (RETURNING / representation)
--------------------------------------------------------------------------------

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
    OR (
      firm.orders.created_by IS NOT NULL
      AND firm.orders.created_by = auth.uid()
    )
  );

COMMENT ON POLICY firm_orders_select ON firm.orders IS
  'Same as 282500, plus created_by = auth.uid() so PostgREST RETURNING works for the inserter.';

--------------------------------------------------------------------------------
-- 2) Order follow-up triggers: system side-effects, not end-user RLS
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION firm.on_order_insert_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
BEGIN
  UPDATE firm.clients
  SET updated_at = NEW.created_at
  WHERE firm_space_id = NEW.firm_space_id
    AND client_space_id IS NOT DISTINCT FROM NEW.client_space_id;

  INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
  VALUES (NEW.firm_space_id, NEW.client_space_id, 'Order created', 'order_created', NEW.id, NEW.created_by);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION firm.on_order_update_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  UPDATE firm.clients
  SET updated_at = NEW.updated_at
  WHERE firm_space_id = NEW.firm_space_id
    AND client_space_id IS NOT DISTINCT FROM NEW.client_space_id;

  IF NEW.status = 'completed' THEN
    INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
    VALUES (NEW.firm_space_id, NEW.client_space_id, 'Order completed', 'order_completed', NEW.id, NULL);
  ELSIF NEW.status = 'cancelled' THEN
    INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
    VALUES (NEW.firm_space_id, NEW.client_space_id, 'Order cancelled', 'order_cancelled', NEW.id, NULL);
  ELSIF OLD.status = 'onboarding' AND NEW.status NOT IN ('onboarding', 'cancelled') THEN
    INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
    VALUES (NEW.firm_space_id, NEW.client_space_id, 'Service started', 'order_started', NEW.id, NULL);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION firm.on_order_insert_follow_up() IS
  'SECURITY DEFINER: touch client + order_created follow-up without requiring caller UPDATE/INSERT RLS on clients/follow-ups.';
COMMENT ON FUNCTION firm.on_order_update_follow_up() IS
  'SECURITY DEFINER: touch client + status follow-ups without requiring caller UPDATE/INSERT RLS on clients/follow-ups.';
