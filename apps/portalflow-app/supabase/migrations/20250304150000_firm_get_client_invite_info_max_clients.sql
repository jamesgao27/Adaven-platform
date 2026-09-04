-- 与 Invite history 中 Inactive 一致：落地页仅对「有效」邀请返回信息
-- 有效 = is_active AND 未过期 AND 未达人数上限
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
    AND (t.expires_at IS NULL OR t.expires_at > now())
    AND (t.max_clients IS NULL OR t.current_clients < t.max_clients);
$$;

COMMENT ON FUNCTION public.firm_get_client_invite_info(text) IS
  '根据 client_invite token 返回邀请信息（仅当有效：is_active、未过期、未达人数上限）';
