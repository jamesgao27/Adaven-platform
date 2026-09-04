-- Overlay identifiers: UI words (Firm/Client, Vendor/Dealer) stay in the product layer.
-- Database objects use provider / consumer only. Do not apply on live Vouchap.

-- ---------------------------------------------------------------------------
-- 1) Tables + column that still said dealer (Wholestore UI vocabulary)
-- ---------------------------------------------------------------------------
ALTER TABLE provider.dealer_follow_ups RENAME TO consumer_follow_ups;
ALTER TABLE provider.dealer_invite_tokens RENAME TO consumer_invite_tokens;
ALTER TABLE provider.consumer_invite_tokens RENAME COLUMN max_dealers TO max_consumers;

COMMENT ON TABLE provider.consumer_follow_ups IS
  'Follow-ups on a provider.consumers enrollment (Portalflow UI: Client).';
COMMENT ON TABLE provider.consumer_invite_tokens IS
  'Open invite tokens for enrolling a consumer space with a provider space.';
COMMENT ON COLUMN provider.consumer_invite_tokens.max_consumers IS
  'Max consumer enrollments for this token; null = unlimited.';

-- ---------------------------------------------------------------------------
-- 2) Function bodies still referencing dealer_* identifiers
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rec RECORD;
  newdef text;
BEGIN
  PERFORM set_config('check_function_bodies', 'off', true);
  FOR rec IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'provider', 'crm', 'consumer')
      AND p.prokind = 'f'
      AND (
        pg_get_functiondef(p.oid) LIKE '%dealer_follow_ups%'
        OR pg_get_functiondef(p.oid) LIKE '%dealer_invite_tokens%'
        OR pg_get_functiondef(p.oid) LIKE '%max_dealers%'
      )
  LOOP
    newdef := rec.def;
    newdef := replace(newdef, 'dealer_invite_tokens', 'consumer_invite_tokens');
    newdef := replace(newdef, 'dealer_follow_ups', 'consumer_follow_ups');
    newdef := replace(newdef, 'max_dealers', 'max_consumers');
    IF newdef IS DISTINCT FROM rec.def THEN
      EXECUTE newdef;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Rename leftover firm/client/dealer constraint, index, policy, trigger names
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.overlay_uiword_to_kind(src text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text := src;
BEGIN
  s := replace(s, 'client_profile_type', E'\x01CPT\x01');
  s := replace(s, 'confirmation', E'\x01CONF\x01');
  s := replace(s, 'confirmed', E'\x01CFD\x01');

  s := replace(s, 'dealer_invite_tokens', 'consumer_invite_tokens');
  s := replace(s, 'dealer_follow_ups', 'consumer_follow_ups');
  s := replace(s, 'max_dealers', 'max_consumers');
  s := replace(s, 'client_invite_tokens', 'consumer_invite_tokens');
  s := replace(s, 'client_follow_ups', 'consumer_follow_ups');
  s := replace(s, 'client_recognition_monthly_usage', 'consumer_recognition_monthly_usage');
  s := replace(s, 'firm_client_follow_ups', 'consumer_follow_ups');
  s := replace(s, 'firm_client_invite_tokens', 'consumer_invite_tokens');
  s := replace(s, 'firm_clients', 'provider_consumers');
  s := replace(s, 'firm_client_', 'consumer_');
  s := replace(s, 'member_clients', 'order_managers');
  s := replace(s, 'group_clients', 'group_consumers');
  s := replace(s, 'firm_orders', 'provider_orders');
  s := replace(s, 'firm_sku_items', 'provider_sku_items');
  s := replace(s, 'firm_skus', 'provider_skus');
  s := replace(s, 'firm_preset_sku_items', 'preset_template_items');
  s := replace(s, 'firm_preset_order_labels', 'preset_template_labels');
  s := replace(s, 'firm_preset_skus', 'preset_templates');
  s := replace(s, 'firm_group_invitees', 'provider_group_invitees');
  s := replace(s, 'firm_group_members', 'provider_group_members');
  s := replace(s, 'firm_groups', 'provider_groups');
  s := replace(s, 'firm_order_labels', 'provider_order_labels');
  s := replace(s, 'firm_firms', 'provider_providers');
  s := replace(s, 'firm_space_id', 'provider_space_id');
  s := replace(s, 'client_space_id', 'consumer_space_id');
  s := replace(s, 'engaged_client', 'engaged_consumer');
  s := replace(s, '_firm_admin', '_provider_admin');
  s := replace(s, '_firm_members', '_provider_members');
  s := replace(s, 'select_firm_client', 'select_provider_consumer');
  s := replace(s, 'via_order_firm', 'via_order_provider');
  s := replace(s, 'engaged_firm', 'engaged_provider');
  s := replace(s, 'promote_firm_admin', 'promote_provider_admin');
  s := replace(s, 'idx_firm_', 'idx_provider_');
  s := replace(s, 'idx_public_projects_firm_space', 'idx_public_projects_provider_space');
  s := replace(s, 'idx_public_projects_client_space', 'idx_public_projects_consumer_space');
  s := replace(s, 'idx_client_recognition', 'idx_consumer_recognition');
  s := replace(s, 'firms_', 'providers_');
  s := replace(s, 'clients_', 'consumers_');
  s := replace(s, 'firm_', 'provider_');
  s := replace(s, 'client_', 'consumer_');
  s := replace(s, 'dealer_', 'consumer_');
  s := replace(s, '_firm', '_provider');
  s := replace(s, '_client', '_consumer');
  s := replace(s, '_dealer', '_consumer');

  s := replace(s, E'\x01CPT\x01', 'client_profile_type');
  s := replace(s, E'\x01CONF\x01', 'confirmation');
  s := replace(s, E'\x01CFD\x01', 'confirmed');
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
    WHERE n.nspname IN ('provider', 'public', 'crm', 'consumer')
      AND con.conname IS DISTINCT FROM pg_temp.overlay_uiword_to_kind(con.conname)
  LOOP
    new_name := pg_temp.overlay_uiword_to_kind(rec.conname);
    IF new_name = rec.conname THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_constraint con2
      JOIN pg_class c2 ON c2.oid = con2.conrelid
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = rec.nspname AND c2.relname = rec.table_name AND con2.conname = new_name
    ) THEN
      CONTINUE;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I',
      rec.nspname, rec.table_name, rec.conname, new_name
    );
  END LOOP;

  FOR rec IN
    SELECT n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('provider', 'public', 'crm', 'consumer')
      AND c.relkind = 'i'
      AND c.relname IS DISTINCT FROM pg_temp.overlay_uiword_to_kind(c.relname)
  LOOP
    new_name := pg_temp.overlay_uiword_to_kind(rec.relname);
    IF new_name = rec.relname THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_class c2
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = rec.nspname AND c2.relname = new_name
    ) THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER INDEX %I.%I RENAME TO %I', rec.nspname, rec.relname, new_name);
  END LOOP;

  FOR rec IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname IN ('provider', 'public', 'crm', 'consumer')
      AND policyname IS DISTINCT FROM pg_temp.overlay_uiword_to_kind(policyname)
  LOOP
    new_name := pg_temp.overlay_uiword_to_kind(rec.policyname);
    IF new_name = rec.policyname THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = rec.schemaname
        AND p.tablename = rec.tablename
        AND p.policyname = new_name
    ) THEN
      CONTINUE;
    END IF;
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
      AND n.nspname IN ('provider', 'public', 'crm', 'consumer')
      AND t.tgname IS DISTINCT FROM pg_temp.overlay_uiword_to_kind(t.tgname)
  LOOP
    new_name := pg_temp.overlay_uiword_to_kind(rec.tgname);
    IF new_name = rec.tgname THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_trigger t2
      JOIN pg_class c2 ON c2.oid = t2.tgrelid
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = rec.nspname AND c2.relname = rec.table_name AND t2.tgname = new_name
    ) THEN
      CONTINUE;
    END IF;
    EXECUTE format(
      'ALTER TRIGGER %I ON %I.%I RENAME TO %I',
      rec.tgname, rec.nspname, rec.table_name, new_name
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
