-- Sync public.projects.status when firm.orders.status is updated.
-- Client project display should follow the linked order state (order is source of truth for engagement lifecycle).

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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_project_status_from_order_trigger ON firm.orders;
CREATE TRIGGER sync_project_status_from_order_trigger
  AFTER UPDATE OF status ON firm.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION firm.sync_project_status_from_order();

COMMENT ON FUNCTION firm.sync_project_status_from_order() IS 'When firm.orders.status changes, update the linked public.projects.status so client project state follows the order.';
