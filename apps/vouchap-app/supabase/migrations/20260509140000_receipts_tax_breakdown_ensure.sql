-- Ensure receipts.tax_breakdown exists on all environments.
-- Some remotes may report migrations "up to date" while this column is missing
-- (diverged history, manual schema edits, or restore from an older snapshot).

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS tax_breakdown jsonb NULL;

COMMENT ON COLUMN public.receipts.tax_breakdown IS
  'Receipt-level sales tax split: legacy flat map {"GST":0.40,"RST":0.28} or JSON array of objects {code,label,rateLabel?,amount,source?} for flexible printed tax lines.';
