-- Drop firm schema tables that were migrated to public in 20250228100000.
-- Application and RPCs use only public.projects and public.project_todos.

DROP TABLE IF EXISTS firm.project_todos CASCADE;
DROP TABLE IF EXISTS firm.projects CASCADE;
