-- Align live Vouchap (giuacjbfsyrristkigmz) with the platform kernel.
-- spaces.kind becomes provider | consumer. Schema firm becomes provider.
-- Product UI labels stay Firm / Client. This file is applied once to that database.

BEGIN;

SET LOCAL statement_timeout = '180s';
SET LOCAL lock_timeout = '15s';

-- ---------------------------------------------------------------------------
-- 1) Kernel kind
-- ---------------------------------------------------------------------------
ALTER TABLE public.spaces DROP CONSTRAINT IF EXISTS spaces_kind_check;
UPDATE public.spaces SET kind = CASE kind
  WHEN 'firm' THEN 'provider'
  WHEN 'client' THEN 'consumer'
  ELSE kind
END
WHERE kind IN ('firm', 'client');
ALTER TABLE public.spaces
  ADD CONSTRAINT spaces_kind_check CHECK (kind IN ('provider', 'consumer'));
COMMENT ON COLUMN public.spaces.kind IS
  'Kernel only: provider (supplies) or consumer (is served). Product copy must not introduce a third kind.';

-- ---------------------------------------------------------------------------
-- 2) Schema, tables, columns
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'firm') THEN
    ALTER SCHEMA firm RENAME TO provider;
  END IF;
END $$;

ALTER TABLE IF EXISTS provider.firms RENAME TO providers;
ALTER TABLE IF EXISTS provider.clients RENAME TO consumers;
ALTER TABLE IF EXISTS provider.client_follow_ups RENAME TO consumer_follow_ups;
ALTER TABLE IF EXISTS provider.client_invite_tokens RENAME TO consumer_invite_tokens;

ALTER TABLE IF EXISTS provider.consumers RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE IF EXISTS provider.consumers RENAME COLUMN client_space_id TO consumer_space_id;
ALTER TABLE IF EXISTS provider.consumers RENAME COLUMN invitee_client_name TO invitee_consumer_name;

ALTER TABLE IF EXISTS provider.consumer_follow_ups RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE IF EXISTS provider.consumer_follow_ups RENAME COLUMN client_space_id TO consumer_space_id;
ALTER TABLE IF EXISTS provider.consumer_follow_ups RENAME COLUMN client_id TO consumer_id;

ALTER TABLE IF EXISTS provider.consumer_invite_tokens RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE IF EXISTS provider.consumer_invite_tokens RENAME COLUMN max_clients TO max_consumers;

ALTER TABLE IF EXISTS provider.invitee_clients RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE IF EXISTS provider.invitee_clients RENAME COLUMN clients_space_id TO consumer_space_id;
ALTER TABLE IF EXISTS provider.invitee_clients RENAME COLUMN invitee_client_name TO invitee_consumer_name;

ALTER TABLE IF EXISTS provider.order_labels RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE IF EXISTS provider.order_managers RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE IF EXISTS provider.orders RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE IF EXISTS provider.orders RENAME COLUMN client_space_id TO consumer_space_id;
ALTER TABLE IF EXISTS provider.orders RENAME COLUMN client_id TO consumer_id;
ALTER TABLE IF EXISTS provider.orders RENAME COLUMN firm_confirmed_at TO provider_confirmed_at;
ALTER TABLE IF EXISTS provider.orders RENAME COLUMN client_confirmed_at TO consumer_confirmed_at;
ALTER TABLE IF EXISTS provider.orders RENAME COLUMN hidden_from_client_at TO hidden_from_consumer_at;

ALTER TABLE IF EXISTS provider.permission_role_members RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE IF EXISTS provider.permission_role_scope RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE IF EXISTS provider.permission_roles RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE IF EXISTS provider.skus RENAME COLUMN firm_space_id TO provider_space_id;

ALTER TABLE IF EXISTS public.projects RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE IF EXISTS public.projects RENAME COLUMN client_space_id TO consumer_space_id;

ALTER TABLE IF EXISTS crm.client_recognition_monthly_usage RENAME TO consumer_recognition_monthly_usage;

-- ---------------------------------------------------------------------------
-- 3) consumer.consumers (space extras). Enrollment stays in provider.consumers.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS consumer;
GRANT USAGE ON SCHEMA consumer TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA consumer TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA consumer TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA consumer GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA consumer GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS consumer.consumers (
  space_id UUID PRIMARY KEY REFERENCES public.spaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE consumer.consumers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consumers_space_select ON consumer.consumers;
CREATE POLICY consumers_space_select ON consumer.consumers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid() AND us.space_id = consumer.consumers.space_id
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON consumer.consumers TO authenticated;
GRANT ALL ON consumer.consumers TO service_role;

INSERT INTO consumer.consumers (space_id, status)
SELECT s.id, 'approved'
FROM public.spaces s
WHERE s.kind = 'consumer'
ON CONFLICT (space_id) DO NOTHING;

GRANT USAGE ON SCHEMA provider TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA provider TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA provider TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA provider TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA provider GRANT ALL ON TABLES TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Rewrite function and policy text
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.overlay_rewrite_ident(src text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  s text := src;
BEGIN
  s := replace(s, 'apply_preset_skus_to_firm', 'apply_preset_skus_to_provider');
  s := replace(s, 'assert_firm_can_confirm_engagement', 'assert_provider_can_confirm_engagement');
  s := replace(s, 'assert_firm_can_create_engagement', 'assert_provider_can_create_engagement');
  s := replace(s, 'auth_user_firm_can_see_client_space', 'auth_user_provider_can_see_consumer_space');
  s := replace(s, 'auth_user_can_select_sku_as_engaged_client', 'auth_user_can_select_sku_as_engaged_consumer');
  s := replace(s, 'auth_user_is_client_space_member', 'auth_user_is_consumer_space_member');
  s := replace(s, 'can_access_client', 'can_access_consumer');
  s := replace(s, 'client_create_onboarding_order_from_published_sku', 'consumer_create_onboarding_order_from_published_sku');
  s := replace(s, 'enforce_marketplace_order_firm_confirmation', 'enforce_marketplace_order_provider_confirmation');
  s := replace(s, 'hide_order_for_client', 'hide_order_for_consumer');
  s := replace(s, 'unhide_order_for_client', 'unhide_order_for_consumer');
  s := replace(s, 'list_published_skus_for_client_catalog', 'list_published_skus_for_consumer_catalog');
  s := replace(s, 'migrate_pending_orders_to_client_space', 'migrate_pending_orders_to_consumer_space');
  s := replace(s, 'set_client_last_follow_up_at', 'set_consumer_last_follow_up_at');
  s := replace(s, 'touch_client', 'touch_consumer');
  s := replace(s, '_client_can_preview_sku', '_consumer_can_preview_sku');
  s := replace(s, 'firm_accept_client_invite_token', 'provider_accept_consumer_invite_token');
  s := replace(s, 'accept_client_invite_token', 'accept_consumer_invite_token');
  s := replace(s, 'firm_get_client_invite_info', 'provider_get_consumer_invite_info');
  s := replace(s, 'firm_create_client_on_behalf', 'provider_create_consumer_on_behalf');
  s := replace(s, 'firm_create_invitee_only', 'provider_create_invitee_only');
  s := replace(s, 'firm_create_pending_order_for_invitee', 'provider_create_pending_order_for_invitee');
  s := replace(s, 'firm_open_invite_joined_counts', 'provider_open_invite_joined_counts');
  s := replace(s, 'get_firm_sku_items_preview_for_order_client', 'get_provider_sku_items_preview_for_order_consumer');
  s := replace(s, 'get_firm_sku_preview_for_order_client', 'get_provider_sku_preview_for_order_consumer');
  s := replace(s, 'get_firm_sku_items_preview_for_client', 'get_provider_sku_items_preview_for_consumer');
  s := replace(s, 'get_firm_sku_preview_for_client', 'get_provider_sku_preview_for_consumer');
  s := replace(s, 'get_client_recognition_quota', 'get_consumer_recognition_quota');
  s := replace(s, 'record_client_recognition_success', 'record_consumer_recognition_success');
  s := replace(s, 'trg_firm_order_grant_client_signing_credits', 'trg_provider_order_grant_consumer_signing_credits');
  s := replace(s, 'user_may_act_for_client_space', 'user_may_act_for_consumer_space');
  s := replace(s, 'apply_client_tag_presets_to_space', 'apply_consumer_tag_presets_to_space');

  s := replace(s, 'crm.client_recognition_monthly_usage', 'crm.consumer_recognition_monthly_usage');
  s := replace(s, 'firm.firms', 'provider.providers');
  s := replace(s, 'firm.clients', 'provider.consumers');
  s := replace(s, 'firm.client_follow_ups', 'provider.consumer_follow_ups');
  s := replace(s, 'firm.client_invite_tokens', 'provider.consumer_invite_tokens');
  s := replace(s, 'provider.client_follow_ups', 'provider.consumer_follow_ups');
  s := replace(s, 'provider.client_invite_tokens', 'provider.consumer_invite_tokens');
  s := replace(s, 'provider.firms', 'provider.providers');
  s := replace(s, 'provider.clients', 'provider.consumers');
  s := replace(s, 'FROM firms', 'FROM providers');
  s := replace(s, 'INTO firms', 'INTO providers');
  s := replace(s, 'UPDATE firms', 'UPDATE providers');
  s := replace(s, 'JOIN firms', 'JOIN providers');
  s := replace(s, 'FROM client_follow_ups', 'FROM consumer_follow_ups');
  s := replace(s, 'INTO client_follow_ups', 'INTO consumer_follow_ups');
  s := replace(s, 'UPDATE client_follow_ups', 'UPDATE consumer_follow_ups');
  s := replace(s, 'FROM client_invite_tokens', 'FROM consumer_invite_tokens');
  s := replace(s, 'INTO client_invite_tokens', 'INTO consumer_invite_tokens');
  s := replace(s, 'UPDATE client_invite_tokens', 'UPDATE consumer_invite_tokens');
  s := replace(s, 'FROM clients', 'FROM consumers');
  s := replace(s, 'INTO clients', 'INTO consumers');
  s := replace(s, 'UPDATE clients', 'UPDATE consumers');
  s := replace(s, 'JOIN clients', 'JOIN consumers');
  s := replace(s, 'search_path = public, firm, crm', 'search_path = public, provider, consumer, crm');
  s := replace(s, 'search_path = public, crm, firm', 'search_path = public, crm, provider, consumer');
  s := replace(s, 'search_path = public, firm', 'search_path = public, provider, consumer');
  s := replace(s, 'SET search_path = firm, public', 'SET search_path = provider, public');
  s := replace(s, 'SET search_path = public, firm', 'SET search_path = public, provider');
  s := replace(s, ' (firm.', ' (provider.');
  s := replace(s, ' firm.', ' provider.');
  s := replace(s, ',firm.', ',provider.');
  s := replace(s, E'\nfirm.', E'\nprovider.');
  s := replace(s, E'\tfirm.', E'\tprovider.');

  s := replace(s, 'p_firm_verification_url', 'p_provider_verification_url');
  s := replace(s, 'p_firm_space_id', 'p_provider_space_id');
  s := replace(s, 'p_firm_client_id', 'p_consumer_id');
  s := replace(s, 'p_client_space_id', 'p_consumer_space_id');
  s := replace(s, 'p_client_user_id', 'p_consumer_user_id');
  s := replace(s, 'p_client_id', 'p_consumer_id');
  s := replace(s, 'out_firm_space_id', 'out_provider_space_id');
  s := replace(s, 'out_client_space_id', 'out_consumer_space_id');
  s := replace(s, 'out_firm_client_id', 'out_consumer_id');
  s := replace(s, 'clients_space_id', 'consumer_space_id');
  s := replace(s, 'firm_space_id', 'provider_space_id');
  s := replace(s, 'client_space_id', 'consumer_space_id');
  s := replace(s, 'firm_client_id', 'consumer_id');
  s := replace(s, 'invitee_client_name', 'invitee_consumer_name');
  s := replace(s, 'invitee_client_id', 'invitee_consumer_id');
  s := replace(s, 'firm_confirmed_at', 'provider_confirmed_at');
  s := replace(s, 'client_confirmed_at', 'consumer_confirmed_at');
  s := replace(s, 'hidden_from_client_at', 'hidden_from_consumer_at');
  s := replace(s, 'max_clients', 'max_consumers');
  s := replace(s, 'client_recognition_monthly_usage', 'consumer_recognition_monthly_usage');
  s := replace(s, 'client_id', 'consumer_id');
  s := replace(s, '''firm''', '''provider''');
  s := replace(s, '''client''', '''consumer''');
  RETURN s;
END;
$$;

DO $$
DECLARE
  rec RECORD;
  stmt text;
  roles_txt text;
BEGIN
  CREATE TEMP TABLE _overlay_fn (
    nsp text,
    name text,
    args text,
    newdef text
  ) ON COMMIT DROP;

  CREATE TEMP TABLE _overlay_trg (
    def text
  ) ON COMMIT DROP;

  CREATE TEMP TABLE _overlay_pol (
    schemaname name,
    tablename name,
    policyname name,
    permissive text,
    roles name[],
    cmd text,
    qual text,
    with_check text
  ) ON COMMIT DROP;

  INSERT INTO _overlay_fn (nsp, name, args, newdef)
  SELECT n.nspname,
         p.proname,
         pg_get_function_identity_arguments(p.oid),
         pg_temp.overlay_rewrite_ident(pg_get_functiondef(p.oid))
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'provider', 'crm')
    AND p.prokind = 'f'
    AND p.proname <> 'overlay_rewrite_ident'
    AND pg_temp.overlay_rewrite_ident(pg_get_functiondef(p.oid)) IS DISTINCT FROM pg_get_functiondef(p.oid);

  INSERT INTO _overlay_trg (def)
  SELECT pg_get_triggerdef(t.oid, true)
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE NOT t.tgisinternal
    AND n.nspname IN ('public', 'provider', 'crm', 'consumer')
    AND EXISTS (
      SELECT 1 FROM _overlay_fn f
      WHERE f.nsp = (SELECT n2.nspname FROM pg_namespace n2 JOIN pg_proc p2 ON p2.pronamespace = n2.oid WHERE p2.oid = t.tgfoid)
        AND f.name = p.proname
        AND f.args = pg_get_function_identity_arguments(p.oid)
    );

  INSERT INTO _overlay_pol (schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check)
  SELECT pol.schemaname, pol.tablename, pol.policyname, pol.permissive, pol.roles, pol.cmd, pol.qual, pol.with_check
  FROM pg_policies pol
  WHERE pol.schemaname IN ('public', 'provider', 'consumer', 'crm', 'storage')
    AND (
      coalesce(pol.qual, '') ~ 'firm|''client'''
      OR coalesce(pol.with_check, '') ~ 'firm|''client'''
      OR coalesce(pol.qual, '') LIKE '%client_space_id%'
      OR coalesce(pol.qual, '') LIKE '%firm_space_id%'
      OR coalesce(pol.with_check, '') LIKE '%client_space_id%'
      OR coalesce(pol.with_check, '') LIKE '%firm_space_id%'
    );

  FOR rec IN SELECT * FROM _overlay_fn
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', rec.nsp, rec.name, rec.args);
  END LOOP;

  PERFORM set_config('check_function_bodies', 'off', true);

  FOR rec IN SELECT * FROM _overlay_fn
  ORDER BY CASE nsp WHEN 'provider' THEN 0 WHEN 'crm' THEN 1 ELSE 2 END, name
  LOOP
    BEGIN
      EXECUTE rec.newdef;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'recreate failed for %.%(%) : %', rec.nsp, rec.name, rec.args, SQLERRM;
    END;
  END LOOP;

  FOR rec IN SELECT * FROM _overlay_trg
  LOOP
    BEGIN
      EXECUTE pg_temp.overlay_rewrite_ident(rec.def);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END LOOP;

  FOR rec IN SELECT * FROM _overlay_pol
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', rec.policyname, rec.schemaname, rec.tablename);
    roles_txt := array_to_string(rec.roles, ', ');
    IF roles_txt IS NULL OR roles_txt = '' THEN
      roles_txt := 'public';
    END IF;
    stmt := format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
      rec.policyname,
      rec.schemaname,
      rec.tablename,
      CASE WHEN rec.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
      CASE WHEN rec.cmd = '*' THEN 'ALL' ELSE rec.cmd END,
      roles_txt
    );
    IF rec.qual IS NOT NULL THEN
      stmt := stmt || format(' USING (%s)', pg_temp.overlay_rewrite_ident(rec.qual));
    END IF;
    IF rec.with_check IS NOT NULL THEN
      stmt := stmt || format(' WITH CHECK (%s)', pg_temp.overlay_rewrite_ident(rec.with_check));
    END IF;
    EXECUTE stmt;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5) Kernel create_space_core
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_space_core(TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.create_space_core(
  p_space_name TEXT,
  p_space_address TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_kind TEXT DEFAULT 'consumer'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_space_id UUID;
  v_kind TEXT;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_kind := COALESCE(NULLIF(TRIM(LOWER(p_kind)), ''), 'consumer');
  IF v_kind NOT IN ('provider', 'consumer') THEN
    RAISE EXCEPTION 'kind must be provider or consumer';
  END IF;

  INSERT INTO public.spaces (name, address, kind)
  VALUES (
    p_space_name,
    NULLIF(TRIM(COALESCE(p_space_address, '')), ''),
    v_kind
  )
  RETURNING id INTO v_space_id;

  INSERT INTO public.user_spaces (user_id, space_id, is_admin)
  VALUES (v_user_id, v_space_id, true)
  ON CONFLICT DO NOTHING;

  UPDATE public.users
  SET current_space_id = v_space_id
  WHERE id = v_user_id;

  RETURN v_space_id;
END;
$$;

COMMENT ON FUNCTION public.create_space_core(TEXT, TEXT, UUID, TEXT) IS
  'Platform: insert spaces + user_spaces + current_space_id. p_kind is provider | consumer.';

GRANT EXECUTE ON FUNCTION public.create_space_core(TEXT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_space_core(TEXT, TEXT, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
