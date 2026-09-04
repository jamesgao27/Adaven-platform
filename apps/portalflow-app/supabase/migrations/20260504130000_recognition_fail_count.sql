-- Track failed AI recognition attempts per voucher; UI switches retry FAB to delete when >= 3.
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS recognition_fail_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS recognition_fail_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.receipts.recognition_fail_count IS 'Increments on recognition outcomes that set needs_retake; reset on successful recognition.';
COMMENT ON COLUMN public.invoices.recognition_fail_count IS 'Increments on recognition outcomes that set needs_retake; reset on successful recognition.';
