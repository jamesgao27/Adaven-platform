-- 修复创建 firm 时报错 42501：new row violates row-level security policy for table "spaces"
-- 原因：create_space_with_user 为 SECURITY DEFINER，其内 INSERT INTO spaces 以函数所有者（postgres）执行，
--       现有策略仅 TO authenticated，postgres 无匹配策略故被拒。
-- 处理：为 postgres / service_role 增加 INSERT 策略，使 RPC 内插入通过；authenticated 仍走原策略（直接插入兜底）。

-- =============================================================================
-- spaces：允许函数所有者（postgres）与 service_role 插入，供 create_space_with_user 使用
-- =============================================================================
DROP POLICY IF EXISTS "spaces_insert_definer" ON public.spaces;
CREATE POLICY "spaces_insert_definer" ON public.spaces
  FOR INSERT
  TO postgres
  WITH CHECK (true);

-- Supabase Cloud 中函数所有者常为 supabase_admin（本地可能无此角色，故用 DO 忽略失败）
DO $$
BEGIN
  DROP POLICY IF EXISTS "spaces_insert_supabase_admin" ON public.spaces;
  CREATE POLICY "spaces_insert_supabase_admin" ON public.spaces
    FOR INSERT TO supabase_admin WITH CHECK (true);
EXCEPTION WHEN OTHERS THEN
  NULL; -- 角色不存在或无权时跳过（本地无 supabase_admin 时）
END $$;

DROP POLICY IF EXISTS "spaces_insert_service_role" ON public.spaces;
CREATE POLICY "spaces_insert_service_role" ON public.spaces
  FOR INSERT
  TO service_role
  WITH CHECK (true);

COMMENT ON POLICY "spaces_insert_definer" ON public.spaces IS
  '供 SECURITY DEFINER 的 create_space_with_user 在 RPC 内插入 spaces（postgres 为常见函数所有者）';
COMMENT ON POLICY "spaces_insert_service_role" ON public.spaces IS
  '供 service_role 插入 spaces（如后台/迁移场景）';
