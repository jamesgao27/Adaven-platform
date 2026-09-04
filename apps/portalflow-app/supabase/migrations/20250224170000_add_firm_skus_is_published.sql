-- SKU 是否发布（客户可见）
ALTER TABLE firm.skus ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN firm.skus.is_published IS '是否发布：true 客户可见，false 草稿';
