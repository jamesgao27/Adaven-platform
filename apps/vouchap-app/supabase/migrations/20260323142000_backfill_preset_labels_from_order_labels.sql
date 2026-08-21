-- Backfill crm.preset_template_labels from firm.order_labels (global dedupe),
-- and link crm.preset_templates to matched preset label ids.

SET search_path = public, firm, crm;

--------------------------------------------------------------------------------
-- 1) Dedupe copy firm.order_labels -> crm.preset_template_labels
--------------------------------------------------------------------------------

INSERT INTO crm.preset_template_labels (dimension, label_name)
SELECT DISTINCT ol.dimension, btrim(ol.label_name)
FROM firm.order_labels ol
WHERE NULLIF(btrim(COALESCE(ol.label_name, '')), '') IS NOT NULL
ON CONFLICT (dimension, label_name_norm) DO NOTHING;

--------------------------------------------------------------------------------
-- 2) Auto-link crm.preset_templates by existing text fields
--------------------------------------------------------------------------------

UPDATE crm.preset_templates pt
SET tax_country_label_id = ptl.id
FROM crm.preset_template_labels ptl
WHERE ptl.dimension = 'country'
  AND ptl.label_name_norm = lower(btrim(COALESCE(pt.tax_country, '')))
  AND NULLIF(btrim(COALESCE(pt.tax_country, '')), '') IS NOT NULL
  AND (pt.tax_country_label_id IS NULL OR pt.tax_country_label_id IS DISTINCT FROM ptl.id);

UPDATE crm.preset_templates pt
SET tax_scenario_label_id = ptl.id
FROM crm.preset_template_labels ptl
WHERE ptl.dimension = 'scenario'
  AND ptl.label_name_norm = lower(btrim(COALESCE(pt.tax_scenario, '')))
  AND NULLIF(btrim(COALESCE(pt.tax_scenario, '')), '') IS NOT NULL
  AND (pt.tax_scenario_label_id IS NULL OR pt.tax_scenario_label_id IS DISTINCT FROM ptl.id);

-- Keep text fields in sync with label ids if ids already exist.
UPDATE crm.preset_templates pt
SET tax_country = COALESCE(pt.tax_country, ptl.label_name)
FROM crm.preset_template_labels ptl
WHERE pt.tax_country_label_id = ptl.id
  AND ptl.dimension = 'country'
  AND (pt.tax_country IS NULL OR btrim(pt.tax_country) = '');

UPDATE crm.preset_templates pt
SET tax_scenario = COALESCE(pt.tax_scenario, ptl.label_name)
FROM crm.preset_template_labels ptl
WHERE pt.tax_scenario_label_id = ptl.id
  AND ptl.dimension = 'scenario'
  AND (pt.tax_scenario IS NULL OR btrim(pt.tax_scenario) = '');

