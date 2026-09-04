-- Unify tax/tag fields across preset_skus, skus, orders, projects
-- Rules:
-- 1) preset_skus -> skus -> orders -> projects for tax_country/tax_scenario
--    skus/orders/projects are independently editable after copy.
-- 2) skus.tags copy to orders; projects copy tags from orders on insert only.
--    after project creation, order/project tags are independent (no sync).
-- 3) orders/projects both have tax_season_year and sync with each other;
--    tax_country/tax_scenario also sync bidirectionally.

SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) Columns
--------------------------------------------------------------------------------

ALTER TABLE firm.preset_skus
  ADD COLUMN IF NOT EXISTS tax_country TEXT,
  ADD COLUMN IF NOT EXISTS tax_scenario TEXT;

ALTER TABLE firm.skus
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE firm.orders
  ADD COLUMN IF NOT EXISTS tax_country TEXT,
  ADD COLUMN IF NOT EXISTS tax_scenario TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tax_season_year INTEGER;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN firm.preset_skus.tax_country IS 'Tax jurisdiction source field copied into firm.skus.';
COMMENT ON COLUMN firm.preset_skus.tax_scenario IS 'Tax scenario source field copied into firm.skus.';
COMMENT ON COLUMN firm.skus.tags IS 'Custom SKU tags. Copied to orders when creating engagement.';
COMMENT ON COLUMN firm.orders.tax_country IS 'Copied from SKU at order creation; syncs with project for the same order.';
COMMENT ON COLUMN firm.orders.tax_scenario IS 'Copied from SKU at order creation; syncs with project for the same order.';
COMMENT ON COLUMN firm.orders.tags IS 'Copied from SKU at order creation; syncs with project for the same order.';
COMMENT ON COLUMN firm.orders.tax_season_year IS 'Tax season year; editable and synchronized with project.';
COMMENT ON COLUMN public.projects.tags IS 'Project tags synchronized with linked order.';

--------------------------------------------------------------------------------
-- 2) Recreate apply_preset_skus_to_firm: include tax fields from preset_skus
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
    SELECT id, name, description, image_url, is_published, tax_country, tax_scenario
    FROM firm.preset_skus ORDER BY sort_order, id
  LOOP
    INSERT INTO firm.skus (
      firm_space_id, name, description, image_url, is_published, template_status, tax_country, tax_scenario, tags
    )
    VALUES (
      p_firm_space_id,
      r.name,
      r.description,
      r.image_url,
      COALESCE(r.is_published, true),
      'private',
      r.tax_country,
      r.tax_scenario,
      ARRAY[]::text[]
    )
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
-- 3) order creation: copy tax/tags from sku
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION firm.orders_fill_tax_fields_from_sku()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, firm
AS $$
BEGIN
  IF NEW.sku_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.tax_country IS NULL
     OR NEW.tax_scenario IS NULL
     OR NEW.tags IS NULL
  THEN
    SELECT
      COALESCE(NEW.tax_country, s.tax_country),
      COALESCE(NEW.tax_scenario, s.tax_scenario),
      COALESCE(NEW.tags, s.tags, ARRAY[]::text[])
    INTO
      NEW.tax_country,
      NEW.tax_scenario,
      NEW.tags
    FROM firm.skus s
    WHERE s.id = NEW.sku_id;
  END IF;

  NEW.tags := COALESCE(NEW.tags, ARRAY[]::text[]);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_orders_fill_tax_fields_from_sku ON firm.orders;
CREATE TRIGGER tr_orders_fill_tax_fields_from_sku
  BEFORE INSERT ON firm.orders
  FOR EACH ROW
  EXECUTE FUNCTION firm.orders_fill_tax_fields_from_sku();

--------------------------------------------------------------------------------
-- 4) project creation: initialize tax/tags from linked order
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.projects_fill_tax_fields_from_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, firm
AS $$
BEGIN
  IF NEW.order_id IS NULL THEN
    NEW.tags := COALESCE(NEW.tags, ARRAY[]::text[]);
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(NEW.tax_country, o.tax_country),
    COALESCE(NEW.tax_scenario, o.tax_scenario),
    COALESCE(NEW.tax_season_year, o.tax_season_year),
    COALESCE(NEW.tags, o.tags, ARRAY[]::text[])
  INTO
    NEW.tax_country,
    NEW.tax_scenario,
    NEW.tax_season_year,
    NEW.tags
  FROM firm.orders o
  WHERE o.id = NEW.order_id;

  NEW.tags := COALESCE(NEW.tags, ARRAY[]::text[]);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_projects_fill_tax_fields_from_order ON public.projects;
CREATE TRIGGER tr_projects_fill_tax_fields_from_order
  BEFORE INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.projects_fill_tax_fields_from_order();

--------------------------------------------------------------------------------
-- 5) Bidirectional sync between orders and projects (tax/season only)
-- tags are copied once (order -> project on project insert), then decoupled.
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION firm.sync_order_tax_fields_to_project()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, firm
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  UPDATE public.projects p
  SET
    tax_country = NEW.tax_country,
    tax_scenario = NEW.tax_scenario,
    tax_season_year = NEW.tax_season_year,
    updated_at = now()
  WHERE p.order_id = NEW.id
    AND (
      p.tax_country IS DISTINCT FROM NEW.tax_country
      OR p.tax_scenario IS DISTINCT FROM NEW.tax_scenario
      OR p.tax_season_year IS DISTINCT FROM NEW.tax_season_year
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_order_tax_fields_to_project ON firm.orders;
CREATE TRIGGER tr_sync_order_tax_fields_to_project
  AFTER INSERT OR UPDATE OF tax_country, tax_scenario, tax_season_year ON firm.orders
  FOR EACH ROW
  EXECUTE FUNCTION firm.sync_order_tax_fields_to_project();

CREATE OR REPLACE FUNCTION public.sync_project_tax_fields_to_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, firm
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  UPDATE firm.orders o
  SET
    tax_country = NEW.tax_country,
    tax_scenario = NEW.tax_scenario,
    tax_season_year = NEW.tax_season_year,
    updated_at = now()
  WHERE o.id = NEW.order_id
    AND (
      o.tax_country IS DISTINCT FROM NEW.tax_country
      OR o.tax_scenario IS DISTINCT FROM NEW.tax_scenario
      OR o.tax_season_year IS DISTINCT FROM NEW.tax_season_year
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_project_tax_fields_to_order ON public.projects;
CREATE TRIGGER tr_sync_project_tax_fields_to_order
  AFTER UPDATE OF tax_country, tax_scenario, tax_season_year ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_project_tax_fields_to_order();

--------------------------------------------------------------------------------
-- 6) Backfill existing data
--------------------------------------------------------------------------------

UPDATE firm.skus
SET tags = COALESCE(tags, ARRAY[]::text[])
WHERE tags IS NULL;

UPDATE firm.orders o
SET
  tax_country = COALESCE(o.tax_country, s.tax_country),
  tax_scenario = COALESCE(o.tax_scenario, s.tax_scenario),
  tags = COALESCE(o.tags, s.tags, ARRAY[]::text[])
FROM firm.skus s
WHERE s.id = o.sku_id
  AND (
    o.tax_country IS NULL
    OR o.tax_scenario IS NULL
    OR o.tags IS NULL
  );

UPDATE public.projects p
SET
  tax_country = COALESCE(p.tax_country, o.tax_country),
  tax_scenario = COALESCE(p.tax_scenario, o.tax_scenario),
  tax_season_year = COALESCE(p.tax_season_year, o.tax_season_year),
  tags = COALESCE(p.tags, o.tags, ARRAY[]::text[])
FROM firm.orders o
WHERE o.id = p.order_id
  AND (
    p.tax_country IS NULL
    OR p.tax_scenario IS NULL
    OR p.tax_season_year IS NULL
    OR p.tags IS NULL
  );
