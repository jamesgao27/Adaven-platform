-- =============================================================================
-- 查看「同名 client space 有多条、且该空间尚无 user」的情况
-- 在 Supabase Dashboard -> SQL Editor 中运行。
-- =============================================================================

-- 1) 按 space 名称分组，只看出现次数 >= 2 的名称（重复的 space 名）
SELECT
  s.name,
  COUNT(*) AS space_count,
  array_agg(s.id ORDER BY s.created_at) AS space_ids,
  array_agg(s.created_at ORDER BY s.created_at) AS created_ats
FROM public.spaces s
WHERE s.kind = 'consumer'
GROUP BY s.name
HAVING COUNT(*) >= 2
ORDER BY space_count DESC;

-- 2) 对每个「重复名称」的 space_id，看 user_spaces 是否有成员（客户接受邀请后才有）
--    若下面结果为空或只有 firm 成员的 member_clients 对应、没有该 space 的 user_spaces，
--    说明该 client space 尚无真实用户加入
SELECT
  s.id AS space_id,
  s.name,
  s.kind,
  s.created_at,
  (SELECT COUNT(*) FROM public.user_spaces us WHERE us.space_id = s.id) AS user_count
FROM public.spaces s
WHERE s.kind = 'consumer'
  AND s.name IN (
    SELECT name FROM public.spaces WHERE kind = 'consumer' GROUP BY name HAVING COUNT(*) >= 2
  )
ORDER BY s.name, s.created_at;

-- 3) 这些 client space 在 firm 侧的关联：clients、邀请
SELECT
  s.id AS client_space_id,
  s.name AS space_name,
  c.firm_space_id,
  c.created_client_name AS client_created_client_name,
  si.id AS invitation_id,
  si.invitee_email,
  si.status AS invitation_status
FROM public.spaces s
LEFT JOIN firm.clients c ON c.client_space_id = s.id
LEFT JOIN public.space_invitations si ON si.space_id = s.id
WHERE s.kind = 'consumer'
  AND s.name IN (
    SELECT name FROM public.spaces WHERE kind = 'consumer' GROUP BY name HAVING COUNT(*) >= 2
  )
ORDER BY s.name, s.created_at;

-- =============================================================================
-- 可选：若确认要删除「重复的」其中一条 space（保留一条，删另一条）
-- 先根据上面结果选定要删的 client_space_id，再按顺序执行下面（取消注释并替换 UUID）
-- 注意：会级联删除 space_invitations、firm.clients、firm.member_clients 等关联
-- =============================================================================
/*
-- 要删除的 client space id（请替换为实际 id）
DO $$
DECLARE
  v_client_space_id UUID := 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
BEGIN
  DELETE FROM public.space_invitations WHERE space_id = v_client_space_id;
  DELETE FROM firm.member_clients WHERE client_space_id = v_client_space_id;
  DELETE FROM firm.clients WHERE client_space_id = v_client_space_id;
  -- 如有 orders 等其它引用 client_space_id 的表，也需先删
  DELETE FROM public.spaces WHERE id = v_client_space_id;
END $$;
*/
