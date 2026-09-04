-- Firm engagement consumption: count only orders with public.projects (association success).
-- Create: block when v_used + v_pending_onboarding >= v_max.
-- Confirm (first project insert): block when v_used >= v_max.

BEGIN;

SET search_path = public, crm, firm;

CREATE OR REPLACE FUNCTION crm.assert_firm_can_create_engagement(p_firm_space_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, firm
AS $$
DECLARE
  v_ws timestamptz;
  v_we timestamptz;
  v_base int := 0;
  v_addon int := 0;
  v_legacy_addon int := 0;
  v_pack_addon int := 0;
  v_max int;
  v_used int;
  v_pending int;
  rsub RECORD;
BEGIN
  IF p_firm_space_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO rsub
  FROM crm._active_space_subscription_row(p_firm_space_id) x;

  IF rsub.order_id IS NULL THEN
    RAISE EXCEPTION 'ENGAGEMENT_NO_SUBSCRIPTION'
      USING ERRCODE = 'P0001',
            HINT = 'Add a firm subscription (annual or trial) in CRM / Subscription and billing.';
  END IF;

  v_ws := rsub.started_at;
  v_we := rsub.expires_at;
  v_base := COALESCE(rsub.engagement_included_per_year, 0);

  IF v_base IS NULL OR v_base < 0 THEN
    v_base := 0;
  END IF;

  SELECT COALESCE(
    COALESCE(
      CASE WHEN (so.metadata->>'engagement_credits_added') ~ '^[0-9]+$' THEN (so.metadata->>'engagement_credits_added')::int END,
      CASE WHEN (so.metadata->>'engagement_addon_slots') ~ '^[0-9]+$' THEN (so.metadata->>'engagement_addon_slots')::int END,
      0
    ),
    0
  )
  INTO v_legacy_addon
  FROM crm.space_orders so
  WHERE so.id = rsub.order_id;

  SELECT COALESCE(SUM(
    COALESCE(
      CASE WHEN (so.metadata->>'engagement_credits_added') ~ '^[0-9]+$' THEN (so.metadata->>'engagement_credits_added')::int END,
      CASE WHEN (so.metadata->>'engagement_addon_slots') ~ '^[0-9]+$' THEN (so.metadata->>'engagement_addon_slots')::int END,
      0
    )
  ), 0)
  INTO v_pack_addon
  FROM crm.space_orders so
  INNER JOIN crm.sku_edition se ON se.id = so.sku_id
  WHERE so.space_id = p_firm_space_id
    AND so.status = 'active'
    AND (so.expires_at IS NULL OR so.expires_at > now())
    AND COALESCE(se.data_limits->>'billing_kind', '') = 'engagement_credit_pack'
    AND so.started_at >= v_ws
    AND so.started_at < v_we;

  v_addon := COALESCE(v_legacy_addon, 0) + COALESCE(v_pack_addon, 0);
  v_max := v_base + COALESCE(v_addon, 0);

  -- Consumed = orders in window that already have a linked project (association succeeded).
  SELECT COUNT(*)::int INTO v_used
  FROM firm.orders o
  WHERE o.firm_space_id = p_firm_space_id
    AND o.created_at >= v_ws
    AND o.created_at < v_we
    AND o.status <> 'cancelled'
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.order_id = o.id);

  -- Draft engagements: onboarding without project yet (counts toward cap so users cannot hoard unlimited drafts).
  SELECT COUNT(*)::int INTO v_pending
  FROM firm.orders o
  WHERE o.firm_space_id = p_firm_space_id
    AND o.created_at >= v_ws
    AND o.created_at < v_we
    AND o.status = 'onboarding'
    AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.order_id = o.id);

  IF COALESCE(v_used, 0) + COALESCE(v_pending, 0) >= v_max THEN
    RAISE EXCEPTION 'ENGAGEMENT_CAPACITY_EXCEEDED'
      USING ERRCODE = 'P0001',
            HINT = 'Engagement capacity is full for this subscription period (linked projects + open drafts). Complete or cancel engagements, add packs in CRM, or wait for renewal.';
  END IF;
END;
$$;

COMMENT ON FUNCTION crm.assert_firm_can_create_engagement(uuid) IS
  'Before creating a new onboarding order: (linked projects in window) + (onboarding without project) < max.';

CREATE OR REPLACE FUNCTION crm.assert_firm_can_confirm_engagement(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, firm
AS $$
DECLARE
  v_firm uuid;
  v_ws timestamptz;
  v_we timestamptz;
  v_base int := 0;
  v_addon int := 0;
  v_legacy_addon int := 0;
  v_pack_addon int := 0;
  v_max int;
  v_used int;
  rsub RECORD;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  SELECT o.firm_space_id INTO v_firm
  FROM firm.orders o
  WHERE o.id = p_order_id;

  IF v_firm IS NULL THEN
    RETURN;
  END IF;

  -- No new consumption if project already exists (idempotent confirm).
  IF EXISTS (SELECT 1 FROM public.projects p WHERE p.order_id = p_order_id) THEN
    RETURN;
  END IF;

  SELECT * INTO rsub
  FROM crm._active_space_subscription_row(v_firm) x;

  IF rsub.order_id IS NULL THEN
    RAISE EXCEPTION 'ENGAGEMENT_NO_SUBSCRIPTION'
      USING ERRCODE = 'P0001',
            HINT = 'Add a firm subscription (annual or trial) in CRM / Subscription and billing.';
  END IF;

  v_ws := rsub.started_at;
  v_we := rsub.expires_at;
  v_base := COALESCE(rsub.engagement_included_per_year, 0);
  IF v_base IS NULL OR v_base < 0 THEN
    v_base := 0;
  END IF;

  SELECT COALESCE(
    COALESCE(
      CASE WHEN (so.metadata->>'engagement_credits_added') ~ '^[0-9]+$' THEN (so.metadata->>'engagement_credits_added')::int END,
      CASE WHEN (so.metadata->>'engagement_addon_slots') ~ '^[0-9]+$' THEN (so.metadata->>'engagement_addon_slots')::int END,
      0
    ),
    0
  )
  INTO v_legacy_addon
  FROM crm.space_orders so
  WHERE so.id = rsub.order_id;

  SELECT COALESCE(SUM(
    COALESCE(
      CASE WHEN (so.metadata->>'engagement_credits_added') ~ '^[0-9]+$' THEN (so.metadata->>'engagement_credits_added')::int END,
      CASE WHEN (so.metadata->>'engagement_addon_slots') ~ '^[0-9]+$' THEN (so.metadata->>'engagement_addon_slots')::int END,
      0
    )
  ), 0)
  INTO v_pack_addon
  FROM crm.space_orders so
  INNER JOIN crm.sku_edition se ON se.id = so.sku_id
  WHERE so.space_id = v_firm
    AND so.status = 'active'
    AND (so.expires_at IS NULL OR so.expires_at > now())
    AND COALESCE(se.data_limits->>'billing_kind', '') = 'engagement_credit_pack'
    AND so.started_at >= v_ws
    AND so.started_at < v_we;

  v_addon := COALESCE(v_legacy_addon, 0) + COALESCE(v_pack_addon, 0);
  v_max := v_base + COALESCE(v_addon, 0);

  SELECT COUNT(*)::int INTO v_used
  FROM firm.orders o
  WHERE o.firm_space_id = v_firm
    AND o.created_at >= v_ws
    AND o.created_at < v_we
    AND o.status <> 'cancelled'
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.order_id = o.id);

  IF COALESCE(v_used, 0) >= v_max THEN
    RAISE EXCEPTION 'ENGAGEMENT_CAPACITY_EXCEEDED'
      USING ERRCODE = 'P0001',
            HINT = 'This subscription period''s engagement allowance is full. Add engagement credit packs in CRM or wait for renewal.';
  END IF;
END;
$$;

COMMENT ON FUNCTION crm.assert_firm_can_confirm_engagement(uuid) IS
  'Before first public.projects row for an order: linked-project count in subscription window must be < max.';

GRANT EXECUTE ON FUNCTION crm.assert_firm_can_confirm_engagement(uuid) TO authenticated;

-- Refresh get_space_entitlements: firm used = linked projects only; pending_onboarding; client included_remaining
CREATE OR REPLACE FUNCTION crm.get_space_entitlements(p_space_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, crm, firm
AS $$
DECLARE
  v_kind text;
  rsub RECORD;
  v_ws timestamptz;
  v_we timestamptz;
  v_base int;
  v_addon int;
  v_legacy_addon int := 0;
  v_pack_addon int := 0;
  v_used int;
  v_pending int;
  v_max int;
  v_included int;
  v_cap int;
  v_used_m int;
  v_credits int;
  v_processing boolean;
  v_included_remaining int;
  ym text;
  v_warnings jsonb := '[]'::jsonb;
  v_blocks jsonb := '[]'::jsonb;
  v_days_left int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.user_id = auth.uid() AND us.space_id = p_space_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  SELECT s.kind INTO v_kind FROM public.spaces s WHERE s.id = p_space_id;
  IF v_kind IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  SELECT * INTO rsub FROM crm._active_space_subscription_row(p_space_id) x;

  IF rsub.order_id IS NOT NULL THEN
    v_days_left := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (rsub.expires_at - now())) / 86400)::int);
    IF v_days_left <= 7 AND COALESCE(rsub.is_trial, false) THEN
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'TRIAL_ENDING', 'days_left', v_days_left));
    END IF;
  ELSE
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('code', 'NO_SUBSCRIPTION'));
  END IF;

  IF v_kind = 'provider' THEN
    IF rsub.order_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'space_kind', v_kind,
        'active_subscription', NULL,
        'firm_engagement', jsonb_build_object(
          'has_subscription', false,
          'window_start', NULL,
          'window_end', NULL,
          'included_per_period', 0,
          'addon_in_period', 0,
          'max_creates', 0,
          'used_in_period', 0,
          'pending_onboarding', 0
        ),
        'warnings', v_warnings,
        'block_codes', v_blocks
      );
    END IF;

    v_ws := rsub.started_at;
    v_we := rsub.expires_at;
    v_base := COALESCE(rsub.engagement_included_per_year, 0);

    SELECT COALESCE(
      COALESCE(
        CASE WHEN (so.metadata->>'engagement_credits_added') ~ '^[0-9]+$' THEN (so.metadata->>'engagement_credits_added')::int END,
        CASE WHEN (so.metadata->>'engagement_addon_slots') ~ '^[0-9]+$' THEN (so.metadata->>'engagement_addon_slots')::int END,
        0
      ),
      0
    )
    INTO v_legacy_addon
    FROM crm.space_orders so
    WHERE so.id = rsub.order_id;

    SELECT COALESCE(SUM(
      COALESCE(
        CASE WHEN (so.metadata->>'engagement_credits_added') ~ '^[0-9]+$' THEN (so.metadata->>'engagement_credits_added')::int END,
        CASE WHEN (so.metadata->>'engagement_addon_slots') ~ '^[0-9]+$' THEN (so.metadata->>'engagement_addon_slots')::int END,
        0
      )
    ), 0)
    INTO v_pack_addon
    FROM crm.space_orders so
    INNER JOIN crm.sku_edition se ON se.id = so.sku_id
    WHERE so.space_id = p_space_id
      AND so.status = 'active'
      AND (so.expires_at IS NULL OR so.expires_at > now())
      AND COALESCE(se.data_limits->>'billing_kind', '') = 'engagement_credit_pack'
      AND so.started_at >= v_ws
      AND so.started_at < v_we;

    v_addon := COALESCE(v_legacy_addon, 0) + COALESCE(v_pack_addon, 0);
    v_max := v_base + COALESCE(v_addon, 0);

    SELECT COUNT(*)::int INTO v_used
    FROM firm.orders o
    WHERE o.firm_space_id = p_space_id
      AND o.created_at >= v_ws
      AND o.created_at < v_we
      AND o.status <> 'cancelled'
      AND EXISTS (SELECT 1 FROM public.projects p WHERE p.order_id = o.id);

    SELECT COUNT(*)::int INTO v_pending
    FROM firm.orders o
    WHERE o.firm_space_id = p_space_id
      AND o.created_at >= v_ws
      AND o.created_at < v_we
      AND o.status = 'onboarding'
      AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.order_id = o.id);

    RETURN jsonb_build_object(
      'ok', true,
      'space_kind', v_kind,
      'active_subscription', jsonb_build_object(
        'order_id', rsub.order_id,
        'sku_code', rsub.sku_code,
        'started_at', rsub.started_at,
        'expires_at', rsub.expires_at,
        'is_trial', rsub.is_trial
      ),
      'firm_engagement', jsonb_build_object(
        'has_subscription', true,
        'window_start', v_ws,
        'window_end', v_we,
        'included_per_period', v_base,
        'addon_in_period', COALESCE(v_addon, 0),
        'max_creates', v_max,
        'used_in_period', COALESCE(v_used, 0),
        'pending_onboarding', COALESCE(v_pending, 0)
      ),
      'warnings', v_warnings,
      'block_codes', v_blocks
    );
  END IF;

  -- client
  v_included := 0;
  IF rsub.order_id IS NOT NULL THEN
    v_included := COALESCE(
      rsub.recognition_included_per_month,
      (SELECT COALESCE((se2.data_limits->>'recognition_included_per_month')::int, 10)
       FROM crm.sku_edition se2 WHERE se2.code = 'CLIENT_RECOGNITION_BASE' LIMIT 1),
      10
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM firm.orders o
    WHERE o.client_space_id = p_space_id AND o.status = 'processing'
  ) INTO v_processing;

  v_cap := CASE WHEN v_processing THEN 100 ELSE NULL END;
  ym := to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM');

  SELECT COALESCE((
    SELECT u.success_count FROM crm.client_recognition_monthly_usage u
    WHERE u.space_id = p_space_id AND u.year_month = ym
  ), 0) INTO v_used_m;

  SELECT COALESCE((
    SELECT b.recognition_credits_balance FROM crm.space_billing_state b WHERE b.space_id = p_space_id
  ), 0) INTO v_credits;

  v_included_remaining := GREATEST(0, COALESCE(v_included, 0) - COALESCE(v_used_m, 0));
  IF v_cap IS NOT NULL THEN
    v_included_remaining := LEAST(v_included_remaining, GREATEST(0, v_cap - COALESCE(v_used_m, 0)));
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'space_kind', v_kind,
    'active_subscription', CASE WHEN rsub.order_id IS NULL THEN NULL ELSE jsonb_build_object(
      'order_id', rsub.order_id,
      'sku_code', rsub.sku_code,
      'started_at', rsub.started_at,
      'expires_at', rsub.expires_at,
      'is_trial', rsub.is_trial
    ) END,
    'client_recognition', jsonb_build_object(
      'enforce', true,
      'included_per_month', v_included,
      'included_remaining', v_included_remaining,
      'monthly_cap', v_cap,
      'used_this_month', v_used_m,
      'credits_balance', v_credits,
      'processing_linked', v_processing
    ),
    'warnings', v_warnings,
    'block_codes', v_blocks
  );
END;
$$;

COMMENT ON FUNCTION crm.get_space_entitlements(uuid) IS 'Member-readable entitlements; firm used_in_period = orders with public.projects; client included_remaining = subscription included left before credits.';

COMMIT;
