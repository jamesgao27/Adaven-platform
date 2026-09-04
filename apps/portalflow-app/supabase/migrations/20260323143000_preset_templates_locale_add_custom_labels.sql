-- Locale-based custom labels for crm.preset_templates:
-- zh -> 中文
-- en -> English

SET search_path = public, firm, crm;

--------------------------------------------------------------------------------
-- 1) Ensure custom labels exist in preset label library
--------------------------------------------------------------------------------

INSERT INTO crm.preset_template_labels (dimension, label_name)
VALUES
  ('custom', '中文'),
  ('custom', 'English')
ON CONFLICT (dimension, label_name_norm) DO NOTHING;

--------------------------------------------------------------------------------
-- 2) Map locale to custom_label_ids (append, dedupe)
--------------------------------------------------------------------------------

UPDATE crm.preset_templates pt
SET custom_label_ids = (
  SELECT COALESCE(array_agg(DISTINCT x.id), ARRAY[]::uuid[])
  FROM unnest(
    COALESCE(pt.custom_label_ids, ARRAY[]::uuid[])
    || ARRAY[
      CASE
        WHEN lower(COALESCE(pt.locale, '')) = 'zh' THEN (
          SELECT ptl.id
          FROM crm.preset_template_labels ptl
          WHERE ptl.dimension = 'custom' AND ptl.label_name_norm = lower('中文')
          LIMIT 1
        )
        WHEN lower(COALESCE(pt.locale, '')) = 'en' THEN (
          SELECT ptl.id
          FROM crm.preset_template_labels ptl
          WHERE ptl.dimension = 'custom' AND ptl.label_name_norm = lower('English')
          LIMIT 1
        )
        ELSE NULL
      END
    ]::uuid[]
  ) AS x(id)
  WHERE x.id IS NOT NULL
)
WHERE lower(COALESCE(pt.locale, '')) IN ('zh', 'en');

