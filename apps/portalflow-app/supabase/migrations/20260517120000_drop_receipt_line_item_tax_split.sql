-- Remove per–receipt-item tax split storage and POS line-tax rule pipeline.
-- Tax is receipt-level only: receipts.tax + receipts.tax_breakdown (jsonb).

BEGIN;

SET search_path = public, crm;

-- ---------------------------------------------------------------------------
-- Line-item tax rows (amount per item × tax kind)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS receipt_item_taxes_all ON public.receipt_item_taxes;
DROP TABLE IF EXISTS public.receipt_item_taxes;

-- ---------------------------------------------------------------------------
-- OCR POS letter on merchandise lines (only fed line-tax engine)
-- ---------------------------------------------------------------------------
ALTER TABLE public.receipt_items
  DROP COLUMN IF EXISTS pos_tax_code;

-- ---------------------------------------------------------------------------
-- Legacy POS learning → crm.tax_pos_code_rule (line-tax only)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_pos_tax_learning_and_maybe_promote(
  uuid, uuid, text, text, text, text, text, integer
);
DROP FUNCTION IF EXISTS public.record_pos_tax_learning_and_maybe_promote(
  uuid, uuid, text, text, text, text, text, int
);

DROP TABLE IF EXISTS public.pos_tax_code_learning_events;

DROP POLICY IF EXISTS crm_tax_pos_code_rule_select ON crm.tax_pos_code_rule;
DROP TABLE IF EXISTS crm.tax_pos_code_rule;

COMMIT;
