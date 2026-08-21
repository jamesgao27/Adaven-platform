-- Simplify firm.orders.status to four values: onboarding, processing, completed, cancelled.
-- Merge collecting, reviewing, filing into processing.
SET search_path = public, firm;

UPDATE firm.orders SET status = 'processing' WHERE status IN ('collecting', 'reviewing', 'filing');

ALTER TABLE firm.orders DROP CONSTRAINT IF EXISTS firm_orders_status_check;

ALTER TABLE firm.orders
  ADD CONSTRAINT firm_orders_status_check
  CHECK (status IN ('onboarding', 'processing', 'completed', 'cancelled'));

COMMENT ON COLUMN firm.orders.status IS 'onboarding=启动, processing=进行中, completed=已完成, cancelled=取消';
