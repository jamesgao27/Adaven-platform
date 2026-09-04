-- Walmart Canada: POS E = GST only on line (included_tax_kind_codes).
INSERT INTO crm.tax_pos_code_rule (
  country_code, region_code, merchant_pattern, pos_tax_code, maps_to_tax_class_code, included_tax_kind_codes, priority, effective_from, source, notes
)
SELECT * FROM (VALUES
  ('CA', 'MB', '%WALMART%', 'E', 'STANDARD_TAXABLE', ARRAY['GST']::text[], 10, '2000-01-01'::date, 'seed',
   'MB Walmart E: GST on line only.'),
  ('CA', '', '%WALMART%', 'E', 'STANDARD_TAXABLE', ARRAY['GST']::text[], 50, '2000-01-01'::date, 'seed',
   'CA Walmart E fallback: GST on line only.')
) AS v(country_code, region_code, merchant_pattern, pos_tax_code, maps_to_tax_class_code, included_tax_kind_codes, priority, effective_from, source, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM crm.tax_pos_code_rule e
  WHERE e.country_code = v.country_code
    AND e.region_code = v.region_code
    AND e.merchant_pattern IS NOT DISTINCT FROM v.merchant_pattern
    AND upper(e.pos_tax_code) = upper(v.pos_tax_code)
    AND e.effective_from = v.effective_from
);
