-- Ensure firm.client_follow_ups written by order status triggers always have created_by set
-- so that follow-up records for order started / cancelled / completed are never owner-less.
SET search_path = public, firm;

-- Recreate on_order_update_follow_up with created_by propagated from firm.orders.created_by
CREATE OR REPLACE FUNCTION firm.on_order_update_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, firm
AS $$
BEGIN
  -- Only act when status actually changes
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Client-side orders
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

  -- Invitee-side orders
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

  RETURN NEW;
END;
$$;

