-- v1→v2 upgrade (SKU items + order_items renamed to projects).
-- Fresh Portalflow already has v2 from 20250224120000; skip the destructive rename.

DO $$
BEGIN
  IF to_regclass('firm.order_items') IS NULL THEN
    RAISE NOTICE 'skip v1→v2: firm.order_items does not exist (already v2)';
    RETURN;
  END IF;

  ALTER TABLE firm.skus DROP CONSTRAINT IF EXISTS skus_project_id_fkey;
  DROP POLICY IF EXISTS firm_projects_select ON firm.projects;
  DROP POLICY IF EXISTS firm_projects_insert ON firm.projects;
  DROP POLICY IF EXISTS firm_projects_update ON firm.projects;
  DROP POLICY IF EXISTS firm_projects_delete ON firm.projects;
  DROP TABLE IF EXISTS firm.projects;
  ALTER TABLE firm.skus DROP COLUMN IF EXISTS project_id;
  ALTER TABLE firm.order_items RENAME TO projects;
END $$;

CREATE INDEX IF NOT EXISTS idx_firm_projects_order ON firm.projects(order_id);

DROP POLICY IF EXISTS firm_order_items_select ON firm.projects;
DROP POLICY IF EXISTS firm_order_items_insert ON firm.projects;
DROP POLICY IF EXISTS firm_order_items_update ON firm.projects;
DROP POLICY IF EXISTS firm_order_items_delete ON firm.projects;

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

ALTER TABLE firm.sku_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS firm_sku_items_select ON firm.sku_items;
DROP POLICY IF EXISTS firm_sku_items_insert ON firm.sku_items;
DROP POLICY IF EXISTS firm_sku_items_update ON firm.sku_items;
DROP POLICY IF EXISTS firm_sku_items_delete ON firm.sku_items;

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

DROP POLICY IF EXISTS firm_projects_select ON firm.projects;
DROP POLICY IF EXISTS firm_projects_insert ON firm.projects;
DROP POLICY IF EXISTS firm_projects_update ON firm.projects;
DROP POLICY IF EXISTS firm_projects_delete ON firm.projects;

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

COMMENT ON TABLE firm.projects IS 'Firm 端：订单下的清单项（由 sku_items 复制创建），进展状态以 order.status 为准';
