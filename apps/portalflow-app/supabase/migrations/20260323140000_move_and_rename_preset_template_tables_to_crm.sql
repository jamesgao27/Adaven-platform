-- Rename/move preset tables:
-- firm.preset_order_labels -> crm.preset_template_labels
-- firm.preset_sku_items    -> crm.preset_template_items
-- firm.preset_skus         -> crm.preset_templates
-- and update apply_preset_skus_to_firm to reference new locations.

SET search_path = public, firm;

CREATE SCHEMA IF NOT EXISTS crm;

--------------------------------------------------------------------------------
-- 1) Move + rename tables (idempotent)
--------------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('firm.preset_order_labels') IS NOT NULL THEN
    ALTER TABLE firm.preset_order_labels SET SCHEMA crm;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('crm.preset_order_labels') IS NOT NULL
     AND to_regclass('crm.preset_template_labels') IS NULL THEN
    ALTER TABLE crm.preset_order_labels RENAME TO preset_template_labels;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('firm.preset_sku_items') IS NOT NULL THEN
    ALTER TABLE firm.preset_sku_items SET SCHEMA crm;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('crm.preset_sku_items') IS NOT NULL
     AND to_regclass('crm.preset_template_items') IS NULL THEN
    ALTER TABLE crm.preset_sku_items RENAME TO preset_template_items;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('firm.preset_skus') IS NOT NULL THEN
    ALTER TABLE firm.preset_skus SET SCHEMA crm;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('crm.preset_skus') IS NOT NULL
     AND to_regclass('crm.preset_templates') IS NULL THEN
    ALTER TABLE crm.preset_skus RENAME TO preset_templates;
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 2) Recreate apply function with crm.* references
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION firm.apply_preset_skus_to_firm(p_firm_space_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = firm, public, crm
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
  v_country_label_id uuid;
  v_scenario_label_id uuid;
  v_custom_label_ids uuid[];
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
  DROP TABLE IF EXISTS _preset_label_map;
  CREATE TEMP TABLE _preset_sku_map  (preset_id UUID PRIMARY KEY, new_id UUID NOT NULL);
  CREATE TEMP TABLE _preset_item_map (preset_id UUID PRIMARY KEY, new_id UUID NOT NULL);
  CREATE TEMP TABLE _preset_label_map (preset_label_id UUID PRIMARY KEY, firm_label_id UUID NOT NULL);

  -- Dedup copy preset label library into firm.order_labels
  INSERT INTO firm.order_labels (firm_space_id, dimension, label_name)
  SELECT p_firm_space_id, ptl.dimension, ptl.label_name
  FROM crm.preset_template_labels ptl
  ON CONFLICT (firm_space_id, dimension, label_name_norm) DO NOTHING;

  INSERT INTO _preset_label_map (preset_label_id, firm_label_id)
  SELECT ptl.id, fol.id
  FROM crm.preset_template_labels ptl
  JOIN firm.order_labels fol
    ON fol.firm_space_id = p_firm_space_id
   AND fol.dimension = ptl.dimension
   AND fol.label_name_norm = ptl.label_name_norm
  ON CONFLICT (preset_label_id) DO UPDATE SET firm_label_id = EXCLUDED.firm_label_id;

  FOR r IN
    SELECT
      id, name, description, image_url, is_published, tax_country, tax_scenario,
      tax_country_label_id, tax_scenario_label_id, custom_label_ids
    FROM crm.preset_templates
    ORDER BY sort_order, id
  LOOP
    SELECT m.firm_label_id INTO v_country_label_id
    FROM _preset_label_map m
    WHERE m.preset_label_id = r.tax_country_label_id;

    SELECT m.firm_label_id INTO v_scenario_label_id
    FROM _preset_label_map m
    WHERE m.preset_label_id = r.tax_scenario_label_id;

    SELECT COALESCE(array_agg(m.firm_label_id), ARRAY[]::uuid[]) INTO v_custom_label_ids
    FROM unnest(COALESCE(r.custom_label_ids, ARRAY[]::uuid[])) AS x(id)
    JOIN _preset_label_map m ON m.preset_label_id = x.id;

    INSERT INTO firm.skus (
      firm_space_id, name, description, image_url, is_published, template_status,
      tax_country, tax_scenario, tags, tax_country_label_id, tax_scenario_label_id, custom_label_ids
    )
    VALUES (
      p_firm_space_id,
      r.name,
      r.description,
      r.image_url,
      COALESCE(r.is_published, true),
      'private',
      COALESCE(r.tax_country, firm.get_order_label_name(v_country_label_id)),
      COALESCE(r.tax_scenario, firm.get_order_label_name(v_scenario_label_id)),
      (
        SELECT COALESCE(array_agg(ol.label_name), ARRAY[]::text[])
        FROM unnest(COALESCE(v_custom_label_ids, ARRAY[]::uuid[])) AS y(id)
        JOIN firm.order_labels ol ON ol.id = y.id
      ),
      v_country_label_id,
      v_scenario_label_id,
      COALESCE(v_custom_label_ids, ARRAY[]::uuid[])
    )
    RETURNING id INTO new_sku_id;

    INSERT INTO _preset_sku_map (preset_id, new_id) VALUES (r.id, new_sku_id);
  END LOOP;

  FOR r IN
    WITH RECURSIVE tree AS (
      SELECT id, preset_sku_id, parent_id, item_kind, initial_responsible_side, title, description, sort_order,
             depends_on_id, ARRAY[sort_order] AS ord
      FROM crm.preset_template_items WHERE parent_id IS NULL
      UNION ALL
      SELECT c.id, c.preset_sku_id, c.parent_id, c.item_kind, c.initial_responsible_side, c.title, c.description, c.sort_order,
             c.depends_on_id, p.ord || c.sort_order
      FROM crm.preset_template_items c
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
    FROM crm.preset_template_items
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

COMMENT ON FUNCTION firm.apply_preset_skus_to_firm(UUID) IS
  'Copy crm.preset_templates + crm.preset_template_items + crm.preset_template_labels to firm.skus / sku_items / order_labels. Idempotent when firm already has skus.';

