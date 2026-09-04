-- Fix client catalog: the previous is_sku_published_catalog OR-branch let is_published=true + template_status=private through.

SET search_path = public, firm;

CREATE OR REPLACE FUNCTION firm.is_sku_published_catalog(p_sku firm.skus)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(p_sku.template_status, '') = 'published'
    AND COALESCE(p_sku.is_published, false) = true;
$$;
