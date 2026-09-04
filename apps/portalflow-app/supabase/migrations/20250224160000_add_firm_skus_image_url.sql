-- Firm SKU 支持封面图与介绍文字（海报样式）
-- image_url 存 Supabase Storage 公共 URL；description 已有，用作介绍文字
ALTER TABLE firm.skus ADD COLUMN IF NOT EXISTS image_url TEXT;
COMMENT ON COLUMN firm.skus.image_url IS 'SKU 封面图 URL（Storage 公共链接）';
