-- Normalize project_todos.sort_order to sibling order (1..n per project_id + parent_id).
-- Previously some rows used a global DFS index from sku_items copy; this preserves relative order within each sibling group.
-- Manual copy: supabase/sql/fix-project-todos-sibling-sort-order.sql

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
