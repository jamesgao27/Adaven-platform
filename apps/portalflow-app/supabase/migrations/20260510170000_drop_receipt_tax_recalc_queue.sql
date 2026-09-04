-- Receipt tax is computed at recognition/save time (receipt-level tax + tax_breakdown only).
-- Async line-tax queue and enqueue RPC are no longer used.

DROP FUNCTION IF EXISTS public.enqueue_receipt_tax_reconcile(uuid);

DROP TABLE IF EXISTS public.receipt_tax_recalc_queue;
