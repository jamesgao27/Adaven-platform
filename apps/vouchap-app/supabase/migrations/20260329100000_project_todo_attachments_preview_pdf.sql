-- Client-generated PDF preview for spreadsheet task attachments (xlsx/xls), used for in-app iframe preview.
ALTER TABLE public.project_todo_attachments
  ADD COLUMN IF NOT EXISTS preview_pdf_url text;

COMMENT ON COLUMN public.project_todo_attachments.preview_pdf_url IS
  'Optional public Storage URL of a PDF derived from attachment_url (e.g. xlsx→pdf) for embedded preview.';
