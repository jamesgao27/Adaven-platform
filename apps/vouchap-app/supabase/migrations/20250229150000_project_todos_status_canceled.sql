-- 允许 project_todos.status = 'canceled'，用于「终止」任务，状态不传导到父级
ALTER TABLE public.project_todos
  DROP CONSTRAINT IF EXISTS project_todos_status_check;

ALTER TABLE public.project_todos
  ADD CONSTRAINT project_todos_status_check
  CHECK (status IN ('action_required', 'missing_info', 'under_review', 'flagged', 'success', 'canceled'));

COMMENT ON COLUMN public.project_todos.status IS 'action_required=需客户行动, missing_info=资料不完整, under_review=审核中, flagged=有争议, success=已通过, canceled=已终止';
