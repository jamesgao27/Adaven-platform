-- Migration: 重命名 public.project_todos.status 的 6 种状态值，便于业务理解
-- 旧值：
--   action_required, missing_info, under_review, flagged, success, canceled
-- 新值：
--   to_submit, missing_info, reviewing, in_progress, completed, canceled
-- 语义对应：
--   to_submit     → To Submit      （初始责任 / 主动撤回时）
--   reviewing     → Reviewing      （已提交给 firm，待审）
--   in_progress   → In Progress    （被 firm 接管处理中）
--   missing_info  → Missing Info   （被 firm 退回补充资料）
--   completed     → Completed      （firm 确认完成）
--   canceled      → Canceled       （任务被终止，不参与父级状态传导）

ALTER TABLE public.project_todos
  DROP CONSTRAINT IF EXISTS project_todos_status_check;

-- 将旧枚举值迁移为新命名（id 不变，仅字符串更易读）
UPDATE public.project_todos SET status = 'to_submit'    WHERE status = 'action_required';
UPDATE public.project_todos SET status = 'reviewing'    WHERE status = 'under_review';
UPDATE public.project_todos SET status = 'in_progress'  WHERE status = 'flagged';
UPDATE public.project_todos SET status = 'missing_info' WHERE status = 'missing_info';
UPDATE public.project_todos SET status = 'completed'    WHERE status = 'success';
UPDATE public.project_todos SET status = 'canceled'     WHERE status = 'canceled';

ALTER TABLE public.project_todos
  ADD CONSTRAINT project_todos_status_check
  CHECK (status IN ('to_submit', 'missing_info', 'reviewing', 'in_progress', 'completed', 'canceled'));

COMMENT ON COLUMN public.project_todos.status IS
  '项目任务状态：to_submit=待提交, missing_info=资料不完整/被退回, reviewing=已提交待审, in_progress=由 firm 处理中, completed=已完成, canceled=已终止';

