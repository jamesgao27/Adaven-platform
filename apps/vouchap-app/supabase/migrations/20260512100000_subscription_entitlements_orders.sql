-- Subscription & entitlements: orders as source of truth, 30-day trial on space create,
-- client recognition from active subscription SKU, firm engagement = annual consumption window,
-- backfill trial from 2026-05-01, get_space_entitlements RPC.

BEGIN;

SET search_path = public, crm, firm;

-- ---------------------------------------------------------------------------
-- 0) Catalog: billing_kind, space_target; trial SKUs; credit-pack SKUs; FIRM_ANNUAL / CLIENT_RECOGNITION_BASE
-- ---------------------------------------------------------------------------

UPDATE crm.sku_edition se
SET data_limits = COALESCE(se.data_limits, '{}'::jsonb)
  || jsonb_build_object(
    'billing_kind', 'space_subscription',
    'space_target', 'firm',
    'consumption_model', 'engagement_per_subscription_year',
    'engagement_included_per_subscription_year',
      COALESCE(
        NULLIF((se.data_limits->>'engagement_included_per_subscription_year')::text, '')::int,
        NULLIF((se.data_limits->>'engagement_credits_included')::text, '')::int,
        NULLIF((se.data_limits->>'engagements_included')::text, '')::int,
        50
      )
  ),
  updated_at = now()
WHERE se.code = 'FIRM_ANNUAL';

UPDATE crm.sku_edition se
SET data_limits = COALESCE(se.data_limits, '{}'::jsonb)
  || jsonb_build_object(
    'billing_kind', 'catalog_policy',
    'space_target', 'client'
  ),
  updated_at = now()
WHERE se.code = 'CLIENT_RECOGNITION_BASE';

INSERT INTO crm.sku_edition (
  code, name, description, feature_modules, data_limits, period_type, quota_period,
  price_monthly, price_yearly, currency, is_trial, sort_order
)
VALUES
  (
    'CLIENT_TRIAL_30',
    'Client trial (30 days)',
    'Auto-created on space registration. Included AI recognitions per month from data_limits.',
    '{"expenses": true, "income": true, "inbound": true, "outbound": true}'::jsonb,
    jsonb_build_object(
      'billing_kind', 'space_subscription',
      'space_target', 'client',
      'recognition_included_per_month', 10,
      'members', 999999
    ),
    'month',
    'month',
    NULL,
    NULL,
    'USD',
    true,
    5
  ),
  (
    'FIRM_TRIAL_30',
    'Firm trial (30 days)',
    'Auto-created on firm space registration. Engagement creations per subscription window.',
    '{"expenses": true, "income": true, "inbound": true, "outbound": true}'::jsonb,
    jsonb_build_object(
      'billing_kind', 'space_subscription',
      'space_target', 'firm',
      'consumption_model', 'engagement_per_subscription_year',
      'engagement_included_per_subscription_year', 10,
      'members', 999999
    ),
    'month',
    'month',
    NULL,
    NULL,
    'USD',
    true,
    6
  ),
  (
    'CLIENT_PAID_MONTHLY',
    'Client subscription (monthly)',
    'Paid client space subscription; configure recognition_included_per_month on SKU.',
    '{"expenses": true, "income": true, "inbound": true, "outbound": true}'::jsonb,
    jsonb_build_object(
      'billing_kind', 'space_subscription',
      'space_target', 'client',
      'recognition_included_per_month', 10,
      'members', 999999
    ),
    'month',
    'month',
    NULL,
    NULL,
    'USD',
    false,
    44
  ),
  (
    'RECOGNITION_CREDIT_PACK',
    'Recognition credits (pack)',
    'Permanent credit order: set metadata.recognition_credits_added. expires_at NULL.',
    '{}'::jsonb,
    jsonb_build_object('billing_kind', 'recognition_credit_pack', 'space_target', 'client'),
    'forever',
    'month',
    NULL,
    NULL,
    'USD',
    false,
    70
  ),
  (
    'ENGAGEMENT_CREDIT_PACK',
    'Engagement credits (pack)',
    'Permanent pack: metadata.engagement_credits_added counts toward current subscription year window.',
    '{}'::jsonb,
    jsonb_build_object('billing_kind', 'engagement_credit_pack', 'space_target', 'firm'),
    'forever',
    'year',
    NULL,
    NULL,
    'USD',
    false,
    71
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  feature_modules = EXCLUDED.feature_modules,
  data_limits = COALESCE(crm.sku_edition.data_limits, '{}'::jsonb) || COALESCE(EXCLUDED.data_limits, '{}'::jsonb),
  period_type = EXCLUDED.period_type,
  quota_period = EXCLUDED.quota_period,
  is_trial = EXCLUDED.is_trial,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- Fix DO UPDATE: merge data_limits properly for conflict
UPDATE crm.sku_edition se
SET data_limits = COALESCE(se.data_limits, '{}'::jsonb) || v.merge
FROM (VALUES
  ('CLIENT_TRIAL_30', '{"billing_kind":"space_subscription","space_target":"client","recognition_included_per_month":10,"members":999999}'::jsonb),
  ('FIRM_TRIAL_30', '{"billing_kind":"space_subscription","space_target":"firm","consumption_model":"engagement_per_subscription_year","engagement_included_per_subscription_year":10,"members":999999}'::jsonb),
  ('CLIENT_PAID_MONTHLY', '{"billing_kind":"space_subscription","space_target":"client","recognition_included_per_month":10,"members":999999}'::jsonb),
  ('RECOGNITION_CREDIT_PACK', '{"billing_kind":"recognition_credit_pack","space_target":"client"}'::jsonb),
  ('ENGAGEMENT_CREDIT_PACK', '{"billing_kind":"engagement_credit_pack","space_target":"firm"}'::jsonb)
) AS v(code, merge)
WHERE se.code = v.code;

-- ---------------------------------------------------------------------------
-- 1) Recognition credits trigger: only recognition_credit_pack (or missing billing_kind legacy)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.apply_space_order_metadata_entitlements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $$
DECLARE
  v_delta int;
  v_bk text;
BEGIN
  IF NEW.metadata IS NULL OR NOT (NEW.metadata ? 'recognition_credits_added') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(se.data_limits->>'billing_kind', '') INTO v_bk
  FROM crm.sku_edition se
  WHERE se.id = NEW.sku_id;

  v_delta := COALESCE((NEW.metadata->>'recognition_credits_added')::int, 0);
  IF v_delta > 0 AND (v_bk = 'recognition_credit_pack' OR v_bk = '') THEN
    INSERT INTO crm.space_billing_state (space_id, recognition_credits_balance, updated_at)
    VALUES (NEW.space_id, v_delta, now())
    ON CONFLICT (space_id) DO UPDATE SET
      recognition_credits_balance = crm.space_billing_state.recognition_credits_balance + EXCLUDED.recognition_credits_balance,
      updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Active subscription picker (paid before trial; latest created)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm._active_space_subscription_row(p_space_id uuid)
RETURNS TABLE(
  order_id uuid,
  sku_code text,
  started_at timestamptz,
  expires_at timestamptz,
  is_trial boolean,
  recognition_included_per_month int,
  engagement_included_per_year int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $$
  SELECT
    so.id,
    se.code,
    so.started_at,
    so.expires_at,
    COALESCE(se.is_trial, false),
    (se.data_limits->>'recognition_included_per_month')::int,
    COALESCE(
      NULLIF((se.data_limits->>'engagement_included_per_subscription_year')::text, '')::int,
      NULLIF((se.data_limits->>'engagements_included')::text, '')::int,
      NULLIF((se.data_limits->>'engagement_credits_included')::text, '')::int
    )
  FROM crm.space_orders so
  INNER JOIN crm.sku_edition se ON se.id = so.sku_id
  INNER JOIN public.spaces sp ON sp.id = so.space_id
  WHERE so.space_id = p_space_id
    AND so.status = 'active'
    AND so.expires_at IS NOT NULL
    AND so.expires_at > now()
    AND COALESCE(se.data_limits->>'billing_kind', '') = 'space_subscription'
    AND (
      COALESCE(se.data_limits->>'space_target', 'any') IN ('any', sp.kind::text)
    )
  ORDER BY (NOT COALESCE(se.is_trial, false)) DESC, so.created_at DESC
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 3) Client recognition quota + record (included from subscription row; 0 if none)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.get_client_recognition_quota(p_space_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, crm, firm
AS $$
DECLARE
  v_kind text;
  v_included int := 0;
  v_cap int;
  v_used int := 0;
  v_credits int := 0;
  v_processing boolean := false;
  v_sub_code text;
  v_sub_exp timestamptz;
  ym text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  END IF;

  IF NOT crm.user_may_act_for_client_space(auth.uid(), p_space_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  SELECT s.kind INTO v_kind FROM public.spaces s WHERE s.id = p_space_id;
  IF v_kind IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  IF v_kind <> 'client' THEN
    RETURN jsonb_build_object('ok', true, 'enforce', false, 'space_kind', v_kind);
  END IF;

  SELECT r.sku_code, r.expires_at, r.recognition_included_per_month
  INTO v_sub_code, v_sub_exp, v_included
  FROM crm._active_space_subscription_row(p_space_id) r;

  IF v_sub_code IS NULL THEN
    v_included := 0;
  ELSE
    v_included := COALESCE(
      v_included,
      (SELECT COALESCE((se2.data_limits->>'recognition_included_per_month')::int, 10)
       FROM crm.sku_edition se2 WHERE se2.code = 'CLIENT_RECOGNITION_BASE' LIMIT 1),
      10
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM firm.orders o
    WHERE o.client_space_id = p_space_id
      AND o.status = 'processing'
  ) INTO v_processing;

  v_cap := CASE WHEN v_processing THEN 100 ELSE NULL END;

  ym := to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM');

  SELECT COALESCE((
    SELECT u.success_count
    FROM crm.client_recognition_monthly_usage u
    WHERE u.space_id = p_space_id AND u.year_month = ym
  ), 0)
  INTO v_used;

  SELECT COALESCE((
    SELECT b.recognition_credits_balance
    FROM crm.space_billing_state b
    WHERE b.space_id = p_space_id
  ), 0)
  INTO v_credits;

  RETURN jsonb_build_object(
    'ok', true,
    'enforce', true,
    'space_kind', 'client',
    'included_per_month', v_included,
    'monthly_cap', v_cap,
    'used_this_month', v_used,
    'credits_balance', v_credits,
    'processing_linked', v_processing,
    'active_subscription_sku', v_sub_code,
    'subscription_expires_at', v_sub_exp
  );
END;
$$;

CREATE OR REPLACE FUNCTION crm.record_client_recognition_success(p_space_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, firm
AS $$
DECLARE
  v_kind text;
  v_included int := 0;
  v_cap int;
  v_used int;
  v_credits int;
  v_processing boolean := false;
  v_sub_code text;
  ym text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  END IF;

  IF NOT crm.user_may_act_for_client_space(auth.uid(), p_space_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  SELECT s.kind INTO v_kind FROM public.spaces s WHERE s.id = p_space_id;
  IF v_kind IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  IF v_kind <> 'client' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_client_space');
  END IF;

  SELECT r.sku_code, r.recognition_included_per_month
  INTO v_sub_code, v_included
  FROM crm._active_space_subscription_row(p_space_id) r;

  IF v_sub_code IS NULL THEN
    v_included := 0;
  ELSE
    v_included := COALESCE(
      v_included,
      (SELECT COALESCE((se2.data_limits->>'recognition_included_per_month')::int, 10)
       FROM crm.sku_edition se2 WHERE se2.code = 'CLIENT_RECOGNITION_BASE' LIMIT 1),
      10
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM firm.orders o
    WHERE o.client_space_id = p_space_id
      AND o.status = 'processing'
  ) INTO v_processing;

  v_cap := CASE WHEN v_processing THEN 100 ELSE NULL END;
  ym := to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM');

  PERFORM pg_advisory_xact_lock(hashtext('crm:recog:' || p_space_id::text));

  INSERT INTO crm.client_recognition_monthly_usage (space_id, year_month, success_count, updated_at)
  VALUES (p_space_id, ym, 0, now())
  ON CONFLICT (space_id, year_month) DO NOTHING;

  SELECT u.success_count INTO v_used
  FROM crm.client_recognition_monthly_usage u
  WHERE u.space_id = p_space_id AND u.year_month = ym
  FOR UPDATE;

  IF v_used IS NULL THEN
    v_used := 0;
  END IF;

  INSERT INTO crm.space_billing_state (space_id, recognition_credits_balance, updated_at)
  VALUES (p_space_id, 0, now())
  ON CONFLICT (space_id) DO NOTHING;

  SELECT b.recognition_credits_balance INTO v_credits
  FROM crm.space_billing_state b
  WHERE b.space_id = p_space_id
  FOR UPDATE;

  IF v_credits IS NULL THEN
    v_credits := 0;
  END IF;

  IF v_cap IS NOT NULL AND v_used >= v_cap THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'MONTHLY_CAP',
      'message', 'You have reached this month''s document recognition limit.'
    );
  END IF;

  IF v_used >= v_included AND v_credits < 1 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', CASE WHEN v_included = 0 AND v_sub_code IS NULL THEN 'NO_SUBSCRIPTION' ELSE 'NEED_CREDIT' END,
      'message',
        CASE
          WHEN v_included = 0 AND v_sub_code IS NULL THEN
            'No active subscription for this workspace. Add a subscription or recognition credits in Subscription and billing, or ask your administrator.'
          ELSE
            'Your included recognitions for this month are used up. Add credits to continue, or wait until next month.'
        END
    );
  END IF;

  UPDATE crm.client_recognition_monthly_usage u
  SET success_count = u.success_count + 1,
      updated_at = now()
  WHERE u.space_id = p_space_id AND u.year_month = ym;

  IF v_used >= v_included THEN
    UPDATE crm.space_billing_state b
    SET recognition_credits_balance = b.recognition_credits_balance - 1,
        updated_at = now()
    WHERE b.space_id = p_space_id;
    v_credits := v_credits - 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'used_this_month', v_used + 1,
    'credits_balance', v_credits,
    'included_per_month', v_included,
    'monthly_cap', v_cap
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Firm engagement: subscription window [started_at, expires_at) + annual consumption
-- ---------------------------------------------------------------------------

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

  SELECT COUNT(*)::int INTO v_used
  FROM firm.orders o
  WHERE o.firm_space_id = p_firm_space_id
    AND o.created_at >= v_ws
    AND o.created_at < v_we
    AND o.status <> 'cancelled';

  IF v_used >= v_max THEN
    RAISE EXCEPTION 'ENGAGEMENT_CAPACITY_EXCEEDED'
      USING ERRCODE = 'P0001',
            HINT = 'This subscription year''s engagement allowance is used up. Add engagement credit packs in CRM or wait for renewal.';
  END IF;
END;
$$;

COMMENT ON FUNCTION crm.assert_firm_can_create_engagement(uuid) IS
  'Firm must have an active space_subscription order. Counts firm.orders created in [started_at, expires_at) excluding cancelled vs base + engagement_credit_pack purchases in same window.';

-- ---------------------------------------------------------------------------
-- 5) Space insert: ops + 30-day trial order
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.on_space_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = crm, public
AS $$
DECLARE
  v_ops_id uuid;
  v_sku_id uuid;
  v_sku_code text;
BEGIN
  SELECT id INTO v_ops_id FROM crm.ops_users ORDER BY created_at ASC LIMIT 1;
  IF v_ops_id IS NOT NULL THEN
    INSERT INTO crm.ops_assignments (ops_user_id, space_id, role)
    VALUES (v_ops_id, NEW.id, 'primary')
    ON CONFLICT (space_id) DO UPDATE SET
      ops_user_id = EXCLUDED.ops_user_id,
      role = EXCLUDED.role;
  END IF;

  v_sku_code := CASE WHEN NEW.kind = 'firm' THEN 'FIRM_TRIAL_30' ELSE 'CLIENT_TRIAL_30' END;
  SELECT se.id INTO v_sku_id FROM crm.sku_edition se WHERE se.code = v_sku_code LIMIT 1;

  IF v_sku_id IS NOT NULL THEN
    INSERT INTO crm.space_orders (space_id, sku_id, status, started_at, expires_at, source, metadata)
    VALUES (NEW.id, v_sku_id, 'active', now(), now() + interval '30 days', 'registration', '{}'::jsonb);
  ELSE
    RAISE WARNING 'crm.on_space_created: missing SKU % for space %', v_sku_code, NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION crm.on_space_created() IS 'public.spaces AFTER INSERT: ops_assignments + 30-day CLIENT_TRIAL_30 or FIRM_TRIAL_30 space_order.';

DROP TRIGGER IF EXISTS trg_spaces_crm_on_created ON public.spaces;
CREATE TRIGGER trg_spaces_crm_on_created
  AFTER INSERT ON public.spaces
  FOR EACH ROW
  EXECUTE FUNCTION crm.on_space_created();

-- ---------------------------------------------------------------------------
-- 6) Backfill: 30-day trial from 2026-05-01 UTC for spaces without active subscription order
-- ---------------------------------------------------------------------------

INSERT INTO crm.space_orders (space_id, sku_id, status, started_at, expires_at, source, metadata)
SELECT
  s.id,
  se.id,
  'active',
  timestamptz '2026-05-01 00:00:00+00',
  timestamptz '2026-05-01 00:00:00+00' + interval '30 days',
  'ops_grant',
  jsonb_build_object('backfill', '2026-05-01-trial-30d')
FROM public.spaces s
INNER JOIN crm.sku_edition se ON se.code = CASE WHEN s.kind = 'firm' THEN 'FIRM_TRIAL_30' ELSE 'CLIENT_TRIAL_30' END
WHERE NOT EXISTS (
  SELECT 1
  FROM crm.space_orders so
  INNER JOIN crm.sku_edition se2 ON se2.id = so.sku_id
  WHERE so.space_id = s.id
    AND so.status = 'active'
    AND so.expires_at IS NOT NULL
    AND so.expires_at > now()
    AND COALESCE(se2.data_limits->>'billing_kind', '') = 'space_subscription'
)
AND NOT EXISTS (
  SELECT 1 FROM crm.space_orders so3
  WHERE so3.space_id = s.id
    AND so3.source = 'ops_grant'
    AND so3.started_at = timestamptz '2026-05-01 00:00:00+00'
);

-- ---------------------------------------------------------------------------
-- 7) get_space_entitlements
-- ---------------------------------------------------------------------------

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
  v_max int;
  v_included int;
  v_cap int;
  v_used_m int;
  v_credits int;
  v_processing boolean;
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

  IF v_kind = 'firm' THEN
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
          'used_in_period', 0
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

    SELECT COUNT(*)::int INTO v_used
    FROM firm.orders o
    WHERE o.firm_space_id = p_space_id
      AND o.created_at >= v_ws
      AND o.created_at < v_we
      AND o.status <> 'cancelled';

    v_max := v_base + COALESCE(v_addon, 0);

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
        'used_in_period', v_used
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

COMMENT ON FUNCTION crm.get_space_entitlements(uuid) IS 'Member-readable entitlements: active subscription, client recognition snapshot, firm engagement window usage.';

GRANT EXECUTE ON FUNCTION crm.get_space_entitlements(uuid) TO authenticated;

COMMIT;
