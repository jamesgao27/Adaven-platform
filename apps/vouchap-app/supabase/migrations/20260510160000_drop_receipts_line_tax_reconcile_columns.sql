-- Remove line-tax reconciliation and merchant-catalog columns from receipts.
-- Tax is receipt-level: receipts.tax + receipts.tax_breakdown (jsonb); stats via tax_kind_id / code.

ALTER TABLE public.receipts
  DROP COLUMN IF EXISTS supplier_name,
  DROP COLUMN IF EXISTS tax_reconciliation_status,
  DROP COLUMN IF EXISTS tax_items_sum,
  DROP COLUMN IF EXISTS tax_variance_amount,
  DROP COLUMN IF EXISTS tax_audit_required,
  DROP COLUMN IF EXISTS tax_audit_comment,
  DROP COLUMN IF EXISTS merchant_entity_id;
