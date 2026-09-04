-- firm.projects：与 skus 结构一致，一单对应一个 project（order 确认时从 sku 复制）
-- 确认 order 时：复制 sku -> project，复制 sku_items -> project_todos（已有）

-- 1) firm.projects（与 firm.skus 对齐：order_id 替代 firm_space_id，无 is_published）
CREATE TABLE IF NOT EXISTS firm.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES firm.orders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id)
);

CREATE INDEX IF NOT EXISTS idx_firm_projects_order ON firm.projects(order_id);
COMMENT ON TABLE firm.projects IS 'Firm 端：订单确认后由 SKU 复制得到，结构与 skus 一致；client 端确认前展示 SKU，确认后展示 project';

-- 2) RLS
ALTER TABLE firm.projects ENABLE ROW LEVEL SECURITY;

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
