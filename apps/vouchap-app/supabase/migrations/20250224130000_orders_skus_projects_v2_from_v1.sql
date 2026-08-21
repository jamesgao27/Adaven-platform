-- 从「前一版」20250224120000 迁移到新设计（SKU 关联 sku_items，order_items 改名为 projects）
-- 前提：已执行过前一版 20250224120000（存在 firm.projects 模板表、firm.skus 带 project_id、firm.order_items）
-- 执行后：firm.projects 为订单下清单项（由 order_items 重命名），firm.sku_items 新建，firm.skus 去掉 project_id

-- =============================================================================
-- 1. 删除旧「项目模板」表 firm.projects 及其 RLS
-- =============================================================================
DROP POLICY IF EXISTS firm_projects_select ON firm.projects;
DROP POLICY IF EXISTS firm_projects_insert ON firm.projects;
DROP POLICY IF EXISTS firm_projects_update ON firm.projects;
DROP POLICY IF EXISTS firm_projects_delete ON firm.projects;

-- 去掉 skus 对旧 projects 的外键，再删表
ALTER TABLE firm.skus DROP CONSTRAINT IF EXISTS skus_project_id_fkey;
DROP TABLE IF EXISTS firm.projects;

-- =============================================================================
-- 2. firm.skus 去掉 project_id
-- =============================================================================
ALTER TABLE firm.skus DROP COLUMN IF EXISTS project_id;

-- =============================================================================
-- 3. order_items 改名为 projects（结构一致，保留数据）
-- =============================================================================
ALTER TABLE firm.order_items RENAME TO projects;

-- 索引名会变成 projects 上的旧名，补一个新索引（若不存在）
CREATE INDEX IF NOT EXISTS idx_firm_projects_order ON firm.projects(order_id);

-- =============================================================================
-- 4. 删除原 order_items 的 RLS（表现在叫 projects，策略名仍是 firm_order_items_*）
-- =============================================================================
DROP POLICY IF EXISTS firm_order_items_select ON firm.projects;
DROP POLICY IF EXISTS firm_order_items_insert ON firm.projects;
DROP POLICY IF EXISTS firm_order_items_update ON firm.projects;
DROP POLICY IF EXISTS firm_order_items_delete ON firm.projects;

-- =============================================================================
-- 5. 新建 firm.sku_items
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
-- 6. RLS：sku_items，以及 projects（新）
-- =============================================================================
ALTER TABLE firm.sku_items ENABLE ROW LEVEL SECURITY;

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

-- 注释
COMMENT ON TABLE firm.projects IS 'Firm 端：订单下的清单项（由 sku_items 复制创建），进展状态以 order.status 为准';
