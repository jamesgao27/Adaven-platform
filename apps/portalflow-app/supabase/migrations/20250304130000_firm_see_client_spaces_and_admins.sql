-- Firm 侧客户列表中需展示：客户 space、space 名称、该 space 管理员的名称和 email。
-- 为 public.spaces、public.user_spaces、public.users 增加「该 firm 的所有成员可见其 clients 表中的 client space 及该 space 成员」的 SELECT 授权。
-- 条件：当前用户在某个 firm_space_id 的 user_spaces 中（即该 firm 的成员），且 firm.clients 存在 (firm_space_id, client_space_id) 指向该 space。
-- 「可见自己」：user_spaces 用 user_id = auth.uid()，spaces 用 EXISTS 查 user_spaces，避免自引用；users 同 space 用 DEFINER 函数。

-- =============================================================================
-- 0. 辅助函数（仅 users 同 space 策略需要，避免自引用 user_spaces）
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

-- 当前用户所在 firm 是否可查看某 client_space_id（DEFINER 避免 user_spaces 策略内再查 user_spaces 导致 42P17 递归）
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

-- =============================================================================
-- 1. public.spaces：firm 可 SELECT 其客户对应的 space（用于显示空间名称等）
-- =============================================================================
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.spaces'::regclass) THEN
    ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "spaces_select_own" ON public.spaces FOR SELECT TO authenticated
      USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.space_id = spaces.id AND us.user_id = auth.uid()));
  END IF;
END $$;

DROP POLICY IF EXISTS "spaces_select_firm_client_spaces" ON public.spaces;
CREATE POLICY "spaces_select_firm_client_spaces" ON public.spaces
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      JOIN firm.clients c ON c.firm_space_id = us.space_id AND c.client_space_id = spaces.id
      WHERE us.user_id = auth.uid()
    )
  );

COMMENT ON POLICY "spaces_select_firm_client_spaces" ON public.spaces IS
  '该 firm 的所有成员可查看其 clients 表中客户对应的 space（用于客户列表显示空间名称）';

-- =============================================================================
-- 2. public.user_spaces：firm 可 SELECT 其客户 space 的成员关系（用于找到管理员/联系人）
-- =============================================================================
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_spaces'::regclass) THEN
    ALTER TABLE public.user_spaces ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "user_spaces_select_own" ON public.user_spaces FOR SELECT TO authenticated
      USING (auth.uid() IS NOT NULL AND user_id = auth.uid());
  END IF;
END $$;

DROP POLICY IF EXISTS "user_spaces_select_firm_client_spaces" ON public.user_spaces;
CREATE POLICY "user_spaces_select_firm_client_spaces" ON public.user_spaces
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND user_spaces.space_id IS NOT NULL
    AND public.auth_user_firm_can_see_client_space(user_spaces.space_id)
  );

COMMENT ON POLICY "user_spaces_select_firm_client_spaces" ON public.user_spaces IS
  '该 firm 的所有成员可查看其客户 space 的 user_spaces（用于获取联系人/管理员 user_id）';

-- =============================================================================
-- 3. public.users：firm 可 SELECT 其客户 space 成员的 id/name/email（用于显示联系人名称和 email）
-- =============================================================================
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.users'::regclass) THEN
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "users_select_self" ON public.users FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND id = auth.uid());
    CREATE POLICY "users_select_same_space" ON public.users FOR SELECT TO authenticated
      USING (public.auth_user_can_see_user(users.id));
  END IF;
END $$;

DROP POLICY IF EXISTS "users_select_firm_client_members" ON public.users;
CREATE POLICY "users_select_firm_client_members" ON public.users
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      JOIN firm.clients c ON c.firm_space_id = us.space_id
      JOIN public.user_spaces client_members ON client_members.space_id = c.client_space_id AND client_members.user_id = users.id
      WHERE us.user_id = auth.uid()
    )
  );

COMMENT ON POLICY "users_select_firm_client_members" ON public.users IS
  '该 firm 的所有成员可查看其客户 space 内成员的 id/name/email（用于客户列表显示联系人名称与邮箱）';

-- 确保 authenticated 对三张表有 SELECT 权限（RLS 再按策略过滤）
GRANT SELECT ON public.spaces TO authenticated;
GRANT SELECT ON public.user_spaces TO authenticated;
GRANT SELECT ON public.users TO authenticated;
