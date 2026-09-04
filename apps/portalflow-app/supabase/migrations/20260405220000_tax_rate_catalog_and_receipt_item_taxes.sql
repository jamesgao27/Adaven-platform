-- Standard / space-cached tax rates + per–receipt-item tax breakdown.
-- Platform rows use space_id IS NULL (seed only). App may insert space_id = current space for cache (catalog_lookup).

-- ---------------------------------------------------------------------------
-- tax_rate_catalog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tax_rate_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid REFERENCES public.spaces(id) ON DELETE CASCADE,
  country_code text NOT NULL,
  region_code text NOT NULL DEFAULT '',
  tax_class_code text NOT NULL,
  tax_kind_code text NOT NULL,
  rate numeric(12, 8) NOT NULL,
  price_basis text NOT NULL DEFAULT 'exclusive' CHECK (price_basis IN ('exclusive', 'inclusive')),
  effective_from date NOT NULL DEFAULT '2000-01-01',
  effective_to date,
  source text NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'catalog_lookup', 'user')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tax_rate_catalog_lookup
  ON public.tax_rate_catalog (country_code, region_code, tax_class_code, effective_from);

CREATE INDEX IF NOT EXISTS idx_tax_rate_catalog_space
  ON public.tax_rate_catalog (space_id, country_code, region_code, tax_class_code);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tax_rate_catalog_platform
  ON public.tax_rate_catalog (country_code, region_code, tax_class_code, tax_kind_code, effective_from)
  WHERE space_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_tax_rate_catalog_space_row
  ON public.tax_rate_catalog (space_id, country_code, region_code, tax_class_code, tax_kind_code, effective_from)
  WHERE space_id IS NOT NULL;

COMMENT ON TABLE public.tax_rate_catalog IS 'Jurisdiction + tax class + tax kind rates; space_id NULL = platform seed, non-null = space cache from builtin / lookup.';

-- ---------------------------------------------------------------------------
-- category_tax_class_map: optional expense category → tax class per space
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.category_tax_class_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  tax_class_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_category_tax_class_map_category ON public.category_tax_class_map (category_id);

-- ---------------------------------------------------------------------------
-- receipt_item_taxes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.receipt_item_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_item_id uuid NOT NULL REFERENCES public.receipt_items(id) ON DELETE CASCADE,
  tax_kind_code text NOT NULL,
  amount numeric(14, 4) NOT NULL,
  rate_applied numeric(12, 8),
  taxable_base numeric(14, 4),
  tax_rate_catalog_id uuid REFERENCES public.tax_rate_catalog(id) ON DELETE SET NULL,
  computation_source text NOT NULL DEFAULT 'rule_engine'
    CHECK (computation_source IN ('rule_engine', 'recalc', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receipt_item_id, tax_kind_code)
);

CREATE INDEX IF NOT EXISTS idx_receipt_item_taxes_item ON public.receipt_item_taxes (receipt_item_id);

-- ---------------------------------------------------------------------------
-- receipts: jurisdiction + reconciliation (optional; keeps ticket tax as-is)
-- ---------------------------------------------------------------------------
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS tax_jurisdiction_country text,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction_region text,
  ADD COLUMN IF NOT EXISTS tax_reconciliation_status text
    CHECK (tax_reconciliation_status IS NULL OR tax_reconciliation_status IN ('matched', 'within_tolerance', 'variance', 'pending_recalc', 'skipped')),
  ADD COLUMN IF NOT EXISTS tax_items_sum numeric(14, 4),
  ADD COLUMN IF NOT EXISTS tax_variance_amount numeric(14, 4);

COMMENT ON COLUMN public.receipts.tax_reconciliation_status IS 'Line-item computed tax sum vs receipts.tax: matched / within_tolerance / variance / pending_recalc / skipped.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.tax_rate_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_tax_class_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_item_taxes ENABLE ROW LEVEL SECURITY;

-- tax_rate_catalog: read platform + own spaces
DROP POLICY IF EXISTS tax_rate_catalog_select ON public.tax_rate_catalog;
CREATE POLICY tax_rate_catalog_select ON public.tax_rate_catalog
  FOR SELECT TO authenticated
  USING (
    space_id IS NULL
    OR space_id IN (SELECT space_id FROM public.user_spaces WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS tax_rate_catalog_insert ON public.tax_rate_catalog;
CREATE POLICY tax_rate_catalog_insert ON public.tax_rate_catalog
  FOR INSERT TO authenticated
  WITH CHECK (
    space_id IS NOT NULL
    AND space_id IN (SELECT space_id FROM public.user_spaces WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS tax_rate_catalog_update ON public.tax_rate_catalog;
CREATE POLICY tax_rate_catalog_update ON public.tax_rate_catalog
  FOR UPDATE TO authenticated
  USING (
    space_id IS NOT NULL
    AND space_id IN (SELECT space_id FROM public.user_spaces WHERE user_id = auth.uid())
  )
  WITH CHECK (
    space_id IS NOT NULL
    AND space_id IN (SELECT space_id FROM public.user_spaces WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS tax_rate_catalog_delete ON public.tax_rate_catalog;
CREATE POLICY tax_rate_catalog_delete ON public.tax_rate_catalog
  FOR DELETE TO authenticated
  USING (
    space_id IS NOT NULL
    AND space_id IN (SELECT space_id FROM public.user_spaces WHERE user_id = auth.uid())
  );

-- category_tax_class_map
DROP POLICY IF EXISTS category_tax_class_map_all ON public.category_tax_class_map;
CREATE POLICY category_tax_class_map_all ON public.category_tax_class_map
  FOR ALL TO authenticated
  USING (
    space_id IN (SELECT space_id FROM public.user_spaces WHERE user_id = auth.uid())
  )
  WITH CHECK (
    space_id IN (SELECT space_id FROM public.user_spaces WHERE user_id = auth.uid())
  );

-- receipt_item_taxes: same receipt access as receipt_items
DROP POLICY IF EXISTS receipt_item_taxes_all ON public.receipt_item_taxes;
CREATE POLICY receipt_item_taxes_all ON public.receipt_item_taxes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.receipt_items ri
      JOIN public.receipts r ON r.id = ri.receipt_id
      WHERE ri.id = receipt_item_taxes.receipt_item_id
        AND r.space_id IN (SELECT space_id FROM public.user_spaces WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.receipt_items ri
      JOIN public.receipts r ON r.id = ri.receipt_id
      WHERE ri.id = receipt_item_taxes.receipt_item_id
        AND r.space_id IN (SELECT space_id FROM public.user_spaces WHERE user_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Seed: Canada examples (space_id NULL = platform)
-- ---------------------------------------------------------------------------
INSERT INTO public.tax_rate_catalog (
  space_id, country_code, region_code, tax_class_code, tax_kind_code, rate, price_basis, effective_from, effective_to, source
)
SELECT * FROM (VALUES
  (NULL::uuid, 'CA', 'BC', 'STANDARD_TAXABLE', 'GST', 0.05::numeric, 'exclusive', '2000-01-01'::date, NULL::date, 'seed'),
  (NULL::uuid, 'CA', 'BC', 'STANDARD_TAXABLE', 'PST', 0.07::numeric, 'exclusive', '2000-01-01'::date, NULL::date, 'seed'),
  (NULL::uuid, 'CA', 'ON', 'STANDARD_TAXABLE', 'HST', 0.13::numeric, 'exclusive', '2000-01-01'::date, NULL::date, 'seed'),
  (NULL::uuid, 'CA', 'AB', 'STANDARD_TAXABLE', 'GST', 0.05::numeric, 'exclusive', '2000-01-01'::date, NULL::date, 'seed'),
  (NULL::uuid, 'CA', '', 'STANDARD_TAXABLE', 'GST', 0.05::numeric, 'exclusive', '2000-01-01'::date, NULL::date, 'seed')
) AS v(space_id, country_code, region_code, tax_class_code, tax_kind_code, rate, price_basis, effective_from, effective_to, source)
WHERE NOT EXISTS (
  SELECT 1 FROM public.tax_rate_catalog t
  WHERE t.space_id IS NULL
    AND t.country_code = v.country_code
    AND t.region_code = v.region_code
    AND t.tax_class_code = v.tax_class_code
    AND t.tax_kind_code = v.tax_kind_code
    AND t.effective_from = v.effective_from
);
