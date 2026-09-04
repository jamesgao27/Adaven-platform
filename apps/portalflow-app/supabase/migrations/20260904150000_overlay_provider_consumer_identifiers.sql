-- Portalflow overlay identifiers → Wholestore provider/consumer vocabulary.
-- Empty project: rename in place. Do not apply on live Vouchap (giuacjbfsyrristkigmz).
-- Product UI copy stays Firm/Client. Extra Portalflow tables (sku_items, groups, …) stay.

-- ---------------------------------------------------------------------------
-- 1) Schema + leftover table
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE firm.invitee_clients;
EXCEPTION
  WHEN undefined_table OR undefined_object THEN NULL;
END $$;
DROP TABLE IF EXISTS firm.invitee_clients CASCADE;

ALTER SCHEMA firm RENAME TO provider;

-- ---------------------------------------------------------------------------
-- 2) Tables
-- ---------------------------------------------------------------------------
ALTER TABLE provider.firms RENAME TO providers;
ALTER TABLE provider.clients RENAME TO consumers;
ALTER TABLE provider.client_follow_ups RENAME TO dealer_follow_ups;
ALTER TABLE provider.client_invite_tokens RENAME TO dealer_invite_tokens;
ALTER TABLE provider.group_clients RENAME TO group_consumers;

-- ---------------------------------------------------------------------------
-- 3) Columns (provider + public.projects)
-- ---------------------------------------------------------------------------
ALTER TABLE provider.consumers RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE provider.consumers RENAME COLUMN client_space_id TO consumer_space_id;
ALTER TABLE provider.consumers RENAME COLUMN invitee_client_name TO invitee_consumer_name;

ALTER TABLE provider.dealer_follow_ups RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE provider.dealer_follow_ups RENAME COLUMN client_space_id TO consumer_space_id;
ALTER TABLE provider.dealer_follow_ups RENAME COLUMN client_id TO consumer_id;

ALTER TABLE provider.dealer_invite_tokens RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE provider.dealer_invite_tokens RENAME COLUMN max_clients TO max_dealers;

ALTER TABLE provider.group_consumers RENAME COLUMN client_id TO consumer_id;

ALTER TABLE provider.group_invitees RENAME COLUMN invitee_client_id TO invitee_consumer_id;

ALTER TABLE provider.groups RENAME COLUMN firm_space_id TO provider_space_id;

ALTER TABLE provider.order_labels RENAME COLUMN firm_space_id TO provider_space_id;

ALTER TABLE provider.order_managers RENAME COLUMN firm_space_id TO provider_space_id;

ALTER TABLE provider.orders RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE provider.orders RENAME COLUMN client_space_id TO consumer_space_id;
ALTER TABLE provider.orders RENAME COLUMN client_id TO consumer_id;
ALTER TABLE provider.orders RENAME COLUMN firm_confirmed_at TO provider_confirmed_at;
ALTER TABLE provider.orders RENAME COLUMN client_confirmed_at TO consumer_confirmed_at;
ALTER TABLE provider.orders RENAME COLUMN hidden_from_client_at TO hidden_from_consumer_at;

ALTER TABLE provider.permission_role_members RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE provider.permission_role_scope RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE provider.permission_roles RENAME COLUMN firm_space_id TO provider_space_id;

ALTER TABLE provider.skus RENAME COLUMN firm_space_id TO provider_space_id;

ALTER TABLE public.projects RENAME COLUMN firm_space_id TO provider_space_id;
ALTER TABLE public.projects RENAME COLUMN client_space_id TO consumer_space_id;

ALTER TABLE crm.client_recognition_monthly_usage RENAME TO consumer_recognition_monthly_usage;

-- ---------------------------------------------------------------------------
-- 4) consumer schema (space-level extras, Wholestore-compatible)
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

COMMENT ON TABLE consumer.consumers IS
  'Consumer-space extras (Portalflow UI: Client). Enrollment with a Firm lives in provider.consumers.';

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

-- ---------------------------------------------------------------------------
-- 5) Grants on renamed provider schema
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA provider TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA provider TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA provider TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA provider TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA provider GRANT ALL ON TABLES TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Rename functions whose names still say firm/client (keeps OID → triggers)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rec RECORD;
  new_name text;
BEGIN
  FOR rec IN
    SELECT p.oid,
           n.nspname,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'provider', 'crm')
      AND p.prokind = 'f'
      AND (
        p.proname ILIKE '%firm%'
        OR p.proname ILIKE '%client%'
      )
  LOOP
    new_name := rec.proname;
    new_name := replace(new_name, 'apply_preset_skus_to_firm', 'apply_preset_skus_to_provider');
    new_name := replace(new_name, 'assert_firm_can_confirm_engagement', 'assert_provider_can_confirm_engagement');
    new_name := replace(new_name, 'assert_firm_can_create_engagement', 'assert_provider_can_create_engagement');
    new_name := replace(new_name, 'auth_user_firm_can_see_client_space', 'auth_user_provider_can_see_consumer_space');
    new_name := replace(new_name, 'auth_user_can_select_sku_as_engaged_client', 'auth_user_can_select_sku_as_engaged_consumer');
    new_name := replace(new_name, 'auth_user_is_client_space_member', 'auth_user_is_consumer_space_member');
    new_name := replace(new_name, 'can_access_client', 'can_access_consumer');
    new_name := replace(new_name, 'client_create_onboarding_order_from_published_sku', 'consumer_create_onboarding_order_from_published_sku');
    new_name := replace(new_name, 'enforce_marketplace_order_firm_confirmation', 'enforce_marketplace_order_provider_confirmation');
    new_name := replace(new_name, 'hide_order_for_client', 'hide_order_for_consumer');
    new_name := replace(new_name, 'unhide_order_for_client', 'unhide_order_for_consumer');
    new_name := replace(new_name, 'link_client_to_user_groups', 'link_consumer_to_user_groups');
    new_name := replace(new_name, 'list_published_skus_for_client_catalog', 'list_published_skus_for_consumer_catalog');
    new_name := replace(new_name, 'migrate_pending_orders_to_client_space', 'migrate_pending_orders_to_consumer_space');
    new_name := replace(new_name, 'set_client_last_follow_up_at', 'set_consumer_last_follow_up_at');
    new_name := replace(new_name, 'touch_client', 'touch_consumer');
    new_name := replace(new_name, 'on_user_spaces_promote_firm_admin', 'on_user_spaces_promote_provider_admin');
    new_name := replace(new_name, '_client_can_preview_sku', '_consumer_can_preview_sku');
    new_name := replace(new_name, 'firm_accept_client_invite_token', 'provider_accept_consumer_invite_token');
    new_name := replace(new_name, 'firm_get_client_invite_info', 'provider_get_consumer_invite_info');
    new_name := replace(new_name, 'accept_client_invite_token', 'accept_consumer_invite_token');
    new_name := replace(new_name, 'firm_bootstrap_admin_group', 'provider_bootstrap_admin_group');
    new_name := replace(new_name, 'firm_create_client_on_behalf', 'provider_create_consumer_on_behalf');
    new_name := replace(new_name, 'firm_create_invitee_only', 'provider_create_invitee_only');
    new_name := replace(new_name, 'firm_create_pending_order_for_invitee', 'provider_create_pending_order_for_invitee');
    new_name := replace(new_name, 'firm_get_client_invite_info', 'provider_get_consumer_invite_info');
    new_name := replace(new_name, 'firm_open_invite_joined_counts', 'provider_open_invite_joined_counts');
    new_name := replace(new_name, 'get_firm_sku_items_preview_for_order_client', 'get_provider_sku_items_preview_for_order_consumer');
    new_name := replace(new_name, 'get_firm_sku_preview_for_order_client', 'get_provider_sku_preview_for_order_consumer');
    new_name := replace(new_name, 'get_firm_sku_items_preview_for_client', 'get_provider_sku_items_preview_for_consumer');
    new_name := replace(new_name, 'get_firm_sku_preview_for_client', 'get_provider_sku_preview_for_consumer');
    new_name := replace(new_name, 'get_client_recognition_quota', 'get_consumer_recognition_quota');
    new_name := replace(new_name, 'record_client_recognition_success', 'record_consumer_recognition_success');
    new_name := replace(new_name, 'trg_firm_order_grant_client_signing_credits', 'trg_provider_order_grant_consumer_signing_credits');
    new_name := replace(new_name, 'user_may_act_for_client_space', 'user_may_act_for_consumer_space');
    new_name := replace(new_name, 'apply_client_tag_presets_to_space', 'apply_consumer_tag_presets_to_space');

    IF new_name IS DISTINCT FROM rec.proname THEN
      EXECUTE format(
        'ALTER FUNCTION %I.%I(%s) RENAME TO %I',
        rec.nspname, rec.proname, rec.args, new_name
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 7) Rewrite function bodies (identifiers after physical rename)
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
  s := replace(s, 'link_client_to_user_groups', 'link_consumer_to_user_groups');
  s := replace(s, 'list_published_skus_for_client_catalog', 'list_published_skus_for_consumer_catalog');
  s := replace(s, 'migrate_pending_orders_to_client_space', 'migrate_pending_orders_to_consumer_space');
  s := replace(s, 'set_client_last_follow_up_at', 'set_consumer_last_follow_up_at');
  s := replace(s, 'touch_client', 'touch_consumer');
  s := replace(s, 'on_user_spaces_promote_firm_admin', 'on_user_spaces_promote_provider_admin');
  s := replace(s, '_client_can_preview_sku', '_consumer_can_preview_sku');
  s := replace(s, 'accept_client_invite_token', 'accept_consumer_invite_token');
  s := replace(s, 'firm_bootstrap_admin_group', 'provider_bootstrap_admin_group');
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
  s := replace(s, 'firm_accept_client_invite_token', 'provider_accept_consumer_invite_token');
  s := replace(s, 'firm_get_client_invite_info', 'provider_get_consumer_invite_info');
  s := replace(s, 'firm_accept_consumer_invite_token', 'provider_accept_consumer_invite_token');
  s := replace(s, 'firm_get_consumer_invite_info', 'provider_get_consumer_invite_info');

  s := replace(s, 'crm.client_recognition_monthly_usage', 'crm.consumer_recognition_monthly_usage');
  s := replace(s, 'firm.firms', 'provider.providers');
  s := replace(s, 'firm.clients', 'provider.consumers');
  s := replace(s, 'firm.client_follow_ups', 'provider.dealer_follow_ups');
  s := replace(s, 'firm.client_invite_tokens', 'provider.dealer_invite_tokens');
  s := replace(s, 'firm.group_clients', 'provider.group_consumers');
  s := replace(s, 'FROM firms', 'FROM providers');
  s := replace(s, 'INTO firms', 'INTO providers');
  s := replace(s, 'UPDATE firms', 'UPDATE providers');
  s := replace(s, 'JOIN firms', 'JOIN providers');
  s := replace(s, 'FROM clients', 'FROM consumers');
  s := replace(s, 'INTO clients', 'INTO consumers');
  s := replace(s, 'UPDATE clients', 'UPDATE consumers');
  s := replace(s, 'JOIN clients', 'JOIN consumers');
  s := replace(s, 'FROM client_follow_ups', 'FROM dealer_follow_ups');
  s := replace(s, 'INTO client_follow_ups', 'INTO dealer_follow_ups');
  s := replace(s, 'UPDATE client_follow_ups', 'UPDATE dealer_follow_ups');
  s := replace(s, 'FROM client_invite_tokens', 'FROM dealer_invite_tokens');
  s := replace(s, 'INTO client_invite_tokens', 'INTO dealer_invite_tokens');
  s := replace(s, 'UPDATE client_invite_tokens', 'UPDATE dealer_invite_tokens');
  s := replace(s, 'FROM group_clients', 'FROM group_consumers');
  s := replace(s, 'INTO group_clients', 'INTO group_consumers');
  s := replace(s, 'UPDATE group_clients', 'UPDATE group_consumers');
  s := replace(s, 'JOIN group_clients', 'JOIN group_consumers');
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
  s := replace(s, 'firm_space_id', 'provider_space_id');
  s := replace(s, 'client_space_id', 'consumer_space_id');
  s := replace(s, 'firm_client_id', 'consumer_id');
  s := replace(s, 'invitee_client_name', 'invitee_consumer_name');
  s := replace(s, 'invitee_client_id', 'invitee_consumer_id');
  s := replace(s, 'firm_confirmed_at', 'provider_confirmed_at');
  s := replace(s, 'client_confirmed_at', 'consumer_confirmed_at');
  s := replace(s, 'hidden_from_client_at', 'hidden_from_consumer_at');
  s := replace(s, 'max_clients', 'max_dealers');
  s := replace(s, '''client_recognition''', '''consumer_recognition''');
  s := replace(s, 'client_recognition_monthly_usage', 'consumer_recognition_monthly_usage');
  s := replace(s, 'client_id', 'consumer_id');
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
    AND (
      pg_get_functiondef(p.oid) LIKE '%firm.%'
      OR pg_get_functiondef(p.oid) LIKE '%firm_space_id%'
      OR pg_get_functiondef(p.oid) LIKE '%client_space_id%'
      OR pg_get_functiondef(p.oid) LIKE '%p_firm_%'
      OR pg_get_functiondef(p.oid) LIKE '%client_recognition%'
      OR pg_get_functiondef(p.oid) LIKE '%client_id%'
      OR pg_get_functiondef(p.oid) LIKE '%firm_client%'
      OR pg_get_functiondef(p.oid) LIKE '%max_clients%'
      OR pg_get_functiondef(p.oid) LIKE '%invitee_client%'
      OR pg_get_functiondef(p.oid) LIKE '%firm_confirmed%'
      OR pg_get_functiondef(p.oid) LIKE '%client_confirmed%'
      OR pg_get_functiondef(p.oid) LIKE '%hidden_from_client%'
      OR pg_get_functiondef(p.oid) LIKE '%apply_preset_skus_to_firm%'
      OR pg_get_functiondef(p.oid) LIKE '%search_path = public, firm%'
    );

  INSERT INTO _overlay_trg (def)
  SELECT pg_get_triggerdef(t.oid, true)
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE NOT t.tgisinternal
    AND n.nspname IN ('public', 'provider', 'crm')
    AND EXISTS (
      SELECT 1 FROM _overlay_fn f
      WHERE f.nsp = (SELECT n2.nspname FROM pg_namespace n2 JOIN pg_proc p2 ON p2.pronamespace = n2.oid WHERE p2.oid = t.tgfoid)
        AND f.name = p.proname
        AND f.args = pg_get_function_identity_arguments(p.oid)
    );

  INSERT INTO _overlay_pol (schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check)
  SELECT pol.schemaname, pol.tablename, pol.policyname, pol.permissive, pol.roles, pol.cmd, pol.qual, pol.with_check
  FROM pg_policies pol
  WHERE pol.schemaname IN ('public', 'provider', 'crm', 'storage');

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
        RAISE EXCEPTION 'overlay recreate failed for %.%(%) : %', rec.nsp, rec.name, rec.args, SQLERRM;
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
    IF EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = rec.schemaname
        AND p.tablename = rec.tablename
        AND p.policyname = rec.policyname
    ) THEN
      CONTINUE;
    END IF;
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
    BEGIN
      EXECUTE stmt;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN OTHERS THEN
        RAISE EXCEPTION 'overlay policy % on %.% failed: %', rec.policyname, rec.schemaname, rec.tablename, SQLERRM;
    END;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.create_space_with_user(TEXT, TEXT, UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_space_with_user(
  p_space_name TEXT,
  p_space_address TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_kind TEXT DEFAULT 'consumer',
  p_provider_verification_url TEXT DEFAULT NULL,
  p_client_profile_type TEXT DEFAULT 'household'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider, consumer, crm
AS $$
DECLARE
  v_user_id UUID;
  v_space_id UUID;
  v_kind TEXT;
  v_verification_url TEXT;
  v_client_profile_type TEXT;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_kind := COALESCE(NULLIF(TRIM(LOWER(p_kind)), ''), 'consumer');
  IF v_kind NOT IN ('consumer', 'provider') THEN
    RAISE EXCEPTION 'kind must be consumer or provider';
  END IF;

  v_client_profile_type := COALESCE(NULLIF(TRIM(LOWER(p_client_profile_type)), ''), 'household');
  IF v_client_profile_type NOT IN ('household', 'business') THEN
    RAISE EXCEPTION 'client_profile_type must be household or business';
  END IF;

  IF v_kind = 'provider' THEN
    IF p_provider_verification_url IS NULL OR TRIM(p_provider_verification_url) = '' THEN
      RAISE EXCEPTION 'Firm registration requires verification attachment URL';
    END IF;
    v_verification_url := TRIM(p_provider_verification_url);
  ELSE
    v_verification_url := NULL;
  END IF;

  v_space_id := public.create_space_core(p_space_name, p_space_address, v_user_id, v_kind);

  UPDATE public.spaces
  SET client_profile_type = CASE
    WHEN v_kind = 'consumer' THEN v_client_profile_type
    ELSE 'household'
  END
  WHERE id = v_space_id;

  IF v_kind = 'provider' THEN
    INSERT INTO provider.providers (space_id, status, verification_attachment_url)
    VALUES (v_space_id, 'pending', v_verification_url);
    PERFORM provider.apply_preset_skus_to_provider(v_space_id);
    PERFORM public.provider_bootstrap_admin_group(v_space_id, v_user_id);
  ELSE
    INSERT INTO consumer.consumers (space_id, status)
    VALUES (v_space_id, 'approved')
    ON CONFLICT (space_id) DO NOTHING;
    PERFORM crm.apply_consumer_tag_presets_to_space(v_space_id, v_client_profile_type);
  END IF;

  RETURN v_space_id;
END;
$$;

COMMENT ON FUNCTION public.create_space_with_user(TEXT, TEXT, UUID, TEXT, TEXT, TEXT) IS
  'Portalflow product wrapper: create_space_core then provider.providers / consumer.consumers + presets.';

GRANT EXECUTE ON FUNCTION public.create_space_with_user(TEXT, TEXT, UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_space_with_user(TEXT, TEXT, UUID, TEXT, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 8) PostgREST exposed schemas
-- ---------------------------------------------------------------------------
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, crm, provider, consumer';
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
