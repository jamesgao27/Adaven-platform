-- 供前端 supabase.rpc() 调用的 public 层 RPC（默认查 public schema）
-- Fresh Portalflow: create invite token table (originally from create-firm-open-invite.sql).

CREATE TABLE IF NOT EXISTS firm.client_invite_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_space_id uuid NOT NULL,
  token text NOT NULL UNIQUE,
  inviter_user_id uuid NOT NULL,
  sku_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  max_clients int,
  current_clients int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_client_invite_tokens_firm_space
  ON firm.client_invite_tokens (firm_space_id);

CREATE INDEX IF NOT EXISTS idx_client_invite_tokens_active
  ON firm.client_invite_tokens (is_active)
  WHERE is_active = true;


-- 1) 根据 token 文本查询邀请信息，供 auth/setup 页展示 firm 名等
CREATE OR REPLACE FUNCTION public.firm_get_client_invite_info(p_token text)
RETURNS TABLE (
  firm_space_id uuid,
  firm_name text,
  inviter_user_id uuid,
  sku_id uuid,
  token_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = firm, public
STABLE
AS $$
  SELECT
    t.firm_space_id,
    s.name AS firm_name,
    t.inviter_user_id,
    t.sku_id,
    t.id AS token_id
  FROM firm.client_invite_tokens t
  LEFT JOIN public.spaces s ON s.id = t.firm_space_id
  WHERE t.token = p_token
    AND t.is_active = true
    AND (t.expires_at IS NULL OR t.expires_at > now());
$$;

COMMENT ON FUNCTION public.firm_get_client_invite_info(text) IS
  '根据 client_invite token 文本返回邀请信息（firm 名等），供 client 端 auth/setup 使用';

CREATE OR REPLACE FUNCTION firm.accept_client_invite_token(
  p_token text,
  p_client_space_id uuid,
  p_client_user_id uuid
)
RETURNS TABLE (
  firm_space_id uuid,
  client_space_id uuid,
  inviter_user_id uuid,
  sku_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = firm, public
AS $$
BEGIN
  RAISE EXCEPTION 'firm.accept_client_invite_token is installed by a later migration';
END;
$$;

-- 2) 包装 firm.accept_client_invite_token，前端统一调用 public.firm_accept_client_invite_token
CREATE OR REPLACE FUNCTION public.firm_accept_client_invite_token(
  p_token text,
  p_client_space_id uuid,
  p_client_user_id uuid
)
RETURNS TABLE (
  firm_space_id uuid,
  client_space_id uuid,
  inviter_user_id uuid,
  sku_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = firm, public
AS $$
  SELECT
    a.firm_space_id,
    a.client_space_id,
    a.inviter_user_id,
    a.sku_id
  FROM firm.accept_client_invite_token(
    p_token,
    p_client_space_id,
    p_client_user_id
  ) a;
$$;

COMMENT ON FUNCTION public.firm_accept_client_invite_token(text, uuid, uuid) IS
  '消费 client 邀请 token，建立 firm–client 关系并创建订单；包装 firm.accept_client_invite_token';
