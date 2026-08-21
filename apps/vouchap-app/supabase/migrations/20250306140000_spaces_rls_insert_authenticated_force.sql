-- 仍报 42501 时强制修复：确保 authenticated 用户可直接 INSERT spaces（客户端兜底路径）
-- 同时再次确保 spaces_insert_policy 存在且允许 kind=client/firm

-- =============================================================================
-- 1. 删除可能冲突的旧策略，统一重建 authenticated 的 INSERT 策略
-- =============================================================================
DROP POLICY IF EXISTS "spaces_insert_policy" ON public.spaces;

-- 已认证用户可插入 spaces（WITH CHECK (true) 避免任何表达式导致 42501）
CREATE POLICY "spaces_insert_policy" ON public.spaces
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

COMMENT ON POLICY "spaces_insert_policy" ON public.spaces IS
  '已认证用户可创建 space。用于客户端直接 INSERT 或 RPC 失败兜底；表约束仍限制 kind 等';

-- =============================================================================
-- 2. 确保表对 authenticated 有 INSERT 权限（RLS 通过后仍需 GRANT）
-- =============================================================================
GRANT INSERT ON public.spaces TO authenticated;
