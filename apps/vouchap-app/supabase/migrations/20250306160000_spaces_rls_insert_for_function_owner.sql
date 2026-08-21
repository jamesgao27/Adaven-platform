-- 为 create_space_with_user 的实际所有者添加 spaces INSERT 策略
-- 若 RPC 仍报 42501，说明执行 INSERT 的角色可能不是 postgres/supabase_admin，本迁移为其补策略

DO $$
DECLARE
  owner_name text;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO owner_name
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'create_space_with_user';

  IF owner_name IS NOT NULL AND owner_name NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    EXECUTE 'DROP POLICY IF EXISTS "spaces_insert_definer_owner" ON public.spaces';
    EXECUTE format(
      'CREATE POLICY "spaces_insert_definer_owner" ON public.spaces FOR INSERT TO %I WITH CHECK (true)',
      owner_name
    );
    RAISE NOTICE 'Created spaces INSERT policy for function owner: %', owner_name;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'spaces_rls_insert_for_function_owner: %', SQLERRM;
END $$;
