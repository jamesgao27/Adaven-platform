-- 订单 / 服务 SKU / 项目 表结构（见 docs/CRM-ORDERS-SKU-PROJECTS.md）
-- SKU 关联一组 sku_items；选 SKU 创建订单时由 sku_items 复制生成 projects；projects 进展状态 = order 状态
-- 依赖：20250224000000_add_space_kind_and_firm_schema.sql
-- 执行后：删除 firm.client_todos、firm.templates

-- =============================================================================
-- 1. firm.skus（服务 SKU，关联一组 sku_items）
-- =============================================================================
CREATE TABLE IF NOT EXISTS firm.skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_firm_skus_firm ON firm.skus(firm_space_id);
COMMENT ON TABLE firm.skus IS 'Firm 端：服务 SKU（商品），关联一组 sku_items';

-- =============================================================================
-- 2. firm.sku_items（SKU 关联的一组项：客户待办 + Firm 待办 模板）
-- =============================================================================
CREATE TABLE IF NOT EXISTS firm.sku_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id UUID NOT NULL REFERENCES firm.skus(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('client', 'firm')),
  title TEXT NOT NULL,
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_firm_sku_items_sku ON firm.sku_items(sku_id);
COMMENT ON TABLE firm.sku_items IS 'Firm 端：SKU 关联的项（客户/Firm 待办模板），创建订单时复制到 projects';

-- =============================================================================
-- 3. firm.orders（订单，一单对应一 SKU；订单状态 = 该单 projects 的进展状态）
-- =============================================================================
CREATE TABLE IF NOT EXISTS firm.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  client_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  sku_id UUID NOT NULL REFERENCES firm.skus(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'confirmed', 'cancelled')),
  due_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_firm_orders_firm ON firm.orders(firm_space_id);
CREATE INDEX IF NOT EXISTS idx_firm_orders_client ON firm.orders(client_space_id);
CREATE INDEX IF NOT EXISTS idx_firm_orders_sku ON firm.orders(sku_id);
CREATE INDEX IF NOT EXISTS idx_firm_orders_due ON firm.orders(due_at);
COMMENT ON TABLE firm.orders IS 'Firm 端：订单，一单对应一个 SKU；order.status = 该单 projects 的进展状态';

-- =============================================================================
-- 4. firm.projects（订单下的清单项，由 sku_items 复制创建；进展状态即 order.status）
-- =============================================================================
CREATE TABLE IF NOT EXISTS firm.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES firm.orders(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('client', 'firm')),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'confirmed')),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_firm_projects_order ON firm.projects(order_id);
COMMENT ON TABLE firm.projects IS 'Firm 端：订单下的清单项（由 sku_items 复制创建），进展状态以 order.status 为准';

-- =============================================================================
-- 5. RLS：skus, sku_items, orders, projects
-- =============================================================================
ALTER TABLE firm.skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm.sku_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY firm_skus_select ON firm.skus FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()));
CREATE POLICY firm_skus_insert ON firm.skus FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()));
CREATE POLICY firm_skus_update ON firm.skus FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()));
CREATE POLICY firm_skus_delete ON firm.skus FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()));

CREATE POLICY firm_sku_items_select ON firm.sku_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM firm.skus s
      JOIN public.user_spaces us ON us.space_id = s.firm_space_id AND us.user_id = auth.uid()
      WHERE s.id = sku_id
    )
  );
CREATE POLICY firm_sku_items_insert ON firm.sku_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM firm.skus s
      JOIN public.user_spaces us ON us.space_id = s.firm_space_id AND us.user_id = auth.uid()
      WHERE s.id = sku_id
    )
  );
CREATE POLICY firm_sku_items_update ON firm.sku_items FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM firm.skus s
      JOIN public.user_spaces us ON us.space_id = s.firm_space_id AND us.user_id = auth.uid()
      WHERE s.id = sku_id
    )
  );
CREATE POLICY firm_sku_items_delete ON firm.sku_items FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM firm.skus s
      JOIN public.user_spaces us ON us.space_id = s.firm_space_id AND us.user_id = auth.uid()
      WHERE s.id = sku_id
    )
  );

CREATE POLICY firm_orders_select ON firm.orders FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.space_id = firm_space_id AND us.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.space_id = client_space_id AND us.user_id = auth.uid())
  );
CREATE POLICY firm_orders_insert ON firm.orders FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()));
CREATE POLICY firm_orders_update ON firm.orders FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.space_id = firm_space_id AND us.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.space_id = client_space_id AND us.user_id = auth.uid())
  );
CREATE POLICY firm_orders_delete ON firm.orders FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()));

CREATE POLICY firm_projects_select ON firm.projects FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM firm.orders o
      JOIN public.user_spaces us ON (us.space_id = o.firm_space_id OR us.space_id = o.client_space_id) AND us.user_id = auth.uid()
      WHERE o.id = order_id
    )
  );
CREATE POLICY firm_projects_insert ON firm.projects FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM firm.orders o
      JOIN public.user_spaces us ON us.space_id = o.firm_space_id AND us.user_id = auth.uid()
      WHERE o.id = order_id
    )
  );
CREATE POLICY firm_projects_update ON firm.projects FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM firm.orders o
      JOIN public.user_spaces us ON (us.space_id = o.firm_space_id OR us.space_id = o.client_space_id) AND us.user_id = auth.uid()
      WHERE o.id = order_id
    )
  );
CREATE POLICY firm_projects_delete ON firm.projects FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM firm.orders o
      JOIN public.user_spaces us ON us.space_id = o.firm_space_id AND us.user_id = auth.uid()
      WHERE o.id = order_id
    )
  );

-- =============================================================================
-- 6. 删除旧表 client_todos、templates 及其 RLS
-- =============================================================================
DROP POLICY IF EXISTS firm_client_todos_select ON firm.client_todos;
DROP POLICY IF EXISTS firm_client_todos_insert ON firm.client_todos;
DROP POLICY IF EXISTS firm_client_todos_update ON firm.client_todos;
DROP POLICY IF EXISTS firm_client_todos_delete ON firm.client_todos;
DROP TABLE IF EXISTS firm.client_todos;

DROP POLICY IF EXISTS firm_templates_select ON firm.templates;
DROP POLICY IF EXISTS firm_templates_insert ON firm.templates;
DROP POLICY IF EXISTS firm_templates_update ON firm.templates;
DROP POLICY IF EXISTS firm_templates_delete ON firm.templates;
DROP TABLE IF EXISTS firm.templates;
