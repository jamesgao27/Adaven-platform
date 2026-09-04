-- Phase C-2: migration-mode for public.projects (single-table pending model)
-- Goal:
--   - Allow projects to be created for pending orders (no client space yet).
--   - Represent pending vs. formal projects in ONE table:
--       * Pending: client_space_id IS NULL AND invitee_client_id IS NOT NULL
--       * Formal:  client_space_id IS NOT NULL (current behaviour)
--   - Keep existing flows intact; this is additive.

SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) Relax constraint: allow public.projects.client_space_id to be NULL
--    - This enables projects for pending orders without a bound client space.
--------------------------------------------------------------------------------

ALTER TABLE public.projects
  ALTER COLUMN client_space_id DROP NOT NULL;

COMMENT ON COLUMN public.projects.client_space_id IS
'Client space for this project; NULL when the project is attached to a pending order for an invitee (see invitee_client_id).';

--------------------------------------------------------------------------------
-- 2) Helper index for pending projects by invitee (firm-side queries / dashboards)
--------------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'public_projects_pending_by_invitee_idx'
  ) THEN
    CREATE INDEX public_projects_pending_by_invitee_idx
      ON public.projects (firm_space_id, invitee_client_id)
      WHERE client_space_id IS NULL AND invitee_client_id IS NOT NULL;
  END IF;
END;
$$;

COMMENT ON INDEX public_projects_pending_by_invitee_idx IS
'Helper index: pending projects (no client_space_id yet), grouped by firm_space_id + invitee_client_id.';

