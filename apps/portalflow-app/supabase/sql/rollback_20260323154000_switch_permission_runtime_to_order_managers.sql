SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) Drop trigger and helper functions
--------------------------------------------------------------------------------

DROP TRIGGER IF EXISTS tr_ensure_order_manager_after_insert ON firm.orders;
DROP FUNCTION IF EXISTS firm.ensure_order_manager_after_insert();

DROP FUNCTION IF EXISTS firm.can_access_project(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS firm.can_access_client(uuid, uuid, uuid, boolean);
DROP FUNCTION IF EXISTS firm.can_access_order(uuid, uuid, boolean);

--------------------------------------------------------------------------------
-- 2) Restore simpler order-manager based policies
--------------------------------------------------------------------------------

DROP POLICY IF EXISTS firm_clients_select ON firm.clients;
DROP POLICY IF EXISTS firm_clients_update ON firm.clients;
DROP POLICY IF EXISTS firm_clients_delete ON firm.clients;

CREATE POLICY firm_clients_select ON firm.clients
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_spaces us
      WHERE us.space_id = firm.clients.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR EXISTS (
      SELECT 1
      FROM firm.orders o
      JOIN firm.order_managers om ON om.order_id = o.id
      WHERE o.firm_space_id = firm.clients.firm_space_id
        AND o.client_space_id = firm.clients.client_space_id
        AND om.manager_user_id = auth.uid()
    )
  );

CREATE POLICY firm_clients_update ON firm.clients
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_spaces us
      WHERE us.space_id = firm.clients.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

CREATE POLICY firm_clients_delete ON firm.clients
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_spaces us
      WHERE us.space_id = firm.clients.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

DROP POLICY IF EXISTS firm_orders_select ON firm.orders;
DROP POLICY IF EXISTS firm_orders_update ON firm.orders;
DROP POLICY IF EXISTS firm_orders_delete ON firm.orders;

CREATE POLICY firm_orders_select ON firm.orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_spaces us
      WHERE us.space_id = firm.orders.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR EXISTS (
      SELECT 1
      FROM firm.order_managers om
      WHERE om.order_id = firm.orders.id
        AND om.manager_user_id = auth.uid()
    )
    OR (
      firm.orders.client_space_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.user_spaces us
        WHERE us.space_id = firm.orders.client_space_id
          AND us.user_id = auth.uid()
      )
    )
  );

CREATE POLICY firm_orders_update ON firm.orders
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_spaces us
      WHERE us.space_id = firm.orders.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR EXISTS (
      SELECT 1
      FROM firm.order_managers om
      WHERE om.order_id = firm.orders.id
        AND om.manager_user_id = auth.uid()
    )
  );

CREATE POLICY firm_orders_delete ON firm.orders
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_spaces us
      WHERE us.space_id = firm.orders.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR EXISTS (
      SELECT 1
      FROM firm.order_managers om
      WHERE om.order_id = firm.orders.id
        AND om.manager_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS public_projects_select ON public.projects;
DROP POLICY IF EXISTS public_projects_insert ON public.projects;
DROP POLICY IF EXISTS public_projects_update ON public.projects;
DROP POLICY IF EXISTS public_projects_delete ON public.projects;

CREATE POLICY public_projects_select ON public.projects
  FOR SELECT TO authenticated
  USING (
    (
      public.projects.order_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM firm.orders o
        JOIN firm.order_managers om ON om.order_id = o.id
        WHERE o.id = public.projects.order_id
          AND om.manager_user_id = auth.uid()
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_spaces us
      WHERE us.space_id = public.projects.client_space_id
        AND us.user_id = auth.uid()
    )
  );

CREATE POLICY public_projects_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY public_projects_update ON public.projects
  FOR UPDATE TO authenticated
  USING (true);

CREATE POLICY public_projects_delete ON public.projects
  FOR DELETE TO authenticated
  USING (true);
