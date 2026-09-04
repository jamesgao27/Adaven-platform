-- Rollback for 20260323123000_unify_tax_tags_across_preset_sku_order_project.sql

SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) Drop sync/default triggers + functions
--------------------------------------------------------------------------------

DROP TRIGGER IF EXISTS tr_sync_project_tax_fields_to_order ON public.projects;
DROP FUNCTION IF EXISTS public.sync_project_tax_fields_to_order();

DROP TRIGGER IF EXISTS tr_sync_order_tax_fields_to_project ON firm.orders;
DROP FUNCTION IF EXISTS firm.sync_order_tax_fields_to_project();

DROP TRIGGER IF EXISTS tr_projects_fill_tax_fields_from_order ON public.projects;
DROP FUNCTION IF EXISTS public.projects_fill_tax_fields_from_order();

DROP TRIGGER IF EXISTS tr_orders_fill_tax_fields_from_sku ON firm.orders;
DROP FUNCTION IF EXISTS firm.orders_fill_tax_fields_from_sku();

--------------------------------------------------------------------------------
-- 2) Restore apply_preset_skus_to_firm without preset tax field dependency
--------------------------------------------------------------------------------

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
  v_old_deps      uuid[];
  v_new_deps      uuid[];
  v_old_dep       uuid;
BEGIN
  IF p_firm_space_id IS NULL THEN
    RAISE EXCEPTION 'firm_space_id is required';
  END IF;
  IF EXISTS (SELECT 1 FROM firm.skus WHERE firm_space_id = p_firm_space_id LIMIT 1) THEN
    RETURN;
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

  FOR r IN
    SELECT id, name, description, image_url, is_published
    FROM firm.preset_skus ORDER BY sort_order, id
  LOOP
    INSERT INTO firm.skus (firm_space_id, name, description, image_url, is_published, template_status)
    VALUES (p_firm_space_id, r.name, r.description, r.image_url, COALESCE(r.is_published, true), 'private')
    RETURNING id INTO new_sku_id;
    INSERT INTO _preset_sku_map (preset_id, new_id) VALUES (r.id, new_sku_id);
  END LOOP;

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

  FOR r IN
    SELECT id, depends_on_id, depends_on_ids
    FROM firm.preset_sku_items
    WHERE (depends_on_id IS NOT NULL)
       OR (cardinality(depends_on_ids) > 0)
  LOOP
    SELECT new_id INTO v_new_item_id FROM _preset_item_map WHERE preset_id = r.id;
    IF v_new_item_id IS NULL THEN CONTINUE; END IF;

    IF cardinality(r.depends_on_ids) > 0 THEN
      v_old_deps := r.depends_on_ids;
    ELSE
      v_old_deps := ARRAY[r.depends_on_id];
    END IF;

    v_new_deps := ARRAY[]::uuid[];
    FOREACH v_old_dep IN ARRAY v_old_deps
    LOOP
      SELECT new_id INTO v_new_dep_id FROM _preset_item_map WHERE preset_id = v_old_dep;
      IF v_new_dep_id IS NOT NULL THEN
        v_new_deps := array_append(v_new_deps, v_new_dep_id);
      END IF;
    END LOOP;

    IF cardinality(v_new_deps) > 0 THEN
      UPDATE firm.sku_items SET
        depends_on_ids = v_new_deps,
        depends_on_id = v_new_deps[1],
        updated_at = now()
      WHERE id = v_new_item_id;
    END IF;
  END LOOP;
END;
$$;

--------------------------------------------------------------------------------
-- 3) Drop columns introduced by this migration
--------------------------------------------------------------------------------

ALTER TABLE public.projects
  DROP COLUMN IF EXISTS tags;

ALTER TABLE firm.orders
  DROP COLUMN IF EXISTS tax_country,
  DROP COLUMN IF EXISTS tax_scenario,
  DROP COLUMN IF EXISTS tags,
  DROP COLUMN IF EXISTS tax_season_year;

ALTER TABLE firm.skus
  DROP COLUMN IF EXISTS tags;

ALTER TABLE firm.preset_skus
  DROP COLUMN IF EXISTS tax_country,
  DROP COLUMN IF EXISTS tax_scenario;
