-- Service Template 状态与分类独立：状态单独存 template_status，分类（tax_country/tax_scenario）独立配置
ALTER TABLE firm.skus
  ADD COLUMN IF NOT EXISTS template_status TEXT;

COMMENT ON COLUMN firm.skus.template_status IS '模板状态：draft=仅草稿不可选用, private=内部可用, published=已发布；与 tax_country/tax_scenario 独立';

-- 回填：已有数据按 is_published + tax 推导
UPDATE firm.skus
SET template_status = CASE
  WHEN is_published = true THEN 'published'
  WHEN tax_country IS NOT NULL OR tax_scenario IS NOT NULL THEN 'private'
  ELSE 'draft'
END
WHERE template_status IS NULL;
