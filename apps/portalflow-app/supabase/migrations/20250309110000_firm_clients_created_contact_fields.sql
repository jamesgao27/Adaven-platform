-- Store creation-time contact name and email so the clients list can show them before the
-- invitee has confirmed. Client name already lives in display_name (created at creation, updated
-- to client self-set after they accept).

ALTER TABLE firm.clients
  ADD COLUMN IF NOT EXISTS created_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS created_contact_email TEXT;

COMMENT ON COLUMN firm.clients.created_contact_name IS 'Contact name as entered when creating (single or Cody bulk). Shown in list before invitee confirms.';
COMMENT ON COLUMN firm.clients.created_contact_email IS 'Contact email (invitee) as entered when creating. Shown in list before invitee confirms.';
