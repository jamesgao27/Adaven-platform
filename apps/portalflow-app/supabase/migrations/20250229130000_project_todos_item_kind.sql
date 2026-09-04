-- project_todos 增加 item_kind，用于区分 phase/section/task，进度只统计 task
ALTER TABLE public.project_todos
  ADD COLUMN IF NOT EXISTS item_kind TEXT NOT NULL DEFAULT 'task'
  CHECK (item_kind IN ('phase', 'section', 'task'));

COMMENT ON COLUMN public.project_todos.item_kind IS 'phase=阶段, section=分类, task=可执行任务；进度统计仅计 task';
