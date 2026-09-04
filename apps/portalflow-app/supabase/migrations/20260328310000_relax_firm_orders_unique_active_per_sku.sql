-- Relax overly strict uniqueness: allow multiple orders per (firm_space_id, client_space_id, sku_id, status).
-- Keep a (much weaker) UNIQUE for legacy ON CONFLICT references by including created_at.
-- This preserves idempotency patterns that reference the constraint name without blocking legitimate multi-orders.

SET search_path = public, firm;

ALTER TABLE firm.orders
  DROP CONSTRAINT IF EXISTS firm_orders_unique_active_per_sku;

ALTER TABLE firm.orders
  ADD CONSTRAINT firm_orders_unique_active_per_sku
  UNIQUE (firm_space_id, client_space_id, sku_id, status, created_at);

COMMENT ON CONSTRAINT firm_orders_unique_active_per_sku ON firm.orders IS
  'Relaxed: allow multiple orders per client+sku+status; uniqueness only when created_at is identical (legacy ON CONFLICT target).';

