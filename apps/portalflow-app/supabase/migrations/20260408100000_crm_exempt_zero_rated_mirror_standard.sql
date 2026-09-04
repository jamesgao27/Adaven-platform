-- Zero-rate supplies: same jurisdiction + tax_kind structure as STANDARD_TAXABLE, rate 0.
-- Single CRM tax_class_code EXEMPT holds all zero-rate rows; receipt lines may still use EXEMPT or ZERO_RATED
-- (semantic distinction on receipt_items / POS rules — app maps ZERO_RATED → EXEMPT for CRM lookup).

-- Mirror every CA/US STANDARD row: one EXEMPT row per (country, region, tax_kind, effective_from).
INSERT INTO crm.tax_rate_standard (
  country_code, region_code, tax_class_code, tax_kind_code, rate, price_basis, effective_from, effective_to, source
)
SELECT
  t.country_code,
  t.region_code,
  'EXEMPT'::text,
  t.tax_kind_code,
  0::numeric(12, 8),
  t.price_basis,
  t.effective_from,
  t.effective_to,
  'seed'::text
FROM crm.tax_rate_standard t
WHERE t.tax_class_code = 'STANDARD_TAXABLE'
  AND t.country_code IN ('CA', 'US')
  AND NOT EXISTS (
    SELECT 1
    FROM crm.tax_rate_standard x
    WHERE x.country_code = t.country_code
      AND x.region_code IS NOT DISTINCT FROM t.region_code
      AND x.tax_class_code = 'EXEMPT'
      AND x.tax_kind_code = t.tax_kind_code
      AND x.effective_from = t.effective_from
  );

COMMENT ON TABLE crm.tax_rate_standard IS
  'Platform standard rates (CA/US reference). EXEMPT mirrors each STANDARD row at rate 0 for all tax_kind rows; ZERO_RATED lines use the same CRM rows (app resolves ZERO_RATED → EXEMPT for lookup).';
