-- 一次性数据修复：将 public.project_todos.sort_order 刷成「同级兄弟」序号 1..n。
--
-- 背景：旧逻辑曾按整棵 WBS 深度优先给一个全局递增的 sort_order；应用层已改为与 sku_items 一致，
-- 即同一 project_id 且同一 parent_id（含根节点 parent_id IS NULL）下各自从 1 递增。
--
-- 规则：在每个 (project_id, parent_id) 分组内，按当前 sort_order → created_at → id 排序后赋新序号。
-- 可重复执行（幂等：重跑后仍是 1..n）。
--
-- 使用：在 Supabase Dashboard → SQL Editor 粘贴执行；或依赖 migration
--       20260321120000_project_todos_sibling_sort_order.sql（内容应与此一致）。

BEGIN;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY project_id, parent_id
      ORDER BY sort_order NULLS LAST, created_at NULLS LAST, id
    ) AS rn
  FROM public.project_todos
)
UPDATE public.project_todos p
SET sort_order = r.rn
FROM ranked r
WHERE p.id = r.id;

COMMIT;
