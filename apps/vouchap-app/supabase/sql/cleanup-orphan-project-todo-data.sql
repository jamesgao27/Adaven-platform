-- =============================================================================
-- 一次性批处理：清理「已无对应 public.projects 行」的 project 任务及其子表数据
-- 适用场景：手动删除了 firm.orders / public.projects 后，残留 public.project_todos、
--           project_todo_attachments、project_todo_responsible_history。
--
-- 表关系（迁移）摘要：
--   project_todos.project_id -> projects(id) ON DELETE CASCADE
--   project_todo_attachments.project_todo_id -> project_todos(id) ON DELETE CASCADE
--   project_todo_responsible_history.project_todo_id -> project_todos(id) ON DELETE CASCADE
-- 若曾绕过外键删除 project，仍可能留下孤儿 todo / 附件 / 历史，本脚本可清掉。
--
-- 使用方式：
--   1) 先单独运行「预览」段 SELECT，确认行数。
--   2) 在 Supabase SQL Editor（建议 service_role / postgres）或 psql 中执行「执行」段。
--   3) 默认包在 BEGIN/COMMIT 中；出错可 ROLLBACK。
--
-- 注意：RLS 下普通角色可能 DELETE 失败，请用有足够权限的角色执行。
-- =============================================================================

-- ----- 预览（先运行，不改数据）------------------------------------------------
-- SELECT COUNT(*) AS orphan_project_todos
-- FROM public.project_todos pt
-- WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = pt.project_id);

-- SELECT COUNT(*) AS orphan_attachments_for_orphan_todos
-- FROM public.project_todo_attachments a
-- JOIN public.project_todos pt ON pt.id = a.project_todo_id
-- WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = pt.project_id);

-- SELECT COUNT(*) AS orphan_history_for_orphan_todos
-- FROM public.project_todo_responsible_history h
-- JOIN public.project_todos pt ON pt.id = h.project_todo_id
-- WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = pt.project_id);

-- 附件/历史指向的 project_todo 已不存在（完全孤儿行）
-- SELECT COUNT(*) AS attachments_todo_missing
-- FROM public.project_todo_attachments a
-- WHERE NOT EXISTS (SELECT 1 FROM public.project_todos pt WHERE pt.id = a.project_todo_id);

-- SELECT COUNT(*) AS history_todo_missing
-- FROM public.project_todo_responsible_history h
-- WHERE NOT EXISTS (SELECT 1 FROM public.project_todos pt WHERE pt.id = h.project_todo_id);

-- ----- 执行 ----------------------------------------------------------------------
BEGIN;

-- A) 子表：先删「project 已不存在」的 todo 上的附件与历史（显式删除，避免依赖 CASCADE 顺序）
DELETE FROM public.project_todo_attachments a
USING public.project_todos pt
WHERE a.project_todo_id = pt.id
  AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = pt.project_id);

DELETE FROM public.project_todo_responsible_history h
USING public.project_todos pt
WHERE h.project_todo_id = pt.id
  AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = pt.project_id);

-- B) 完全孤儿：附件/历史指向的 project_todos 行已不存在
DELETE FROM public.project_todo_attachments a
WHERE NOT EXISTS (SELECT 1 FROM public.project_todos pt WHERE pt.id = a.project_todo_id);

DELETE FROM public.project_todo_responsible_history h
WHERE NOT EXISTS (SELECT 1 FROM public.project_todos pt WHERE pt.id = h.project_todo_id);

-- C) 删除「project 已不存在」的 project_todos（树形 parent_id / depends_on_id 多为 ON DELETE SET NULL，
--    单次 DELETE 通常即可；若遇约束错误可再执行一次或分段删）
DELETE FROM public.project_todos pt
WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = pt.project_id);

COMMIT;

-- =============================================================================
-- 可选：若仍存在 public.projects 但其 order_id 指向已删除的 firm.orders，可另行处理，例如：
-- DELETE FROM public.projects pr
-- WHERE NOT EXISTS (SELECT 1 FROM firm.orders o WHERE o.id = pr.order_id);
-- （会 CASCADE 删除该项目下 project_todos 等，请先确认业务允许）
-- =============================================================================
