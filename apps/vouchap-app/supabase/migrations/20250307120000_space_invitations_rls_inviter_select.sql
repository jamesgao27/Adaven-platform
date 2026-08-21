-- Allow inviter to SELECT their own space_invitations (fixes 406 after firm_create_client_on_behalf:
-- invitation is for the new client space; inviter is not in that space's user_spaces, so existing
-- policies block SELECT. Inviter must be able to read the row to send the invitation email.)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'space_invitations') THEN
    DROP POLICY IF EXISTS space_invitations_select_inviter ON public.space_invitations;
    CREATE POLICY space_invitations_select_inviter ON public.space_invitations
      FOR SELECT TO authenticated
      USING (inviter_id = auth.uid());
  END IF;
END $$;
