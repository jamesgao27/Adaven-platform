-- Client 自定义标签改为 clients 表上的文本数组（参考 projects 做法），不再使用 client_labels 表
-- 依赖：若已执行 20250308200000，则本迁移会回退 label_id 并改为 labels[]；若未执行则仅添加 labels[]

-- 1. 若存在 client_labels 表则删除（表删除时其 RLS 策略会一并删除；若表从未创建则跳过）
DROP TABLE IF EXISTS firm.client_labels;

-- 2. firm.clients：移除 label_id，增加 labels 文本数组
ALTER TABLE firm.clients
  DROP COLUMN IF EXISTS label_id;

ALTER TABLE firm.clients
  ADD COLUMN IF NOT EXISTS labels TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN firm.clients.labels IS 'Client custom tags (text array). Status can show first tag; editable on client detail only.';
