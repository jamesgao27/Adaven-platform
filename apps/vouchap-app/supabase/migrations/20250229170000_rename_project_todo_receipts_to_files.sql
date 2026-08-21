-- 若之前已运行旧迁移创建了 project_todo_receipts，则重命名为 project_todo_files（与新建库一致）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'project_todo_receipts') THEN
    ALTER TABLE public.project_todo_receipts RENAME TO project_todo_files;
    DROP POLICY IF EXISTS project_todo_receipts_select ON public.project_todo_files;
    DROP POLICY IF EXISTS project_todo_receipts_insert ON public.project_todo_files;
    DROP POLICY IF EXISTS project_todo_receipts_delete ON public.project_todo_files;
    CREATE POLICY project_todo_files_select ON public.project_todo_files FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.project_todos pt
          JOIN public.projects p ON p.id = pt.project_id
          JOIN public.receipts r ON r.id = project_todo_files.receipt_id
          WHERE pt.id = project_todo_files.project_todo_id
            AND (p.client_space_id = r.space_id OR p.firm_space_id = r.space_id)
            AND EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.user_id = auth.uid() AND (us.space_id = p.client_space_id OR us.space_id = p.firm_space_id))
        )
      );
    CREATE POLICY project_todo_files_insert ON public.project_todo_files FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.project_todos pt
          JOIN public.projects p ON p.id = pt.project_id
          JOIN public.receipts r ON r.id = receipt_id
          WHERE pt.id = project_todo_id
            AND (p.client_space_id = r.space_id OR p.firm_space_id = r.space_id)
            AND EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.user_id = auth.uid() AND (us.space_id = p.client_space_id OR us.space_id = p.firm_space_id))
        )
      );
    CREATE POLICY project_todo_files_delete ON public.project_todo_files FOR DELETE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.project_todos pt
          JOIN public.projects p ON p.id = pt.project_id
          WHERE pt.id = project_todo_files.project_todo_id
            AND EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.user_id = auth.uid() AND (us.space_id = p.client_space_id OR us.space_id = p.firm_space_id))
        )
      );
    COMMENT ON TABLE public.project_todo_files IS '任务关联的附件（收据/凭证）；上传或 AI 匹配后关联到 project_todo，附件 URL 存于 receipts.image_url';
  END IF;
END $$;
