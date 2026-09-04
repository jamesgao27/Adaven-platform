-- Invitee 客户同样有 last follow-up、service start：client_follow_ups 支持 invitee_client_id，订单触发器为 invitee 订单写入跟进
SET search_path = public, firm;

-- 1) client_follow_ups 支持 invitee：新增 invitee_client_id，client_space_id 改为可空
ALTER TABLE firm.client_follow_ups
  ADD COLUMN IF NOT EXISTS invitee_client_id UUID REFERENCES firm.invitee_clients(id) ON DELETE CASCADE;

ALTER TABLE firm.client_follow_ups
  ALTER COLUMN client_space_id DROP NOT NULL;

ALTER TABLE firm.client_follow_ups
  ADD CONSTRAINT client_follow_ups_client_or_invitee CHECK (
    (client_space_id IS NOT NULL AND invitee_client_id IS NULL)
    OR (client_space_id IS NULL AND invitee_client_id IS NOT NULL)
  );

COMMENT ON COLUMN firm.client_follow_ups.invitee_client_id IS 'Invitee 跟进：仅当 client_space_id 为空时使用；认领后跟进按 client_space_id 记';

CREATE INDEX IF NOT EXISTS idx_firm_client_follow_ups_invitee
  ON firm.client_follow_ups (invitee_client_id)
  WHERE invitee_client_id IS NOT NULL;

-- 2) 插入跟进时仅对 client 行更新 clients.updated_at（invitee 行不更新 firm.clients）
CREATE OR REPLACE FUNCTION firm.set_client_last_follow_up_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, firm
AS $$
BEGIN
  IF NEW.client_space_id IS NOT NULL THEN
    PERFORM firm.touch_client(NEW.firm_space_id, NEW.client_space_id, NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$;

-- 3) 订单 INSERT：client 订单写 client 跟进；invitee 订单写 invitee 跟进
CREATE OR REPLACE FUNCTION firm.on_order_insert_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, firm
AS $$
BEGIN
  IF NEW.client_space_id IS NOT NULL THEN
    PERFORM firm.touch_client(NEW.firm_space_id, NEW.client_space_id, NEW.created_at);
    INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
    VALUES (NEW.firm_space_id, NEW.client_space_id, 'Order created', 'order_created', NEW.id, NEW.created_by);
  ELSIF NEW.invitee_client_id IS NOT NULL THEN
    INSERT INTO firm.client_follow_ups (firm_space_id, invitee_client_id, content, kind, reference_id, created_by)
    VALUES (NEW.firm_space_id, NEW.invitee_client_id, 'Order created', 'order_created', NEW.id, NEW.created_by);
  END IF;
  RETURN NEW;
END;
$$;

-- 4) 订单 UPDATE status：client / invitee 分别写跟进
CREATE OR REPLACE FUNCTION firm.on_order_update_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, firm
AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.client_space_id IS NOT NULL THEN
    PERFORM firm.touch_client(NEW.firm_space_id, NEW.client_space_id, NEW.updated_at);
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
  ELSIF NEW.invitee_client_id IS NOT NULL THEN
    IF NEW.status = 'completed' THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, invitee_client_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, NEW.invitee_client_id, 'Order completed', 'order_completed', NEW.id, NULL);
    ELSIF NEW.status = 'cancelled' THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, invitee_client_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, NEW.invitee_client_id, 'Order cancelled', 'order_cancelled', NEW.id, NULL);
    ELSIF OLD.status = 'onboarding' AND NEW.status NOT IN ('onboarding', 'cancelled') THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, invitee_client_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, NEW.invitee_client_id, 'Service started', 'order_started', NEW.id, NULL);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
