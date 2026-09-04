-- 任务附件表：核心元数据 + JSONB 动态扩展，不再关联 receipts
-- 替换 project_todo_files（原关联 receipt_id）

DROP TABLE IF EXISTS public.project_todo_files CASCADE;

CREATE TABLE IF NOT EXISTS public.project_todo_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_todo_id UUID NOT NULL REFERENCES public.project_todos(id) ON DELETE CASCADE,
  attachment_url TEXT NOT NULL,
  doc_type TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_AI',
  extracted_data JSONB,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_todo_attachments_status_check CHECK (status IN ('PENDING_AI', 'PROCESSED', 'VERIFIED'))
);

CREATE INDEX IF NOT EXISTS idx_project_todo_attachments_todo ON public.project_todo_attachments(project_todo_id);

ALTER TABLE public.project_todo_attachments ENABLE ROW LEVEL SECURITY;

-- 与 project_todos 一致：通过 project 的 client_space_id / firm_space_id 授权
CREATE POLICY project_todo_attachments_select ON public.project_todo_attachments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.project_todos pt
      JOIN public.projects p ON p.id = pt.project_id
      WHERE pt.id = project_todo_attachments.project_todo_id
        AND EXISTS (
          SELECT 1 FROM public.user_spaces us
          WHERE us.user_id = auth.uid() AND (us.space_id = p.client_space_id OR us.space_id = p.firm_space_id)
        )
    )
  );

CREATE POLICY project_todo_attachments_insert ON public.project_todo_attachments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_todos pt
      JOIN public.projects p ON p.id = pt.project_id
      WHERE pt.id = project_todo_id
        AND EXISTS (
          SELECT 1 FROM public.user_spaces us
          WHERE us.user_id = auth.uid() AND (us.space_id = p.client_space_id OR us.space_id = p.firm_space_id)
        )
    )
  );

CREATE POLICY project_todo_attachments_update ON public.project_todo_attachments FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.project_todos pt
      JOIN public.projects p ON p.id = pt.project_id
      WHERE pt.id = project_todo_attachments.project_todo_id
        AND EXISTS (
          SELECT 1 FROM public.user_spaces us
          WHERE us.user_id = auth.uid() AND (us.space_id = p.client_space_id OR us.space_id = p.firm_space_id)
        )
    )
  );

CREATE POLICY project_todo_attachments_delete ON public.project_todo_attachments FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.project_todos pt
      JOIN public.projects p ON p.id = pt.project_id
      WHERE pt.id = project_todo_attachments.project_todo_id
        AND EXISTS (
          SELECT 1 FROM public.user_spaces us
          WHERE us.user_id = auth.uid() AND (us.space_id = p.client_space_id OR us.space_id = p.firm_space_id)
        )
    )
  );

COMMENT ON TABLE public.project_todo_attachments IS '任务关联的附件；核心元数据 + extracted_data JSONB 动态扩展；attachment_url 为 Storage 路径或公网 URL';
COMMENT ON COLUMN public.project_todo_attachments.doc_type IS 'AI 识别类型，如 CANADA_T4, US_1040_W2, EXPENSE_RECEIPT';
COMMENT ON COLUMN public.project_todo_attachments.status IS 'PENDING_AI | PROCESSED | VERIFIED';
