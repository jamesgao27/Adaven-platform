-- Ensure Storage buckets exist on a fresh Portalflow project.
-- receipts / marketplace are public (getPublicUrl). tax-filing / chat-audio are private.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('receipts', 'receipts', true, NULL, NULL),
  ('chat-audio', 'chat-audio', false, NULL, NULL),
  ('marketplace', 'marketplace', true, NULL, NULL),
  ('tax-filing', 'tax-filing', false, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "receipts_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "receipts_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "receipts_authenticated_delete" ON storage.objects;
DROP POLICY IF EXISTS "receipts_public_select" ON storage.objects;

CREATE POLICY "receipts_authenticated_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'receipts');

CREATE POLICY "receipts_authenticated_update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'receipts');

CREATE POLICY "receipts_authenticated_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'receipts');

CREATE POLICY "receipts_public_select"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'receipts');

DROP POLICY IF EXISTS "chat_audio_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_audio_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "chat_audio_authenticated_delete" ON storage.objects;
DROP POLICY IF EXISTS "chat_audio_authenticated_select" ON storage.objects;

CREATE POLICY "chat_audio_authenticated_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'chat-audio');

CREATE POLICY "chat_audio_authenticated_update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'chat-audio');

CREATE POLICY "chat_audio_authenticated_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'chat-audio');

CREATE POLICY "chat_audio_authenticated_select"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-audio');
