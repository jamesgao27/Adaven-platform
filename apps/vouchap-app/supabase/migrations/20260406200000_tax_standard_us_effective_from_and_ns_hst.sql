-- Legacy fix: US COMBINED rows that still used effective_from = 2025-01-01 would miss older receipts.
-- Current seed (20260406180000) already uses 2000-01-01. NS HST 15% pre-2025-04-01 window is in that seed too.

UPDATE crm.tax_rate_standard
SET effective_from = DATE '2000-01-01'
WHERE country_code = 'US'
  AND tax_class_code = 'STANDARD_TAXABLE'
  AND tax_kind_code = 'COMBINED_SALES_TAX'
  AND effective_from = DATE '2025-01-01';
