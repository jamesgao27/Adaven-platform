-- Migration: 为 firm.sku_items、firm.preset_sku_items 和 public.project_todos 添加 depends_on_id
-- 支持 Section/Phase 级别的显式前置依赖关联，实现灵活的任务解锁逻辑
-- 不硬编码 phase 顺序，由模板编辑时显式配置

-- ══════════════════════════════════════════════════════════
-- 1. firm.sku_items（firm 自建 SKU 模板）
-- ══════════════════════════════════════════════════════════
ALTER TABLE firm.sku_items
  ADD COLUMN IF NOT EXISTS depends_on_id UUID
    REFERENCES firm.sku_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN firm.sku_items.depends_on_id IS
  'Optional: this item unlocks only after the referenced item reaches status=success. NULL = no prerequisite.';

CREATE INDEX IF NOT EXISTS idx_firm_sku_items_depends_on
  ON firm.sku_items(depends_on_id)
  WHERE depends_on_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════
-- 2. firm.preset_sku_items（预设 SKU 模板）
-- ══════════════════════════════════════════════════════════
ALTER TABLE firm.preset_sku_items
  ADD COLUMN IF NOT EXISTS depends_on_id UUID
    REFERENCES firm.preset_sku_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN firm.preset_sku_items.depends_on_id IS
  'Optional predecessor within the same preset SKU. Copied to firm.sku_items.depends_on_id via apply_preset_skus_to_firm().';

CREATE INDEX IF NOT EXISTS idx_firm_preset_sku_items_depends_on
  ON firm.preset_sku_items(depends_on_id)
  WHERE depends_on_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════
-- 3. public.project_todos（实际订单任务）
-- ══════════════════════════════════════════════════════════
ALTER TABLE public.project_todos
  ADD COLUMN IF NOT EXISTS depends_on_id UUID
    REFERENCES public.project_todos(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.project_todos.depends_on_id IS
  'Optional: this todo is blocked (read-only in UI) until the referenced todo''s subtree reaches status=success. Copied from firm.sku_items.depends_on_id at order confirmation; can be adjusted on live projects.';

CREATE INDEX IF NOT EXISTS idx_project_todos_depends_on
  ON public.project_todos(depends_on_id)
  WHERE depends_on_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════
-- 4. 更新 apply_preset_skus_to_firm：同步复制 depends_on_id
--    先 DROP 消除重载歧义，再重建；两步法确保依赖映射正确
-- ══════════════════════════════════════════════════════════
-- CASCADE 确保所有同签名残留版本（含依赖它的对象）一并清除
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

  -- Step 1b: 深度优先复制 preset_sku_items -> firm.sku_items（跳过 depends_on_id，先建立映射）
  FOR r IN
    WITH RECURSIVE tree AS (
      SELECT id, preset_sku_id, parent_id, item_kind, type, title, description, sort_order,
             depends_on_id, ARRAY[sort_order] AS ord
      FROM firm.preset_sku_items WHERE parent_id IS NULL
      UNION ALL
      SELECT c.id, c.preset_sku_id, c.parent_id, c.item_kind, c.type, c.title, c.description, c.sort_order,
             c.depends_on_id, p.ord || c.sort_order
      FROM firm.preset_sku_items c
      INNER JOIN tree p ON c.parent_id = p.id
    )
    SELECT t.id, t.preset_sku_id, t.parent_id, t.item_kind, t.type, t.title, t.description,
           t.sort_order, t.depends_on_id
    FROM tree t ORDER BY t.preset_sku_id, t.ord
  LOOP
    SELECT m.new_id INTO new_sku_id FROM _preset_sku_map m WHERE m.preset_id = r.preset_sku_id;
    IF new_sku_id IS NULL THEN CONTINUE; END IF;
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
  '将 preset_skus + preset_sku_items（含 depends_on_id）复制到指定 firm_space_id；两步法确保依赖映射正确';

-- public 包装函数：改用 LANGUAGE plpgsql + PERFORM，避免 sql 函数体在创建时解析引用时的歧义
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
