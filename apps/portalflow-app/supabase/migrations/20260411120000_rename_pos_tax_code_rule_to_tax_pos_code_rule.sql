-- Legacy DBs applied 20260409100000 when the table was crm.pos_tax_code_rule.
-- Fresh installs use crm.tax_pos_code_rule from the updated baseline migration.
-- RPC body still referenced the old name until refreshed — replace here for safety.

DO $$
BEGIN
  IF to_regclass('crm.pos_tax_code_rule') IS NOT NULL
     AND to_regclass('crm.tax_pos_code_rule') IS NULL THEN
    ALTER TABLE crm.pos_tax_code_rule RENAME TO tax_pos_code_rule;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_pos_tax_learning_and_maybe_promote(
  p_space_id uuid,
  p_receipt_id uuid,
  p_country_code text,
  p_region_code text,
  p_merchant_display_name text,
  p_pos_tax_code text,
  p_maps_to_tax_class_code text,
  p_min_observations int DEFAULT 2
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $$
DECLARE
  v_uid uuid;
  v_pattern text;
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
  v_region := upper(btrim(coalesce(p_region_code, '')));
  v_pos := upper(btrim(coalesce(p_pos_tax_code, '')));
  v_class := upper(btrim(coalesce(p_maps_to_tax_class_code, '')));

  IF v_country = '' OR v_pos = '' OR v_class NOT IN ('STANDARD_TAXABLE', 'EXEMPT', 'ZERO_RATED') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;

  IF p_min_observations IS NULL OR p_min_observations < 2 THEN
    p_min_observations := 2;
  END IF;

  v_pattern := public.normalize_merchant_pattern_for_learning(p_merchant_display_name);

  INSERT INTO public.pos_tax_code_learning_events (
    space_id, receipt_id, country_code, region_code, merchant_pattern, merchant_display_name,
    pos_tax_code, maps_to_tax_class_code
  ) VALUES (
    p_space_id, p_receipt_id, v_country, v_region, v_pattern, left(p_merchant_display_name, 200),
    v_pos, v_class
  );

  SELECT r.maps_to_tax_class_code INTO existing_class
  FROM crm.tax_pos_code_rule r
  WHERE r.country_code = v_country
    AND coalesce(r.region_code, '') = v_region
    AND r.merchant_pattern = v_pattern
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
    FROM public.pos_tax_code_learning_events
    WHERE country_code = v_country
      AND coalesce(region_code, '') = v_region
      AND merchant_pattern = v_pattern
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
    FROM public.pos_tax_code_learning_events
    WHERE country_code = v_country
      AND coalesce(region_code, '') = v_region
      AND merchant_pattern = v_pattern
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
    SELECT 1 FROM crm.tax_pos_code_rule r
    WHERE r.country_code = v_country
      AND coalesce(r.region_code, '') = v_region
      AND r.merchant_pattern = v_pattern
      AND upper(r.pos_tax_code) = v_pos
      AND (r.effective_to IS NULL OR r.effective_to >= current_date)
  ) THEN
    RETURN jsonb_build_object(
      'ok', true, 'recorded', true, 'promoted', false, 'reason', 'rule_race_or_exists'
    );
  END IF;

  INSERT INTO crm.tax_pos_code_rule (
    country_code, region_code, merchant_pattern, pos_tax_code, maps_to_tax_class_code,
    priority, effective_from, source, notes
  ) VALUES (
    v_country, v_region, v_pattern, v_pos, win_class,
    150, CURRENT_DATE, 'learned',
    format('Auto-promoted: %s consistent observations in 180d (learning pipeline).', win_cnt)
  );

  RETURN jsonb_build_object(
    'ok', true, 'recorded', true, 'promoted', true,
    'maps_to_tax_class_code', win_class, 'observation_count', win_cnt
  );
END;
$$;

COMMENT ON TABLE crm.tax_pos_code_rule IS
  'Maps retailer POS line codes to tax_class_code. source=learned rows are auto-inserted by public.record_pos_tax_learning_and_maybe_promote; seed rows are platform examples.';
