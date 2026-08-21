-- Migration: 为 public.project_todos 增加 initial_responsible_side（初始责任方）
-- 用于与当前责任方 responsible_side 区分，避免初始即为 firm 负责的任务出现 RETURN 等不合理选项。

-- 1) 新增列：initial_responsible_side（可选，取值 client/firm）
ALTER TABLE public.project_todos
  ADD COLUMN IF NOT EXISTS initial_responsible_side TEXT
    CHECK (initial_responsible_side IN ('client', 'firm'));

COMMENT ON COLUMN public.project_todos.initial_responsible_side IS
  '初始责任方：client | firm。创建时固定不变，通常从 firm.sku_items.initial_responsible_side 复制，用于判断是否允许 RETURN 等流转操作。';

-- 2) 回填已有数据：将当前 responsible_side 作为初始责任方
UPDATE public.project_todos
SET initial_responsible_side = responsible_side
WHERE initial_responsible_side IS NULL;
