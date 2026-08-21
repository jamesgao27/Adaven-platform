-- 多前置依赖：project_todos 增加 depends_on_ids 数组，与 depends_on_id 并存（depends_on_id 保留为首项兼容）
ALTER TABLE public.project_todos
  ADD COLUMN IF NOT EXISTS depends_on_ids UUID[] DEFAULT '{}';

COMMENT ON COLUMN public.project_todos.depends_on_ids IS
  'Optional: this todo is blocked until ALL referenced todos reach completed/canceled. Replaces single depends_on_id for multi-select.';

-- 从已有 depends_on_id 回填
UPDATE public.project_todos
SET depends_on_ids = ARRAY[depends_on_id]
WHERE depends_on_id IS NOT NULL AND (depends_on_ids IS NULL OR depends_on_ids = '{}');

CREATE INDEX IF NOT EXISTS idx_project_todos_depends_on_ids
  ON public.project_todos USING GIN (depends_on_ids)
  WHERE depends_on_ids IS NOT NULL AND array_length(depends_on_ids, 1) > 0;
