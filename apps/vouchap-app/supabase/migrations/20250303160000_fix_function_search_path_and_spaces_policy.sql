-- 修复 Supabase 安全顾问告警：
-- 1) function_search_path_mutable：为所有被点名的函数设置 search_path
-- 2) rls_policy_always_true：spaces_insert_policy 的 WITH CHECK (true) 改为显式约束
-- 说明：auth_leaked_password_protection 需在 Supabase Dashboard → Authentication → Settings 中开启

-- =============================================================================
-- 1. 为函数设置 search_path（按 schema 使用 public 或 firm, public）
-- =============================================================================
DO $$
DECLARE
  r RECORD;
  sp TEXT;
  func_names TEXT[] := ARRAY[
    'get_user_current_household_id', 'update_all_category_usage_counts', 'update_all_purpose_usage_counts',
    'increment_category_usage', 'increment_purpose_usage', 'get_user_space_ids', 'update_all_account_usage_counts',
    'expire_old_invitations', 'get_user_household_id', 'create_default_categories', 'create_default_purposes',
    'update_usage_counts_on_item_change', 'get_current_user_email', 'is_household_admin', 'get_user_current_space_id',
    'update_account_usage_on_receipt_or_invoice_change', 'create_default_accounts', 'check_household_has_admin',
    'update_all_payment_account_usage_counts', 'increment_payment_account_usage', 'update_payment_account_usage_on_receipt_change',
    'get_user_space_id', 'update_updated_at_column', 'is_space_admin', 'check_space_has_admin'
  ];
  firm_func_names TEXT[] := ARRAY['set_client_last_follow_up_at'];
BEGIN
  -- public schema 函数
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = ANY(func_names)
  LOOP
    EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path = public', r.nspname, r.proname, r.args);
  END LOOP;

  -- firm schema 函数
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'firm' AND p.proname = ANY(firm_func_names)
  LOOP
    EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path = firm, public', r.nspname, r.proname, r.args);
  END LOOP;
END $$;

-- =============================================================================
-- 2. spaces_insert_policy：去掉 WITH CHECK (true)，改为显式约束
--    仅允许已认证用户插入，且 kind 必须为合法值（client/firm）
-- =============================================================================
DROP POLICY IF EXISTS "spaces_insert_policy" ON public.spaces;

CREATE POLICY "spaces_insert_policy" ON public.spaces
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND kind IN ('client', 'firm')
  );

COMMENT ON POLICY "spaces_insert_policy" ON public.spaces IS
  '已认证用户可创建 space；kind 仅允许 client/firm（新用户注册时尚未有 space，故不进一步限制）';
