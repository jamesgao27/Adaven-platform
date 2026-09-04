-- 记录上传者姓名（纯文本），用于文件列表行内展示
ALTER TABLE public.project_todo_attachments
  ADD COLUMN IF NOT EXISTS uploader_name TEXT;

COMMENT ON COLUMN public.project_todo_attachments.uploader_name IS '上传操作人姓名（纯文本，用于列表展示）';
