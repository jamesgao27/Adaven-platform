-- Expanded standard sales tax reference data for US + Canada in crm.tax_rate_standard.
-- US: population-weighted combined state + average local rate per Tax Foundation, January 2025.
--   https://taxfoundation.org/data/all/state/sales-tax-rates-2025/
--   tax_kind_code = COMBINED_SALES_TAX (single line; local jurisdictions vary).
-- Canada: GST / HST / PST / QST / RST as applicable (CRA public guides; NS HST 14% effective 2025-04-01).
-- Idempotent: skip if same natural key + effective_from already exists.

INSERT INTO crm.tax_rate_standard (
  country_code, region_code, tax_class_code, tax_kind_code, rate, price_basis, effective_from, effective_to, source
)
SELECT v.country_code, v.region_code, v.tax_class_code, v.tax_kind_code, v.rate::numeric, v.price_basis::text, v.effective_from::date, v.effective_to::date, v.source::text
FROM (
  VALUES
  -- -------- Canada: HST provinces (single component) --------
  ('CA', 'ON', 'STANDARD_TAXABLE', 'HST', '0.13', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('CA', 'NB', 'STANDARD_TAXABLE', 'HST', '0.15', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('CA', 'NL', 'STANDARD_TAXABLE', 'HST', '0.15', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('CA', 'PE', 'STANDARD_TAXABLE', 'HST', '0.15', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('CA', 'NS', 'STANDARD_TAXABLE', 'HST', '0.15', 'exclusive', '2000-01-01', '2025-03-31', 'seed'),
  ('CA', 'NS', 'STANDARD_TAXABLE', 'HST', '0.14', 'exclusive', '2025-04-01', NULL, 'seed'),
  -- -------- Canada: GST + provincial --------
  ('CA', 'BC', 'STANDARD_TAXABLE', 'GST', '0.05', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('CA', 'BC', 'STANDARD_TAXABLE', 'PST', '0.07', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('CA', 'MB', 'STANDARD_TAXABLE', 'GST', '0.05', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('CA', 'MB', 'STANDARD_TAXABLE', 'RST', '0.07', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('CA', 'SK', 'STANDARD_TAXABLE', 'GST', '0.05', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('CA', 'SK', 'STANDARD_TAXABLE', 'PST', '0.06', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('CA', 'QC', 'STANDARD_TAXABLE', 'GST', '0.05', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('CA', 'QC', 'STANDARD_TAXABLE', 'QST', '0.09975', 'exclusive', '2000-01-01', NULL, 'seed'),
  -- -------- Canada: GST only (AB + territories) --------
  ('CA', 'AB', 'STANDARD_TAXABLE', 'GST', '0.05', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('CA', 'NT', 'STANDARD_TAXABLE', 'GST', '0.05', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('CA', 'NU', 'STANDARD_TAXABLE', 'GST', '0.05', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('CA', 'YT', 'STANDARD_TAXABLE', 'GST', '0.05', 'exclusive', '2000-01-01', NULL, 'seed'),
  -- -------- Canada: country fallback (unknown province) --------
  ('CA', '', 'STANDARD_TAXABLE', 'GST', '0.05', 'exclusive', '2000-01-01', NULL, 'seed'),

  -- -------- US: combined state + avg local (Jan 2025 reference); effective_from 2000-01-01 so historical receipt dates still match
  ('US', 'AL', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.09427', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'AK', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.01821', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'AZ', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.08414', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'AR', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.09460', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'CA', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.08802', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'CO', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.07857', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'CT', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.06350', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'DE', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'FL', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.06948', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'GA', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.07418', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'HI', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.04500', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'ID', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.06027', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'IL', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.08890', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'IN', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.07000', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'IA', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.06942', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'KS', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.08773', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'KY', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.06000', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'LA', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.10116', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'ME', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.05500', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'MD', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.06000', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'MA', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.06250', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'MI', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.06000', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'MN', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.08125', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'MS', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.07062', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'MO', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.08410', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'MT', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'NE', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.06972', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'NV', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.08236', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'NH', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'NJ', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.06601', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'NM', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.07627', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'NY', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.08532', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'NC', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.06996', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'ND', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.07050', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'OH', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.07233', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'OK', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.09005', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'OR', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'PA', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.06341', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'RI', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.07000', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'SC', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.07499', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'SD', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.06114', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'TN', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.09556', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'TX', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.08201', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'UT', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.07319', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'VT', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.06366', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'VA', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.05771', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'WA', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.09429', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'WV', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.06569', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'WI', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.05702', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'WY', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.05441', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', 'DC', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.06000', 'exclusive', '2000-01-01', NULL, 'seed'),
  ('US', '', 'STANDARD_TAXABLE', 'COMBINED_SALES_TAX', '0.0665', 'exclusive', '2000-01-01', NULL, 'seed')
) AS v(country_code, region_code, tax_class_code, tax_kind_code, rate, price_basis, effective_from, effective_to, source)
WHERE NOT EXISTS (
  SELECT 1 FROM crm.tax_rate_standard t
  WHERE t.country_code = v.country_code
    AND t.region_code = v.region_code
    AND t.tax_class_code = v.tax_class_code
    AND t.tax_kind_code = v.tax_kind_code
    AND t.effective_from = v.effective_from::date
);

COMMENT ON TABLE crm.tax_rate_standard IS
  'Platform standard rates: CA/US sales tax reference. US COMBINED_SALES_TAX = state + population-weighted avg local (Tax Foundation Jan 2025). Verify before compliance use; groceries/exemptions not modeled.';
