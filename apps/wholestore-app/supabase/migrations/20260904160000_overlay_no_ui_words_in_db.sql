-- Wholestore overlay: SQL identifiers are provider/consumer only.
-- Vendor / Dealer / Factory are product UI words, not table/column/RPC names.
-- Do not apply on live Vouchap (giuacjbfsyrristkigmz).

-- ---------------------------------------------------------------------------
-- 1) Tables + column
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS provider.dealer_follow_ups RENAME TO consumer_follow_ups;
ALTER TABLE IF EXISTS provider.dealer_invite_tokens RENAME TO consumer_invite_tokens;
ALTER TABLE IF EXISTS provider.consumer_invite_tokens RENAME COLUMN max_dealers TO max_consumers;

COMMENT ON TABLE provider.consumer_follow_ups IS
  'Follow-ups on a provider.consumers enrollment (Wholestore UI: Dealer).';
COMMENT ON TABLE provider.consumer_invite_tokens IS
  'Open invite tokens for enrolling a consumer space with a provider space.';
COMMENT ON COLUMN provider.consumer_invite_tokens.max_consumers IS
  'Max consumer enrollments for this token; null = unlimited.';

-- ---------------------------------------------------------------------------
-- 2) Rewrite function names, params, OUT columns, and bodies
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.overlay_rewrite_ident(src text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  s text := src;
BEGIN
  s := replace(s, 'list_marketplace_factory_posters', 'list_marketplace_provider_posters');
  s := replace(s, 'get_marketplace_factory_poster', 'get_marketplace_provider_poster');
  s := replace(s, 'list_store_skus_for_factory', 'list_store_skus_for_provider');
  s := replace(s, 'ensure_factory_default_poster', 'ensure_provider_default_poster');
  s := replace(s, 'dealer_apply_to_factory', 'consumer_apply_to_provider');
  s := replace(s, 'create_dealer_with_space', 'create_consumer_with_space');
  s := replace(s, 'list_pending_dealers_for_me', 'list_pending_consumers_for_me');
  s := replace(s, 'claim_pending_dealer', 'claim_pending_consumer');
  s := replace(s, 'dealer_open_invite_joined_counts', 'provider_open_invite_joined_counts');
  s := replace(s, 'dealer_get_invite_info', 'provider_get_consumer_invite_info');
  s := replace(s, 'dealer_accept_invite_token', 'provider_accept_consumer_invite_token');
  s := replace(s, 'set_dealer_last_follow_up_at', 'set_consumer_last_follow_up_at');
  s := replace(s, 'dealer_invite_tokens', 'consumer_invite_tokens');
  s := replace(s, 'dealer_follow_ups', 'consumer_follow_ups');
  s := replace(s, 'max_dealers', 'max_consumers');
  s := replace(s, 'p_dealer_name', 'p_consumer_name');
  s := replace(s, 'factory_name', 'provider_name');
  s := replace(s, 'dealer_name', 'consumer_name');
  s := replace(s, 'per_factory', 'per_provider');
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
  WHERE n.nspname IN ('public', 'provider', 'consumer')
    AND p.prokind = 'f'
    AND p.proname <> 'overlay_rewrite_ident'
    AND (
      p.proname ILIKE '%dealer%'
      OR p.proname ILIKE '%factory%'
      OR pg_get_functiondef(p.oid) LIKE '%dealer_follow_ups%'
      OR pg_get_functiondef(p.oid) LIKE '%dealer_invite_tokens%'
      OR pg_get_functiondef(p.oid) LIKE '%max_dealers%'
      OR pg_get_functiondef(p.oid) LIKE '%p_dealer_name%'
      OR pg_get_functiondef(p.oid) LIKE '%factory_name%'
      OR pg_get_functiondef(p.oid) LIKE '%dealer_name%'
      OR pg_get_functiondef(p.oid) LIKE '%create_dealer%'
      OR pg_get_functiondef(p.oid) LIKE '%dealer_apply%'
      OR pg_get_functiondef(p.oid) LIKE '%per_factory%'
    );

  INSERT INTO _overlay_trg (def)
  SELECT pg_get_triggerdef(t.oid, true)
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE NOT t.tgisinternal
    AND n.nspname IN ('public', 'provider', 'consumer')
    AND EXISTS (
      SELECT 1 FROM _overlay_fn f
      WHERE f.nsp = (SELECT n2.nspname FROM pg_namespace n2 JOIN pg_proc p2 ON p2.pronamespace = n2.oid WHERE p2.oid = t.tgfoid)
        AND f.name = p.proname
        AND f.args = pg_get_function_identity_arguments(p.oid)
    );

  INSERT INTO _overlay_pol (schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check)
  SELECT pol.schemaname, pol.tablename, pol.policyname, pol.permissive, pol.roles, pol.cmd, pol.qual, pol.with_check
  FROM pg_policies pol
  WHERE pol.schemaname IN ('public', 'provider', 'consumer', 'storage');

  FOR rec IN SELECT * FROM _overlay_fn
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', rec.nsp, rec.name, rec.args);
  END LOOP;

  PERFORM set_config('check_function_bodies', 'off', true);

  FOR rec IN SELECT * FROM _overlay_fn
  ORDER BY CASE nsp WHEN 'provider' THEN 0 ELSE 1 END, name
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

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA provider TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.provider_open_invite_joined_counts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.provider_get_consumer_invite_info(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_accept_consumer_invite_token(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_provider_default_poster(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Leftover dealer/factory object names
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.overlay_uiword_to_kind(src text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text := src;
BEGIN
  s := pg_temp.overlay_rewrite_ident(src);
  s := replace(s, 'dealer_', 'consumer_');
  s := replace(s, 'factory_', 'provider_');
  RETURN s;
END;
$$;

DO $$
DECLARE
  rec RECORD;
  new_name text;
BEGIN
  FOR rec IN
    SELECT n.nspname, c.relname AS table_name, con.conname
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('provider', 'public', 'consumer')
      AND con.conname IS DISTINCT FROM pg_temp.overlay_uiword_to_kind(con.conname)
  LOOP
    new_name := pg_temp.overlay_uiword_to_kind(rec.conname);
    IF new_name = rec.conname THEN CONTINUE; END IF;
    IF EXISTS (
      SELECT 1 FROM pg_constraint con2
      JOIN pg_class c2 ON c2.oid = con2.conrelid
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = rec.nspname AND c2.relname = rec.table_name AND con2.conname = new_name
    ) THEN CONTINUE; END IF;
    EXECUTE format(
      'ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I',
      rec.nspname, rec.table_name, rec.conname, new_name
    );
  END LOOP;

  FOR rec IN
    SELECT n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('provider', 'public', 'consumer')
      AND c.relkind = 'i'
      AND c.relname IS DISTINCT FROM pg_temp.overlay_uiword_to_kind(c.relname)
  LOOP
    new_name := pg_temp.overlay_uiword_to_kind(rec.relname);
    IF new_name = rec.relname THEN CONTINUE; END IF;
    IF EXISTS (
      SELECT 1 FROM pg_class c2
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = rec.nspname AND c2.relname = new_name
    ) THEN CONTINUE; END IF;
    EXECUTE format('ALTER INDEX %I.%I RENAME TO %I', rec.nspname, rec.relname, new_name);
  END LOOP;

  FOR rec IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname IN ('provider', 'public', 'consumer')
      AND policyname IS DISTINCT FROM pg_temp.overlay_uiword_to_kind(policyname)
  LOOP
    new_name := pg_temp.overlay_uiword_to_kind(rec.policyname);
    IF new_name = rec.policyname THEN CONTINUE; END IF;
    IF EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = rec.schemaname AND p.tablename = rec.tablename AND p.policyname = new_name
    ) THEN CONTINUE; END IF;
    EXECUTE format(
      'ALTER POLICY %I ON %I.%I RENAME TO %I',
      rec.policyname, rec.schemaname, rec.tablename, new_name
    );
  END LOOP;

  FOR rec IN
    SELECT n.nspname, c.relname AS table_name, t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND n.nspname IN ('provider', 'public', 'consumer')
      AND t.tgname IS DISTINCT FROM pg_temp.overlay_uiword_to_kind(t.tgname)
  LOOP
    new_name := pg_temp.overlay_uiword_to_kind(rec.tgname);
    IF new_name = rec.tgname THEN CONTINUE; END IF;
    IF EXISTS (
      SELECT 1 FROM pg_trigger t2
      JOIN pg_class c2 ON c2.oid = t2.tgrelid
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = rec.nspname AND c2.relname = rec.table_name AND t2.tgname = new_name
    ) THEN CONTINUE; END IF;
    EXECUTE format(
      'ALTER TRIGGER %I ON %I.%I RENAME TO %I',
      rec.tgname, rec.nspname, rec.table_name, new_name
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
