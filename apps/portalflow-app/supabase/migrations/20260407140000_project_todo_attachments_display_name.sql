-- User-facing attachment title (chat + task file list); AI doc_type stays a separate code column.

ALTER TABLE public.project_todo_attachments
  ADD COLUMN IF NOT EXISTS source_file_name TEXT,
  ADD COLUMN IF NOT EXISTS display_name TEXT;

COMMENT ON COLUMN public.project_todo_attachments.source_file_name IS 'Original upload file name; kept for default title construction.';
COMMENT ON COLUMN public.project_todo_attachments.display_name IS 'Editable label shown in chat and task file rows; distinct from doc_type (AI code).';
