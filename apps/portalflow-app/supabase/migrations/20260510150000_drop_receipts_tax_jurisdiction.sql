-- Remove persisted tax jurisdiction on receipts. Jurisdiction for line-tax / CRM lookup
-- is derived at reconcile time from currency, entity/processed_by text, and POS rules — not stored on the row.

ALTER TABLE public.receipts
  DROP COLUMN IF EXISTS tax_jurisdiction_country,
  DROP COLUMN IF EXISTS tax_jurisdiction_region;
