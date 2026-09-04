-- Async receipt line-tax split / reconciliation: decouple from app save path.
-- App calls public.enqueue_receipt_tax_reconcile(receipt_id); a backend worker drains receipt_tax_recalc_queue.

CREATE TABLE IF NOT EXISTS public.receipt_tax_recalc_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.receipts (id) ON DELETE CASCADE,
  space_id uuid NOT NULL,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text,
  attempts int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS receipt_tax_recalc_queue_pending_enqueued_at
  ON public.receipt_tax_recalc_queue (enqueued_at)
  WHERE processed_at IS NULL;

-- At most one pending row per receipt (required for INSERT ... ON CONFLICT below).
CREATE UNIQUE INDEX IF NOT EXISTS receipt_tax_recalc_queue_pending_receipt_uniq
  ON public.receipt_tax_recalc_queue (receipt_id)
  WHERE processed_at IS NULL;

COMMENT ON TABLE public.receipt_tax_recalc_queue IS
  'Pending receipt line-tax recompute jobs; drained by service-role worker (not the mobile/web save path).';

ALTER TABLE public.receipt_tax_recalc_queue ENABLE ROW LEVEL SECURITY;

-- No direct client access; inserts happen via SECURITY DEFINER RPC only.

-- LANGUAGE sql + one statement: survives runners that split on ";" inside plpgsql (42P01 on "variables").
-- Validation errors use division-by-zero (short-circuit CASE); message is generic unless you wrap in plpgsql later.
CREATE OR REPLACE FUNCTION public.enqueue_receipt_tax_reconcile(p_receipt_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $sql$
WITH checks AS (
  SELECT (
    CASE
      WHEN auth.uid() IS NULL THEN 1 / 0
      WHEN NOT EXISTS (SELECT 1 FROM public.receipts r0 WHERE r0.id = p_receipt_id) THEN 1 / 0
      WHEN NOT EXISTS (
        SELECT 1
        FROM public.receipts r1
        INNER JOIN public.user_spaces us1 ON us1.space_id = r1.space_id AND us1.user_id = auth.uid()
        WHERE r1.id = p_receipt_id
      ) THEN 1 / 0
      ELSE 0
    END
  ) AS _
),
ins AS (
  INSERT INTO public.receipt_tax_recalc_queue (receipt_id, space_id)
  SELECT p_receipt_id, r.space_id
  FROM checks
  CROSS JOIN public.receipts r
  INNER JOIN public.user_spaces us ON us.space_id = r.space_id AND us.user_id = auth.uid()
  WHERE r.id = p_receipt_id
  ON CONFLICT (receipt_id) WHERE (processed_at IS NULL)
  DO UPDATE SET enqueued_at = now()
  RETURNING 1 AS _
)
SELECT NULL::void FROM ins;
$sql$;

REVOKE ALL ON FUNCTION public.enqueue_receipt_tax_reconcile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_receipt_tax_reconcile(uuid) TO authenticated;

COMMENT ON FUNCTION public.enqueue_receipt_tax_reconcile(uuid) IS
  'Member-only: enqueue (or bump) a pending receipt tax recompute job; does not run tax logic.';
