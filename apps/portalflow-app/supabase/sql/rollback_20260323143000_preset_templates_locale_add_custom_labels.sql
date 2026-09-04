-- Rollback for 20260323143000_preset_templates_locale_add_custom_labels.sql
-- Safe rollback only removes locale-derived label ids from preset_templates.
-- It does not delete labels from crm.preset_template_labels to avoid data loss.

SET search_path = public, firm, crm;

WITH locale_custom_ids AS (
  SELECT id
  FROM crm.preset_template_labels
  WHERE dimension = 'custom'
    AND label_name_norm IN (lower('中文'), lower('English'))
)
UPDATE crm.preset_templates pt
SET custom_label_ids = COALESCE(
  (
    SELECT array_agg(x.id)
    FROM unnest(COALESCE(pt.custom_label_ids, ARRAY[]::uuid[])) AS x(id)
    WHERE x.id NOT IN (SELECT id FROM locale_custom_ids)
  ),
  ARRAY[]::uuid[]
)
WHERE lower(COALESCE(pt.locale, '')) IN ('zh', 'en');

