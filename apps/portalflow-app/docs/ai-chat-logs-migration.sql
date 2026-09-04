-- ai_chat_logs 表迁移脚本
-- 说明：
-- - 请先在测试环境执行并验证无误，再在生产环境执行
-- - 若项目 ID 不是 uuid，请将 uuid 改为 text 或对应类型

-- 1. 新增 project_id 列（用于按报税项目区分聊天记录）
ALTER TABLE ai_chat_logs
  ADD COLUMN IF NOT EXISTS project_id uuid NULL;

-- 从 request_data 中回填历史 projectId（如曾经写入过）
UPDATE ai_chat_logs
SET project_id = NULLIF(request_data->>'projectId', '')::uuid
WHERE voucher_type IN ('attachments', 'tax-filing');


-- 2. voucher_type: 'attachments' -> 'tax-filing'
UPDATE ai_chat_logs
SET voucher_type = 'tax-filing'
WHERE voucher_type = 'attachments';


-- 3. audio_url 更名为 attachment_url（统一所有附件/音频的 URL）
ALTER TABLE ai_chat_logs
RENAME COLUMN audio_url TO attachment_url;


-- 4. 可选：简化 request_data 内容（根据需要选择是否执行）

-- 4.1 语音类记录：只保留时长，去掉冗余 audioUrl / imageUrl 等
UPDATE ai_chat_logs
SET request_data = jsonb_build_object(
  'audioDurationSeconds', COALESCE((request_data->>'audioDurationSeconds')::int, 0)
)
WHERE type = 'audio';

-- 4.2 报税附件记录：保留 todoId 与 fileName，projectId 已迁到 project_id 列
UPDATE ai_chat_logs
SET request_data = jsonb_strip_nulls(
  jsonb_build_object(
    'todoId', request_data->>'todoId',
    'fileName', request_data->>'fileName'
  )
)
WHERE voucher_type = 'tax-filing';

-- 4.3 票据 / 发票 / inbound / outbound 的图片 / 文档：
--     保留 imageUrl / rawText 即可，如需更细可按 voucher_type 再拆分
UPDATE ai_chat_logs
SET request_data = jsonb_strip_nulls(
  jsonb_build_object(
    'imageUrl', request_data->>'imageUrl',
    'rawText', request_data->>'rawText'
  )
)
WHERE type IN ('image', 'text');

