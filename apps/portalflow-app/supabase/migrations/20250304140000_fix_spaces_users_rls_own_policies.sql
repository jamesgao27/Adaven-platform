-- 修复 20250304130000 导致的登录后跳 setup space 问题：
-- user_spaces 的「可见自己」策略在 USING 中再次查询 user_spaces，产生自引用，导致无法看到自己的 user_spaces。
-- 方案：user_spaces 直接允许 user_id = auth.uid()，无子查询；spaces 用 EXISTS 查 user_spaces（此时已能看见自己的行，无递归）；
-- users 的「同 space」仍用 SECURITY DEFINER 函数避免自引用。

-- =============================================================================
-- 1. 辅助函数：当前用户是否可查看指定用户（自己 或 同 space），供 users 策略用
--    auth.uid() 为 NULL 时直接返回 false，避免 RLS 上下文无 JWT 时报错
-- =============================================================================
CREATE OR REPLACE FUNCTION public.auth_user_can_see_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.uid() IS NOT NULL)
    AND (
      p_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.user_spaces a, public.user_spaces b
        WHERE a.user_id = auth.uid() AND b.user_id = p_user_id AND a.space_id = b.space_id
      )
    );
$$;

COMMENT ON FUNCTION public.auth_user_can_see_user(uuid) IS
  'RLS 策略用：判断当前用户是否可查看目标用户（本人或同 space）';

-- =============================================================================
-- 1b. 辅助函数：当前用户所在 firm 是否可查看某 client_space_id（供 user_spaces 策略用，避免策略内再查 user_spaces 导致递归）
-- =============================================================================
CREATE OR REPLACE FUNCTION public.auth_user_firm_can_see_client_space(p_client_space_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, firm
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_spaces us
    JOIN firm.clients c ON c.firm_space_id = us.space_id AND c.client_space_id = p_client_space_id
    WHERE us.user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.auth_user_firm_can_see_client_space(uuid) IS
  'RLS 策略用：当前用户是否在某个 firm 中且该 firm 的 clients 包含目标 client_space_id（DEFINER 避免 user_spaces 自引用递归）';

-- =============================================================================
-- 2. user_spaces：仅用 user_id = auth.uid()，无自引用；auth.uid() 为 NULL 时不通过
-- =============================================================================
DROP POLICY IF EXISTS "user_spaces_select_own" ON public.user_spaces;
CREATE POLICY "user_spaces_select_own" ON public.user_spaces
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- 用 DEFINER 函数替代策略内直接查 user_spaces，消除 42P17 递归
DROP POLICY IF EXISTS "user_spaces_select_firm_client_spaces" ON public.user_spaces;
CREATE POLICY "user_spaces_select_firm_client_spaces" ON public.user_spaces
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND user_spaces.space_id IS NOT NULL
    AND public.auth_user_firm_can_see_client_space(user_spaces.space_id)
  );

-- =============================================================================
-- 3. spaces：可见「自己所在的 space」，子查询读 user_spaces 时已能看见自己的行，无递归
-- =============================================================================
DROP POLICY IF EXISTS "spaces_select_own" ON public.spaces;
CREATE POLICY "spaces_select_own" ON public.spaces
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = spaces.id AND us.user_id = auth.uid()
    )
  );

-- =============================================================================
-- 4. users：同 space 可见仍用 DEFINER 函数（需读他人 user_spaces）
-- =============================================================================
DROP POLICY IF EXISTS "users_select_same_space" ON public.users;
CREATE POLICY "users_select_same_space" ON public.users
  FOR SELECT TO authenticated
  USING (public.auth_user_can_see_user(users.id));

-- =============================================================================
-- 5. 策略注释改为「该 firm 的所有成员」可见
-- =============================================================================
COMMENT ON POLICY "spaces_select_firm_client_spaces" ON public.spaces IS
  '该 firm 的所有成员可查看其 clients 表中客户对应的 space（用于客户列表显示空间名称）';

COMMENT ON POLICY "user_spaces_select_firm_client_spaces" ON public.user_spaces IS
  '该 firm 的所有成员可查看其客户 space 的 user_spaces（用于获取联系人/管理员 user_id）';

COMMENT ON POLICY "users_select_firm_client_members" ON public.users IS
  '该 firm 的所有成员可查看其客户 space 内成员的 id/name/email（用于客户列表显示联系人名称与邮箱）';

-- =============================================================================
-- 6. 确保 authenticated 对三张表有 SELECT 权限（RLS 再按策略过滤行）
-- =============================================================================
GRANT SELECT ON public.spaces TO authenticated;
GRANT SELECT ON public.user_spaces TO authenticated;
GRANT SELECT ON public.users TO authenticated;
