-- Manual rollback for 20260323153000. invitee_client_id / invitee_clients references here are legacy;
-- after 20260325140000, production RPCs use firm.clients; review before running against merged DBs.

SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) Drop permission tables
--------------------------------------------------------------------------------

DROP TABLE IF EXISTS firm.permission_role_scope CASCADE;
DROP TABLE IF EXISTS firm.permission_role_members CASCADE;
DROP TABLE IF EXISTS firm.permission_roles CASCADE;

--------------------------------------------------------------------------------
-- 2) Restore order_managers back to clients_assignee
--------------------------------------------------------------------------------

DROP POLICY IF EXISTS order_managers_select_firm_members ON firm.order_managers;
DROP POLICY IF EXISTS order_managers_insert_firm_admin ON firm.order_managers;
DROP POLICY IF EXISTS order_managers_update_firm_admin ON firm.order_managers;
DROP POLICY IF EXISTS order_managers_delete_firm_admin ON firm.order_managers;

DROP INDEX IF EXISTS firm.order_managers_order_id_key;
DROP INDEX IF EXISTS firm.order_managers_firm_space_id_manager_user_id_order_id_key;
DROP INDEX IF EXISTS firm.order_managers_firm_space_id_idx;
DROP INDEX IF EXISTS firm.order_managers_manager_user_id_idx;

ALTER TABLE IF EXISTS firm.order_managers
  DROP CONSTRAINT IF EXISTS order_managers_order_id_fkey;

ALTER TABLE firm.order_managers
  ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE firm.order_managers
  RENAME COLUMN manager_user_id TO user_id;

ALTER TABLE firm.order_managers
  RENAME COLUMN order_id TO client_space_id;

ALTER TABLE firm.order_managers
  ADD COLUMN IF NOT EXISTS invitee_client_id UUID REFERENCES firm.invitee_clients(id) ON DELETE CASCADE;

ALTER TABLE firm.order_managers RENAME TO clients_assignee;

CREATE UNIQUE INDEX IF NOT EXISTS clients_assignee_client_key
  ON firm.clients_assignee (firm_space_id, user_id, client_space_id)
  WHERE client_space_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS clients_assignee_invitee_key
  ON firm.clients_assignee (firm_space_id, invitee_client_id)
  WHERE invitee_client_id IS NOT NULL;

ALTER TABLE firm.clients_assignee
  ADD CONSTRAINT clients_assignee_client_or_invitee CHECK (
    (client_space_id IS NOT NULL AND invitee_client_id IS NULL)
    OR (client_space_id IS NULL AND invitee_client_id IS NOT NULL)
  );

DROP POLICY IF EXISTS clients_assignee_select_firm_members ON firm.clients_assignee;
DROP POLICY IF EXISTS clients_assignee_insert_firm_admin ON firm.clients_assignee;
DROP POLICY IF EXISTS clients_assignee_update_firm_admin ON firm.clients_assignee;
DROP POLICY IF EXISTS clients_assignee_delete_firm_admin ON firm.clients_assignee;

CREATE POLICY clients_assignee_select_firm_members ON firm.clients_assignee
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients_assignee.firm_space_id
        AND us.user_id = auth.uid()
    )
  );

CREATE POLICY clients_assignee_insert_firm_admin ON firm.clients_assignee
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients_assignee.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

CREATE POLICY clients_assignee_update_firm_admin ON firm.clients_assignee
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients_assignee.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients_assignee.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

CREATE POLICY clients_assignee_delete_firm_admin ON firm.clients_assignee
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients_assignee.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );
