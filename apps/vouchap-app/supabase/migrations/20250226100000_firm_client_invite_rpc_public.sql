-- 供前端 supabase.rpc() 调用的 public 层 RPC（默认查 public schema）
-- 依赖：firm.client_invite_tokens 表存在（见 create-firm-open-invite.sql）；
--      若使用 accept，需已存在 firm.accept_client_invite_token。

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
