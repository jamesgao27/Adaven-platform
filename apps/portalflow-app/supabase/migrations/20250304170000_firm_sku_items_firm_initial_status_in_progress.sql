-- 修正已从 sku_items 复制创建的 project_todos 初始状态（一次性数据修复）：
-- sku_items 表无 status 字段，初始状态应在创建 project_todos 时按 initial_responsible_side 设置。
-- 旧逻辑曾将全部 task 设为 to_submit，此处将 responsible_side=firm 且当前为 to_submit 的 task 改为 in_progress。

UPDATE public.project_todos
SET status = 'in_progress'
WHERE item_kind = 'task'
  AND responsible_side = 'firm'
  AND status = 'to_submit';
