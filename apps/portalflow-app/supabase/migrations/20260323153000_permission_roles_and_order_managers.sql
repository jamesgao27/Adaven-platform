SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) Reuse clients_assignee as order_managers
--------------------------------------------------------------------------------

ALTER TABLE IF EXISTS firm.clients_assignee RENAME TO order_managers;

ALTER TABLE firm.order_managers
  RENAME COLUMN user_id TO manager_user_id;

ALTER TABLE firm.order_managers
  RENAME COLUMN client_space_id TO order_id;

-- Existing order policies may still reference old clients_assignee.invitee_client_id.
-- Drop them before removing invitee_client_id on the reused table.
DROP POLICY IF EXISTS firm_orders_select ON firm.orders;
DROP POLICY IF EXISTS firm_orders_update ON firm.orders;
DROP POLICY IF EXISTS firm_orders_delete ON firm.orders;
DROP POLICY IF EXISTS firm_clients_select ON firm.clients;
DROP POLICY IF EXISTS firm_clients_update ON firm.clients;
DROP POLICY IF EXISTS firm_clients_delete ON firm.clients;

-- Old FK from member_clients/client_space_id -> public.spaces(id).
-- After renaming to order_id it must be removed, then replaced by FK to firm.orders(id).
ALTER TABLE firm.order_managers
  DROP CONSTRAINT IF EXISTS member_clients_client_space_id_fkey;
ALTER TABLE firm.order_managers
  DROP CONSTRAINT IF EXISTS clients_assignee_client_space_id_fkey;

ALTER TABLE firm.order_managers
  DROP CONSTRAINT IF EXISTS clients_assignee_client_or_invitee;

ALTER TABLE firm.order_managers
  DROP COLUMN IF EXISTS invitee_client_id;

DROP INDEX IF EXISTS firm.clients_assignee_client_key;
DROP INDEX IF EXISTS firm.clients_assignee_invitee_key;
DROP INDEX IF EXISTS firm.clients_assignee_order_id_key;
DROP INDEX IF EXISTS firm.clients_assignee_firm_space_id_manager_user_id_order_id_key;
DROP INDEX IF EXISTS firm.order_managers_order_id_key;
DROP INDEX IF EXISTS firm.order_managers_firm_space_id_manager_user_id_order_id_key;

ALTER TABLE firm.order_managers
  ALTER COLUMN order_id TYPE uuid USING order_id::uuid;

ALTER TABLE firm.order_managers
  ALTER COLUMN manager_user_id SET NOT NULL;

-- clients_assignee historical rows use client_space_id (not order id).
-- Keep only rows that already match existing orders before adding FK.
DELETE FROM firm.order_managers om
WHERE om.order_id IS NULL
   OR NOT EXISTS (
    SELECT 1
    FROM firm.orders o
    WHERE o.id = om.order_id
  );

ALTER TABLE firm.order_managers
  ADD CONSTRAINT order_managers_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES firm.orders(id) ON DELETE CASCADE;

INSERT INTO firm.order_managers (firm_space_id, manager_user_id, order_id, created_at)
SELECT
  o.firm_space_id,
  COALESCE(o.created_by, fallback.user_id) AS manager_user_id,
  o.id AS order_id,
  COALESCE(o.created_at, now()) AS created_at
FROM firm.orders o
LEFT JOIN LATERAL (
  SELECT us.user_id
  FROM public.user_spaces us
  WHERE us.space_id = o.firm_space_id
  ORDER BY us.is_admin DESC, us.user_id
  LIMIT 1
) fallback ON true
LEFT JOIN firm.order_managers om ON om.order_id = o.id
WHERE om.id IS NULL
  AND COALESCE(o.created_by, fallback.user_id) IS NOT NULL;

ALTER TABLE firm.order_managers
  ALTER COLUMN order_id SET NOT NULL;

CREATE UNIQUE INDEX order_managers_order_id_key
  ON firm.order_managers (order_id);

CREATE UNIQUE INDEX order_managers_firm_space_id_manager_user_id_order_id_key
  ON firm.order_managers (firm_space_id, manager_user_id, order_id);

CREATE INDEX order_managers_firm_space_id_idx
  ON firm.order_managers (firm_space_id);

CREATE INDEX order_managers_manager_user_id_idx
  ON firm.order_managers (manager_user_id);

COMMENT ON TABLE firm.order_managers IS 'Order-level unique manager mapping (one manager per order).';
COMMENT ON COLUMN firm.order_managers.manager_user_id IS 'Assigned manager user id for this order.';
COMMENT ON COLUMN firm.order_managers.order_id IS 'Firm order id managed by manager_user_id.';

--------------------------------------------------------------------------------
-- 2) RLS for order_managers
--------------------------------------------------------------------------------

ALTER TABLE firm.order_managers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clients_assignee_select_firm_members ON firm.order_managers;
DROP POLICY IF EXISTS clients_assignee_insert_firm_admin ON firm.order_managers;
DROP POLICY IF EXISTS clients_assignee_update_firm_admin ON firm.order_managers;
DROP POLICY IF EXISTS clients_assignee_delete_firm_admin ON firm.order_managers;
DROP POLICY IF EXISTS order_managers_select_firm_members ON firm.order_managers;
DROP POLICY IF EXISTS order_managers_insert_firm_admin ON firm.order_managers;
DROP POLICY IF EXISTS order_managers_update_firm_admin ON firm.order_managers;
DROP POLICY IF EXISTS order_managers_delete_firm_admin ON firm.order_managers;

CREATE POLICY order_managers_select_firm_members ON firm.order_managers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.order_managers.firm_space_id
        AND us.user_id = auth.uid()
    )
  );

CREATE POLICY order_managers_insert_firm_admin ON firm.order_managers
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.order_managers.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

CREATE POLICY order_managers_update_firm_admin ON firm.order_managers
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.order_managers.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.order_managers.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

CREATE POLICY order_managers_delete_firm_admin ON firm.order_managers
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.order_managers.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

--------------------------------------------------------------------------------
-- 3) Permission tables
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS firm.permission_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  role_name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  member_permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  order_permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (firm_space_id, role_key)
);

CREATE INDEX IF NOT EXISTS permission_roles_firm_space_id_idx
  ON firm.permission_roles (firm_space_id);

CREATE TABLE IF NOT EXISTS firm.permission_role_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES firm.permission_roles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (firm_space_id, user_id)
);

CREATE INDEX IF NOT EXISTS permission_role_members_role_id_idx
  ON firm.permission_role_members (role_id);

CREATE INDEX IF NOT EXISTS permission_role_members_firm_space_id_idx
  ON firm.permission_role_members (firm_space_id);

CREATE TABLE IF NOT EXISTS firm.permission_role_scope (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES firm.permission_roles(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK (dimension IN ('season', 'country', 'scenario', 'custom')),
  scope_mode TEXT NOT NULL DEFAULT 'all' CHECK (scope_mode IN ('all', 'include')),
  label_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role_id, dimension)
);

CREATE INDEX IF NOT EXISTS permission_role_scope_role_id_idx
  ON firm.permission_role_scope (role_id);

CREATE INDEX IF NOT EXISTS permission_role_scope_firm_space_id_idx
  ON firm.permission_role_scope (firm_space_id);

COMMENT ON TABLE firm.permission_roles IS 'Firm permission role definitions.';
COMMENT ON TABLE firm.permission_role_members IS 'Single-role binding for each firm member.';
COMMENT ON TABLE firm.permission_role_scope IS 'Role order-scope by label dimensions.';

--------------------------------------------------------------------------------
-- 4) RLS for permission tables
--------------------------------------------------------------------------------

ALTER TABLE firm.permission_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm.permission_role_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm.permission_role_scope ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS permission_roles_select_firm_members ON firm.permission_roles;
DROP POLICY IF EXISTS permission_roles_insert_firm_admin ON firm.permission_roles;
DROP POLICY IF EXISTS permission_roles_update_firm_admin ON firm.permission_roles;
DROP POLICY IF EXISTS permission_roles_delete_firm_admin ON firm.permission_roles;

CREATE POLICY permission_roles_select_firm_members ON firm.permission_roles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.permission_roles.firm_space_id
        AND us.user_id = auth.uid()
    )
  );

CREATE POLICY permission_roles_insert_firm_admin ON firm.permission_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.permission_roles.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

CREATE POLICY permission_roles_update_firm_admin ON firm.permission_roles
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.permission_roles.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.permission_roles.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

CREATE POLICY permission_roles_delete_firm_admin ON firm.permission_roles
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.permission_roles.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

DROP POLICY IF EXISTS permission_role_members_select_firm_members ON firm.permission_role_members;
DROP POLICY IF EXISTS permission_role_members_insert_firm_admin ON firm.permission_role_members;
DROP POLICY IF EXISTS permission_role_members_update_firm_admin ON firm.permission_role_members;
DROP POLICY IF EXISTS permission_role_members_delete_firm_admin ON firm.permission_role_members;

CREATE POLICY permission_role_members_select_firm_members ON firm.permission_role_members
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.permission_role_members.firm_space_id
        AND us.user_id = auth.uid()
    )
  );

CREATE POLICY permission_role_members_insert_firm_admin ON firm.permission_role_members
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.permission_role_members.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

CREATE POLICY permission_role_members_update_firm_admin ON firm.permission_role_members
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.permission_role_members.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.permission_role_members.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

CREATE POLICY permission_role_members_delete_firm_admin ON firm.permission_role_members
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.permission_role_members.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

DROP POLICY IF EXISTS permission_role_scope_select_firm_members ON firm.permission_role_scope;
DROP POLICY IF EXISTS permission_role_scope_insert_firm_admin ON firm.permission_role_scope;
DROP POLICY IF EXISTS permission_role_scope_update_firm_admin ON firm.permission_role_scope;
DROP POLICY IF EXISTS permission_role_scope_delete_firm_admin ON firm.permission_role_scope;

CREATE POLICY permission_role_scope_select_firm_members ON firm.permission_role_scope
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.permission_role_scope.firm_space_id
        AND us.user_id = auth.uid()
    )
  );

CREATE POLICY permission_role_scope_insert_firm_admin ON firm.permission_role_scope
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.permission_role_scope.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

CREATE POLICY permission_role_scope_update_firm_admin ON firm.permission_role_scope
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.permission_role_scope.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.permission_role_scope.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

CREATE POLICY permission_role_scope_delete_firm_admin ON firm.permission_role_scope
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.permission_role_scope.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );
