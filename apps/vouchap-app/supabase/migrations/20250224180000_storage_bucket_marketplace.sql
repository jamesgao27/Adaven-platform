-- =============================================================================
-- Storage bucket "marketplace"：服务市场 SKU 封面图等
-- 前置（必做）：在 Supabase Dashboard > Storage 中新建 bucket，
--   id/name 均为 "marketplace"，勾选 Public。否则上传会报 "Bucket not found"。
-- 本迁移仅创建 storage.objects 的 RLS 策略（可重复执行）。
-- =============================================================================

DROP POLICY IF EXISTS "marketplace_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "marketplace_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "marketplace_authenticated_delete" ON storage.objects;
DROP POLICY IF EXISTS "marketplace_public_select" ON storage.objects;

-- 策略：已认证用户可上传/更新/删除（SKU 编辑时上传封面）
CREATE POLICY "marketplace_authenticated_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'marketplace');

CREATE POLICY "marketplace_authenticated_update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'marketplace');

CREATE POLICY "marketplace_authenticated_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'marketplace');

-- 策略：公开读取（服务市场与 SKU 卡片展示封面）
CREATE POLICY "marketplace_public_select"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'marketplace');
