-- 客户状态仅保留 active/inactive；展示状态由业务规则自动计算（见 docs/CRM-CLIENT-STATUS.md）
-- 依赖：20250224100000_add_client_status_assignee_follow_ups.sql

ALTER TABLE firm.clients DROP CONSTRAINT IF EXISTS clients_status_check;

ALTER TABLE firm.clients
  ADD CONSTRAINT clients_status_check CHECK (status IN ('active', 'inactive'));

-- 将既有 pending 统一改为 active
UPDATE firm.clients SET status = 'active' WHERE status NOT IN ('active', 'inactive');

COMMENT ON COLUMN firm.clients.status IS '客户表状态：active 正常，inactive 已停服；列表展示状态由 displayStatus 自动计算';
