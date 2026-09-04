-- 1) 复用：统一更新 clients.updated_at 的函数（跟进、订单等操作均可调用）
CREATE OR REPLACE FUNCTION firm.touch_client(
  p_firm_space_id UUID,
  p_client_space_id UUID,
  p_at TIMESTAMPTZ DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, firm
AS $$
BEGIN
  UPDATE firm.clients
  SET updated_at = p_at
  WHERE firm_space_id = p_firm_space_id AND client_space_id = p_client_space_id;
END;
$$;

COMMENT ON FUNCTION firm.touch_client IS '更新该客户在 firm.clients 的 updated_at，供跟进、订单等任何“触及”客户的操作复用';

-- 2) client_follow_ups 增加 kind、reference_id，用于区分手动备注与订单等系统事件
ALTER TABLE firm.client_follow_ups
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'note'
  CHECK (kind IN ('note', 'order_created', 'order_started', 'order_completed', 'order_cancelled'));

ALTER TABLE firm.client_follow_ups
  ADD COLUMN IF NOT EXISTS reference_id UUID;

COMMENT ON COLUMN firm.client_follow_ups.kind IS 'note=手动跟进, order_created=创建订单, order_started=启动服务, order_completed=完成订单, order_cancelled=取消订单';
COMMENT ON COLUMN firm.client_follow_ups.reference_id IS '关联实体 id，如 order_id';

-- 3) 跟进插入时改为调用 touch_client，并保持与现有触发器兼容
CREATE OR REPLACE FUNCTION firm.set_client_last_follow_up_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, firm
AS $$
BEGIN
  PERFORM firm.touch_client(NEW.firm_space_id, NEW.client_space_id, NEW.created_at);
  RETURN NEW;
END;
$$;

-- 4) 订单 INSERT：touch_client + 写入一条 follow_up（Order created）
CREATE OR REPLACE FUNCTION firm.on_order_insert_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, firm
AS $$
BEGIN
  PERFORM firm.touch_client(NEW.firm_space_id, NEW.client_space_id, NEW.created_at);
  INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
  VALUES (NEW.firm_space_id, NEW.client_space_id, 'Order created', 'order_created', NEW.id, NEW.created_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_insert_follow_up ON firm.orders;
CREATE TRIGGER trg_order_insert_follow_up
  AFTER INSERT ON firm.orders
  FOR EACH ROW EXECUTE PROCEDURE firm.on_order_insert_follow_up();

-- 5) 订单 UPDATE status：touch_client + 按状态变化写入 follow_up（Service started / Order completed / Order cancelled）
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_update_follow_up ON firm.orders;
CREATE TRIGGER trg_order_update_follow_up
  AFTER UPDATE OF status ON firm.orders
  FOR EACH ROW EXECUTE PROCEDURE firm.on_order_update_follow_up();
