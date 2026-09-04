-- Migration: 将「责任人」相关列重命名为表意更清晰的名称
-- project_todos.type → responsible_side（当前责任方）
-- sku_items / preset_sku_items.type → initial_responsible_side（初始责任方）

-- ══════════════════════════════════════════════════════════
-- 1. public.project_todos
-- ══════════════════════════════════════════════════════════
ALTER TABLE public.project_todos
  RENAME COLUMN type TO responsible_side;

COMMENT ON COLUMN public.project_todos.responsible_side IS
  '当前责任方：client | firm。可随任务流转变更。';

-- ══════════════════════════════════════════════════════════
-- 2. firm.sku_items
-- ══════════════════════════════════════════════════════════
ALTER TABLE firm.sku_items
  RENAME COLUMN type TO initial_responsible_side;

COMMENT ON COLUMN firm.sku_items.initial_responsible_side IS
  '初始责任方：client | firm。复制到 project_todos 时作为 responsible_side 的初始值。';

-- ══════════════════════════════════════════════════════════
-- 3. firm.preset_sku_items
-- ══════════════════════════════════════════════════════════
ALTER TABLE firm.preset_sku_items
  RENAME COLUMN type TO initial_responsible_side;

COMMENT ON COLUMN firm.preset_sku_items.initial_responsible_side IS
  '初始责任方：client | firm。复制到 firm.sku_items 时写入 initial_responsible_side。';

-- ══════════════════════════════════════════════════════════
-- 4. 重建 apply_preset_skus_to_firm：使用新列名 initial_responsible_side
-- ══════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS firm.apply_preset_skus_to_firm(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.apply_preset_skus_to_firm(UUID) CASCADE;

CREATE OR REPLACE FUNCTION firm.apply_preset_skus_to_firm(p_firm_space_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = firm, public
AS $$
DECLARE
  r               RECORD;
  new_sku_id      UUID;
  new_item_id     UUID;
  new_parent_id   UUID;
  v_new_item_id   UUID;
  v_new_dep_id    UUID;
BEGIN
  IF p_firm_space_id IS NULL THEN
    RAISE EXCEPTION 'firm_space_id is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.spaces s
    JOIN public.user_spaces us ON us.space_id = s.id AND us.user_id = auth.uid()
    WHERE s.id = p_firm_space_id AND s.kind = 'provider'
  ) THEN
    RAISE EXCEPTION 'Not allowed: not a member of this firm space';
  END IF;

  DROP TABLE IF EXISTS _preset_sku_map;
  DROP TABLE IF EXISTS _preset_item_map;
  CREATE TEMP TABLE _preset_sku_map  (preset_id UUID PRIMARY KEY, new_id UUID NOT NULL);
  CREATE TEMP TABLE _preset_item_map (preset_id UUID PRIMARY KEY, new_id UUID NOT NULL);

  -- Step 1a: 复制 preset_skus -> firm.skus
  FOR r IN
    SELECT id, name, description, image_url, is_published
    FROM firm.preset_skus ORDER BY sort_order, id
  LOOP
    INSERT INTO firm.skus (firm_space_id, name, description, image_url, is_published)
    VALUES (p_firm_space_id, r.name, r.description, r.image_url, COALESCE(r.is_published, true))
    RETURNING id INTO new_sku_id;
    INSERT INTO _preset_sku_map (preset_id, new_id) VALUES (r.id, new_sku_id);
  END LOOP;

  -- Step 1b: 深度优先复制 preset_sku_items -> firm.sku_items（使用 initial_responsible_side）
  FOR r IN
    WITH RECURSIVE tree AS (
      SELECT id, preset_sku_id, parent_id, item_kind, initial_responsible_side, title, description, sort_order,
             depends_on_id, ARRAY[sort_order] AS ord
      FROM firm.preset_sku_items WHERE parent_id IS NULL
      UNION ALL
      SELECT c.id, c.preset_sku_id, c.parent_id, c.item_kind, c.initial_responsible_side, c.title, c.description, c.sort_order,
             c.depends_on_id, p.ord || c.sort_order
      FROM firm.preset_sku_items c
      INNER JOIN tree p ON c.parent_id = p.id
    )
    SELECT t.id, t.preset_sku_id, t.parent_id, t.item_kind, t.initial_responsible_side, t.title, t.description,
           t.sort_order, t.depends_on_id
    FROM tree t ORDER BY t.preset_sku_id, t.ord
  LOOP
    SELECT m.new_id INTO new_sku_id FROM _preset_sku_map m WHERE m.preset_id = r.preset_sku_id;
    IF new_sku_id IS NULL THEN CONTINUE; END IF;
    new_parent_id := NULL;
    IF r.parent_id IS NOT NULL THEN
      SELECT m.new_id INTO new_parent_id FROM _preset_item_map m WHERE m.preset_id = r.parent_id;
    END IF;
    INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, initial_responsible_side, title, description, sort_order)
    VALUES (new_sku_id, new_parent_id, r.item_kind, r.initial_responsible_side, r.title, r.description, COALESCE(r.sort_order, 0))
    RETURNING id INTO new_item_id;
    INSERT INTO _preset_item_map (preset_id, new_id) VALUES (r.id, new_item_id)
    ON CONFLICT (preset_id) DO UPDATE SET new_id = EXCLUDED.new_id;
  END LOOP;

  -- Step 2: 回填 depends_on_id（映射已完整，可正确解析所有引用）
  FOR r IN
    SELECT id, depends_on_id FROM firm.preset_sku_items WHERE depends_on_id IS NOT NULL
  LOOP
    SELECT new_id INTO v_new_item_id FROM _preset_item_map WHERE preset_id = r.id;
    SELECT new_id INTO v_new_dep_id  FROM _preset_item_map WHERE preset_id = r.depends_on_id;
    IF v_new_item_id IS NOT NULL AND v_new_dep_id IS NOT NULL THEN
      UPDATE firm.sku_items SET depends_on_id = v_new_dep_id WHERE id = v_new_item_id;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION firm.apply_preset_skus_to_firm(UUID) IS
  '将 preset_skus + preset_sku_items（含 depends_on_id、initial_responsible_side）复制到指定 firm_space_id；两步法确保依赖映射正确';

CREATE FUNCTION public.apply_preset_skus_to_firm(p_firm_space_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
BEGIN
  PERFORM firm.apply_preset_skus_to_firm(p_firm_space_id);
END;
$$;
COMMENT ON FUNCTION public.apply_preset_skus_to_firm(UUID) IS 'RPC 包装：将预设 SKU（含依赖关系）复制到指定 firm 空间';
