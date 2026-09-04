-- Client 自定义标签改为 clients 表上的文本数组（参考 projects 做法），不再使用 client_labels 表
-- 依赖：若已执行 20250308200000，则本迁移会回退 label_id 并改为 labels[]；若未执行则仅添加 labels[]

-- 1. Drop label_id FK first, then the lookup table.
ALTER TABLE firm.clients
  DROP COLUMN IF EXISTS label_id;

DROP TABLE IF EXISTS firm.client_labels;

ALTER TABLE firm.clients
  ADD COLUMN IF NOT EXISTS labels TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN firm.clients.labels IS 'Client custom tags (text array). Status can show first tag; editable on client detail only.';
