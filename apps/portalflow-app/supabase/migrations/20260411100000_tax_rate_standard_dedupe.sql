-- Remove accidental duplicate rows in crm.tax_rate_standard (same natural key, multiple ids).
-- Unique index ux_crm_tax_rate_standard_natural should prevent this; this migration repairs legacy/bypass cases.
-- Keep the oldest row (created_at, then id) per (country_code, region_code, tax_class_code, tax_kind_code, effective_from).

WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY country_code, region_code, tax_class_code, tax_kind_code, effective_from
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS keep_id
  FROM crm.tax_rate_standard
)
UPDATE public.receipt_item_taxes rit
SET crm_tax_rate_standard_id = r.keep_id
FROM ranked r
WHERE rit.crm_tax_rate_standard_id = r.id
  AND r.id <> r.keep_id;

DELETE FROM crm.tax_rate_standard t
WHERE t.id IN (
  SELECT id FROM (
    SELECT id,
           row_number() OVER (
             PARTITION BY country_code, region_code, tax_class_code, tax_kind_code, effective_from
             ORDER BY created_at ASC NULLS LAST, id ASC
           ) AS rn
    FROM crm.tax_rate_standard
  ) x
  WHERE x.rn > 1
);
