-- ai_chat_logs: 增补字段以精确区分助理类型与识别对象

alter table public.ai_chat_logs
  add column if not exists invoice_id uuid null,
  add column if not exists inbound_id uuid null,
  add column if not exists outbound_id uuid null,
  add column if not exists project_todo_id uuid null;

-- 若 type 字段为 enum，需要在数据库手动扩展枚举。
-- 这里假设 type 为 text/varchar，因此无需额外迁移即可写入
-- 'document' 与 'attachment' 两种新类型。

