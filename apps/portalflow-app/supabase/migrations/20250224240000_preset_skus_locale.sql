-- 预设 SKU 支持多语言：locale = 'zh' | 'en'，应用预设时可按语言选用
ALTER TABLE firm.preset_skus
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'zh'
  CHECK (locale IN ('zh', 'en'));

CREATE INDEX IF NOT EXISTS idx_firm_preset_skus_locale ON firm.preset_skus(locale);
COMMENT ON COLUMN firm.preset_skus.locale IS '预设语言：zh 中文，en 英文；应用预设时按此筛选';

-- 更新复制函数：支持按 locale 只复制该语言预设
CREATE OR REPLACE FUNCTION firm.apply_preset_skus_to_firm(p_firm_space_id UUID, p_locale TEXT DEFAULT 'zh')
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
  IF p_locale IS NULL OR p_locale NOT IN ('zh', 'en') THEN
    p_locale := 'zh';
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
  CREATE TEMP TABLE _preset_sku_map (preset_id UUID PRIMARY KEY, new_id UUID NOT NULL);
  CREATE TEMP TABLE _preset_item_map (preset_id UUID PRIMARY KEY, new_id UUID NOT NULL);

  FOR r IN
    SELECT id, name, description, image_url, is_published
    FROM firm.preset_skus
    WHERE locale = p_locale
    ORDER BY sort_order, id
  LOOP
    INSERT INTO firm.skus (firm_space_id, name, description, image_url, is_published)
    VALUES (p_firm_space_id, r.name, r.description, r.image_url, COALESCE(r.is_published, true))
    RETURNING id INTO new_sku_id;
    INSERT INTO _preset_sku_map (preset_id, new_id) VALUES (r.id, new_sku_id);
  END LOOP;

  FOR r IN
    WITH RECURSIVE tree AS (
      SELECT t.id, t.preset_sku_id, t.parent_id, t.item_kind, t.type, t.title, t.description, t.sort_order, ARRAY[t.sort_order] AS ord
      FROM firm.preset_sku_items t
      JOIN firm.preset_skus s ON s.id = t.preset_sku_id AND s.locale = p_locale
      WHERE t.parent_id IS NULL
      UNION ALL
      SELECT c.id, c.preset_sku_id, c.parent_id, c.item_kind, c.type, c.title, c.description, c.sort_order, p.ord || c.sort_order
      FROM firm.preset_sku_items c
      INNER JOIN tree p ON c.parent_id = p.id
    )
    SELECT t.id, t.preset_sku_id, t.parent_id, t.item_kind, t.type, t.title, t.description, t.sort_order
    FROM tree t
    ORDER BY t.preset_sku_id, t.ord
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
END;
$$;

COMMENT ON FUNCTION firm.apply_preset_skus_to_firm(UUID, TEXT) IS '将指定 locale 的 preset_skus（含 name, description, image_url, is_published）+ preset_sku_items 复制到 firm；p_locale 默认 zh';

DROP FUNCTION IF EXISTS public.apply_preset_skus_to_firm(UUID);
CREATE OR REPLACE FUNCTION public.apply_preset_skus_to_firm(p_firm_space_id UUID, p_locale TEXT DEFAULT 'zh')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, firm AS $$
  SELECT firm.apply_preset_skus_to_firm(p_firm_space_id, p_locale);
$$;
COMMENT ON FUNCTION public.apply_preset_skus_to_firm(UUID, TEXT) IS 'RPC: apply preset SKUs to firm; p_locale zh|en';
