-- 一次性修复 spaces 表 42501：清除所有 INSERT 策略后重建，确保无残留策略拦截
-- 请在 Supabase SQL Editor 中执行本迁移（或整段 SQL）

-- =============================================================================
-- 1. 删除 spaces 上所有现有的 INSERT 策略（按已知名称）
-- =============================================================================
DROP POLICY IF EXISTS "spaces_insert_policy" ON public.spaces;
DROP POLICY IF EXISTS "spaces_insert_definer" ON public.spaces;
DROP POLICY IF EXISTS "spaces_insert_supabase_admin" ON public.spaces;
DROP POLICY IF EXISTS "spaces_insert_service_role" ON public.spaces;

-- =============================================================================
-- 2. 重建：仅保留两条 INSERT 策略
-- =============================================================================
-- 2a. 已认证用户（前端直接 INSERT 或 API 带 JWT 请求）
CREATE POLICY "spaces_insert_policy" ON public.spaces
  FOR INSERT TO authenticated WITH CHECK (true);

-- 2b. 函数所有者与后端（RPC create_space_with_user 为 SECURITY DEFINER）
CREATE POLICY "spaces_insert_definer" ON public.spaces
  FOR INSERT TO postgres WITH CHECK (true);

CREATE POLICY "spaces_insert_service_role" ON public.spaces
  FOR INSERT TO service_role WITH CHECK (true);

-- supabase_admin（Cloud 上常见函数所有者；本地无此角色可忽略报错）
DO $$
BEGIN
  CREATE POLICY "spaces_insert_supabase_admin" ON public.spaces
    FOR INSERT TO supabase_admin WITH CHECK (true);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- =============================================================================
-- 3. 表级权限
-- =============================================================================
GRANT INSERT ON public.spaces TO authenticated;
