-- Repair: 25140000 may have failed when client_follow_ups.invitee_client_id pointed at rows not yet in firm.clients.
-- Clears invalid client_id, backfills only where firm.clients exists, re-adds FK, reapplies safe trigger bodies.
SET search_path = public, firm;

ALTER TABLE firm.client_follow_ups DROP CONSTRAINT IF EXISTS client_follow_ups_client_id_fkey;

ALTER TABLE firm.client_follow_ups ADD COLUMN IF NOT EXISTS client_id UUID;

UPDATE firm.client_follow_ups cfu
SET client_id = NULL
WHERE cfu.client_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM firm.clients c WHERE c.id = cfu.client_id);

UPDATE firm.client_follow_ups cfu
SET client_id = cfu.invitee_client_id
FROM firm.clients c
WHERE cfu.invitee_client_id IS NOT NULL
  AND cfu.client_id IS NULL
  AND c.id = cfu.invitee_client_id;

ALTER TABLE firm.client_follow_ups
  ADD CONSTRAINT client_follow_ups_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES firm.clients(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION firm.on_order_insert_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, firm
AS $$
DECLARE
  v_uid uuid;
BEGIN
  IF NEW.client_space_id IS NOT NULL THEN
    PERFORM firm.touch_client(NEW.firm_space_id, NEW.client_space_id, NEW.created_at);
    INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
    VALUES (NEW.firm_space_id, NEW.client_space_id, 'Order created', 'order_created', NEW.id, NEW.created_by);
  ELSIF NEW.client_id IS NOT NULL OR NEW.invitee_client_id IS NOT NULL THEN
    v_uid := COALESCE(NEW.client_id, NEW.invitee_client_id);
    IF EXISTS (SELECT 1 FROM firm.clients c WHERE c.id = v_uid) THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, client_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, v_uid, 'Order created', 'order_created', NEW.id, NEW.created_by);
    ELSIF NEW.invitee_client_id IS NOT NULL THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, invitee_client_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, NEW.invitee_client_id, 'Order created', 'order_created', NEW.id, NEW.created_by);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION firm.on_order_update_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, firm
AS $$
DECLARE
  v_uid uuid;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.client_space_id IS NOT NULL THEN
    PERFORM firm.touch_client(NEW.firm_space_id, NEW.client_space_id, NEW.updated_at);

    IF NEW.status = 'completed' THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, NEW.client_space_id, 'Order completed', 'order_completed', NEW.id, NEW.created_by);

    ELSIF NEW.status = 'cancelled' THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, NEW.client_space_id, 'Order cancelled', 'order_cancelled', NEW.id, NEW.created_by);

    ELSIF OLD.status = 'onboarding' AND NEW.status NOT IN ('onboarding', 'cancelled') THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, NEW.client_space_id, 'Service started', 'order_started', NEW.id, NEW.created_by);
    END IF;

  ELSIF NEW.client_id IS NOT NULL OR NEW.invitee_client_id IS NOT NULL THEN
    v_uid := COALESCE(NEW.client_id, NEW.invitee_client_id);
    IF EXISTS (SELECT 1 FROM firm.clients c WHERE c.id = v_uid) THEN
      IF NEW.status = 'completed' THEN
        INSERT INTO firm.client_follow_ups (firm_space_id, client_id, content, kind, reference_id, created_by)
        VALUES (NEW.firm_space_id, v_uid, 'Order completed', 'order_completed', NEW.id, NEW.created_by);

      ELSIF NEW.status = 'cancelled' THEN
        INSERT INTO firm.client_follow_ups (firm_space_id, client_id, content, kind, reference_id, created_by)
        VALUES (NEW.firm_space_id, v_uid, 'Order cancelled', 'order_cancelled', NEW.id, NEW.created_by);

      ELSIF OLD.status = 'onboarding' AND NEW.status NOT IN ('onboarding', 'cancelled') THEN
        INSERT INTO firm.client_follow_ups (firm_space_id, client_id, content, kind, reference_id, created_by)
        VALUES (NEW.firm_space_id, v_uid, 'Service started', 'order_started', NEW.id, NEW.created_by);
      END IF;
    ELSIF NEW.invitee_client_id IS NOT NULL THEN
      IF NEW.status = 'completed' THEN
        INSERT INTO firm.client_follow_ups (firm_space_id, invitee_client_id, content, kind, reference_id, created_by)
        VALUES (NEW.firm_space_id, NEW.invitee_client_id, 'Order completed', 'order_completed', NEW.id, NEW.created_by);

      ELSIF NEW.status = 'cancelled' THEN
        INSERT INTO firm.client_follow_ups (firm_space_id, invitee_client_id, content, kind, reference_id, created_by)
        VALUES (NEW.firm_space_id, NEW.invitee_client_id, 'Order cancelled', 'order_cancelled', NEW.id, NEW.created_by);

      ELSIF OLD.status = 'onboarding' AND NEW.status NOT IN ('onboarding', 'cancelled') THEN
        INSERT INTO firm.client_follow_ups (firm_space_id, invitee_client_id, content, kind, reference_id, created_by)
        VALUES (NEW.firm_space_id, NEW.invitee_client_id, 'Service started', 'order_started', NEW.id, NEW.created_by);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
