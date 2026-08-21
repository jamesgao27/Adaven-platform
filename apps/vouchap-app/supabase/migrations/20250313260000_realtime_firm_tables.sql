-- Enable Realtime (postgres_changes) for firm schema tables used by clients and engagements modules.
-- Dashboard alternative: Database → Publications → supabase_realtime → add tables.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'firm' AND tablename = 'clients') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE firm.clients;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'firm' AND tablename = 'orders') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE firm.orders;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'firm' AND tablename = 'invitee_clients') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE firm.invitee_clients;
  END IF;
END $$;
