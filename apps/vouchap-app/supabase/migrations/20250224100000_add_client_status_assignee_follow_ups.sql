-- Client 增加：状态、负责人、最近跟进时间；跟进记录表
-- 依赖：20250224000000_add_space_kind_and_firm_schema.sql

-- 1. firm.clients 增加 status、assigned_user_id、last_follow_up_at
ALTER TABLE firm.clients
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'pending'));

ALTER TABLE firm.clients
  ADD COLUMN IF NOT EXISTS assigned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE firm.clients
  ADD COLUMN IF NOT EXISTS last_follow_up_at TIMESTAMPTZ;

COMMENT ON COLUMN firm.clients.status IS '客户状态：active 在服，inactive 停服，pending 待开通';
COMMENT ON COLUMN firm.clients.assigned_user_id IS '负责人（主对接人）';
COMMENT ON COLUMN firm.clients.last_follow_up_at IS '最近一次跟进时间，由跟进记录更新';

CREATE INDEX IF NOT EXISTS idx_firm_clients_assigned ON firm.clients(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_firm_clients_status ON firm.clients(status);

-- 2. firm.client_follow_ups：客户跟进记录
CREATE TABLE IF NOT EXISTS firm.client_follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  client_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_firm_client_follow_ups_firm ON firm.client_follow_ups(firm_space_id);
CREATE INDEX IF NOT EXISTS idx_firm_client_follow_ups_client ON firm.client_follow_ups(client_space_id);
CREATE INDEX IF NOT EXISTS idx_firm_client_follow_ups_created ON firm.client_follow_ups(created_at DESC);

COMMENT ON TABLE firm.client_follow_ups IS 'Firm 端：客户跟进记录';

-- 3. 插入/更新跟进记录时更新 clients.last_follow_up_at
CREATE OR REPLACE FUNCTION firm.set_client_last_follow_up_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE firm.clients
  SET last_follow_up_at = NEW.created_at
  WHERE firm_space_id = NEW.firm_space_id AND client_space_id = NEW.client_space_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_follow_ups_set_last ON firm.client_follow_ups;
CREATE TRIGGER trg_client_follow_ups_set_last
  AFTER INSERT ON firm.client_follow_ups
  FOR EACH ROW EXECUTE PROCEDURE firm.set_client_last_follow_up_at();

-- 4. RLS：client_follow_ups
ALTER TABLE firm.client_follow_ups ENABLE ROW LEVEL SECURITY;

CREATE POLICY firm_client_follow_ups_select ON firm.client_follow_ups FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );
CREATE POLICY firm_client_follow_ups_insert ON firm.client_follow_ups FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );
CREATE POLICY firm_client_follow_ups_update ON firm.client_follow_ups FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );
CREATE POLICY firm_client_follow_ups_delete ON firm.client_follow_ups FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm_space_id AND us.user_id = auth.uid()
    )
  );
