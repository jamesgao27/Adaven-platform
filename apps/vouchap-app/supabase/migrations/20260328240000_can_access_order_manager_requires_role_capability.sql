-- firm.can_access_order previously OR-ed firm.order_managers without checking permission_role_members.
-- Removing a member's roles (or stripping order flags) left order_managers rows in place, so they still
-- passed RLS and the UI still showed them as manager. Require firm membership + at least one role
-- that grants order read/write (any scope) for the order_managers shortcut; label scoping still applies
-- via the separate permission_role_members branch. Admins unchanged.

SET search_path = public, firm;

CREATE OR REPLACE FUNCTION firm.user_has_any_order_permission_in_space(
  p_user_id uuid,
  p_firm_space_id uuid,
  p_for_write boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, firm
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM firm.permission_role_members prm
    JOIN firm.permission_roles pr ON pr.id = prm.role_id
    WHERE prm.firm_space_id = p_firm_space_id
      AND prm.user_id = p_user_id
      AND (
        CASE
          WHEN p_for_write THEN
            COALESCE(pr.order_permissions ->> 'all', 'false') = 'true'
            OR COALESCE(pr.order_permissions ->> 'edit', 'false') = 'true'
            OR COALESCE(pr.order_permissions ->> 'update', 'false') = 'true'
            OR COALESCE(pr.order_permissions ->> 'manage', 'false') = 'true'
          ELSE
            COALESCE(pr.order_permissions ->> 'all', 'false') = 'true'
            OR COALESCE(pr.order_permissions ->> 'view', 'false') = 'true'
            OR COALESCE(pr.order_permissions ->> 'read', 'false') = 'true'
            OR COALESCE(pr.order_permissions ->> 'list', 'false') = 'true'
        END
      )
  );
$$;

COMMENT ON FUNCTION firm.user_has_any_order_permission_in_space(uuid, uuid, boolean) IS
  'True if p_user_id has any permission role in the firm space with at least one order read (or write) flag; no label filtering.';

CREATE OR REPLACE FUNCTION firm.can_access_order(
  p_user_id uuid,
  p_order_id uuid,
  p_for_write boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, firm
AS $$
  WITH target_order AS (
    SELECT o.*
    FROM firm.orders o
    WHERE o.id = p_order_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM target_order o
    WHERE
      EXISTS (
        SELECT 1
        FROM public.user_spaces us
        WHERE us.space_id = o.firm_space_id
          AND us.user_id = p_user_id
          AND us.is_admin = true
      )
      OR EXISTS (
        SELECT 1
        FROM firm.order_managers om
        WHERE om.order_id = o.id
          AND om.manager_user_id = p_user_id
          AND EXISTS (
            SELECT 1
            FROM public.user_spaces us
            WHERE us.space_id = o.firm_space_id
              AND us.user_id = p_user_id
          )
          AND firm.user_has_any_order_permission_in_space(p_user_id, o.firm_space_id, p_for_write)
      )
      OR EXISTS (
        SELECT 1
        FROM firm.permission_role_members prm
        JOIN firm.permission_roles pr ON pr.id = prm.role_id
        WHERE prm.firm_space_id = o.firm_space_id
          AND prm.user_id = p_user_id
          AND (
            CASE
              WHEN p_for_write THEN
                COALESCE(pr.order_permissions ->> 'all', 'false') = 'true'
                OR COALESCE(pr.order_permissions ->> 'edit', 'false') = 'true'
                OR COALESCE(pr.order_permissions ->> 'update', 'false') = 'true'
                OR COALESCE(pr.order_permissions ->> 'manage', 'false') = 'true'
              ELSE
                COALESCE(pr.order_permissions ->> 'all', 'false') = 'true'
                OR COALESCE(pr.order_permissions ->> 'view', 'false') = 'true'
                OR COALESCE(pr.order_permissions ->> 'read', 'false') = 'true'
                OR COALESCE(pr.order_permissions ->> 'list', 'false') = 'true'
            END
          )
          AND NOT EXISTS (
            SELECT 1
            FROM firm.permission_role_scope prs
            WHERE prs.role_id = pr.id
              AND prs.dimension = 'season'
              AND prs.scope_mode = 'include'
              AND (
                o.tax_season_label_id IS NULL
                OR NOT (o.tax_season_label_id = ANY (prs.label_ids))
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM firm.permission_role_scope prs
            WHERE prs.role_id = pr.id
              AND prs.dimension = 'country'
              AND prs.scope_mode = 'include'
              AND (
                o.tax_country_label_id IS NULL
                OR NOT (o.tax_country_label_id = ANY (prs.label_ids))
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM firm.permission_role_scope prs
            WHERE prs.role_id = pr.id
              AND prs.dimension = 'scenario'
              AND prs.scope_mode = 'include'
              AND (
                o.tax_scenario_label_id IS NULL
                OR NOT (o.tax_scenario_label_id = ANY (prs.label_ids))
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM firm.permission_role_scope prs
            WHERE prs.role_id = pr.id
              AND prs.dimension = 'custom'
              AND prs.scope_mode = 'include'
              AND (
                cardinality(COALESCE(o.custom_label_ids, ARRAY[]::uuid[])) = 0
                OR NOT (COALESCE(o.custom_label_ids, ARRAY[]::uuid[]) && prs.label_ids)
              )
          )
      )
  );
$$;

COMMENT ON FUNCTION firm.can_access_order(uuid, uuid, boolean) IS
  'Firm order access: space admin; or order_managers only if still in user_spaces and has any order role capability; or role+label scope.';
