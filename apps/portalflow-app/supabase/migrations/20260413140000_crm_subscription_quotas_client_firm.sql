-- Firm annual + client recognition quotas (CRM-configured via space_orders + metadata).
-- Client: CLIENT_SUB SKU + optional credits in space_billing_state; monthly cap 100 when any firm.orders processing.
-- Firm: FIRM_ANNUAL + sum(metadata.engagement_addon_slots) caps non-terminal firm.orders count.

BEGIN;

SET search_path = public, crm, firm;

-- CRM catalog/orders lived in vouchap-crm SQL, not in this app's migration chain.
CREATE SCHEMA IF NOT EXISTS crm;

CREATE TABLE IF NOT EXISTS crm.ops_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  name text,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'ops',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm.sku_edition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  feature_modules jsonb NOT NULL DEFAULT '{}',
  data_limits jsonb NOT NULL DEFAULT '{}',
  period_type text NOT NULL DEFAULT 'month',
  quota_period text NOT NULL DEFAULT 'month',
  price_monthly numeric(10, 2),
  price_yearly numeric(10, 2),
  currency text NOT NULL DEFAULT 'USD',
  is_trial boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm.sku_addon (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text,
  description text,
  units int NOT NULL,
  price numeric(10, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm.space_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL,
  sku_id uuid NOT NULL REFERENCES crm.sku_edition(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_ops_user_id uuid REFERENCES crm.ops_users(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'registration',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sku_edition_code ON crm.sku_edition(code);
CREATE INDEX IF NOT EXISTS idx_space_orders_space ON crm.space_orders(space_id);
CREATE INDEX IF NOT EXISTS idx_space_orders_space_created ON crm.space_orders(space_id, created_at DESC);

ALTER TABLE crm.sku_edition ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.sku_addon ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.space_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.ops_users ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA crm TO anon, authenticated, service_role;
GRANT SELECT ON crm.sku_edition TO anon, authenticated, service_role;
GRANT SELECT ON crm.sku_addon TO anon, authenticated, service_role;
GRANT SELECT, INSERT ON crm.space_orders TO authenticated;

-- 1) sku_edition: annual price (optional display / reporting)
ALTER TABLE crm.sku_edition
  ADD COLUMN IF NOT EXISTS price_yearly numeric(10, 2);

COMMENT ON COLUMN crm.sku_edition.price_yearly IS 'Annual list price (USD) when period_type = year; optional.';

-- 2) space_orders: JSON metadata (engagement_addon_slots, recognition_credits_added, ...)
ALTER TABLE crm.space_orders
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN crm.space_orders.metadata IS 'Order extras: engagement_addon_slots (int), recognition_credits_added (int credits granted on insert), etc.';

-- Client-space actions: member OR assigned firm order manager for any order on that client space
CREATE OR REPLACE FUNCTION crm.user_may_act_for_client_space(p_uid uuid, p_client_space_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, firm
AS $$
  SELECT p_uid IS NOT NULL    AND p_client_space_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.user_spaces us
        WHERE us.user_id = p_uid AND us.space_id = p_client_space_id
      )
      OR EXISTS (
        SELECT 1
        FROM firm.orders o
        INNER JOIN firm.order_managers om ON om.order_id = o.id AND om.manager_user_id = p_uid
        WHERE o.client_space_id = p_client_space_id
      )
    );
$$;

-- 3) Client recognition usage (successful runs only; counted in UTC YYYY-MM)
CREATE TABLE IF NOT EXISTS crm.client_recognition_monthly_usage (
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  year_month text NOT NULL CHECK (year_month ~ '^[0-9]{4}-[0-9]{2}$'),
  success_count int NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_client_recognition_usage_month
  ON crm.client_recognition_monthly_usage (year_month);

COMMENT ON TABLE crm.client_recognition_monthly_usage IS 'Per client space: successful AI document recognitions per UTC month.';

-- 4) Prepaid recognition credits (incremented by order metadata trigger; decremented on success past included tier)
CREATE TABLE IF NOT EXISTS crm.space_billing_state (
  space_id uuid PRIMARY KEY REFERENCES public.spaces(id) ON DELETE CASCADE,
  recognition_credits_balance int NOT NULL DEFAULT 0 CHECK (recognition_credits_balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE crm.space_billing_state IS 'Mutable billing counters for a space; credits from CRM orders metadata.recognition_credits_added.';

ALTER TABLE crm.client_recognition_monthly_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.space_billing_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_recognition_monthly_usage_select ON crm.client_recognition_monthly_usage;
CREATE POLICY client_recognition_monthly_usage_select ON crm.client_recognition_monthly_usage
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid() AND us.space_id = crm.client_recognition_monthly_usage.space_id
    )
  );

DROP POLICY IF EXISTS space_billing_state_select ON crm.space_billing_state;
CREATE POLICY space_billing_state_select ON crm.space_billing_state
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid() AND us.space_id = crm.space_billing_state.space_id
    )
  );

-- 5) Apply recognition credits when ops inserts an order with metadata.recognition_credits_added
CREATE OR REPLACE FUNCTION crm.apply_space_order_metadata_entitlements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $$
DECLARE
  v_delta int;
BEGIN
  IF NEW.metadata IS NOT NULL AND (NEW.metadata ? 'recognition_credits_added') THEN
    v_delta := COALESCE((NEW.metadata->>'recognition_credits_added')::int, 0);
    IF v_delta > 0 THEN
      INSERT INTO crm.space_billing_state (space_id, recognition_credits_balance, updated_at)
      VALUES (NEW.space_id, v_delta, now())
      ON CONFLICT (space_id) DO UPDATE SET
        recognition_credits_balance = crm.space_billing_state.recognition_credits_balance + EXCLUDED.recognition_credits_balance,
        updated_at = now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_space_orders_apply_metadata ON crm.space_orders;
CREATE TRIGGER trg_space_orders_apply_metadata
  AFTER INSERT ON crm.space_orders
  FOR EACH ROW
  EXECUTE FUNCTION crm.apply_space_order_metadata_entitlements();

-- 6) Firm engagement capacity (raises ENGAGEMENT_CAPACITY_EXCEEDED)
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
    SELECT (se.data_limits->>'engagements_included')::int
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
    CASE
      WHEN (so.metadata->>'engagement_addon_slots') ~ '^[0-9]+$'
        THEN (so.metadata->>'engagement_addon_slots')::int
      ELSE 0
    END
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
            HINT = 'Raise firm engagement cap via CRM (FIRM_ANNUAL order metadata.engagement_addon_slots) or complete/cancel engagements.';
  END IF;
END;
$$;

COMMENT ON FUNCTION crm.assert_firm_can_create_engagement(uuid) IS 'Raises if firm has FIRM_ANNUAL and active (non-cancelled, non-completed) firm.orders count >= included + sum(metadata.engagement_addon_slots).';

-- 7) Client quota read (for UI / preflight)
CREATE OR REPLACE FUNCTION crm.get_client_recognition_quota(p_space_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, crm, firm
AS $$
DECLARE
  v_kind text;
  v_enforce boolean := false;
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

  IF v_kind <> 'consumer' THEN
    RETURN jsonb_build_object('ok', true, 'enforce', false, 'space_kind', v_kind);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM crm.space_orders so
    JOIN crm.sku_edition se ON se.id = so.sku_id
    WHERE so.space_id = p_space_id
      AND so.status = 'active'
      AND (so.expires_at IS NULL OR so.expires_at > now())
      AND se.code = 'CLIENT_SUB'
  ) THEN
    v_enforce := true;
    v_included := COALESCE((
      SELECT (se.data_limits->>'recognition_included_per_month')::int
      FROM crm.space_orders so
      JOIN crm.sku_edition se ON se.id = so.sku_id
      WHERE so.space_id = p_space_id
        AND so.status = 'active'
        AND (so.expires_at IS NULL OR so.expires_at > now())
        AND se.code = 'CLIENT_SUB'
      ORDER BY so.created_at DESC
      LIMIT 1
    ), 10);
  END IF;

  IF NOT v_enforce THEN
    RETURN jsonb_build_object('ok', true, 'enforce', false, 'space_kind', 'client');
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

-- 8) Record one successful recognition (atomic)
CREATE OR REPLACE FUNCTION crm.record_client_recognition_success(p_space_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, firm
AS $$
DECLARE
  v_kind text;
  v_enforce boolean := false;
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

  IF v_kind <> 'consumer' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_client_space');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM crm.space_orders so
    JOIN crm.sku_edition se ON se.id = so.sku_id
    WHERE so.space_id = p_space_id
      AND so.status = 'active'
      AND (so.expires_at IS NULL OR so.expires_at > now())
      AND se.code = 'CLIENT_SUB'
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_client_sub_order');
  END IF;

  v_enforce := true;
  v_included := COALESCE((
    SELECT (se.data_limits->>'recognition_included_per_month')::int
    FROM crm.space_orders so
    JOIN crm.sku_edition se ON se.id = so.sku_id
    WHERE so.space_id = p_space_id
      AND so.status = 'active'
      AND (so.expires_at IS NULL OR so.expires_at > now())
      AND se.code = 'CLIENT_SUB'
    ORDER BY so.created_at DESC
    LIMIT 1
  ), 10);

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

GRANT EXECUTE ON FUNCTION crm.assert_firm_can_create_engagement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION crm.get_client_recognition_quota(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION crm.record_client_recognition_success(uuid) TO authenticated;

-- 9) Client catalog RPC: enforce firm engagement cap before INSERT
CREATE OR REPLACE FUNCTION firm.client_create_onboarding_order_from_published_sku(
  p_client_space_id uuid,
  p_sku_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_uid uuid;
  v_firm uuid;
  v_client_row_id uuid;
  v_order_id uuid;
  r_sku firm.skus%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_client_space_id IS NULL OR p_sku_id IS NULL THEN
    RAISE EXCEPTION 'Invalid arguments';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_spaces us
    INNER JOIN public.spaces sp ON sp.id = us.space_id
    WHERE us.user_id = v_uid
      AND us.space_id = p_client_space_id
      AND sp.kind = 'consumer'
  ) THEN
    RAISE EXCEPTION 'Not a member of this client space';
  END IF;

  SELECT * INTO r_sku FROM firm.skus WHERE id = p_sku_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SKU not found';
  END IF;

  IF NOT firm.is_sku_published_catalog(r_sku) THEN
    RAISE EXCEPTION 'SKU is not published';
  END IF;

  v_firm := r_sku.firm_space_id;

  PERFORM crm.assert_firm_can_create_engagement(v_firm);

  SELECT c.id INTO v_client_row_id
  FROM firm.clients c
  WHERE c.firm_space_id = v_firm
    AND c.client_space_id = p_client_space_id
  ORDER BY c.created_at DESC NULLS LAST
  LIMIT 1;

  INSERT INTO firm.orders (
    firm_space_id,
    client_space_id,
    client_id,
    sku_id,
    status,
    created_by,
    tax_country,
    tax_scenario,
    tags
  ) VALUES (
    v_firm,
    p_client_space_id,
    v_client_row_id,
    p_sku_id,
    'onboarding',
    v_uid,
    r_sku.tax_country,
    r_sku.tax_scenario,
    r_sku.tags
  )
  RETURNING id INTO v_order_id;

  RETURN v_order_id;
END;
$$;

COMMENT ON FUNCTION firm.client_create_onboarding_order_from_published_sku(uuid, uuid) IS
  'Client space member: create onboarding order for a published SKU (links firm.clients when present). Enforces CRM FIRM_ANNUAL engagement cap.';

COMMIT;
