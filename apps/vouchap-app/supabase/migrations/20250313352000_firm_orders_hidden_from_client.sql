-- Space-level hide for client: add hidden_from_client_at to firm.orders and RPCs for client to set/clear.
-- When firm restarts the order (status no longer cancelled), clear hidden so it shows again for the space.

ALTER TABLE firm.orders
  ADD COLUMN IF NOT EXISTS hidden_from_client_at TIMESTAMPTZ;

COMMENT ON COLUMN firm.orders.hidden_from_client_at IS 'When set, this order is hidden from the client space list (space-level; any member of client_space_id sees the same). Cleared when firm restarts the order.';

-- RPC: client-space member may set hidden (hide from list)
CREATE OR REPLACE FUNCTION firm.hide_order_for_client(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
BEGIN
  UPDATE firm.orders o
  SET hidden_from_client_at = now()
  WHERE o.id = p_order_id
    AND o.client_space_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid() AND us.space_id = o.client_space_id
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or you do not have permission to hide it';
  END IF;
END;
$$;

-- RPC: client-space member may clear hidden (unhide)
CREATE OR REPLACE FUNCTION firm.unhide_order_for_client(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
BEGIN
  UPDATE firm.orders o
  SET hidden_from_client_at = NULL
  WHERE o.id = p_order_id
    AND o.client_space_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid() AND us.space_id = o.client_space_id
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or you do not have permission to unhide it';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION firm.hide_order_for_client(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION firm.unhide_order_for_client(uuid) TO authenticated;

COMMENT ON FUNCTION firm.hide_order_for_client(uuid) IS 'Client-space member hides this order from the list (space-level).';
COMMENT ON FUNCTION firm.unhide_order_for_client(uuid) IS 'Client-space member unhides this order.';

-- When order status is no longer cancelled (firm restarted), clear hidden so it shows again
CREATE OR REPLACE FUNCTION firm.sync_project_status_from_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  proj_status text;
BEGIN
  -- Map order status to project status (public.projects.status: planned, in_progress, completed, cancelled)
  proj_status := CASE NEW.status
    WHEN 'onboarding' THEN 'planned'
    WHEN 'processing' THEN 'in_progress'
    WHEN 'completed'  THEN 'completed'
    WHEN 'cancelled'  THEN 'cancelled'
    ELSE NULL
  END;
  IF proj_status IS NOT NULL THEN
    UPDATE public.projects
    SET status = proj_status, updated_at = now()
    WHERE order_id = NEW.id;
  END IF;
  -- Firm restarted order: clear space-level hidden so client list shows it again
  IF NEW.status IS DISTINCT FROM 'cancelled' THEN
    NEW.hidden_from_client_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
