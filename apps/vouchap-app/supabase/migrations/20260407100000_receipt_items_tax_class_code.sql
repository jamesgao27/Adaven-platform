-- Per-line sales tax class override (STANDARD_TAXABLE | EXEMPT | ZERO_RATED).
-- When set, applyReceiptItemTaxesAndReconcile uses this instead of category_tax_class_map alone.

ALTER TABLE public.receipt_items
  ADD COLUMN IF NOT EXISTS tax_class_code text;

COMMENT ON COLUMN public.receipt_items.tax_class_code IS
  'Optional: STANDARD_TAXABLE, EXEMPT, or ZERO_RATED. Overrides category_tax_class_map for line-item tax rules. Null = use category default.';
