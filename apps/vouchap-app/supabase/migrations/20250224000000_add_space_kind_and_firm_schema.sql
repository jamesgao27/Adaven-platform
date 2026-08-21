-- =============================================================================
-- 1. 为 spaces 增加 kind 标记：client | firm
-- 2. 新建 schema firm，Firm 端功能数据表存于此 schema
-- =============================================================================

-- 1. spaces 增加 kind，默认 'client'
ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'client'
    CHECK (kind IN ('client', 'firm'));

COMMENT ON COLUMN public.spaces.kind IS '空间类型：client 普通客户空间，firm 服务端/事务所空间';

-- 2. 创建 firm schema 并授权（Supabase 需暴露 schema 才能用 .schema('firm').from(...)）
CREATE SCHEMA IF NOT EXISTS firm;
GRANT USAGE ON SCHEMA firm TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA firm TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA firm TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA firm GRANT ALL ON TABLES TO anon, authenticated, service_role;

-- 3. firm.clients：Firm 管理的在服客户（关联其他 space）
CREATE TABLE IF NOT EXISTS firm.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  client_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(firm_space_id, client_space_id)
);

CREATE INDEX IF NOT EXISTS idx_firm_clients_firm ON firm.clients(firm_space_id);
CREATE INDEX IF NOT EXISTS idx_firm_clients_client ON firm.clients(client_space_id);

COMMENT ON TABLE firm.clients IS 'Firm 端：在服客户，关联 firm space 与 client space';

-- 4. firm.member_clients：成员可管理的客户（高级权限）
CREATE TABLE IF NOT EXISTS firm.member_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(firm_space_id, user_id, client_space_id)
);

CREATE INDEX IF NOT EXISTS idx_firm_member_clients_firm ON firm.member_clients(firm_space_id);
CREATE INDEX IF NOT EXISTS idx_firm_member_clients_user ON firm.member_clients(user_id);

COMMENT ON TABLE firm.member_clients IS 'Firm 端：成员可管理的客户分配';

-- 5. firm.client_todos：客户待提交资料清单（协同管理）
CREATE TABLE IF NOT EXISTS firm.client_todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  client_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_at DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'confirmed', 'cancelled')),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_firm_client_todos_firm ON firm.client_todos(firm_space_id);
CREATE INDEX IF NOT EXISTS idx_firm_client_todos_client ON firm.client_todos(client_space_id);

COMMENT ON TABLE firm.client_todos IS 'Firm 端：推送给客户的待提交资料 todo';

-- 6. firm.templates：不同客户类别的报税资料清单模板
CREATE TABLE IF NOT EXISTS firm.templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_firm_templates_firm ON firm.templates(firm_space_id);

COMMENT ON TABLE firm.templates IS 'Firm 端：客户类别报税资料清单模板，items 为清单项数组';

-- 7. RLS：firm schema 表需根据 user 所属 space 及 member_clients 做策略（后续可细化）
ALTER TABLE firm.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm.member_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm.client_todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm.templates ENABLE ROW LEVEL SECURITY;

-- 用户属于某 space 则可访问该 space 作为 firm 的数据
CREATE POLICY firm_clients_select ON firm.clients FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );
CREATE POLICY firm_clients_insert ON firm.clients FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );
CREATE POLICY firm_clients_update ON firm.clients FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );
CREATE POLICY firm_clients_delete ON firm.clients FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );

CREATE POLICY firm_member_clients_select ON firm.member_clients FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );
CREATE POLICY firm_member_clients_insert ON firm.member_clients FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );
CREATE POLICY firm_member_clients_update ON firm.member_clients FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );
CREATE POLICY firm_member_clients_delete ON firm.member_clients FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );

CREATE POLICY firm_client_todos_select ON firm.client_todos FOR SELECT
  TO authenticated
  USING (
    -- Firm 成员可看
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
    OR
    -- Client 空间成员可看推送给自己的 todo
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = client_space_id AND us.user_id = auth.uid()
    )
  );
CREATE POLICY firm_client_todos_insert ON firm.client_todos FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );
CREATE POLICY firm_client_todos_update ON firm.client_todos FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = client_space_id AND us.user_id = auth.uid()
    )
  );
CREATE POLICY firm_client_todos_delete ON firm.client_todos FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );

CREATE POLICY firm_templates_select ON firm.templates FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );
CREATE POLICY firm_templates_insert ON firm.templates FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );
CREATE POLICY firm_templates_update ON firm.templates FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );
CREATE POLICY firm_templates_delete ON firm.templates FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );
