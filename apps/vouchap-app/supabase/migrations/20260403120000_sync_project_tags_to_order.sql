-- Keep firm.orders.tags aligned with public.projects.tags when the project is updated
-- (project is the engagement-facing source for Tina + client/firm Info; order row stays consistent for CRM lists).

SET search_path = public, firm;

CREATE OR REPLACE FUNCTION public.sync_project_tax_fields_to_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, firm
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  UPDATE firm.orders o
  SET
    tax_country = NEW.tax_country,
    tax_scenario = NEW.tax_scenario,
    tax_season_year = NEW.tax_season_year,
    tags = COALESCE(NEW.tags, ARRAY[]::text[]),
    updated_at = now()
  WHERE o.id = NEW.order_id
    AND (
      o.tax_country IS DISTINCT FROM NEW.tax_country
      OR o.tax_scenario IS DISTINCT FROM NEW.tax_scenario
      OR o.tax_season_year IS DISTINCT FROM NEW.tax_season_year
      OR o.tags IS DISTINCT FROM COALESCE(NEW.tags, ARRAY[]::text[])
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_project_tax_fields_to_order ON public.projects;
CREATE TRIGGER tr_sync_project_tax_fields_to_order
  AFTER UPDATE OF tax_country, tax_scenario, tax_season_year, tags ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_project_tax_fields_to_order();

COMMENT ON FUNCTION public.sync_project_tax_fields_to_order() IS
  'Mirror project classification text fields and tags onto firm.orders for the linked order.';
