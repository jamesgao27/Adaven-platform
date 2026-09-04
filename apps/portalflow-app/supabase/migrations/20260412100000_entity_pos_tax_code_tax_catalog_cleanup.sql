-- Per-merchant POS tax codes (public, shared catalog — not space-partitioned).
-- merchant_entity_id is a platform-stable uuid key for tax/POS rules, NOT a reference to public.entities.
-- Standard rates remain in crm.tax_rate_standard only.

-- ---------------------------------------------------------------------------
-- receipt_item_taxes: drop catalog column (drops FK); link to entity POS rule
-- ---------------------------------------------------------------------------
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS merchant_entity_id uuid NULL;

COMMENT ON COLUMN public.receipts.merchant_entity_id IS
  'Shared-catalog merchant key for public.entity_pos_tax_code lookups. Not public.entities.id (payee rows are space-scoped).';

ALTER TABLE public.receipt_item_taxes
  DROP COLUMN IF EXISTS tax_rate_catalog_id;

-- ---------------------------------------------------------------------------
-- receipt_items: resolved tax_kind list for audit/UI
-- ---------------------------------------------------------------------------
ALTER TABLE public.receipt_items
  ADD COLUMN IF NOT EXISTS applicable_tax_kinds jsonb NULL;

COMMENT ON COLUMN public.receipt_items.applicable_tax_kinds IS
  'JSON array of tax_kind_code strings applied to this line after merchant/CRM POS resolution (e.g. ["GST","RST"]).';

-- ---------------------------------------------------------------------------
-- public.entity_pos_tax_code (global catalog; merchant_entity_id is not public.entities)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.entity_pos_tax_code (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_entity_id uuid NOT NULL,
  country_code text NOT NULL,
  jurisdiction_region text NOT NULL DEFAULT '',
  pos_tax_code text NOT NULL,
  maps_to_tax_class_code text NOT NULL
    CHECK (maps_to_tax_class_code IN ('STANDARD_TAXABLE', 'EXEMPT', 'ZERO_RATED')),
  included_tax_kind_codes text[] NULL,
  priority int NOT NULL DEFAULT 100,
  effective_from date NOT NULL DEFAULT '2000-01-01',
  effective_to date,
  source text NOT NULL DEFAULT 'learned'
    CHECK (source IN ('seed', 'user', 'learned', 'model')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_pos_tax_code_lookup
  ON public.entity_pos_tax_code (merchant_entity_id, country_code, jurisdiction_region, pos_tax_code, effective_from);

COMMENT ON TABLE public.entity_pos_tax_code IS
  'Platform-shared POS tax code meanings by merchant_entity_id (not public.entities.id), country, and jurisdiction_region.';

COMMENT ON COLUMN public.entity_pos_tax_code.merchant_entity_id IS
  'Stable merchant key for this catalog; intentionally no FK to public.entities.';

ALTER TABLE public.receipt_item_taxes
  ADD COLUMN IF NOT EXISTS entity_pos_tax_code_id uuid REFERENCES public.entity_pos_tax_code(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receipt_item_taxes_entity_pos_code
  ON public.receipt_item_taxes (entity_pos_tax_code_id);

COMMENT ON COLUMN public.receipt_item_taxes.entity_pos_tax_code_id IS
  'When line used public.entity_pos_tax_code for class/kinds resolution.';

-- ---------------------------------------------------------------------------
-- Learning events (tenant-scoped audit trail; catalog rows are global)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.entity_pos_tax_code_learning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  merchant_entity_id uuid NOT NULL,
  receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  country_code text NOT NULL,
  jurisdiction_region text NOT NULL DEFAULT '',
  pos_tax_code text NOT NULL,
  maps_to_tax_class_code text NOT NULL
    CHECK (maps_to_tax_class_code IN ('STANDARD_TAXABLE', 'EXEMPT', 'ZERO_RATED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_pos_tax_learn_lookup
  ON public.entity_pos_tax_code_learning_events (space_id, merchant_entity_id, country_code, jurisdiction_region, pos_tax_code, created_at);

COMMENT ON TABLE public.entity_pos_tax_code_learning_events IS
  'Per-space observations feeding promotion into global public.entity_pos_tax_code (SECURITY DEFINER RPC).';

CREATE OR REPLACE FUNCTION public.entity_pos_tax_code_learning_enforce_receipt_space()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.receipts r
    WHERE r.id = NEW.receipt_id AND r.space_id IS NOT DISTINCT FROM NEW.space_id
  ) THEN
    RAISE EXCEPTION 'entity_pos_tax_code_learning_events: receipt_id % does not belong to space_id %', NEW.receipt_id, NEW.space_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entity_pos_tax_learn_receipt_space ON public.entity_pos_tax_code_learning_events;
CREATE TRIGGER trg_entity_pos_tax_learn_receipt_space
  BEFORE INSERT OR UPDATE OF space_id, receipt_id ON public.entity_pos_tax_code_learning_events
  FOR EACH ROW
  EXECUTE FUNCTION public.entity_pos_tax_code_learning_enforce_receipt_space();

-- Drop legacy triggers if re-running migration dev loops
DROP TRIGGER IF EXISTS trg_entity_pos_tax_code_entity_space_match ON public.entity_pos_tax_code;
DROP TRIGGER IF EXISTS trg_entity_pos_tax_learn_entity_space_match ON public.entity_pos_tax_code_learning_events;

DROP FUNCTION IF EXISTS public.entity_pos_tax_code_enforce_entity_space_match();
DROP FUNCTION IF EXISTS public.entity_pos_tax_code_learning_enforce_entity_space_match();

-- ---------------------------------------------------------------------------
-- RLS: global catalog readable like crm; learning events per space
-- ---------------------------------------------------------------------------
ALTER TABLE public.entity_pos_tax_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_pos_tax_code_learning_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS entity_pos_tax_code_select ON public.entity_pos_tax_code;
CREATE POLICY entity_pos_tax_code_select ON public.entity_pos_tax_code
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS entity_pos_tax_code_insert ON public.entity_pos_tax_code;
DROP POLICY IF EXISTS entity_pos_tax_code_update ON public.entity_pos_tax_code;
DROP POLICY IF EXISTS entity_pos_tax_code_delete ON public.entity_pos_tax_code;

DROP POLICY IF EXISTS entity_pos_tax_code_learning_select ON public.entity_pos_tax_code_learning_events;
CREATE POLICY entity_pos_tax_code_learning_select ON public.entity_pos_tax_code_learning_events
  FOR SELECT TO authenticated
  USING (
    space_id IN (SELECT space_id FROM public.user_spaces WHERE user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- RPC: learn (per space) + promote into global entity_pos_tax_code
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_entity_pos_tax_learning_and_maybe_promote(
  p_space_id uuid,
  p_receipt_id uuid,
  p_merchant_entity_id uuid,
  p_country_code text,
  p_jurisdiction_region text,
  p_pos_tax_code text,
  p_maps_to_tax_class_code text,
  p_min_observations int DEFAULT 2
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_country text;
  v_region text;
  v_pos text;
  v_class text;
  win_class text;
  win_cnt bigint;
  qual_group_count int;
  existing_class text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF p_merchant_entity_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.user_id = v_uid AND us.space_id = p_space_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'space_denied');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.receipts r
    WHERE r.id = p_receipt_id AND r.space_id = p_space_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'receipt_denied');
  END IF;

  v_country := upper(btrim(coalesce(p_country_code, '')));
  v_region := upper(btrim(coalesce(p_jurisdiction_region, '')));
  v_pos := upper(btrim(coalesce(p_pos_tax_code, '')));
  v_class := upper(btrim(coalesce(p_maps_to_tax_class_code, '')));

  IF v_country = '' OR v_pos = '' OR v_class NOT IN ('STANDARD_TAXABLE', 'EXEMPT', 'ZERO_RATED') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;

  IF p_min_observations IS NULL OR p_min_observations < 2 THEN
    p_min_observations := 2;
  END IF;

  INSERT INTO public.entity_pos_tax_code_learning_events (
    space_id, merchant_entity_id, receipt_id, country_code, jurisdiction_region, pos_tax_code, maps_to_tax_class_code
  ) VALUES (
    p_space_id, p_merchant_entity_id, p_receipt_id, v_country, v_region, v_pos, v_class
  );

  SELECT r.maps_to_tax_class_code INTO existing_class
  FROM public.entity_pos_tax_code r
  WHERE r.merchant_entity_id = p_merchant_entity_id
    AND r.country_code = v_country
    AND coalesce(r.jurisdiction_region, '') = v_region
    AND upper(r.pos_tax_code) = v_pos
    AND (r.effective_to IS NULL OR r.effective_to >= current_date)
  ORDER BY r.priority ASC NULLS LAST, r.created_at DESC
  LIMIT 1;

  IF existing_class IS NOT NULL THEN
    IF upper(existing_class) = v_class THEN
      RETURN jsonb_build_object(
        'ok', true, 'recorded', true, 'promoted', false, 'reason', 'rule_already_exists'
      );
    END IF;
    RETURN jsonb_build_object(
      'ok', true, 'recorded', true, 'promoted', false, 'reason', 'existing_rule_differs'
    );
  END IF;

  SELECT COUNT(*)::int INTO qual_group_count
  FROM (
    SELECT maps_to_tax_class_code
    FROM public.entity_pos_tax_code_learning_events
    WHERE space_id = p_space_id
      AND merchant_entity_id = p_merchant_entity_id
      AND country_code = v_country
      AND coalesce(jurisdiction_region, '') = v_region
      AND upper(pos_tax_code) = v_pos
      AND created_at > now() - interval '180 days'
    GROUP BY maps_to_tax_class_code
    HAVING COUNT(*) >= p_min_observations
  ) q;

  IF qual_group_count IS NULL OR qual_group_count = 0 THEN
    RETURN jsonb_build_object(
      'ok', true, 'recorded', true, 'promoted', false, 'reason', 'insufficient_observations'
    );
  END IF;

  IF qual_group_count > 1 THEN
    RETURN jsonb_build_object(
      'ok', true, 'recorded', true, 'promoted', false, 'reason', 'conflicting_classes'
    );
  END IF;

  SELECT maps_to_tax_class_code, cnt INTO win_class, win_cnt
  FROM (
    SELECT maps_to_tax_class_code, COUNT(*) AS cnt
    FROM public.entity_pos_tax_code_learning_events
    WHERE space_id = p_space_id
      AND merchant_entity_id = p_merchant_entity_id
      AND country_code = v_country
      AND coalesce(jurisdiction_region, '') = v_region
      AND upper(pos_tax_code) = v_pos
      AND created_at > now() - interval '180 days'
    GROUP BY maps_to_tax_class_code
    HAVING COUNT(*) >= p_min_observations
  ) w;

  IF win_class IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'recorded', true, 'promoted', false, 'reason', 'insufficient_observations'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.entity_pos_tax_code r
    WHERE r.merchant_entity_id = p_merchant_entity_id
      AND r.country_code = v_country
      AND coalesce(r.jurisdiction_region, '') = v_region
      AND upper(r.pos_tax_code) = v_pos
      AND (r.effective_to IS NULL OR r.effective_to >= current_date)
  ) THEN
    RETURN jsonb_build_object(
      'ok', true, 'recorded', true, 'promoted', false, 'reason', 'rule_race_or_exists'
    );
  END IF;

  INSERT INTO public.entity_pos_tax_code (
    merchant_entity_id, country_code, jurisdiction_region, pos_tax_code, maps_to_tax_class_code,
    priority, effective_from, source, notes
  ) VALUES (
    p_merchant_entity_id, v_country, v_region, v_pos, win_class,
    150, CURRENT_DATE, 'learned',
    format('Auto-promoted: %s consistent observations in 180d.', win_cnt)
  );

  RETURN jsonb_build_object(
    'ok', true, 'recorded', true, 'promoted', true,
    'maps_to_tax_class_code', win_class, 'observation_count', win_cnt
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_entity_pos_tax_learning_and_maybe_promote FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_entity_pos_tax_learning_and_maybe_promote TO authenticated;

COMMENT ON FUNCTION public.record_entity_pos_tax_learning_and_maybe_promote IS
  'Record observations per space; promote to shared public.entity_pos_tax_code on merchant_entity_id + jurisdiction keys.';

DROP FUNCTION IF EXISTS public.record_pos_tax_learning_and_maybe_promote(uuid, uuid, text, text, text, text, text, int);

DROP FUNCTION IF EXISTS public.normalize_merchant_pattern_for_learning(text);

-- ---------------------------------------------------------------------------
-- Drop deprecated public tables
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.pos_tax_code_learning_events;
DROP TABLE IF EXISTS public.category_tax_class_map;
DROP TABLE IF EXISTS public.tax_rate_catalog;
