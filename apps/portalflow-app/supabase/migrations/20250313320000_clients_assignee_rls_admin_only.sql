-- firm.clients_assignee: only firm admins may INSERT/UPDATE/DELETE (assign service owner).
-- SELECT remains for all firm members so assignee column can be shown. Aligns with UI (Assign button hidden for non-admin).
SET search_path = firm, public;

-- Drop legacy policies (created on member_clients, now on clients_assignee after rename)
DROP POLICY IF EXISTS firm_member_clients_select ON firm.clients_assignee;
DROP POLICY IF EXISTS firm_member_clients_insert ON firm.clients_assignee;
DROP POLICY IF EXISTS firm_member_clients_update ON firm.clients_assignee;
DROP POLICY IF EXISTS firm_member_clients_delete ON firm.clients_assignee;

-- SELECT: any firm member can read (for assignee display in list/detail)
CREATE POLICY clients_assignee_select_firm_members ON firm.clients_assignee
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients_assignee.firm_space_id AND us.user_id = auth.uid()
    )
  );

-- INSERT / UPDATE / DELETE: only firm admin (is_admin = true for that firm space)
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

COMMENT ON POLICY clients_assignee_select_firm_members ON firm.clients_assignee IS
  'Firm members can read assignee rows for their firm.';
COMMENT ON POLICY clients_assignee_insert_firm_admin ON firm.clients_assignee IS
  'Only firm admins can assign (insert) service owner.';
COMMENT ON POLICY clients_assignee_update_firm_admin ON firm.clients_assignee IS
  'Only firm admins can change (update) service owner.';
COMMENT ON POLICY clients_assignee_delete_firm_admin ON firm.clients_assignee IS
  'Only firm admins can remove (delete) assignee rows.';
