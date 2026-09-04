-- projects / project_todos 迁至 public schema，主权归属于 client；projects 增加 firm_space_id、client_space_id 便于授权与查询

-- =============================================================================
-- 1) public.projects（含 firm_space_id、client_space_id、order_id）
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_space_id UUID NOT NULL,
  client_space_id UUID NOT NULL,
  order_id UUID NOT NULL REFERENCES firm.orders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id)
);

CREATE INDEX IF NOT EXISTS idx_public_projects_order ON public.projects(order_id);
CREATE INDEX IF NOT EXISTS idx_public_projects_firm_space ON public.projects(firm_space_id);
CREATE INDEX IF NOT EXISTS idx_public_projects_client_space ON public.projects(client_space_id);
COMMENT ON TABLE public.projects IS '项目（主权归属 client）；一单对应一个 project，含 firm_space_id/client_space_id 用于授权与直接查询';

-- =============================================================================
-- 2) public.project_todos（关联 project_id，树形 parent_id）
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.project_todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  parent_id UUID NULL REFERENCES public.project_todos(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('client', 'firm')),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'confirmed')),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_public_project_todos_project ON public.project_todos(project_id);
CREATE INDEX IF NOT EXISTS idx_public_project_todos_parent ON public.project_todos(parent_id);
COMMENT ON TABLE public.project_todos IS '项目任务/资料槽位（树形 WBS）；主权归属 client';

-- =============================================================================
-- 3) RLS：按 client_space_id / firm_space_id 授权（user_spaces）
-- =============================================================================
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_todos ENABLE ROW LEVEL SECURITY;

-- projects：用户在该项目的 client_space 或 firm_space 内即可访问
CREATE POLICY public_projects_select ON public.projects FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid() AND (us.space_id = projects.client_space_id OR us.space_id = projects.firm_space_id)
    )
  );
CREATE POLICY public_projects_insert ON public.projects FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid() AND us.space_id = projects.firm_space_id
    )
  );
CREATE POLICY public_projects_update ON public.projects FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid() AND (us.space_id = projects.client_space_id OR us.space_id = projects.firm_space_id)
    )
  );
CREATE POLICY public_projects_delete ON public.projects FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid() AND us.space_id = projects.firm_space_id
    )
  );

-- project_todos：通过 project 的 client_space_id / firm_space_id 授权
CREATE POLICY public_project_todos_select ON public.project_todos FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.user_spaces us ON (us.space_id = p.client_space_id OR us.space_id = p.firm_space_id) AND us.user_id = auth.uid()
      WHERE p.id = project_todos.project_id
    )
  );
CREATE POLICY public_project_todos_insert ON public.project_todos FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.user_spaces us ON (us.space_id = p.client_space_id OR us.space_id = p.firm_space_id) AND us.user_id = auth.uid()
      WHERE p.id = project_todos.project_id
    )
  );
CREATE POLICY public_project_todos_update ON public.project_todos FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.user_spaces us ON (us.space_id = p.client_space_id OR us.space_id = p.firm_space_id) AND us.user_id = auth.uid()
      WHERE p.id = project_todos.project_id
    )
  );
CREATE POLICY public_project_todos_delete ON public.project_todos FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.user_spaces us ON (us.space_id = p.client_space_id OR us.space_id = p.firm_space_id) AND us.user_id = auth.uid()
      WHERE p.id = project_todos.project_id
    )
  );

-- =============================================================================
-- 4) 数据迁移：firm.projects -> public.projects，firm.project_todos -> public.project_todos
-- =============================================================================
INSERT INTO public.projects (
  id, firm_space_id, client_space_id, order_id, name, description, image_url,
  status, start_at, end_at, created_at, updated_at
)
SELECT
  fp.id,
  o.firm_space_id,
  o.client_space_id,
  fp.order_id,
  fp.name,
  fp.description,
  fp.image_url,
  COALESCE(fp.status, 'in_progress'),
  fp.start_at,
  fp.end_at,
  fp.created_at,
  fp.updated_at
FROM firm.projects fp
JOIN firm.orders o ON o.id = fp.order_id
ON CONFLICT (order_id) DO NOTHING;

-- 先插入 parent_id = NULL，避免自引用顺序问题
INSERT INTO public.project_todos (
  id, project_id, parent_id, type, title, description, status, sort_order, created_at, updated_at
)
SELECT
  pt.id,
  p.id,
  NULL,
  pt.type,
  pt.title,
  pt.description,
  pt.status,
  pt.sort_order,
  pt.created_at,
  pt.updated_at
FROM firm.project_todos pt
JOIN public.projects p ON p.order_id = pt.order_id
ON CONFLICT (id) DO NOTHING;

-- 再回填 parent_id（同 id 迁移，父节点已存在）
UPDATE public.project_todos pt
SET parent_id = fpt.parent_id
FROM firm.project_todos fpt
JOIN public.projects p ON p.order_id = fpt.order_id
WHERE pt.id = fpt.id AND pt.project_id = p.id AND fpt.parent_id IS NOT NULL;
