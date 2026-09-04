-- Client 自定义标签（类似项目标签）：firm 可创建多个标签，客户可挂一个标签，列表/详情中 status 显示为标签且可手动调整
-- 依赖：firm.clients 已存在

-- 1. firm.client_labels：Firm 下可用的客户标签
CREATE TABLE IF NOT EXISTS firm.client_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#636E72',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_firm_client_labels_firm_name
  ON firm.client_labels(firm_space_id, LOWER(TRIM(name)));
CREATE INDEX IF NOT EXISTS idx_firm_client_labels_firm ON firm.client_labels(firm_space_id);

COMMENT ON TABLE firm.client_labels IS 'Firm 端：客户自定义标签，用于 status 展示与筛选';

-- 2. firm.clients 增加 label_id
ALTER TABLE firm.clients
  ADD COLUMN IF NOT EXISTS label_id UUID REFERENCES firm.client_labels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_firm_clients_label ON firm.clients(label_id);
COMMENT ON COLUMN firm.clients.label_id IS '客户展示用标签（status 显示为此标签），可手动调整';

-- 3. RLS：client_labels
ALTER TABLE firm.client_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY firm_client_labels_select ON firm.client_labels FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.space_id = firm_space_id AND us.user_id = auth.uid())
  );
CREATE POLICY firm_client_labels_insert ON firm.client_labels FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.space_id = firm_space_id AND us.user_id = auth.uid())
  );
CREATE POLICY firm_client_labels_update ON firm.client_labels FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.space_id = firm_space_id AND us.user_id = auth.uid())
  );
CREATE POLICY firm_client_labels_delete ON firm.client_labels FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_spaces us WHERE us.space_id = firm_space_id AND us.user_id = auth.uid())
  );
