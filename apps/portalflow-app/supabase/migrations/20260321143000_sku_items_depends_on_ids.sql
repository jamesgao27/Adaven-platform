-- SKU 模板任务支持多前置依赖（与 project_todos.depends_on_ids 对齐）；depends_on_id 保留为首项兼容旧逻辑
ALTER TABLE firm.sku_items
  ADD COLUMN IF NOT EXISTS depends_on_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN firm.sku_items.depends_on_ids IS 'Predecessor sku_item ids (multi). depends_on_id should match first element when set.';

UPDATE firm.sku_items
SET depends_on_ids = ARRAY[depends_on_id]::uuid[]
WHERE depends_on_id IS NOT NULL;
