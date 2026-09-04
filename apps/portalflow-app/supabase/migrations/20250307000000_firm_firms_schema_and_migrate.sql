-- Firm 状态与证明文件迁入 firm schema：public.spaces 仅保留 kind，firm 专属数据入 firm.firms
-- 1. 新建 firm.firms（space_id PK，status，verification_attachment_url）
-- 2. 从 public.spaces 迁移已有 firm 数据到 firm.firms
-- 3. 重写 create_space_with_user：spaces 不再写 firm 列，kind=firm 时写入 firm.firms
-- 4. 删除 public.spaces 的 firm_status、verification_attachment_url 列
-- 5. firm.firms RLS：已认证用户仅可读其所在 space 对应的行

SET search_path = public, firm;

-- =============================================================================
-- 1. 创建 firm.firms 表
-- =============================================================================
CREATE TABLE IF NOT EXISTS firm.firms (
  space_id UUID PRIMARY KEY REFERENCES public.spaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  verification_attachment_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE firm.firms IS 'Firm 扩展信息：审核状态与证明文件。与 public.spaces 一对一（space_id），名称/地址仅存于 spaces';
COMMENT ON COLUMN firm.firms.status IS '审核状态：pending 待审核，approved 已开通';
COMMENT ON COLUMN firm.firms.verification_attachment_url IS '验证机构附件 URL（如执业资格证等）';

-- 若当前库已有 firm_status/verification_attachment_url，先迁移再删列
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'spaces' AND column_name = 'firm_status'
  ) THEN
    INSERT INTO firm.firms (space_id, status, verification_attachment_url)
    SELECT id, COALESCE(NULLIF(TRIM(firm_status), ''), 'pending'), verification_attachment_url
    FROM public.spaces
    WHERE kind = 'provider'
    ON CONFLICT (space_id) DO UPDATE SET
      status = EXCLUDED.status,
      verification_attachment_url = EXCLUDED.verification_attachment_url,
      updated_at = now();
  END IF;
END $$;

-- =============================================================================
-- 2. RLS：firm.firms 仅允许成员读本 firm 行
-- =============================================================================
ALTER TABLE firm.firms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "firm_firms_select_member" ON firm.firms;
CREATE POLICY "firm_firms_select_member" ON firm.firms
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.firms.space_id AND us.user_id = auth.uid()
    )
  );

-- 普通 authenticated 不可直接 INSERT/UPDATE，仅通过 RPC（definer）或 service_role
DROP POLICY IF EXISTS "firm_firms_insert_authenticated" ON firm.firms;
CREATE POLICY "firm_firms_insert_authenticated" ON firm.firms
  FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "firm_firms_update_authenticated" ON firm.firms;
CREATE POLICY "firm_firms_update_authenticated" ON firm.firms
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

-- postgres（create_space_with_user 的 definer）可 INSERT
DROP POLICY IF EXISTS "firm_firms_insert_postgres" ON firm.firms;
CREATE POLICY "firm_firms_insert_postgres" ON firm.firms FOR INSERT TO postgres WITH CHECK (true);
DROP POLICY IF EXISTS "firm_firms_update_postgres" ON firm.firms;
CREATE POLICY "firm_firms_update_postgres" ON firm.firms FOR UPDATE TO postgres USING (true) WITH CHECK (true);

-- service_role 可写（审核时更新 status、后台脚本等）
DROP POLICY IF EXISTS "firm_firms_all_service_role" ON firm.firms;
CREATE POLICY "firm_firms_all_service_role" ON firm.firms FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 3. 重写 create_space_with_user：spaces 不写 firm 列，kind=firm 时写 firm.firms
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_space_with_user(
  p_space_name TEXT,
  p_space_address TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_kind TEXT DEFAULT 'consumer',
  p_firm_verification_url TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_user_id UUID;
  v_space_id UUID;
  v_kind TEXT;
  v_verification_url TEXT;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_kind := COALESCE(NULLIF(TRIM(LOWER(p_kind)), ''), 'client');
  IF v_kind NOT IN ('consumer', 'provider') THEN
    RAISE EXCEPTION 'kind must be consumer or provider';
  END IF;

  IF v_kind = 'provider' THEN
    IF p_firm_verification_url IS NULL OR TRIM(p_firm_verification_url) = '' THEN
      RAISE EXCEPTION 'Firm registration requires verification attachment URL';
    END IF;
    v_verification_url := TRIM(p_firm_verification_url);
  ELSE
    v_verification_url := NULL;
  END IF;

  INSERT INTO public.spaces (name, address, kind)
  VALUES (
    p_space_name,
    NULLIF(TRIM(p_space_address), ''),
    v_kind
  )
  RETURNING id INTO v_space_id;

  IF v_kind = 'provider' THEN
    INSERT INTO firm.firms (space_id, status, verification_attachment_url)
    VALUES (v_space_id, 'pending', v_verification_url);
  END IF;

  INSERT INTO public.user_spaces (user_id, space_id, is_admin)
  VALUES (v_user_id, v_space_id, true)
  ON CONFLICT DO NOTHING;

  UPDATE public.users
  SET current_space_id = v_space_id
  WHERE id = v_user_id;

  IF v_kind = 'provider' THEN
    PERFORM firm.apply_preset_skus_to_firm(v_space_id);
  END IF;

  RETURN v_space_id;
END;
$$;

COMMENT ON FUNCTION public.create_space_with_user(TEXT, TEXT, UUID, TEXT, TEXT) IS
  '创建空间并加入当前用户为管理员。kind=firm 时必传 p_firm_verification_url，写入 firm.firms 并复制 preset_skus';

-- =============================================================================
-- 4. 从 public.spaces 删除 firm 专属列
-- =============================================================================
ALTER TABLE public.spaces DROP COLUMN IF EXISTS firm_status;
ALTER TABLE public.spaces DROP COLUMN IF EXISTS verification_attachment_url;
