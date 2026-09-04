-- Fix regression introduced in 20260328280000:
-- pending orders (client_space_id IS NULL, client_id IS NOT NULL) must write follow-ups via client_id path.
SET search_path = public, firm;

CREATE OR REPLACE FUNCTION firm.on_order_insert_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
BEGIN
  IF NEW.client_space_id IS NOT NULL THEN
    UPDATE firm.clients
    SET updated_at = NEW.created_at
    WHERE firm_space_id = NEW.firm_space_id
      AND client_space_id = NEW.client_space_id;

    INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
    VALUES (NEW.firm_space_id, NEW.client_space_id, 'Order created', 'order_created', NEW.id, NEW.created_by);
  ELSIF NEW.client_id IS NOT NULL THEN
    UPDATE firm.clients
    SET updated_at = NEW.created_at
    WHERE id = NEW.client_id
      AND firm_space_id = NEW.firm_space_id;

    INSERT INTO firm.client_follow_ups (firm_space_id, client_id, content, kind, reference_id, created_by)
    VALUES (NEW.firm_space_id, NEW.client_id, 'Order created', 'order_created', NEW.id, NEW.created_by);
  END IF;

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

  IF NEW.client_space_id IS NOT NULL THEN
    UPDATE firm.clients
    SET updated_at = NEW.updated_at
    WHERE firm_space_id = NEW.firm_space_id
      AND client_space_id = NEW.client_space_id;

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
  ELSIF NEW.client_id IS NOT NULL THEN
    UPDATE firm.clients
    SET updated_at = NEW.updated_at
    WHERE id = NEW.client_id
      AND firm_space_id = NEW.firm_space_id;

    IF NEW.status = 'completed' THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, client_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, NEW.client_id, 'Order completed', 'order_completed', NEW.id, NULL);
    ELSIF NEW.status = 'cancelled' THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, client_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, NEW.client_id, 'Order cancelled', 'order_cancelled', NEW.id, NULL);
    ELSIF OLD.status = 'onboarding' AND NEW.status NOT IN ('onboarding', 'cancelled') THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, client_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, NEW.client_id, 'Service started', 'order_started', NEW.id, NULL);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION firm.on_order_insert_follow_up() IS
  'SECURITY DEFINER; supports both claimed clients (client_space_id) and pending clients (client_id).';
COMMENT ON FUNCTION firm.on_order_update_follow_up() IS
  'SECURITY DEFINER; supports both claimed clients (client_space_id) and pending clients (client_id).';
