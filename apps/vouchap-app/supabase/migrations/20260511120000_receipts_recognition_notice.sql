-- User-visible English notice when recognition did not run or failed (e.g. workspace quota vs model API).
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS recognition_notice text NULL;

COMMENT ON COLUMN public.receipts.recognition_notice IS
  'English notice shown in app when recognition stops (plan/credits limit, technical failure). Cleared on successful recognition. Not the Gemini API dashboard quota.';
