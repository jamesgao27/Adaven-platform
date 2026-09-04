-- Allow firm members to delete invitee_clients (e.g. bulk delete from clients list)
SET search_path = firm, public;

CREATE POLICY invitee_clients_delete_firm_members ON firm.invitee_clients
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid() AND us.space_id = firm.invitee_clients.firm_space_id
    )
  );

COMMENT ON POLICY invitee_clients_delete_firm_members ON firm.invitee_clients IS
  'Firm members of firm_space_id can delete their invitee_clients rows.';

GRANT DELETE ON firm.invitee_clients TO authenticated;
