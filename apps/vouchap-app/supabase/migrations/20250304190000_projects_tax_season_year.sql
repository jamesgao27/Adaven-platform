-- 为报税项目增加可编辑的税季年份，供 Classification / 列表使用

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS tax_season_year INTEGER;

COMMENT ON COLUMN public.projects.tax_season_year IS 'Explicit tax season year for classification; falls back to order.due_at / created_at when NULL.';

