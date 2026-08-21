-- 注册 Firm 空间：审核状态与验证机构附件
-- 1. spaces 增加 firm_status、verification_attachment_url（仅 kind=firm 时使用）
-- 2. 创建/扩展 create_space_with_user，支持 p_kind、p_firm_verification_url；创建 firm 后由客户端调用 apply_preset_skus_to_firm

-- =============================================================================
-- 1. spaces 表新增列
-- =============================================================================
ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS firm_status TEXT
    CHECK (firm_status IS NULL OR firm_status IN ('pending', 'approved'));

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS verification_attachment_url TEXT;

COMMENT ON COLUMN public.spaces.firm_status IS
  'Firm 审核状态：pending 待审核，approved 已开通。仅 kind=firm 时有效；NULL 表示 client 或未设';
COMMENT ON COLUMN public.spaces.verification_attachment_url IS
  '验证机构附件 URL（如执业资格证等）。注册 firm 时必填，审核用';

-- 仅当 kind=firm 时 firm_status 应有值（业务约束，不在 DB 强制）
-- 新注册 firm 默认为 pending，审核通过后更新为 approved

-- =============================================================================
-- 2. create_space_with_user：支持 kind 与 firm 验证附件
--    若已有 3 参数版本则先删除再创建 5 参数版本（带默认值，兼容只传 3 参数）
-- =============================================================================
DROP FUNCTION IF EXISTS public.create_space_with_user(TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.create_space_with_user(
  p_space_name TEXT,
  p_space_address TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_kind TEXT DEFAULT 'client',
  p_firm_verification_url TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_space_id UUID;
  v_kind TEXT;
  v_firm_status TEXT;
  v_verification_url TEXT;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_kind := COALESCE(NULLIF(TRIM(LOWER(p_kind)), ''), 'client');
  IF v_kind NOT IN ('client', 'firm') THEN
    RAISE EXCEPTION 'kind must be client or firm';
  END IF;

  IF v_kind = 'firm' THEN
    IF p_firm_verification_url IS NULL OR TRIM(p_firm_verification_url) = '' THEN
      RAISE EXCEPTION 'Firm registration requires verification attachment URL';
    END IF;
    v_firm_status := 'pending';
    v_verification_url := TRIM(p_firm_verification_url);
  ELSE
    v_firm_status := NULL;
    v_verification_url := NULL;
  END IF;

  INSERT INTO public.spaces (name, address, kind, firm_status, verification_attachment_url)
  VALUES (
    p_space_name,
    NULLIF(TRIM(p_space_address), ''),
    v_kind,
    v_firm_status,
    v_verification_url
  )
  RETURNING id INTO v_space_id;

  INSERT INTO public.user_spaces (user_id, space_id, is_admin)
  VALUES (v_user_id, v_space_id, true)
  ON CONFLICT DO NOTHING;

  UPDATE public.users
  SET current_space_id = v_space_id
  WHERE id = v_user_id;

  RETURN v_space_id;
END;
$$;

COMMENT ON FUNCTION public.create_space_with_user(TEXT, TEXT, UUID, TEXT, TEXT) IS
  '创建空间并加入当前用户为管理员。kind=firm 时必传 p_firm_verification_url，firm_status 设为 pending；创建后客户端需调用 apply_preset_skus_to_firm 复制预设 SKU';
