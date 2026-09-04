-- Migration: 创建 project_todos 责任方流转历史表（含可选意见 note）

-- 1) 历史表：记录每次责任方变更 + 可选意见
CREATE TABLE IF NOT EXISTS public.project_todo_responsible_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_todo_id UUID NOT NULL
    REFERENCES public.project_todos(id) ON DELETE CASCADE,
  from_side TEXT NOT NULL
    CHECK (from_side IN ('client', 'firm')),
  to_side   TEXT NOT NULL
    CHECK (to_side IN ('client', 'firm')),
  note      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_todo_responsible_history_todo
  ON public.project_todo_responsible_history(project_todo_id);

COMMENT ON TABLE public.project_todo_responsible_history IS
  'project_todos 责任方流转历史；含 from/to 以及可选意见 note';

COMMENT ON COLUMN public.project_todo_responsible_history.note IS
  '流转时填写的说明/意见，可为空';

-- 2) RLS：与 project_todos 授权一致，可访问该项目的用户均可读写历史
ALTER TABLE public.project_todo_responsible_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_todo_responsible_history_select
ON public.project_todo_responsible_history
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.project_todos t
    JOIN public.projects p ON p.id = t.project_id
    JOIN public.user_spaces us
      ON us.user_id = auth.uid()
     AND (us.space_id = p.client_space_id OR us.space_id = p.firm_space_id)
    WHERE t.id = project_todo_responsible_history.project_todo_id
  )
);

CREATE POLICY project_todo_responsible_history_insert
ON public.project_todo_responsible_history
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.project_todos t
    JOIN public.projects p ON p.id = t.project_id
    JOIN public.user_spaces us
      ON us.user_id = auth.uid()
     AND (us.space_id = p.client_space_id OR us.space_id = p.firm_space_id)
    WHERE t.id = project_todo_responsible_history.project_todo_id
  )
);

