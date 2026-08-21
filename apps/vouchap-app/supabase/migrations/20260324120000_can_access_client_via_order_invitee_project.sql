SET search_path = public, firm;

-- SUPERSEDED by 20260325110000 then 20260325140000 (firm.can_access_client uses firm.clients via COALESCE(client_id, invitee_client_id); no invitee_clients JOIN).
-- Kept for migration replay order on new environments.

-- firm.can_access_client previously required firm.orders.client_space_id = firm.clients.client_space_id.
-- Engagements can still be visible via can_access_order when:
--   - order links client only through invitee_clients.clients_space_id (order.client_space_id not set yet), or
--   - public.projects.client_space_id is set while order row was not backfilled.
-- Extend the helper so order-scoped users see the same clients in firm.clients RLS.

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
      AND firm.can_access_order(p_user_id, o.id, p_for_write)
  )
  OR EXISTS (
    SELECT 1
    FROM firm.orders o
    JOIN firm.invitee_clients ic ON ic.id = o.invitee_client_id
    WHERE o.firm_space_id = p_firm_space_id
      AND o.invitee_client_id IS NOT NULL
      AND ic.clients_space_id IS NOT NULL
      AND ic.clients_space_id = p_client_space_id
      AND firm.can_access_order(p_user_id, o.id, p_for_write)
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN firm.orders o ON o.id = p.order_id
    WHERE p.client_space_id = p_client_space_id
      AND o.firm_space_id = p_firm_space_id
      AND p.order_id IS NOT NULL
      AND firm.can_access_order(p_user_id, o.id, p_for_write)
  );
$$;

COMMENT ON FUNCTION firm.can_access_client(uuid, uuid, uuid, boolean) IS
  'True if user can access any firm order for this client (direct order.client_space_id, invitee_clients.clients_space_id, or project.client_space_id).';
