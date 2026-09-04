-- 分类与用途：增加 scope 字段区分支出/收入，不增加新表
-- 执行：在 Supabase SQL Editor 中运行此脚本

-- categories: 用于支出 expense 或收入 income
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'expense';

UPDATE categories SET scope = 'expense' WHERE scope IS NULL;

-- 可选：约束仅允许 'expense' | 'income'
-- ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_scope_check;
-- ALTER TABLE categories ADD CONSTRAINT categories_scope_check CHECK (scope IN ('expense', 'income'));

-- purposes: 用于支出 expense 或收入 income
ALTER TABLE purposes
  ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'expense';

UPDATE purposes SET scope = 'expense' WHERE scope IS NULL;

-- 可选：约束
-- ALTER TABLE purposes DROP CONSTRAINT IF EXISTS purposes_scope_check;
-- ALTER TABLE purposes ADD CONSTRAINT purposes_scope_check CHECK (scope IN ('expense', 'income'));

-- 说明：执行后可在管理页分「支出」「收入」两组维护；模型识别支出时用 expense 列表、收入时用 income 列表。
