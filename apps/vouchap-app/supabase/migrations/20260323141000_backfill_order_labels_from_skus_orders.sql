-- Backfill firm.order_labels from existing firm.skus and firm.orders data.
-- Includes dimensions: country, scenario, custom, season.
-- Also backfills *_label_id / custom_label_ids columns on skus/orders.

SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) Extract labels from firm.skus / firm.orders into firm.order_labels
--------------------------------------------------------------------------------

-- country from skus.tax_country + orders.tax_country
INSERT INTO firm.order_labels (firm_space_id, dimension, label_name)
SELECT DISTINCT s.firm_space_id, 'country', btrim(s.tax_country)
FROM firm.skus s
WHERE NULLIF(btrim(COALESCE(s.tax_country, '')), '') IS NOT NULL
ON CONFLICT (firm_space_id, dimension, label_name_norm) DO NOTHING;

INSERT INTO firm.order_labels (firm_space_id, dimension, label_name)
SELECT DISTINCT o.firm_space_id, 'country', btrim(o.tax_country)
FROM firm.orders o
WHERE NULLIF(btrim(COALESCE(o.tax_country, '')), '') IS NOT NULL
ON CONFLICT (firm_space_id, dimension, label_name_norm) DO NOTHING;

-- scenario from skus.tax_scenario + orders.tax_scenario
INSERT INTO firm.order_labels (firm_space_id, dimension, label_name)
SELECT DISTINCT s.firm_space_id, 'scenario', btrim(s.tax_scenario)
FROM firm.skus s
WHERE NULLIF(btrim(COALESCE(s.tax_scenario, '')), '') IS NOT NULL
ON CONFLICT (firm_space_id, dimension, label_name_norm) DO NOTHING;

INSERT INTO firm.order_labels (firm_space_id, dimension, label_name)
SELECT DISTINCT o.firm_space_id, 'scenario', btrim(o.tax_scenario)
FROM firm.orders o
WHERE NULLIF(btrim(COALESCE(o.tax_scenario, '')), '') IS NOT NULL
ON CONFLICT (firm_space_id, dimension, label_name_norm) DO NOTHING;

-- custom from skus.tags + orders.tags
INSERT INTO firm.order_labels (firm_space_id, dimension, label_name)
SELECT DISTINCT s.firm_space_id, 'custom', btrim(t.tag)
FROM firm.skus s
CROSS JOIN LATERAL unnest(COALESCE(s.tags, ARRAY[]::text[])) AS t(tag)
WHERE NULLIF(btrim(COALESCE(t.tag, '')), '') IS NOT NULL
ON CONFLICT (firm_space_id, dimension, label_name_norm) DO NOTHING;

INSERT INTO firm.order_labels (firm_space_id, dimension, label_name)
SELECT DISTINCT o.firm_space_id, 'custom', btrim(t.tag)
FROM firm.orders o
CROSS JOIN LATERAL unnest(COALESCE(o.tags, ARRAY[]::text[])) AS t(tag)
WHERE NULLIF(btrim(COALESCE(t.tag, '')), '') IS NOT NULL
ON CONFLICT (firm_space_id, dimension, label_name_norm) DO NOTHING;

-- season from orders.tax_season_year
INSERT INTO firm.order_labels (firm_space_id, dimension, label_name)
SELECT DISTINCT o.firm_space_id, 'season', o.tax_season_year::text
FROM firm.orders o
WHERE o.tax_season_year IS NOT NULL
ON CONFLICT (firm_space_id, dimension, label_name_norm) DO NOTHING;

--------------------------------------------------------------------------------
-- 2) Backfill sku label IDs
--------------------------------------------------------------------------------

UPDATE firm.skus s
SET tax_country_label_id = ol.id
FROM firm.order_labels ol
WHERE ol.firm_space_id = s.firm_space_id
  AND ol.dimension = 'country'
  AND ol.label_name_norm = lower(btrim(COALESCE(s.tax_country, '')))
  AND NULLIF(btrim(COALESCE(s.tax_country, '')), '') IS NOT NULL
  AND (s.tax_country_label_id IS NULL OR s.tax_country_label_id IS DISTINCT FROM ol.id);

UPDATE firm.skus s
SET tax_scenario_label_id = ol.id
FROM firm.order_labels ol
WHERE ol.firm_space_id = s.firm_space_id
  AND ol.dimension = 'scenario'
  AND ol.label_name_norm = lower(btrim(COALESCE(s.tax_scenario, '')))
  AND NULLIF(btrim(COALESCE(s.tax_scenario, '')), '') IS NOT NULL
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
  WHERE NULLIF(btrim(COALESCE(t.tag, '')), '') IS NOT NULL
  GROUP BY s2.id
) sub
WHERE sub.sku_id = s.id;

--------------------------------------------------------------------------------
-- 3) Backfill order label IDs (including season)
--------------------------------------------------------------------------------

UPDATE firm.orders o
SET tax_country_label_id = ol.id
FROM firm.order_labels ol
WHERE ol.firm_space_id = o.firm_space_id
  AND ol.dimension = 'country'
  AND ol.label_name_norm = lower(btrim(COALESCE(o.tax_country, '')))
  AND NULLIF(btrim(COALESCE(o.tax_country, '')), '') IS NOT NULL
  AND (o.tax_country_label_id IS NULL OR o.tax_country_label_id IS DISTINCT FROM ol.id);

UPDATE firm.orders o
SET tax_scenario_label_id = ol.id
FROM firm.order_labels ol
WHERE ol.firm_space_id = o.firm_space_id
  AND ol.dimension = 'scenario'
  AND ol.label_name_norm = lower(btrim(COALESCE(o.tax_scenario, '')))
  AND NULLIF(btrim(COALESCE(o.tax_scenario, '')), '') IS NOT NULL
  AND (o.tax_scenario_label_id IS NULL OR o.tax_scenario_label_id IS DISTINCT FROM ol.id);

UPDATE firm.orders o
SET tax_season_label_id = ol.id
FROM firm.order_labels ol
WHERE ol.firm_space_id = o.firm_space_id
  AND ol.dimension = 'season'
  AND o.tax_season_year IS NOT NULL
  AND ol.label_name_norm = lower(o.tax_season_year::text)
  AND (o.tax_season_label_id IS NULL OR o.tax_season_label_id IS DISTINCT FROM ol.id);

-- Prefer existing order.custom_label_ids; fill missing from order.tags, then fallback from sku.custom_label_ids.
UPDATE firm.orders o
SET custom_label_ids = COALESCE(sub.ids, ARRAY[]::uuid[])
FROM (
  SELECT
    o2.id AS order_id,
    array_agg(DISTINCT ol.id) AS ids
  FROM firm.orders o2
  CROSS JOIN LATERAL unnest(COALESCE(o2.tags, ARRAY[]::text[])) AS t(tag)
  JOIN firm.order_labels ol
    ON ol.firm_space_id = o2.firm_space_id
   AND ol.dimension = 'custom'
   AND ol.label_name_norm = lower(btrim(COALESCE(t.tag, '')))
  WHERE NULLIF(btrim(COALESCE(t.tag, '')), '') IS NOT NULL
  GROUP BY o2.id
) sub
WHERE sub.order_id = o.id
  AND cardinality(COALESCE(o.custom_label_ids, ARRAY[]::uuid[])) = 0;

UPDATE firm.orders o
SET custom_label_ids = COALESCE(s.custom_label_ids, ARRAY[]::uuid[])
FROM firm.skus s
WHERE s.id = o.sku_id
  AND cardinality(COALESCE(o.custom_label_ids, ARRAY[]::uuid[])) = 0;

