-- Phase 2 (merge invitee → clients): RLS for pending rows + can_access_client via orders.client_id.
-- Depends on 20260325100000_merge_invitee_into_clients_phase1_columns_backfill.sql
SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) can_access_client: keep invitee_clients + project paths; add orders.client_id → firm.clients
--    Replaced again by 20260325140000_phase3_invitee_rpc_firm_clients_followups.sql (no invitee_clients JOIN).
--------------------------------------------------------------------------------

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
    FROM firm.orders o
    JOIN firm.clients c ON c.id = o.client_id
    WHERE o.firm_space_id = p_firm_space_id
      AND o.client_id IS NOT NULL
      AND c.client_space_id IS NOT NULL
      AND c.client_space_id = p_client_space_id
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
  'True if user can access any firm order for this client (order.client_space_id, invitee_clients.clients_space_id, orders.client_id→clients.client_space_id, or project.client_space_id).';

--------------------------------------------------------------------------------
-- 2) firm.clients RLS: pending rows (client_space_id IS NULL) — align with former invitee_clients (firm members)
--------------------------------------------------------------------------------

DROP POLICY IF EXISTS firm_clients_select ON firm.clients;
DROP POLICY IF EXISTS firm_clients_update ON firm.clients;
DROP POLICY IF EXISTS firm_clients_delete ON firm.clients;

CREATE POLICY firm_clients_select ON firm.clients
  FOR SELECT TO authenticated
  USING (
    (
      firm.clients.client_space_id IS NOT NULL
      AND firm.can_access_client(auth.uid(), firm.clients.firm_space_id, firm.clients.client_space_id, false)
    )
    OR (
      firm.clients.client_space_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.user_spaces us
        WHERE us.user_id = auth.uid()
          AND us.space_id = firm.clients.firm_space_id
      )
    )
  );

CREATE POLICY firm_clients_update ON firm.clients
  FOR UPDATE TO authenticated
  USING (
    (
      firm.clients.client_space_id IS NOT NULL
      AND firm.can_access_client(auth.uid(), firm.clients.firm_space_id, firm.clients.client_space_id, true)
    )
    OR (
      firm.clients.client_space_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.user_spaces us
        WHERE us.user_id = auth.uid()
          AND us.space_id = firm.clients.firm_space_id
      )
    )
  );

CREATE POLICY firm_clients_delete ON firm.clients
  FOR DELETE TO authenticated
  USING (
    (
      firm.clients.client_space_id IS NOT NULL
      AND firm.can_access_client(auth.uid(), firm.clients.firm_space_id, firm.clients.client_space_id, true)
    )
    OR (
      firm.clients.client_space_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.user_spaces us
        WHERE us.user_id = auth.uid()
          AND us.space_id = firm.clients.firm_space_id
      )
    )
  );
