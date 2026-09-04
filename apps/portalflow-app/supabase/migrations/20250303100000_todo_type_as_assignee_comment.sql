-- 明确 project_todos.type / sku_items.type 为「当前责任人」/「初始责任人」
-- 单任务可在 client ↔ firm 间流转（交给 Firm / 退回 Client）；sku_items.type 作为创建 project_todos 时的初始责任人

COMMENT ON COLUMN public.project_todos.type IS
  '当前责任人：client=客户负责，firm=机构负责；可随任务流转更新（交给Firm/退回Client）';

COMMENT ON COLUMN firm.sku_items.type IS
  '初始责任人：创建 project_todos 时复制到此列，作为该任务的初始负责方（client/firm）';

COMMENT ON COLUMN firm.preset_sku_items.type IS
  '初始责任人（复制到 firm.sku_items 后生效，创建 project_todos 时再复制为任务当前责任人）';
