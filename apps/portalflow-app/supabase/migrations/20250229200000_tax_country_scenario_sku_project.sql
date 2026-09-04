-- 报税国别与场景：SKU 与 Project 对齐，供识别提示词上下文
-- firm.skus：Firm 配置该 SKU 的报税辖区与场景
-- public.projects：创建时从 SKU 复制，保持一致

-- 1) firm.skus 增加 tax_country、tax_scenario
ALTER TABLE firm.skus
  ADD COLUMN IF NOT EXISTS tax_country TEXT,
  ADD COLUMN IF NOT EXISTS tax_scenario TEXT;

COMMENT ON COLUMN firm.skus.tax_country IS '报税辖区：CANADA | USA，用于识别提示词与附件归类';
COMMENT ON COLUMN firm.skus.tax_scenario IS '报税场景：如 T1, T2, 1040, 1120-S';

-- 2) public.projects 增加 tax_country、tax_scenario（与 SKU 对齐，创建时从 SKU 复制）
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS tax_country TEXT,
  ADD COLUMN IF NOT EXISTS tax_scenario TEXT;

COMMENT ON COLUMN public.projects.tax_country IS '报税辖区：与 SKU 一致，用于识别提示词';
COMMENT ON COLUMN public.projects.tax_scenario IS '报税场景：与 SKU 一致';
