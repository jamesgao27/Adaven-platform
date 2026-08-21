-- POS tax letter codes (merchant-specific) → crm tax_class for line rules.
-- Platform-maintained; authenticated read-only. Table: crm.tax_pos_code_rule.

CREATE TABLE IF NOT EXISTS crm.tax_pos_code_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL,
  -- Province/state code; '' = any region in country
  region_code text NOT NULL DEFAULT '',
  -- ILIKE pattern vs merchant/store name, e.g. %WALMART%; '%' = any
  merchant_pattern text NOT NULL DEFAULT '%',
  pos_tax_code text NOT NULL,
  maps_to_tax_class_code text NOT NULL
    CHECK (maps_to_tax_class_code IN ('STANDARD_TAXABLE', 'EXEMPT', 'ZERO_RATED')),
  priority int NOT NULL DEFAULT 100,
  effective_from date NOT NULL DEFAULT '2000-01-01',
  effective_to date,
  source text NOT NULL DEFAULT 'seed',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tax_pos_code_rule_country
  ON crm.tax_pos_code_rule (country_code, region_code, pos_tax_code, effective_from);

ALTER TABLE crm.tax_pos_code_rule
  ADD COLUMN IF NOT EXISTS included_tax_kind_codes text[] NULL;

COMMENT ON COLUMN crm.tax_pos_code_rule.included_tax_kind_codes IS
  'If set, only these tax_kind_code values apply to the line; null = all kinds for jurisdiction.';

COMMENT ON TABLE crm.tax_pos_code_rule IS
  'Maps retailer POS codes to tax_class_code; optional included_tax_kind_codes limits which tax kinds apply per line.';

ALTER TABLE crm.tax_pos_code_rule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_tax_pos_code_rule_select ON crm.tax_pos_code_rule;
CREATE POLICY crm_tax_pos_code_rule_select ON crm.tax_pos_code_rule
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON TABLE crm.tax_pos_code_rule TO authenticated;

-- Seed: examples only — adjust per merchant agreements / receipt samples.
INSERT INTO crm.tax_pos_code_rule (
  country_code, region_code, merchant_pattern, pos_tax_code, maps_to_tax_class_code, included_tax_kind_codes, priority, effective_from, source, notes
)
SELECT * FROM (VALUES
  ('CA', 'MB', '%WALMART%', 'D', 'ZERO_RATED', NULL::text[], 10, '2000-01-01'::date, 'seed',
   'Sample MB Walmart: common grocery zero-rated marker on ticket (verify per store).'),
  ('CA', 'MB', '%WALMART%', 'H', 'STANDARD_TAXABLE', NULL::text[], 10, '2000-01-01'::date, 'seed',
   'Sample MB Walmart: full taxable line.'),
  ('CA', '', '%WALMART%', 'D', 'ZERO_RATED', NULL::text[], 50, '2000-01-01'::date, 'seed',
   'Fallback CA Walmart D when province-specific rule missing.'),
  ('CA', '', '%WALMART%', 'H', 'STANDARD_TAXABLE', NULL::text[], 50, '2000-01-01'::date, 'seed',
   'Fallback CA Walmart H.'),
  ('CA', 'MB', '%WALMART%', 'E', 'STANDARD_TAXABLE', ARRAY['GST']::text[], 10, '2000-01-01'::date, 'seed',
   'MB Walmart E: GST on line only (no PST/RST on line).'),
  ('CA', '', '%WALMART%', 'E', 'STANDARD_TAXABLE', ARRAY['GST']::text[], 50, '2000-01-01'::date, 'seed',
   'CA Walmart E fallback: GST on line only.'),
  ('US', '', '%WALMART%', 'N', 'EXEMPT', NULL::text[], 20, '2000-01-01'::date, 'seed',
   'Common US Walmart non-tax line indicator (verify per state).'),
  ('US', '', '%WALMART%', 'X', 'STANDARD_TAXABLE', NULL::text[], 20, '2000-01-01'::date, 'seed',
   'Common US Walmart taxable line indicator.')
) AS v(country_code, region_code, merchant_pattern, pos_tax_code, maps_to_tax_class_code, included_tax_kind_codes, priority, effective_from, source, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM crm.tax_pos_code_rule e
  WHERE e.country_code = v.country_code
    AND e.region_code = v.region_code
    AND e.merchant_pattern IS NOT DISTINCT FROM v.merchant_pattern
    AND upper(e.pos_tax_code) = upper(v.pos_tax_code)
    AND e.effective_from = v.effective_from
);

-- Line-level POS code from model / OCR
ALTER TABLE public.receipt_items
  ADD COLUMN IF NOT EXISTS pos_tax_code text;

COMMENT ON COLUMN public.receipt_items.pos_tax_code IS
  'Retailer POS tax code letter(s) from receipt line when extracted; resolved via crm.tax_pos_code_rule.';

-- Tax audit flag (large variance vs receipt.tax after line engine)
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS tax_audit_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_audit_comment text;

COMMENT ON COLUMN public.receipts.tax_audit_required IS
  'True when |receipt.tax − Σ line taxes| exceeds rounding tolerance after line engine.';
COMMENT ON COLUMN public.receipts.tax_audit_comment IS
  'English note for reviewers: variance amount and suspected causes.';
