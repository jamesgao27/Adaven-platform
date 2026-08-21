-- Billing model: (1) Firm annual + engagement credits, (2) Client free monthly included + purchased credits,
-- (3) One-time recognition credit bonus when firm creates first firm.orders row for a client space.
-- Removes legacy VCH_* / CLIENT_SUB dependency for client recognition enforcement.

BEGIN;

SET search_path = public, crm, firm;

COMMENT ON COLUMN crm.space_orders.metadata IS
  'Firm: engagement_credits_added (int, extra concurrent engagement capacity vs FIRM_ANNUAL base). Client: recognition_credits_added (int, prepaid recognition credits). Legacy key engagement_addon_slots still summed for firm cap if present.';

-- ---------------------------------------------------------------------------
-- 1) Firm engagement cap (FIRM_ANNUAL + sum(metadata engagement credits))
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm.assert_firm_can_create_engagement(p_firm_space_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, firm
AS $$
DECLARE
  v_base int;
  v_addon int;
  v_max int;
  v_current int;
BEGIN
  IF p_firm_space_id IS NULL THEN
    RETURN;
  END IF;

  v_base := (
    SELECT COALESCE(
      (se.data_limits->>'engagement_credits_included')::int,
      (se.data_limits->>'engagements_included')::int
    )
    FROM crm.space_orders so
    JOIN crm.sku_edition se ON se.id = so.sku_id
    WHERE so.space_id = p_firm_space_id
      AND so.status = 'active'
      AND (so.expires_at IS NULL OR so.expires_at > now())
      AND se.code = 'FIRM_ANNUAL'
    ORDER BY so.created_at DESC
    LIMIT 1
  );

  IF v_base IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(
    COALESCE(
      CASE WHEN (so.metadata->>'engagement_credits_added') ~ '^[0-9]+$' THEN (so.metadata->>'engagement_credits_added')::int END,
      CASE WHEN (so.metadata->>'engagement_addon_slots') ~ '^[0-9]+$' THEN (so.metadata->>'engagement_addon_slots')::int END,
      0
    )
  ), 0)
  INTO v_addon
  FROM crm.space_orders so
  WHERE so.space_id = p_firm_space_id
    AND so.status = 'active'
    AND (so.expires_at IS NULL OR so.expires_at > now());

  v_max := v_base + v_addon;

  SELECT COUNT(*)::int INTO v_current
  FROM firm.orders o
  WHERE o.firm_space_id = p_firm_space_id
    AND o.status NOT IN ('cancelled', 'completed');

  IF v_current >= v_max THEN
    RAISE EXCEPTION 'ENGAGEMENT_CAPACITY_EXCEEDED'
      USING ERRCODE = 'P0001',
            HINT = 'Raise firm engagement capacity via CRM (FIRM_ANNUAL + space_orders.metadata.engagement_credits_added) or complete/cancel engagements.';
  END IF;
END;
$$;

COMMENT ON FUNCTION crm.assert_firm_can_create_engagement(uuid) IS
  'Raises if firm has FIRM_ANNUAL and active firm.orders count >= engagement_credits_included + sum(metadata engagement credits).';

-- ---------------------------------------------------------------------------
-- 2) Client recognition: always enforced for client spaces; included tier from catalog CLIENT_RECOGNITION_BASE
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
  v_included int := 10;
  v_cap int;
  v_used int := 0;
  v_credits int := 0;
  v_processing boolean := false;
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

  SELECT COALESCE((se.data_limits->>'recognition_included_per_month')::int, 10)
  INTO v_included
  FROM crm.sku_edition se
  WHERE se.code = 'CLIENT_RECOGNITION_BASE'
  LIMIT 1;

  IF v_included IS NULL THEN
    v_included := 10;
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
    'processing_linked', v_processing
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
  v_included int := 10;
  v_cap int;
  v_used int;
  v_credits int;
  v_processing boolean := false;
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

  SELECT COALESCE((se.data_limits->>'recognition_included_per_month')::int, 10)
  INTO v_included
  FROM crm.sku_edition se
  WHERE se.code = 'CLIENT_RECOGNITION_BASE'
  LIMIT 1;

  IF v_included IS NULL THEN
    v_included := 10;
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
      'code', 'NEED_CREDIT',
      'message', 'Your included recognitions for this month are used up. Add credits to continue, or wait until next month.'
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
-- 3) First firm.orders row per (firm_space_id, client_space_id): grant recognition credits to client
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm.trg_firm_order_grant_client_signing_credits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, firm
AS $$
DECLARE
  v_bonus int;
  v_other boolean;
BEGIN
  IF NEW.client_space_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE((se.data_limits->>'recognition_credits_per_signing')::int, 0)
  INTO v_bonus
  FROM crm.sku_edition se
  WHERE se.code = 'FIRM_CLIENT_SIGNING_BONUS'
  LIMIT 1;

  IF v_bonus IS NULL OR v_bonus <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM firm.orders o
    WHERE o.firm_space_id = NEW.firm_space_id
      AND o.client_space_id = NEW.client_space_id
      AND o.id IS DISTINCT FROM NEW.id
  )
  INTO v_other;

  IF v_other THEN
    RETURN NEW;
  END IF;

  INSERT INTO crm.space_billing_state (space_id, recognition_credits_balance, updated_at)
  VALUES (NEW.client_space_id, v_bonus, now())
  ON CONFLICT (space_id) DO UPDATE SET
    recognition_credits_balance = crm.space_billing_state.recognition_credits_balance + EXCLUDED.recognition_credits_balance,
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_firm_orders_client_signing_credits ON firm.orders;
CREATE TRIGGER trg_firm_orders_client_signing_credits
  AFTER INSERT ON firm.orders
  FOR EACH ROW
  EXECUTE FUNCTION crm.trg_firm_order_grant_client_signing_credits();

COMMENT ON FUNCTION crm.trg_firm_order_grant_client_signing_credits() IS
  'When the first firm.orders row is created for a (firm_space_id, client_space_id), add recognition credits to the client space (config: sku_edition FIRM_CLIENT_SIGNING_BONUS).';

-- ---------------------------------------------------------------------------
-- 4) Space registration: no VCH_TRIAL order; ops assignment only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm.on_space_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = crm, public
AS $$
DECLARE
  v_ops_id uuid;
BEGIN
  SELECT id INTO v_ops_id FROM crm.ops_users ORDER BY created_at ASC LIMIT 1;
  IF v_ops_id IS NOT NULL THEN
    INSERT INTO crm.ops_assignments (ops_user_id, space_id, role)
    VALUES (v_ops_id, NEW.id, 'primary')
    ON CONFLICT (space_id) DO UPDATE SET
      ops_user_id = EXCLUDED.ops_user_id,
      role = EXCLUDED.role;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION crm.on_space_created() IS 'public.spaces AFTER INSERT: ops_assignments only (billing via FIRM_ANNUAL / client credits, not VCH_TRIAL).';

-- ---------------------------------------------------------------------------
-- 5) Catalog cleanup + new SKU rows (idempotent upsert; delete obsolete editions not referenced)
-- ---------------------------------------------------------------------------
DELETE FROM crm.sku_addon a
WHERE a.code IN (
  'VCH_ADDON_500',
  'ENG_PACK_50',
  'ENG_PACK_100',
  'ENG_PACK_200',
  'ENG_PACK_500',
  'CLIENT_CREDIT_100'
);

DELETE FROM crm.sku_edition se
WHERE se.code IN (
  'VCH_TRIAL',
  'VCH_BASIC',
  'VCH_BIZ',
  'VCH_FLOW',
  'VCH_ELITE',
  'CLIENT_SUB'
)
AND NOT EXISTS (SELECT 1 FROM crm.space_orders o WHERE o.sku_id = se.id);

INSERT INTO crm.sku_edition (
  code, name, description, feature_modules, data_limits, period_type, quota_period,
  price_monthly, price_yearly, currency, is_trial, sort_order
)
VALUES (
  'CLIENT_RECOGNITION_BASE',
  'Client recognition (included tier)',
  'Catalog-only: free included AI recognitions per month for all client spaces. Not a purchasable order row.',
  '{"expenses": true, "income": true, "inbound": true, "outbound": true}'::jsonb,
  '{"recognition_included_per_month": 10, "billing_role": "client_catalog"}'::jsonb,
  'forever',
  'month',
  NULL,
  NULL,
  'USD',
  false,
  0
),
(
  'FIRM_CLIENT_SIGNING_BONUS',
  'Firm–client signing bonus (recognition credits)',
  'Catalog-only: recognition credits granted to the client space on first firm.orders row for each (firm, client) pair.',
  '{"expenses": true, "income": true, "inbound": true, "outbound": true}'::jsonb,
  '{"recognition_credits_per_signing": 20, "billing_role": "policy"}'::jsonb,
  'forever',
  'month',
  NULL,
  NULL,
  'USD',
  false,
  5
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  feature_modules = EXCLUDED.feature_modules,
  data_limits = EXCLUDED.data_limits,
  period_type = EXCLUDED.period_type,
  quota_period = EXCLUDED.quota_period,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  currency = EXCLUDED.currency,
  is_trial = EXCLUDED.is_trial,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO crm.sku_edition (
  code, name, description, feature_modules, data_limits, period_type, quota_period,
  price_monthly, price_yearly, currency, is_trial, sort_order
)
VALUES (
  'FIRM_ANNUAL',
  'Firm Annual',
  'Annual firm plan. Includes engagement_credits_included concurrent engagements (non-cancelled, non-completed). Top up via CRM orders metadata.engagement_credits_added.',
  '{"expenses": true, "income": true, "inbound": true, "outbound": true}'::jsonb,
  '{"engagement_credits_included": 50, "billing_role": "firm"}'::jsonb,
  'year',
  'year',
  NULL,
  99.00,
  'USD',
  false,
  40
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  feature_modules = EXCLUDED.feature_modules,
  data_limits = EXCLUDED.data_limits,
  period_type = EXCLUDED.period_type,
  quota_period = EXCLUDED.quota_period,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  currency = EXCLUDED.currency,
  is_trial = EXCLUDED.is_trial,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO crm.sku_addon (code, name, description, units, price, currency, is_active, sort_order)
VALUES
  (
    'ENGAGEMENT_CREDITS_REF',
    'Engagement credits (reference pack)',
    'Reference listing for CRM: engagement credit packs sold with firm annual billing. units = credits per pack; price = reference USD (0 = quote separately).',
    10,
    0,
    'USD',
    true,
    10
  ),
  (
    'CLIENT_RECOGNITION_CREDITS_REF',
    'Client recognition credits (reference pack)',
    'Reference listing: prepaid recognition credits for client spaces. Grant balance via space_orders.metadata.recognition_credits_added.',
    100,
    0,
    'USD',
    true,
    20
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  units = EXCLUDED.units,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

COMMENT ON FUNCTION firm.client_create_onboarding_order_from_published_sku(uuid, uuid) IS
  'Client space member: create onboarding order for a published SKU. Enforces FIRM_ANNUAL engagement capacity (credits + metadata).';

COMMIT;
