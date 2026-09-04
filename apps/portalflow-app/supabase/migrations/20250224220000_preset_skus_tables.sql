-- 预设 SKU 来源表：供新建 firm 初始化服务目录，可随时维护（直接刷表或 CRM 后台）
-- 新建 firm 时或「初始化预设」时，从本表复制到 firm.skus / firm.sku_items

-- =============================================================================
-- 1. firm.preset_skus（与 firm.skus 结构对齐，无 firm_space_id）
-- =============================================================================
CREATE TABLE IF NOT EXISTS firm.preset_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  is_published BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE firm.preset_skus IS '预设 SKU 模板：新建 firm 时从此表复制到 firm.skus，可随时维护';
COMMENT ON COLUMN firm.preset_skus.image_url IS 'SKU 封面图 URL（如 Storage marketplace 公共链接）；应用预设时会一并复制到 firm.skus';

-- =============================================================================
-- 2. firm.preset_sku_items（与 firm.sku_items 结构对齐，preset_sku_id + parent_id 树形）
-- =============================================================================
CREATE TABLE IF NOT EXISTS firm.preset_sku_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_sku_id UUID NOT NULL REFERENCES firm.preset_skus(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES firm.preset_sku_items(id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL DEFAULT 'task' CHECK (item_kind IN ('phase', 'section', 'task')),
  type TEXT NOT NULL CHECK (type IN ('client', 'firm')),
  title TEXT NOT NULL,
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_firm_preset_sku_items_sku ON firm.preset_sku_items(preset_sku_id);
CREATE INDEX IF NOT EXISTS idx_firm_preset_sku_items_parent ON firm.preset_sku_items(parent_id);

COMMENT ON TABLE firm.preset_sku_items IS '预设 SKU 任务清单（层级）；复制到 firm 时写入 firm.sku_items';

-- =============================================================================
-- 3. RLS：所有人可读（用于「应用预设」），仅 service_role 可写（维护用 SQL/后台）
-- =============================================================================
ALTER TABLE firm.preset_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm.preset_sku_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY firm_preset_skus_select ON firm.preset_skus FOR SELECT TO authenticated
  USING (true);

CREATE POLICY firm_preset_sku_items_select ON firm.preset_sku_items FOR SELECT TO authenticated
  USING (true);

-- 写入：service_role 或 app_metadata.preset_editor = true 的认证用户（便于 CRM 中维护）
CREATE POLICY firm_preset_skus_all_service ON firm.preset_skus FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY firm_preset_sku_items_all_service ON firm.preset_sku_items FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY firm_preset_skus_insert_editor ON firm.preset_skus FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'preset_editor') = 'true');
CREATE POLICY firm_preset_skus_update_editor ON firm.preset_skus FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'preset_editor') = 'true');
CREATE POLICY firm_preset_skus_delete_editor ON firm.preset_skus FOR DELETE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'preset_editor') = 'true');

CREATE POLICY firm_preset_sku_items_insert_editor ON firm.preset_sku_items FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'preset_editor') = 'true');
CREATE POLICY firm_preset_sku_items_update_editor ON firm.preset_sku_items FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'preset_editor') = 'true');
CREATE POLICY firm_preset_sku_items_delete_editor ON firm.preset_sku_items FOR DELETE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'preset_editor') = 'true');

-- =============================================================================
-- 4. 函数：将预设 SKU 复制到指定 firm_space_id
-- =============================================================================
CREATE OR REPLACE FUNCTION firm.apply_preset_skus_to_firm(p_firm_space_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = firm, public
AS $$
DECLARE
  r RECORD;
  new_sku_id UUID;
  new_item_id UUID;
  new_parent_id UUID;
BEGIN
  IF p_firm_space_id IS NULL THEN
    RAISE EXCEPTION 'firm_space_id is required';
  END IF;
  -- 仅允许该 firm 空间成员执行
  IF NOT EXISTS (
    SELECT 1 FROM public.spaces s
    JOIN public.user_spaces us ON us.space_id = s.id AND us.user_id = auth.uid()
    WHERE s.id = p_firm_space_id AND s.kind = 'provider'
  ) THEN
    RAISE EXCEPTION 'Not allowed: not a member of this firm space';
  END IF;

  DROP TABLE IF EXISTS _preset_sku_map;
  DROP TABLE IF EXISTS _preset_item_map;
  CREATE TEMP TABLE _preset_sku_map (
    preset_id UUID PRIMARY KEY,
    new_id UUID NOT NULL
  );
  CREATE TEMP TABLE _preset_item_map (
    preset_id UUID PRIMARY KEY,
    new_id UUID NOT NULL
  );

  -- 1) 复制 preset_skus -> skus，建立映射
  FOR r IN
    SELECT id, name, description, image_url, is_published
    FROM firm.preset_skus
    ORDER BY sort_order, id
  LOOP
    INSERT INTO firm.skus (firm_space_id, name, description, image_url, is_published)
    VALUES (p_firm_space_id, r.name, r.description, r.image_url, COALESCE(r.is_published, true))
    RETURNING id INTO new_sku_id;
    INSERT INTO _preset_sku_map (preset_id, new_id) VALUES (r.id, new_sku_id);
  END LOOP;

  -- 2) 按树深度优先复制 preset_sku_items -> sku_items
  FOR r IN
    WITH RECURSIVE tree AS (
      SELECT id, preset_sku_id, parent_id, item_kind, type, title, description, sort_order,
             ARRAY[sort_order] AS ord
      FROM firm.preset_sku_items
      WHERE parent_id IS NULL
      UNION ALL
      SELECT c.id, c.preset_sku_id, c.parent_id, c.item_kind, c.type, c.title, c.description, c.sort_order,
             p.ord || c.sort_order
      FROM firm.preset_sku_items c
      INNER JOIN tree p ON c.parent_id = p.id
    )
    SELECT t.id, t.preset_sku_id, t.parent_id, t.item_kind, t.type, t.title, t.description, t.sort_order
    FROM tree t
    ORDER BY t.preset_sku_id, t.ord
  LOOP
    SELECT m.new_id INTO new_sku_id FROM _preset_sku_map m WHERE m.preset_id = r.preset_sku_id;
    IF new_sku_id IS NULL THEN
      CONTINUE;
    END IF;
    new_parent_id := NULL;
    IF r.parent_id IS NOT NULL THEN
      SELECT m.new_id INTO new_parent_id FROM _preset_item_map m WHERE m.preset_id = r.parent_id;
    END IF;
    INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order)
    VALUES (new_sku_id, new_parent_id, r.item_kind, r.type, r.title, r.description, COALESCE(r.sort_order, 0))
    RETURNING id INTO new_item_id;
    INSERT INTO _preset_item_map (preset_id, new_id) VALUES (r.id, new_item_id)
    ON CONFLICT (preset_id) DO UPDATE SET new_id = EXCLUDED.new_id;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION firm.apply_preset_skus_to_firm(UUID) IS '将 preset_skus + preset_sku_items 复制到指定 firm_space_id 的 skus + sku_items';

-- 供 Supabase RPC 调用（RPC 默认用 public）
CREATE OR REPLACE FUNCTION public.apply_preset_skus_to_firm(p_firm_space_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, firm
AS $$
  SELECT firm.apply_preset_skus_to_firm(p_firm_space_id);
$$;
COMMENT ON FUNCTION public.apply_preset_skus_to_firm(UUID) IS 'RPC 包装：将预设 SKU 复制到指定 firm 空间';
