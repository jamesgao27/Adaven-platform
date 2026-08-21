-- preset_skus 未生效修复：
-- 1. create_space_with_user 在创建 kind=firm 时于服务端直接调用 apply_preset_skus_to_firm，不依赖客户端
-- 2. apply_preset_skus_to_firm 幂等：若该 firm 已有 skus 则直接返回，避免重复复制

-- =============================================================================
-- 1. apply_preset_skus_to_firm 幂等：已有 skus 则跳过
-- =============================================================================
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
  -- 幂等：该 firm 已有模板则不再复制，避免服务端+客户端重复
  IF EXISTS (SELECT 1 FROM firm.skus WHERE firm_space_id = p_firm_space_id LIMIT 1) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.spaces s
    JOIN public.user_spaces us ON us.space_id = s.id AND us.user_id = auth.uid()
    WHERE s.id = p_firm_space_id AND s.kind = 'firm'
  ) THEN
    RAISE EXCEPTION 'Not allowed: not a member of this firm space';
  END IF;

  DROP TABLE IF EXISTS _preset_sku_map;
  DROP TABLE IF EXISTS _preset_item_map;
  CREATE TEMP TABLE _preset_sku_map  (preset_id UUID PRIMARY KEY, new_id UUID NOT NULL);
  CREATE TEMP TABLE _preset_item_map (preset_id UUID PRIMARY KEY, new_id UUID NOT NULL);

  -- Step 1a: 复制 preset_skus -> firm.skus（预设模板初始为 private 内部可用）
  FOR r IN
    SELECT id, name, description, image_url, is_published
    FROM firm.preset_skus ORDER BY sort_order, id
  LOOP
    INSERT INTO firm.skus (firm_space_id, name, description, image_url, is_published, template_status)
    VALUES (p_firm_space_id, r.name, r.description, r.image_url, COALESCE(r.is_published, true), 'private')
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

  -- Step 2: 回填 depends_on_id
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
  '将 preset_skus + preset_sku_items 复制到指定 firm；幂等（已有 skus 则跳过）。创建 firm 时由 create_space_with_user 服务端调用，客户端也可兜底调用。';

-- =============================================================================
-- 2. create_space_with_user：创建 firm 时在服务端执行 apply_preset_skus_to_firm
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_space_with_user(
  p_space_name TEXT,
  p_space_address TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_kind TEXT DEFAULT 'client',
  p_firm_verification_url TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_space_id UUID;
  v_kind TEXT;
  v_firm_status TEXT;
  v_verification_url TEXT;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_kind := COALESCE(NULLIF(TRIM(LOWER(p_kind)), ''), 'client');
  IF v_kind NOT IN ('client', 'firm') THEN
    RAISE EXCEPTION 'kind must be client or firm';
  END IF;

  IF v_kind = 'firm' THEN
    IF p_firm_verification_url IS NULL OR TRIM(p_firm_verification_url) = '' THEN
      RAISE EXCEPTION 'Firm registration requires verification attachment URL';
    END IF;
    v_firm_status := 'pending';
    v_verification_url := TRIM(p_firm_verification_url);
  ELSE
    v_firm_status := NULL;
    v_verification_url := NULL;
  END IF;

  INSERT INTO public.spaces (name, address, kind, firm_status, verification_attachment_url)
  VALUES (
    p_space_name,
    NULLIF(TRIM(p_space_address), ''),
    v_kind,
    v_firm_status,
    v_verification_url
  )
  RETURNING id INTO v_space_id;

  INSERT INTO public.user_spaces (user_id, space_id, is_admin)
  VALUES (v_user_id, v_space_id, true)
  ON CONFLICT DO NOTHING;

  UPDATE public.users
  SET current_space_id = v_space_id
  WHERE id = v_user_id;

  -- 服务端直接应用预设模板，不依赖客户端二次请求
  IF v_kind = 'firm' THEN
    PERFORM firm.apply_preset_skus_to_firm(v_space_id);
  END IF;

  RETURN v_space_id;
END;
$$;

COMMENT ON FUNCTION public.create_space_with_user(TEXT, TEXT, UUID, TEXT, TEXT) IS
  '创建空间并加入当前用户为管理员。kind=firm 时必传 p_firm_verification_url，firm_status 设为 pending，并在服务端自动复制 preset_skus 到该 firm';
