-- =============================================================================
-- Storage bucket "tax-filing"：税表模块上传文件，按 client space_id 分文件夹存储
-- 前置（必做）：在 Supabase Dashboard > Storage 中新建 bucket，
--   id/name 均为 "tax-filing"，勾选 Public。否则上传会报 "Bucket not found"。
-- 本迁移仅创建 storage.objects 的 RLS 策略（可重复执行）。
-- =============================================================================

DROP POLICY IF EXISTS "tax_filing_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "tax_filing_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "tax_filing_authenticated_delete" ON storage.objects;
DROP POLICY IF EXISTS "tax_filing_public_select" ON storage.objects;

CREATE POLICY "tax_filing_authenticated_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'tax-filing');

CREATE POLICY "tax_filing_authenticated_update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'tax-filing');

CREATE POLICY "tax_filing_authenticated_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'tax-filing');

CREATE POLICY "tax_filing_public_select"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'tax-filing');
