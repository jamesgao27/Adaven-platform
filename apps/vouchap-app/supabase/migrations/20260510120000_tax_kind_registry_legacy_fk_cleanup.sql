-- 1) Logical sales-tax "kind" registry (jurisdiction-scoped): same printed label may map to different rows
--    (e.g. BC PST vs SK PST vs MB RST). Apps should store crm.tax_kind_registry.id on receipt tax_breakdown lines.
-- 2) Link crm.tax_rate_standard rows to that registry for maintenance and lookups.
-- 3) Drop legacy supplier/customer FK columns superseded by entity_id (pre-entities migration).
--
-- Backup recommended before applying on production.

-- ---------------------------------------------------------------------------
-- crm.tax_kind_registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.tax_kind_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL,
  region_code text NOT NULL DEFAULT '',
  tax_class_code text NOT NULL DEFAULT 'STANDARD_TAXABLE',
  tax_kind_code text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_crm_tax_kind_registry_natural UNIQUE (country_code, region_code, tax_class_code, tax_kind_code)
);

COMMENT ON TABLE crm.tax_kind_registry IS
  'Logical sales-tax component per jurisdiction + class + kind (stable id). Distinct from crm.tax_rate_standard rows which are versioned by effective_from. Use id in receipts.tax_breakdown JSON; keep printed label in JSON for audit.';

COMMENT ON COLUMN crm.tax_kind_registry.tax_kind_code IS
  'Canonical kind code aligned with crm.tax_rate_standard.tax_kind_code (e.g. GST, PST, RST, HST, QST, COMBINED_SALES_TAX).';

CREATE INDEX IF NOT EXISTS idx_crm_tax_kind_registry_lookup
  ON crm.tax_kind_registry (country_code, region_code, tax_kind_code);

ALTER TABLE crm.tax_kind_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_tax_kind_registry_select ON crm.tax_kind_registry;
CREATE POLICY crm_tax_kind_registry_select ON crm.tax_kind_registry
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON TABLE crm.tax_kind_registry TO authenticated;

-- Seed registry from all distinct kind keys already present in standard rates
INSERT INTO crm.tax_kind_registry (country_code, region_code, tax_class_code, tax_kind_code)
SELECT DISTINCT country_code, region_code, tax_class_code, tax_kind_code
FROM crm.tax_rate_standard
ON CONFLICT (country_code, region_code, tax_class_code, tax_kind_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- crm.tax_rate_standard → registry
-- ---------------------------------------------------------------------------
ALTER TABLE crm.tax_rate_standard
  ADD COLUMN IF NOT EXISTS tax_kind_registry_id uuid REFERENCES crm.tax_kind_registry(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_tax_rate_standard_tax_kind_registry
  ON crm.tax_rate_standard (tax_kind_registry_id);

COMMENT ON COLUMN crm.tax_rate_standard.tax_kind_registry_id IS
  'Stable logical tax component; same for all effective_from rows sharing country/region/class/kind.';

UPDATE crm.tax_rate_standard trs
SET tax_kind_registry_id = r.id
FROM crm.tax_kind_registry r
WHERE r.country_code = trs.country_code
  AND r.region_code IS NOT DISTINCT FROM trs.region_code
  AND r.tax_class_code = trs.tax_class_code
  AND r.tax_kind_code = trs.tax_kind_code
  AND (trs.tax_kind_registry_id IS DISTINCT FROM r.id);

-- ---------------------------------------------------------------------------
-- receipts.tax_breakdown JSON contract (documented; column unchanged jsonb)
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.receipts.tax_breakdown IS
  'Receipt-level tax split. Legacy: flat map {"GST":0.40,"RST":0.28}. Preferred array: [{ "tax_kind_id": "<crm.tax_kind_registry.id>", "crm_tax_rate_standard_id": "<optional row for dated rate>", "code": "GST", "label": "verbatim line", "rateLabel": "5%", "amount": 0.4, "source": "model|strip" }]. tax_kind_id distinguishes same printed code across provinces.';

-- ---------------------------------------------------------------------------
-- Optional resolver for SQL / Edge (case-sensitive keys as stored in CRM seeds)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm.resolve_tax_kind_registry_id(
  p_country_code text,
  p_region_code text,
  p_tax_class_code text,
  p_tax_kind_code text
) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, crm
AS $$
  SELECT r.id
  FROM crm.tax_kind_registry r
  WHERE r.country_code = p_country_code
    AND r.region_code IS NOT DISTINCT FROM coalesce(nullif(trim(p_region_code), ''), '')
    AND r.tax_class_code = p_tax_class_code
    AND r.tax_kind_code = p_tax_kind_code
  LIMIT 1;
$$;

COMMENT ON FUNCTION crm.resolve_tax_kind_registry_id(text, text, text, text) IS
  'Returns crm.tax_kind_registry.id for natural key; region empty string matches CRM seed for country-wide fallback.';

GRANT EXECUTE ON FUNCTION crm.resolve_tax_kind_registry_id(text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Legacy FK columns (suppliers/customers era) — dropped after entity_id migration
-- ---------------------------------------------------------------------------
DO $drop_legacy_entity_fks$
BEGIN
  IF to_regclass('public.receipts') IS NOT NULL THEN
    ALTER TABLE public.receipts DROP COLUMN IF EXISTS supplier_id;
    ALTER TABLE public.receipts DROP COLUMN IF EXISTS supplier_customer_id;
  END IF;
  IF to_regclass('public.invoices') IS NOT NULL THEN
    ALTER TABLE public.invoices DROP COLUMN IF EXISTS customer_id;
    ALTER TABLE public.invoices DROP COLUMN IF EXISTS customer_supplier_id;
  END IF;
  IF to_regclass('public.inbound') IS NOT NULL THEN
    ALTER TABLE public.inbound DROP COLUMN IF EXISTS supplier_id;
  END IF;
  IF to_regclass('public.outbound') IS NOT NULL THEN
    ALTER TABLE public.outbound DROP COLUMN IF EXISTS customer_id;
  END IF;
END $drop_legacy_entity_fks$;
