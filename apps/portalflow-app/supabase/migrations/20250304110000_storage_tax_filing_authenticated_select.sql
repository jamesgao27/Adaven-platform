-- Firm 侧打开 client 上传的附件时需用 createSignedUrl；明确允许 authenticated 角色 SELECT tax-filing bucket，确保 signed URL 能生成成功。
-- 与既有 tax_filing_public_select 并存：public 用于公网直链（bucket 为 Public 时），authenticated 用于已登录用户生成 signed URL（bucket 为 Private 时也适用）。

DROP POLICY IF EXISTS "tax_filing_authenticated_select" ON storage.objects;
CREATE POLICY "tax_filing_authenticated_select"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'tax-filing');
