-- Platform standard tax rates live in crm.tax_rate_standard (read-only for authenticated app users).
-- public.tax_rate_catalog is space-scoped cache only (NOT NULL space_id).

CREATE SCHEMA IF NOT EXISTS crm;

CREATE TABLE IF NOT EXISTS crm.tax_rate_standard (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL,
  region_code text NOT NULL DEFAULT '',
  tax_class_code text NOT NULL,
  tax_kind_code text NOT NULL,
  rate numeric(12, 8) NOT NULL,
  price_basis text NOT NULL DEFAULT 'exclusive' CHECK (price_basis IN ('exclusive', 'inclusive')),
  effective_from date NOT NULL DEFAULT '2000-01-01',
  effective_to date,
  source text NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'catalog_lookup', 'user', 'model')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_tax_rate_standard_lookup
  ON crm.tax_rate_standard (country_code, region_code, tax_class_code, effective_from);

CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_tax_rate_standard_natural
  ON crm.tax_rate_standard (country_code, region_code, tax_class_code, tax_kind_code, effective_from);

COMMENT ON TABLE crm.tax_rate_standard IS 'Platform-maintained standard rates; client spaces SELECT only; writes via service_role / ops.';

-- RLS: logged-in users read; no INSERT/UPDATE/DELETE for authenticated (service_role bypasses).
ALTER TABLE crm.tax_rate_standard ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_tax_rate_standard_select ON crm.tax_rate_standard;
CREATE POLICY crm_tax_rate_standard_select ON crm.tax_rate_standard
  FOR SELECT TO authenticated
  USING (true);

GRANT USAGE ON SCHEMA crm TO authenticated;
GRANT SELECT ON TABLE crm.tax_rate_standard TO authenticated;

-- Canada/US reference rates are seeded in 20260406180000_seed_crm_tax_rate_standard_us_ca.sql (single source).

-- Copy any legacy platform rows from public (space_id IS NULL) into crm if not already present
INSERT INTO crm.tax_rate_standard (
  country_code, region_code, tax_class_code, tax_kind_code, rate, price_basis, effective_from, effective_to, source
)
SELECT
  p.country_code,
  p.region_code,
  p.tax_class_code,
  p.tax_kind_code,
  p.rate,
  p.price_basis,
  p.effective_from,
  p.effective_to,
  CASE p.source
    WHEN 'seed' THEN 'seed'
    WHEN 'catalog_lookup' THEN 'catalog_lookup'
    WHEN 'user' THEN 'user'
    ELSE 'seed'
  END
FROM public.tax_rate_catalog p
WHERE p.space_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM crm.tax_rate_standard c
    WHERE c.country_code = p.country_code
      AND c.region_code = p.region_code
      AND c.tax_class_code = p.tax_class_code
      AND c.tax_kind_code = p.tax_kind_code
      AND c.effective_from = p.effective_from
  );

-- receipt_item_taxes: optional link to CRM standard row (space cache uses tax_rate_catalog_id)
ALTER TABLE public.receipt_item_taxes
  ADD COLUMN IF NOT EXISTS crm_tax_rate_standard_id uuid REFERENCES crm.tax_rate_standard(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receipt_item_taxes_crm_standard
  ON public.receipt_item_taxes (crm_tax_rate_standard_id);

COMMENT ON COLUMN public.receipt_item_taxes.crm_tax_rate_standard_id IS 'When rate came from crm.tax_rate_standard; tax_rate_catalog_id is for public space cache only.';

-- Remove legacy platform rows from public (FK on receipt_item_taxes is ON DELETE SET NULL)
DELETE FROM public.tax_rate_catalog WHERE space_id IS NULL;

DROP INDEX IF EXISTS ux_tax_rate_catalog_platform;

-- Space cache must always be tied to a space
ALTER TABLE public.tax_rate_catalog
  ALTER COLUMN space_id SET NOT NULL;

-- Tighten SELECT: no more synthetic "platform" in public
DROP POLICY IF EXISTS tax_rate_catalog_select ON public.tax_rate_catalog;
CREATE POLICY tax_rate_catalog_select ON public.tax_rate_catalog
  FOR SELECT TO authenticated
  USING (
    space_id IN (SELECT space_id FROM public.user_spaces WHERE user_id = auth.uid())
  );
