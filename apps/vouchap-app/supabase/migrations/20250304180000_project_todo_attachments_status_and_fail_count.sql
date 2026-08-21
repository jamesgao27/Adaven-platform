-- 扩展 project_todo_attachments.status 取值，并增加识别失败次数计数
-- 新增状态：
--   - PROCESSING    ：正在识别中
--   - FAILED_ONCE   ：识别失败 1 次
--   - FAILED_TWICE  ：识别失败 2 次
--   - FAILED_FINAL  ：识别失败 3 次（不再自动重试，仅允许用户手动重试）
-- 保留原有状态：
--   - PENDING_AI    ：等待触发识别（历史数据或队列中）
--   - PROCESSED     ：识别成功
--   - VERIFIED      ：人工确认/调整后

ALTER TABLE public.project_todo_attachments
  ADD COLUMN IF NOT EXISTS recognition_fail_count INTEGER NOT NULL DEFAULT 0;

-- 更新 status 检查约束，加入新的状态取值
ALTER TABLE public.project_todo_attachments
  DROP CONSTRAINT IF EXISTS project_todo_attachments_status_check;

ALTER TABLE public.project_todo_attachments
  ADD CONSTRAINT project_todo_attachments_status_check
  CHECK (
    status IN (
      'PENDING_AI',
      'PROCESSING',
      'FAILED_ONCE',
      'FAILED_TWICE',
      'FAILED_FINAL',
      'PROCESSED',
      'VERIFIED'
    )
  );

COMMENT ON COLUMN public.project_todo_attachments.recognition_fail_count IS '识别失败次数（用户可见：1 次=FAILED_ONCE，2 次=FAILED_TWICE，3 次及以上=FAILED_FINAL）';

