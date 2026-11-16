-- Invitee avatar badge (WebSidebar) listens to space_invitations via Realtime.
ALTER TABLE public.space_invitations REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'space_invitations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.space_invitations;
  END IF;
END $$;
