-- Remove entity-scoped POS tax catalog (superseded by receipt-level tax_breakdown + crm.tax_kind_registry).
-- App code no longer references these objects (receipt-item-tax path removed).

BEGIN;

SET search_path = public, crm;

-- ---------------------------------------------------------------------------
-- RPC + triggers (depend on learning_events / catalog)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_entity_pos_tax_learning_and_maybe_promote(
  uuid, uuid, uuid, text, text, text, text, integer
);

DROP TRIGGER IF EXISTS trg_entity_pos_tax_learn_receipt_space ON public.entity_pos_tax_code_learning_events;
DROP FUNCTION IF EXISTS public.entity_pos_tax_code_learning_enforce_receipt_space();

DROP FUNCTION IF EXISTS public.entity_pos_tax_code_enforce_entity_space_match();
DROP FUNCTION IF EXISTS public.entity_pos_tax_code_learning_enforce_entity_space_match();

-- ---------------------------------------------------------------------------
-- Columns that referenced the catalog
-- ---------------------------------------------------------------------------
-- Must drop FK before entity_pos_tax_code (table receipt_item_taxes removed in 20260517120000).
ALTER TABLE public.receipt_item_taxes
  DROP COLUMN IF EXISTS entity_pos_tax_code_id;

ALTER TABLE public.receipt_items
  DROP COLUMN IF EXISTS applicable_tax_kinds;

-- ---------------------------------------------------------------------------
-- Tables + RLS policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS entity_pos_tax_code_learning_select ON public.entity_pos_tax_code_learning_events;
DROP POLICY IF EXISTS entity_pos_tax_code_select ON public.entity_pos_tax_code;
DROP POLICY IF EXISTS entity_pos_tax_code_insert ON public.entity_pos_tax_code;
DROP POLICY IF EXISTS entity_pos_tax_code_update ON public.entity_pos_tax_code;
DROP POLICY IF EXISTS entity_pos_tax_code_delete ON public.entity_pos_tax_code;

DROP TABLE IF EXISTS public.entity_pos_tax_code_learning_events;
DROP TABLE IF EXISTS public.entity_pos_tax_code;

COMMIT;
