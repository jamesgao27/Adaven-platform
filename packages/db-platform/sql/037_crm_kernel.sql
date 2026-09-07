-- Wholestore crm kernel: SKU / space_orders / entitlements / registration trial.
-- SQL identifiers are provider/consumer only. Do not run on Vouchap.

CREATE SCHEMA IF NOT EXISTS crm;

CREATE TABLE IF NOT EXISTS crm.sku_edition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  feature_modules jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_limits jsonb NOT NULL DEFAULT '{}'::jsonb,
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
  created_by_ops_user_id uuid,
  source text NOT NULL DEFAULT 'registration',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ws_space_orders_space ON crm.space_orders (space_id, created_at DESC);

INSERT INTO crm.sku_edition (
  code, name, description, feature_modules, data_limits, period_type, quota_period,
  price_monthly, price_yearly, currency, is_trial, sort_order
) VALUES
(
  'PROVIDER_TRIAL_30', 'Vendor trial (30 days)', 'Registration trial for provider spaces.',
  '{"catalog": true, "enrollments": true}'::jsonb,
  '{"billing_kind": "space_subscription", "space_target": "provider", "members": 10, "max_consumers": 20, "orders_included_per_period": 50}'::jsonb,
  'month', 'month', NULL, NULL, 'USD', true, 10
),
(
  'PROVIDER_ANNUAL', 'Vendor annual', 'Paid annual subscription for provider spaces.',
  '{"catalog": true, "enrollments": true}'::jsonb,
  '{"billing_kind": "space_subscription", "space_target": "provider", "members": 999999, "max_consumers": 500, "orders_included_per_period": 2000}'::jsonb,
  'year', 'year', NULL, 1200, 'USD', false, 20
),
(
  'CONSUMER_TRIAL_30', 'Dealer trial (30 days)', 'Registration trial for consumer spaces.',
  '{"marketplace": true, "orders": true}'::jsonb,
  '{"billing_kind": "space_subscription", "space_target": "consumer", "members": 10, "orders_included_per_period": 30}'::jsonb,
  'month', 'month', NULL, NULL, 'USD', true, 30
),
(
  'CONSUMER_PAID_MONTHLY', 'Dealer monthly', 'Paid monthly subscription for consumer spaces.',
  '{"marketplace": true, "orders": true}'::jsonb,
  '{"billing_kind": "space_subscription", "space_target": "consumer", "members": 50, "orders_included_per_period": 200}'::jsonb,
  'month', 'month', 49, NULL, 'USD', false, 40
),
(
  'ORDER_CREDIT_PACK', 'Order credit pack', 'Permanent extra marketplace orders.',
  '{"orders": true}'::jsonb,
  '{"billing_kind": "order_credit_pack", "space_target": "any"}'::jsonb,
  'forever', 'month', NULL, NULL, 'USD', false, 50
)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    data_limits = EXCLUDED.data_limits,
    feature_modules = EXCLUDED.feature_modules;

INSERT INTO crm.sku_addon (code, name, units, price, currency, sort_order)
VALUES ('ORDER_CREDITS_REF', 'Order credits (reference)', 20, 0, 'USD', 10)
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION crm._active_space_subscription_row(p_space_id uuid)
RETURNS TABLE (
  order_id uuid,
  sku_id uuid,
  sku_code text,
  started_at timestamptz,
  expires_at timestamptz,
  is_trial boolean,
  data_limits jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = crm, public
AS $$
  SELECT so.id, so.sku_id, se.code, so.started_at, so.expires_at, se.is_trial, se.data_limits
  FROM crm.space_orders so
  JOIN crm.sku_edition se ON se.id = so.sku_id
  WHERE so.space_id = p_space_id
    AND so.status = 'active'
    AND so.expires_at IS NOT NULL
    AND so.expires_at > now()
    AND COALESCE(se.data_limits->>'billing_kind', 'space_subscription') = 'space_subscription'
  ORDER BY se.is_trial ASC, so.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION crm.get_space_entitlements(p_space_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = crm, public, provider
AS $$
DECLARE
  v_kind text;
  v_order_id uuid;
  v_sku_code text;
  v_started timestamptz;
  v_expires timestamptz;
  v_is_trial boolean;
  v_limits jsonb;
  v_members int := 0;
  v_max_consumers int := 0;
  v_used_consumers int := 0;
  v_orders_included int := 0;
  v_orders_used int := 0;
  v_order_credits int := 0;
BEGIN
  SELECT kind INTO v_kind FROM public.spaces WHERE id = p_space_id;
  IF v_kind IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SPACE_NOT_FOUND');
  END IF;

  SELECT s.order_id, s.sku_code, s.started_at, s.expires_at, s.is_trial, s.data_limits
  INTO v_order_id, v_sku_code, v_started, v_expires, v_is_trial, v_limits
  FROM crm._active_space_subscription_row(p_space_id) s;
  SELECT count(*) INTO v_members FROM public.user_spaces WHERE space_id = p_space_id;

  IF v_order_id IS NOT NULL THEN
    v_max_consumers := COALESCE((v_limits->>'max_consumers')::int, 0);
    v_orders_included := COALESCE((v_limits->>'orders_included_per_period')::int, 0);
  END IF;

  SELECT COALESCE(sum((so.metadata->>'order_credits_added')::int), 0)
  INTO v_order_credits
  FROM crm.space_orders so
  JOIN crm.sku_edition se ON se.id = so.sku_id
  WHERE so.space_id = p_space_id
    AND so.status = 'active'
    AND COALESCE(se.data_limits->>'billing_kind', '') = 'order_credit_pack';

  IF to_regclass('provider.consumers') IS NOT NULL THEN
    SELECT count(*) INTO v_used_consumers
    FROM provider.consumers c
    WHERE c.provider_space_id = p_space_id
      AND COALESCE(c.status, 'approved') <> 'rejected';
  END IF;

  IF to_regclass('provider.orders') IS NOT NULL AND v_order_id IS NOT NULL THEN
    SELECT count(*) INTO v_orders_used
    FROM provider.orders o
    WHERE (o.consumer_space_id = p_space_id OR o.provider_space_id = p_space_id)
      AND o.created_at >= v_started
      AND o.created_at < v_expires
      AND COALESCE(o.status, '') <> 'cancelled';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'space_kind', v_kind,
    'active_subscription', CASE WHEN v_order_id IS NULL THEN NULL ELSE jsonb_build_object(
      'order_id', v_order_id,
      'sku_code', v_sku_code,
      'started_at', v_started,
      'expires_at', v_expires,
      'is_trial', v_is_trial
    ) END,
    'members', jsonb_build_object(
      'used', v_members,
      'limit', COALESCE((v_limits->>'members')::int, 0)
    ),
    'provider_enrollment', jsonb_build_object(
      'max_consumers', v_max_consumers,
      'used', v_used_consumers
    ),
    'consumer_orders', jsonb_build_object(
      'included_per_period', v_orders_included,
      'used_in_period', v_orders_used,
      'credits_balance', v_order_credits,
      'max_creates', v_orders_included + v_order_credits
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION crm.assert_space_has_active_subscription(p_space_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = crm
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM crm._active_space_subscription_row(p_space_id)) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION crm.assert_provider_can_enroll_consumer(p_provider_space_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = crm
AS $$
DECLARE
  ent jsonb;
BEGIN
  PERFORM crm.assert_space_has_active_subscription(p_provider_space_id);
  ent := crm.get_space_entitlements(p_provider_space_id);
  IF COALESCE((ent->'provider_enrollment'->>'max_consumers')::int, 0) > 0
     AND COALESCE((ent->'provider_enrollment'->>'used')::int, 0)
         >= COALESCE((ent->'provider_enrollment'->>'max_consumers')::int, 0) THEN
    RAISE EXCEPTION 'PROVIDER_CONSUMER_LIMIT'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION crm.assert_consumer_can_create_order(p_consumer_space_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = crm
AS $$
DECLARE
  ent jsonb;
  used int;
  max_creates int;
BEGIN
  PERFORM crm.assert_space_has_active_subscription(p_consumer_space_id);
  ent := crm.get_space_entitlements(p_consumer_space_id);
  used := COALESCE((ent->'consumer_orders'->>'used_in_period')::int, 0);
  max_creates := COALESCE((ent->'consumer_orders'->>'max_creates')::int, 0);
  IF max_creates > 0 AND used >= max_creates THEN
    RAISE EXCEPTION 'ORDER_QUOTA_EXCEEDED'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION crm.on_space_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = crm, public
AS $$
DECLARE
  v_code text;
  v_sku uuid;
BEGIN
  v_code := CASE WHEN NEW.kind = 'provider' THEN 'PROVIDER_TRIAL_30' ELSE 'CONSUMER_TRIAL_30' END;
  SELECT id INTO v_sku FROM crm.sku_edition WHERE code = v_code LIMIT 1;
  IF v_sku IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM crm.space_orders so
    JOIN crm.sku_edition se ON se.id = so.sku_id
    WHERE so.space_id = NEW.id
      AND so.status = 'active'
      AND so.source = 'registration'
  ) THEN
    RETURN NEW;
  END IF;
  INSERT INTO crm.space_orders (space_id, sku_id, status, started_at, expires_at, source)
  VALUES (NEW.id, v_sku, 'active', now(), now() + interval '30 days', 'registration');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_spaces_crm_on_created ON public.spaces;
CREATE TRIGGER trg_spaces_crm_on_created
  AFTER INSERT ON public.spaces
  FOR EACH ROW EXECUTE FUNCTION crm.on_space_created();

INSERT INTO crm.space_orders (space_id, sku_id, status, started_at, expires_at, source)
SELECT s.id, se.id, 'active', now(), now() + interval '30 days', 'ops_grant'
FROM public.spaces s
JOIN crm.sku_edition se ON se.code = CASE WHEN s.kind = 'provider' THEN 'PROVIDER_TRIAL_30' ELSE 'CONSUMER_TRIAL_30' END
WHERE NOT EXISTS (
  SELECT 1 FROM crm.space_orders so
  JOIN crm.sku_edition se2 ON se2.id = so.sku_id
  WHERE so.space_id = s.id
    AND so.status = 'active'
    AND COALESCE(se2.data_limits->>'billing_kind', '') = 'space_subscription'
    AND so.expires_at IS NOT NULL
    AND so.expires_at > now()
);

CREATE OR REPLACE FUNCTION crm._prepend_assert_after_begin(p_schema text, p_name text, p_assert text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  def text;
  oid oid;
  pos int;
BEGIN
  SELECT p.oid INTO oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = p_schema AND p.proname = p_name
  ORDER BY p.oid
  LIMIT 1;
  IF oid IS NULL THEN
    RETURN;
  END IF;
  def := pg_get_functiondef(oid);
  IF position(p_assert IN def) > 0 THEN
    RETURN;
  END IF;
  pos := position('BEGIN' IN def);
  IF pos = 0 THEN
    RETURN;
  END IF;
  def := overlay(def placing E'BEGIN\n  ' || p_assert || E'\n' from pos for 5);
  EXECUTE def;
END;
$$;

SELECT crm._prepend_assert_after_begin(
  'provider',
  'consumer_apply_to_provider',
  'PERFORM crm.assert_space_has_active_subscription(p_consumer_space_id);'
);
SELECT crm._prepend_assert_after_begin(
  'provider',
  'create_consumer_with_space',
  'PERFORM crm.assert_provider_can_enroll_consumer(p_provider_space_id);'
);
SELECT crm._prepend_assert_after_begin(
  'provider',
  'consumer_create_order_from_published_skus',
  'PERFORM crm.assert_consumer_can_create_order(p_consumer_space_id);'
);

ALTER TABLE crm.sku_edition ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.sku_addon ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.space_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sku_edition_select ON crm.sku_edition;
CREATE POLICY sku_edition_select ON crm.sku_edition FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS sku_addon_select ON crm.sku_addon;
CREATE POLICY sku_addon_select ON crm.sku_addon FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS space_orders_select_member ON crm.space_orders;
CREATE POLICY space_orders_select_member ON crm.space_orders
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.space_id = space_orders.space_id AND us.user_id = auth.uid()));

GRANT USAGE ON SCHEMA crm TO authenticated, service_role, anon;
GRANT SELECT ON crm.sku_edition, crm.sku_addon TO authenticated;
GRANT SELECT ON crm.space_orders TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA crm TO service_role;
GRANT EXECUTE ON FUNCTION crm.get_space_entitlements(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.assert_space_has_active_subscription(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.assert_provider_can_enroll_consumer(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.assert_consumer_can_create_order(uuid) TO authenticated, service_role;

DO $$
BEGIN
  BEGIN
    EXECUTE $q$ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, provider, consumer, crm'$q$;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;
NOTIFY pgrst, 'reload config';
