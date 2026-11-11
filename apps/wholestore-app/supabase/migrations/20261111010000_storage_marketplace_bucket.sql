-- Shared avatar / space logo uploads use the public marketplace bucket
-- (same path layout as Portalflow / Vouchap ManagementScreen).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('marketplace', 'marketplace', true, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "marketplace_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "marketplace_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "marketplace_authenticated_delete" ON storage.objects;
DROP POLICY IF EXISTS "marketplace_public_select" ON storage.objects;

CREATE POLICY "marketplace_authenticated_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'marketplace');

CREATE POLICY "marketplace_authenticated_update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'marketplace');

CREATE POLICY "marketplace_authenticated_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'marketplace');

CREATE POLICY "marketplace_public_select"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'marketplace');
