-- Phase 1: project_todos 支持 WBS 树；projects 增加 status/start_at/end_at

-- 1) firm.project_todos 增加 parent_id（自引用，构成树）
ALTER TABLE firm.project_todos
  ADD COLUMN IF NOT EXISTS parent_id UUID NULL REFERENCES firm.project_todos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_firm_project_todos_parent ON firm.project_todos(parent_id);
COMMENT ON COLUMN firm.project_todos.parent_id IS '父任务 id，NULL 表示根级；用于 WBS 树形结构';

-- 2) firm.projects 增加 status、start_at、end_at
ALTER TABLE firm.projects
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled'));

ALTER TABLE firm.projects
  ADD COLUMN IF NOT EXISTS start_at timestamptz NULL;

ALTER TABLE firm.projects
  ADD COLUMN IF NOT EXISTS end_at timestamptz NULL;

COMMENT ON COLUMN firm.projects.status IS '项目状态：planned=计划中, in_progress=进行中, completed=已完成, cancelled=已取消';
COMMENT ON COLUMN firm.projects.start_at IS '项目开始时间';
COMMENT ON COLUMN firm.projects.end_at IS '项目结束时间';
