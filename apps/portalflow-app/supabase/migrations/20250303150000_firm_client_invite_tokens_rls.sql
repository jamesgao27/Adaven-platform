-- 为 firm.client_invite_tokens 启用 RLS，修复 Supabase 安全告警：
-- - rls_disabled_in_public
-- - sensitive_columns_exposed (token 列)
-- 策略：仅允许属于该 firm space 的成员对该表进行 SELECT/INSERT/UPDATE。

ALTER TABLE firm.client_invite_tokens ENABLE ROW LEVEL SECURITY;

-- 仅 firm 成员可查看本 space 的邀请记录（含 token，用于复制链接）
CREATE POLICY firm_client_invite_tokens_select ON firm.client_invite_tokens
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );

-- 仅 firm 成员可创建邀请（需在对应 firm space 内）
CREATE POLICY firm_client_invite_tokens_insert ON firm.client_invite_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );

-- 仅 firm 成员可更新本 space 的邀请（如切换 is_active）
CREATE POLICY firm_client_invite_tokens_update ON firm.client_invite_tokens
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );

-- 仅 firm 成员可删除本 space 的邀请（可选，便于清理）
CREATE POLICY firm_client_invite_tokens_delete ON firm.client_invite_tokens
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );

COMMENT ON TABLE firm.client_invite_tokens IS 'Firm 端：开放邀请 token，RLS 限制仅 firm space 成员可访问';
