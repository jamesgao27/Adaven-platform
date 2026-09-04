-- ai_chat_logs: project_todo_id 字段不再使用，安全删除

alter table public.ai_chat_logs
  drop column if exists project_todo_id;

