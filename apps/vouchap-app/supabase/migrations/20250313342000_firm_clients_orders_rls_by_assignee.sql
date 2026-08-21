-- Engagement visibility follows client assignee; client visibility: admin sees all, members only assignee.
-- Order created_by is still stored but not used for permissions.
-- Tables: use clients_assignee (member_clients was renamed); orders with client_space_id or invitee_client_id.
--
-- IMPORTANT: 20250304200000 created policies on firm.clients but did NOT run ENABLE ROW LEVEL SECURITY,
-- so RLS was never applied and all firm members could see all clients. This migration enables RLS and
-- replaces policies to use clients_assignee (member_clients was renamed in 20250313290000).

SET search_path = public, firm;

-- 1) firm.clients: enable RLS (required for policies to apply), then replace policies with assignee-based visibility
ALTER TABLE firm.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS firm_clients_select ON firm.clients;
DROP POLICY IF EXISTS firm_clients_update ON firm.clients;
DROP POLICY IF EXISTS firm_clients_delete ON firm.clients;

-- SELECT: firm admin sees all; firm member sees only clients where they are assignee (clients_assignee)
CREATE POLICY firm_clients_select ON firm.clients
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR
    EXISTS (
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.clients.firm_space_id
        AND ca.client_space_id = firm.clients.client_space_id
        AND ca.user_id = auth.uid()
    )
  );

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
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.clients.firm_space_id
        AND ca.client_space_id = firm.clients.client_space_id
        AND ca.user_id = auth.uid()
    )
  );

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
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.clients.firm_space_id
        AND ca.client_space_id = firm.clients.client_space_id
        AND ca.user_id = auth.uid()
    )
  );

COMMENT ON POLICY firm_clients_select ON firm.clients IS 'Admin sees all clients; member sees only clients where they are assignee.';
COMMENT ON POLICY firm_clients_update ON firm.clients IS 'Same as SELECT.';
COMMENT ON POLICY firm_clients_delete ON firm.clients IS 'Same as SELECT.';

-- 2) firm.orders: visibility by client assignee (not by order created_by)
-- SELECT: firm admin sees all; firm member sees orders whose client (client_space_id or invitee_client_id) they assign; client-space member sees their orders
DROP POLICY IF EXISTS firm_orders_select ON firm.orders;
DROP POLICY IF EXISTS firm_orders_update ON firm.orders;
DROP POLICY IF EXISTS firm_orders_delete ON firm.orders;

CREATE POLICY firm_orders_select ON firm.orders
  FOR SELECT TO authenticated
  USING (
    -- Firm admin: all orders in this firm
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.orders.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR
    -- Firm member: assignee of this order's client (by client_space_id or invitee_client_id)
    EXISTS (
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.orders.firm_space_id
        AND ca.user_id = auth.uid()
        AND (
          (firm.orders.client_space_id IS NOT NULL AND ca.client_space_id = firm.orders.client_space_id)
          OR (firm.orders.invitee_client_id IS NOT NULL AND ca.invitee_client_id = firm.orders.invitee_client_id)
        )
    )
    OR
    -- Client: user is member of the order's client space (e.g. after invitee claim)
    (firm.orders.client_space_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.orders.client_space_id
        AND us.user_id = auth.uid()
    ))
  );

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
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.orders.firm_space_id
        AND ca.user_id = auth.uid()
        AND (
          (firm.orders.client_space_id IS NOT NULL AND ca.client_space_id = firm.orders.client_space_id)
          OR (firm.orders.invitee_client_id IS NOT NULL AND ca.invitee_client_id = firm.orders.invitee_client_id)
        )
    )
  );

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
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.orders.firm_space_id
        AND ca.user_id = auth.uid()
        AND (
          (firm.orders.client_space_id IS NOT NULL AND ca.client_space_id = firm.orders.client_space_id)
          OR (firm.orders.invitee_client_id IS NOT NULL AND ca.invitee_client_id = firm.orders.invitee_client_id)
        )
    )
  );

COMMENT ON POLICY firm_orders_select ON firm.orders IS 'Engagement visibility by client assignee: admin all; member only orders for clients they assign; client sees own.';
COMMENT ON POLICY firm_orders_update ON firm.orders IS 'Same as SELECT (created_by not used for permission).';
COMMENT ON POLICY firm_orders_delete ON firm.orders IS 'Same as SELECT.';
