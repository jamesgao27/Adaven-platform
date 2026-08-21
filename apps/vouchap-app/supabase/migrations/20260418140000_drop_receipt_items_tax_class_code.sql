-- Remove per-line tax class override on receipt items (replaced by POS rules + default taxable path).
ALTER TABLE public.receipt_items
  DROP COLUMN IF EXISTS tax_class_code;
