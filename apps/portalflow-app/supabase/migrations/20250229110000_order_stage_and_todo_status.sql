-- 订单 6 阶段 + 待办 5 状态（见需求文档）
-- Stage: Onboarding（启动）= 契约建立，不再保留 pending。6 阶段 + cancelled
-- Todo: Action Required, Missing Info, Under Review, Flagged, Success

-- =============================================================================
-- 1) firm.orders.status：6 阶段 + cancelled
-- =============================================================================
ALTER TABLE firm.orders
  DROP CONSTRAINT IF EXISTS firm_orders_status_check;

ALTER TABLE firm.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

-- 迁移旧数据（pending 与 gathering 均归为 onboarding）
UPDATE firm.orders SET status = 'onboarding' WHERE status IN ('pending', 'gathering');
UPDATE firm.orders SET status = 'processing' WHERE status = 'submitted';
UPDATE firm.orders SET status = 'completed' WHERE status = 'confirmed';

ALTER TABLE firm.orders
  ADD CONSTRAINT firm_orders_status_check
  CHECK (status IN ('onboarding', 'collecting', 'processing', 'reviewing', 'filing', 'completed', 'cancelled'));

COMMENT ON COLUMN firm.orders.status IS 'onboarding=启动, collecting=资料中, processing=处理中, reviewing=待确认, filing=申报中, completed=已完成, cancelled=取消';

-- =============================================================================
-- 2) public.project_todos.status：5 状态
-- =============================================================================
ALTER TABLE public.project_todos
  DROP CONSTRAINT IF EXISTS project_todos_status_check;

UPDATE public.project_todos SET status = 'action_required' WHERE status = 'pending';
UPDATE public.project_todos SET status = 'under_review' WHERE status = 'submitted';
UPDATE public.project_todos SET status = 'success' WHERE status = 'confirmed';

ALTER TABLE public.project_todos
  ADD CONSTRAINT project_todos_status_check
  CHECK (status IN ('action_required', 'missing_info', 'under_review', 'flagged', 'success'));

COMMENT ON COLUMN public.project_todos.status IS 'action_required=需客户行动, missing_info=资料不完整, under_review=审核中, flagged=有争议, success=已通过';
