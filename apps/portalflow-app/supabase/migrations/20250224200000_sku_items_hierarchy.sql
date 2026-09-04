-- SKU 任务清单层级：支持 L2(Phase) / L3(Section) / L4(Task)
-- 仅 item_kind = 'task' 的项会复制到 project_todos；phase/section 仅用于展示分组

ALTER TABLE firm.sku_items
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES firm.sku_items(id) ON DELETE CASCADE;

ALTER TABLE firm.sku_items
  ADD COLUMN IF NOT EXISTS item_kind TEXT NOT NULL DEFAULT 'task'
  CHECK (item_kind IN ('phase', 'section', 'task'));

CREATE INDEX IF NOT EXISTS idx_firm_sku_items_parent ON firm.sku_items(parent_id);

COMMENT ON COLUMN firm.sku_items.parent_id IS '父节点：null=Phase(L2)，phase_id=Section(L3)，section_id=Task(L4)';
COMMENT ON COLUMN firm.sku_items.item_kind IS 'phase=阶段(L2), section=分类(L3), task=可执行任务(L4)，仅 task 复制到 project_todos';
