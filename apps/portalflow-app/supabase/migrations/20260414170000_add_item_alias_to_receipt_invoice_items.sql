-- Preserve OCR/original line name while storing a readable alias for display/search.
-- item_alias is optional and should not replace name.

ALTER TABLE public.receipt_items
  ADD COLUMN IF NOT EXISTS item_alias text;

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS item_alias text;

COMMENT ON COLUMN public.receipt_items.item_alias IS
  'Optional human-readable alias for cryptic OCR line names; original line text remains in name.';

COMMENT ON COLUMN public.invoice_items.item_alias IS
  'Optional human-readable alias for cryptic OCR line names; original line text remains in name.';
