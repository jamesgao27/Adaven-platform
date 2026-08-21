-- 报税流程节点：预览(pending)、资料收集(gathering)、审阅(submitted)、申报完成(confirmed)、取消(cancelled)
-- 客户接受订单后应为 gathering，不再直接设为 confirmed

-- 1) 放宽 firm.orders.status 的 CHECK，增加 gathering
ALTER TABLE firm.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE firm.orders
  ADD CONSTRAINT firm_orders_status_check
  CHECK (status IN ('pending', 'gathering', 'submitted', 'confirmed', 'cancelled'));

COMMENT ON COLUMN firm.orders.status IS 'pending=预览, gathering=资料收集, submitted=审阅, confirmed=申报完成, cancelled=取消';
