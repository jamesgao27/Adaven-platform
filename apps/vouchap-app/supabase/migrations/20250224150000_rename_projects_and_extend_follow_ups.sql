-- Rename firm.projects -> firm.project_todos, and extend client_follow_ups for attachments & AI fields

-- 1) Rename projects table to project_todos
ALTER TABLE IF EXISTS firm.projects
  RENAME TO project_todos;

-- Rename index used on order_id (if it exists)
ALTER INDEX IF EXISTS idx_firm_projects_order
  RENAME TO idx_firm_project_todos_order;

COMMENT ON TABLE firm.project_todos IS
  'Firm 端：订单下的清单项（由 sku_items 复制创建），同时作为双方 todo（按 type 区分 client/firm）。';


-- 2) Extend firm.client_follow_ups with attachments & model fields

ALTER TABLE firm.client_follow_ups
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE firm.client_follow_ups
  ADD COLUMN IF NOT EXISTS model_kind text;

ALTER TABLE firm.client_follow_ups
  ADD COLUMN IF NOT EXISTS model_status text
    CHECK (model_status IN ('pending','processing','done','error'));

ALTER TABLE firm.client_follow_ups
  ADD COLUMN IF NOT EXISTS model_result jsonb;

ALTER TABLE firm.client_follow_ups
  ADD COLUMN IF NOT EXISTS model_summary text;

