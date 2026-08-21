-- Drop duplicate ZERO_RATED rows in crm.tax_rate_standard (same rates as EXEMPT mirror).
-- Receipt lines keep tax_class_code EXEMPT | ZERO_RATED; CRM stores one zero-rate class only.

UPDATE public.receipt_item_taxes rit
SET crm_tax_rate_standard_id = e.id
FROM crm.tax_rate_standard z
INNER JOIN crm.tax_rate_standard e
  ON e.country_code = z.country_code
  AND e.region_code IS NOT DISTINCT FROM z.region_code
  AND e.tax_kind_code = z.tax_kind_code
  AND e.effective_from = z.effective_from
  AND e.tax_class_code = 'EXEMPT'
WHERE rit.crm_tax_rate_standard_id = z.id
  AND z.tax_class_code = 'ZERO_RATED';

DELETE FROM crm.tax_rate_standard WHERE tax_class_code = 'ZERO_RATED';

COMMENT ON TABLE crm.tax_rate_standard IS
  'Platform standard rates (CA/US reference). EXEMPT mirrors each STANDARD row at rate 0 for all tax_kind rows; ZERO_RATED lines use the same CRM rows (app resolves ZERO_RATED → EXEMPT for lookup).';
