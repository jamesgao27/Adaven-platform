-- 仍报 42501 时的兜底：为 public 角色添加 INSERT 策略
-- PostgreSQL 中所有角色默认属于 public，故该策略对所有请求角色生效（含 anon、authenticated 等）。
-- 若请求实际以 anon 或其它未单独建策的角色发出，此策略可让插入通过。
-- 约束：仅允许 kind IN ('client','firm')，与业务一致。

DROP POLICY IF EXISTS "spaces_insert_public" ON public.spaces;
CREATE POLICY "spaces_insert_public" ON public.spaces
  FOR INSERT
  TO public
  WITH CHECK (kind IN ('client', 'firm'));

COMMENT ON POLICY "spaces_insert_public" ON public.spaces IS
  '兜底：允许所有角色（含 anon）插入 spaces，仅限 kind=client|firm。若仅用 RPC 创建可考虑移除 anon 的 GRANT';

-- 若请求以 anon 发出，还需表级 INSERT 权限
GRANT INSERT ON public.spaces TO anon;
