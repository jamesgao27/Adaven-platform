-- Backfill: historical rows used input_type = 'image' for camera captures before
-- gallery vs camera was distinguished. Set those to 'camera' so 'image' can mean
-- gallery/file-picker uploads in the UI.
--
-- Cutoff: 2026-03-01 17:00 (adjust timezone below to match your intent).
-- Default here is China Standard Time (UTC+8). For US Central instead, use e.g.:
--   AND created_at < timestamptz '2026-03-01 17:00:00-06:00'
--
-- Review counts before applying:
--   SELECT COUNT(*) FROM public.receipts  WHERE input_type = 'image' AND created_at < :cutoff;
--   SELECT COUNT(*) FROM public.invoices WHERE input_type = 'image' AND created_at < :cutoff;

BEGIN;

UPDATE public.receipts
SET
  input_type = 'camera',
  updated_at = now()
WHERE input_type = 'image'
  AND created_at < timestamptz '2026-03-01 17:00:00+08:00';

UPDATE public.invoices
SET
  input_type = 'camera',
  updated_at = now()
WHERE input_type = 'image'
  AND created_at < timestamptz '2026-03-01 17:00:00+08:00';

COMMIT;
