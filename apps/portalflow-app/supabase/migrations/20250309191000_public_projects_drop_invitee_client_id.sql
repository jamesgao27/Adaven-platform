-- Phase C-3: remove redundant invitee_client_id from public.projects
-- Goal:
--   - Keep invitee linkage as the responsibility of firm.orders (invitee_client_id).
--   - public.projects remains 1:1 with orders via order_id; we avoid duplicating invitee_client_id.
--   - Clean up column, index, and comments that depend on public.projects.invitee_client_id.

SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) Drop helper index that depends on public.projects.invitee_client_id
--------------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'public_projects_pending_by_invitee_idx'
  ) THEN
    DROP INDEX public.public_projects_pending_by_invitee_idx;
  END IF;
END;
$$;

--------------------------------------------------------------------------------
-- 2) Drop public.projects.invitee_client_id column (and its comment)
--------------------------------------------------------------------------------

ALTER TABLE public.projects
  DROP COLUMN IF EXISTS invitee_client_id;

-- NOTE:
--  - invitee linkage now lives solely on firm.orders.invitee_client_id.
--  - To query projects by invitee, join via firm.orders:
--      firm.orders (invitee_client_id, id) → public.projects(order_id)

