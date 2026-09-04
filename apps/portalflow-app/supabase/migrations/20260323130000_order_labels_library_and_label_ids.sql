-- Label library for preset + firm, and label-id references for skus/orders.
-- Keeps existing text fields as denormalized display values for compatibility.

SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) Label tables
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS firm.preset_order_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dimension TEXT NOT NULL CHECK (dimension IN ('season', 'country', 'scenario', 'custom')),
  label_name TEXT NOT NULL,
  label_name_norm TEXT GENERATED ALWAYS AS (lower(btrim(label_name))) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dimension, label_name_norm)
);

CREATE TABLE IF NOT EXISTS firm.order_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK (dimension IN ('season', 'country', 'scenario', 'custom')),
  label_name TEXT NOT NULL,
  label_name_norm TEXT GENERATED ALWAYS AS (lower(btrim(label_name))) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (firm_space_id, dimension, label_name_norm)
);

CREATE INDEX IF NOT EXISTS idx_firm_order_labels_firm_dim
  ON firm.order_labels (firm_space_id, dimension);

COMMENT ON TABLE firm.order_labels IS 'Firm label library: season/country/scenario/custom.';
COMMENT ON TABLE firm.preset_order_labels IS 'Preset label library used to bootstrap firm.order_labels.';

--------------------------------------------------------------------------------
-- 2) Label-id columns
--------------------------------------------------------------------------------

ALTER TABLE firm.preset_skus
  ADD COLUMN IF NOT EXISTS tax_country_label_id UUID REFERENCES firm.preset_order_labels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tax_scenario_label_id UUID REFERENCES firm.preset_order_labels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS custom_label_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE firm.skus
  ADD COLUMN IF NOT EXISTS tax_country_label_id UUID REFERENCES firm.order_labels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tax_scenario_label_id UUID REFERENCES firm.order_labels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS custom_label_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE firm.orders
  ADD COLUMN IF NOT EXISTS tax_country_label_id UUID REFERENCES firm.order_labels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tax_scenario_label_id UUID REFERENCES firm.order_labels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tax_season_label_id UUID REFERENCES firm.order_labels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS custom_label_ids UUID[] NOT NULL DEFAULT '{}';

--------------------------------------------------------------------------------
-- 3) Helpers
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION firm.ensure_order_label_id(
  p_firm_space_id uuid,
  p_dimension text,
  p_label_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_id uuid;
  v_name text := NULLIF(btrim(COALESCE(p_label_name, '')), '');
BEGIN
  IF p_firm_space_id IS NULL OR p_dimension IS NULL OR v_name IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO firm.order_labels (firm_space_id, dimension, label_name)
  VALUES (p_firm_space_id, p_dimension, v_name)
  ON CONFLICT (firm_space_id, dimension, label_name_norm)
  DO UPDATE SET label_name = EXCLUDED.label_name
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION firm.get_order_label_name(
  p_label_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, firm
AS $$
  SELECT ol.label_name FROM firm.order_labels ol WHERE ol.id = p_label_id
$$;

--------------------------------------------------------------------------------
-- 4) Backfill preset label library + map preset_skus ids
--------------------------------------------------------------------------------

INSERT INTO firm.preset_order_labels (dimension, label_name)
SELECT DISTINCT 'country', btrim(ps.tax_country)
FROM firm.preset_skus ps
WHERE NULLIF(btrim(COALESCE(ps.tax_country, '')), '') IS NOT NULL
ON CONFLICT (dimension, label_name_norm) DO NOTHING;

INSERT INTO firm.preset_order_labels (dimension, label_name)
SELECT DISTINCT 'scenario', btrim(ps.tax_scenario)
FROM firm.preset_skus ps
WHERE NULLIF(btrim(COALESCE(ps.tax_scenario, '')), '') IS NOT NULL
ON CONFLICT (dimension, label_name_norm) DO NOTHING;

UPDATE firm.preset_skus ps
SET tax_country_label_id = pol.id
FROM firm.preset_order_labels pol
WHERE pol.dimension = 'country'
  AND pol.label_name_norm = lower(btrim(COALESCE(ps.tax_country, '')))
  AND ps.tax_country IS NOT NULL
  AND (ps.tax_country_label_id IS NULL OR ps.tax_country_label_id IS DISTINCT FROM pol.id);

UPDATE firm.preset_skus ps
SET tax_scenario_label_id = pol.id
FROM firm.preset_order_labels pol
WHERE pol.dimension = 'scenario'
  AND pol.label_name_norm = lower(btrim(COALESCE(ps.tax_scenario, '')))
  AND ps.tax_scenario IS NOT NULL
  AND (ps.tax_scenario_label_id IS NULL OR ps.tax_scenario_label_id IS DISTINCT FROM pol.id);

--------------------------------------------------------------------------------
-- 5) Backfill firm label library + map skus/orders ids
--------------------------------------------------------------------------------

-- country/scenario from skus
INSERT INTO firm.order_labels (firm_space_id, dimension, label_name)
SELECT DISTINCT s.firm_space_id, 'country', btrim(s.tax_country)
FROM firm.skus s
WHERE NULLIF(btrim(COALESCE(s.tax_country, '')), '') IS NOT NULL
ON CONFLICT (firm_space_id, dimension, label_name_norm) DO NOTHING;

INSERT INTO firm.order_labels (firm_space_id, dimension, label_name)
SELECT DISTINCT s.firm_space_id, 'scenario', btrim(s.tax_scenario)
FROM firm.skus s
WHERE NULLIF(btrim(COALESCE(s.tax_scenario, '')), '') IS NOT NULL
ON CONFLICT (firm_space_id, dimension, label_name_norm) DO NOTHING;

-- custom from skus.tags
INSERT INTO firm.order_labels (firm_space_id, dimension, label_name)
SELECT DISTINCT s.firm_space_id, 'custom', btrim(t.tag)
FROM firm.skus s
CROSS JOIN LATERAL unnest(COALESCE(s.tags, ARRAY[]::text[])) AS t(tag)
WHERE NULLIF(btrim(COALESCE(t.tag, '')), '') IS NOT NULL
ON CONFLICT (firm_space_id, dimension, label_name_norm) DO NOTHING;

-- season from orders.tax_season_year
INSERT INTO firm.order_labels (firm_space_id, dimension, label_name)
SELECT DISTINCT o.firm_space_id, 'season', o.tax_season_year::text
FROM firm.orders o
WHERE o.tax_season_year IS NOT NULL
ON CONFLICT (firm_space_id, dimension, label_name_norm) DO NOTHING;

UPDATE firm.skus s
SET tax_country_label_id = ol.id
FROM firm.order_labels ol
WHERE ol.firm_space_id = s.firm_space_id
  AND ol.dimension = 'country'
  AND ol.label_name_norm = lower(btrim(COALESCE(s.tax_country, '')))
  AND s.tax_country IS NOT NULL
  AND (s.tax_country_label_id IS NULL OR s.tax_country_label_id IS DISTINCT FROM ol.id);

UPDATE firm.skus s
SET tax_scenario_label_id = ol.id
FROM firm.order_labels ol
WHERE ol.firm_space_id = s.firm_space_id
  AND ol.dimension = 'scenario'
  AND ol.label_name_norm = lower(btrim(COALESCE(s.tax_scenario, '')))
  AND s.tax_scenario IS NOT NULL
  AND (s.tax_scenario_label_id IS NULL OR s.tax_scenario_label_id IS DISTINCT FROM ol.id);

UPDATE firm.skus s
SET custom_label_ids = COALESCE(sub.ids, ARRAY[]::uuid[])
FROM (
  SELECT
    s2.id AS sku_id,
    array_agg(DISTINCT ol.id) AS ids
  FROM firm.skus s2
  CROSS JOIN LATERAL unnest(COALESCE(s2.tags, ARRAY[]::text[])) AS t(tag)
  JOIN firm.order_labels ol
    ON ol.firm_space_id = s2.firm_space_id
   AND ol.dimension = 'custom'
   AND ol.label_name_norm = lower(btrim(COALESCE(t.tag, '')))
  GROUP BY s2.id
) sub
WHERE sub.sku_id = s.id;

UPDATE firm.orders o
SET tax_country_label_id = COALESCE(o.tax_country_label_id, s.tax_country_label_id),
    tax_scenario_label_id = COALESCE(o.tax_scenario_label_id, s.tax_scenario_label_id),
    custom_label_ids = CASE
      WHEN cardinality(COALESCE(o.custom_label_ids, ARRAY[]::uuid[])) > 0 THEN o.custom_label_ids
      ELSE COALESCE(s.custom_label_ids, ARRAY[]::uuid[])
    END
FROM firm.skus s
WHERE s.id = o.sku_id;

UPDATE firm.orders o
SET tax_season_label_id = ol.id
FROM firm.order_labels ol
WHERE ol.firm_space_id = o.firm_space_id
  AND ol.dimension = 'season'
  AND o.tax_season_year IS NOT NULL
  AND ol.label_name_norm = lower(o.tax_season_year::text)
  AND (o.tax_season_label_id IS NULL OR o.tax_season_label_id IS DISTINCT FROM ol.id);

--------------------------------------------------------------------------------
-- 6) Recreate apply_preset_skus_to_firm: copy preset label library (dedupe) + map ids
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
  SELECT p_firm_space_id, pol.dimension, pol.label_name
  FROM firm.preset_order_labels pol
  ON CONFLICT (firm_space_id, dimension, label_name_norm) DO NOTHING;

  INSERT INTO _preset_label_map (preset_label_id, firm_label_id)
  SELECT pol.id, fol.id
  FROM firm.preset_order_labels pol
  JOIN firm.order_labels fol
    ON fol.firm_space_id = p_firm_space_id
   AND fol.dimension = pol.dimension
   AND fol.label_name_norm = pol.label_name_norm
  ON CONFLICT (preset_label_id) DO UPDATE SET firm_label_id = EXCLUDED.firm_label_id;

  FOR r IN
    SELECT
      id, name, description, image_url, is_published, tax_country, tax_scenario,
      tax_country_label_id, tax_scenario_label_id, custom_label_ids
    FROM firm.preset_skus
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
-- 7) Recreate order fill trigger: copy label ids from sku + keep denormalized text
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION firm.orders_fill_tax_fields_from_sku()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, firm
AS $$
DECLARE
  v_sku record;
BEGIN
  IF NEW.sku_id IS NULL THEN
    NEW.tags := COALESCE(NEW.tags, ARRAY[]::text[]);
    NEW.custom_label_ids := COALESCE(NEW.custom_label_ids, ARRAY[]::uuid[]);
    RETURN NEW;
  END IF;

  SELECT
    s.tax_country,
    s.tax_scenario,
    COALESCE(s.tags, ARRAY[]::text[]) AS tags,
    s.tax_country_label_id,
    s.tax_scenario_label_id,
    COALESCE(s.custom_label_ids, ARRAY[]::uuid[]) AS custom_label_ids
  INTO v_sku
  FROM firm.skus s
  WHERE s.id = NEW.sku_id;

  IF NEW.tax_country_label_id IS NULL THEN NEW.tax_country_label_id := v_sku.tax_country_label_id; END IF;
  IF NEW.tax_scenario_label_id IS NULL THEN NEW.tax_scenario_label_id := v_sku.tax_scenario_label_id; END IF;
  IF cardinality(COALESCE(NEW.custom_label_ids, ARRAY[]::uuid[])) = 0 THEN
    NEW.custom_label_ids := COALESCE(v_sku.custom_label_ids, ARRAY[]::uuid[]);
  END IF;

  IF NEW.tax_country IS NULL THEN
    NEW.tax_country := COALESCE(
      firm.get_order_label_name(NEW.tax_country_label_id),
      v_sku.tax_country
    );
  END IF;
  IF NEW.tax_scenario IS NULL THEN
    NEW.tax_scenario := COALESCE(
      firm.get_order_label_name(NEW.tax_scenario_label_id),
      v_sku.tax_scenario
    );
  END IF;
  IF NEW.tags IS NULL THEN
    NEW.tags := COALESCE(
      (
        SELECT array_agg(ol.label_name)
        FROM unnest(COALESCE(NEW.custom_label_ids, ARRAY[]::uuid[])) AS x(id)
        JOIN firm.order_labels ol ON ol.id = x.id
      ),
      v_sku.tags,
      ARRAY[]::text[]
    );
  END IF;

  -- Keep season label and season year aligned when one side is provided.
  IF NEW.tax_season_label_id IS NULL AND NEW.tax_season_year IS NOT NULL THEN
    NEW.tax_season_label_id := firm.ensure_order_label_id(
      NEW.firm_space_id,
      'season',
      NEW.tax_season_year::text
    );
  END IF;
  IF NEW.tax_season_year IS NULL AND NEW.tax_season_label_id IS NOT NULL THEN
    BEGIN
      NEW.tax_season_year := firm.get_order_label_name(NEW.tax_season_label_id)::integer;
    EXCEPTION
      WHEN others THEN
        NEW.tax_season_year := NULL;
    END;
  END IF;

  NEW.tags := COALESCE(NEW.tags, ARRAY[]::text[]);
  NEW.custom_label_ids := COALESCE(NEW.custom_label_ids, ARRAY[]::uuid[]);
  RETURN NEW;
END;
$$;

-- Keep denormalized text fields synced when label ids change.
CREATE OR REPLACE FUNCTION firm.orders_sync_label_texts_from_ids()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, firm
AS $$
BEGIN
  NEW.tax_country := COALESCE(
    firm.get_order_label_name(NEW.tax_country_label_id),
    NEW.tax_country
  );
  NEW.tax_scenario := COALESCE(
    firm.get_order_label_name(NEW.tax_scenario_label_id),
    NEW.tax_scenario
  );
  IF cardinality(COALESCE(NEW.custom_label_ids, ARRAY[]::uuid[])) > 0 THEN
    NEW.tags := COALESCE(
      (
        SELECT array_agg(ol.label_name)
        FROM unnest(COALESCE(NEW.custom_label_ids, ARRAY[]::uuid[])) AS x(id)
        JOIN firm.order_labels ol ON ol.id = x.id
      ),
      ARRAY[]::text[]
    );
  END IF;

  IF NEW.tax_season_label_id IS NULL AND NEW.tax_season_year IS NOT NULL THEN
    NEW.tax_season_label_id := firm.ensure_order_label_id(
      NEW.firm_space_id,
      'season',
      NEW.tax_season_year::text
    );
  END IF;
  IF NEW.tax_season_year IS NULL AND NEW.tax_season_label_id IS NOT NULL THEN
    BEGIN
      NEW.tax_season_year := firm.get_order_label_name(NEW.tax_season_label_id)::integer;
    EXCEPTION
      WHEN others THEN
        NEW.tax_season_year := NULL;
    END;
  END IF;

  NEW.tags := COALESCE(NEW.tags, ARRAY[]::text[]);
  NEW.custom_label_ids := COALESCE(NEW.custom_label_ids, ARRAY[]::uuid[]);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_orders_fill_tax_fields_from_sku ON firm.orders;
CREATE TRIGGER tr_orders_fill_tax_fields_from_sku
  BEFORE INSERT ON firm.orders
  FOR EACH ROW
  EXECUTE FUNCTION firm.orders_fill_tax_fields_from_sku();

DROP TRIGGER IF EXISTS tr_orders_sync_label_texts_from_ids ON firm.orders;
CREATE TRIGGER tr_orders_sync_label_texts_from_ids
  BEFORE UPDATE OF tax_country_label_id, tax_scenario_label_id, tax_season_label_id, custom_label_ids, tax_season_year
  ON firm.orders
  FOR EACH ROW
  EXECUTE FUNCTION firm.orders_sync_label_texts_from_ids();
