-- Phase 1 (merge invitee_clients → firm.clients): schema + backfill only.
-- - firm.clients: invitee_* columns, client_space_id nullable; pending rows use same id as firm.invitee_clients.id.
-- - firm.orders: client_id → firm.clients(id); backfilled from invitee_clients + existing (firm_space_id, client_space_id).
-- - invitee_clients table and orders.invitee_client_id remain until a later migration (RLS/RPC/app next).
SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) firm.clients: invitee fields + nullable client_space_id
--------------------------------------------------------------------------------

ALTER TABLE firm.clients
  ADD COLUMN IF NOT EXISTS invitee_email TEXT,
  ADD COLUMN IF NOT EXISTS invitee_client_name TEXT,
  ADD COLUMN IF NOT EXISTS invitee_contact_name TEXT;

COMMENT ON COLUMN firm.clients.invitee_email IS
  'Invitee identity email (pending or snapshot); normalized lower(trim) on write in app/RPC.';
COMMENT ON COLUMN firm.clients.invitee_client_name IS 'Org/client name as entered for pending invitee.';
COMMENT ON COLUMN firm.clients.invitee_contact_name IS 'Contact name as entered for pending invitee.';

ALTER TABLE firm.clients
  ALTER COLUMN client_space_id DROP NOT NULL;

--------------------------------------------------------------------------------
-- 2) firm.orders: client_id (dual-write period with invitee_client_id)
--------------------------------------------------------------------------------

ALTER TABLE firm.orders
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES firm.clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_firm_orders_client_id
  ON firm.orders (client_id)
  WHERE client_id IS NOT NULL;

COMMENT ON COLUMN firm.orders.client_id IS
  'Canonical firm client row (pending: client_space_id null on firm.clients; replaces invitee_client_id long-term).';

--------------------------------------------------------------------------------
-- 3) Claimed invitees: ensure firm.clients row exists (edge cases), then copy metadata
--------------------------------------------------------------------------------

INSERT INTO firm.clients (firm_space_id, client_space_id, invitee_email, invitee_client_name, invitee_contact_name)
SELECT
  ic.firm_space_id,
  ic.clients_space_id,
  ic.invitee_email,
  ic.invitee_client_name,
  ic.invitee_contact_name
FROM firm.invitee_clients ic
WHERE ic.clients_space_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM firm.clients c
    WHERE c.firm_space_id = ic.firm_space_id
      AND c.client_space_id = ic.clients_space_id
  );

UPDATE firm.clients c
SET
  invitee_email = ic.invitee_email,
  invitee_client_name = ic.invitee_client_name,
  invitee_contact_name = ic.invitee_contact_name,
  updated_at = now()
FROM firm.invitee_clients ic
WHERE ic.clients_space_id IS NOT NULL
  AND c.firm_space_id = ic.firm_space_id
  AND c.client_space_id = ic.clients_space_id;

--------------------------------------------------------------------------------
-- 4) Pending invitees: one firm.clients row per invitee_clients row (same primary key id)
--------------------------------------------------------------------------------

INSERT INTO firm.clients (
  id,
  firm_space_id,
  client_space_id,
  invitee_email,
  invitee_client_name,
  invitee_contact_name,
  created_at,
  updated_at
)
SELECT
  ic.id,
  ic.firm_space_id,
  NULL::uuid,
  ic.invitee_email,
  ic.invitee_client_name,
  ic.invitee_contact_name,
  ic.created_at,
  ic.updated_at
FROM firm.invitee_clients ic
WHERE ic.clients_space_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM firm.clients fc WHERE fc.id = ic.id);

--------------------------------------------------------------------------------
-- 5) Backfill firm.orders.client_id
--------------------------------------------------------------------------------

UPDATE firm.orders o
SET client_id = c.id
FROM firm.invitee_clients ic
JOIN firm.clients c ON c.firm_space_id = ic.firm_space_id
  AND (
    (ic.clients_space_id IS NOT NULL AND c.client_space_id = ic.clients_space_id)
    OR (ic.clients_space_id IS NULL AND c.id = ic.id)
  )
WHERE o.invitee_client_id = ic.id
  AND o.client_id IS NULL;

UPDATE firm.orders o
SET client_id = c.id
FROM firm.clients c
WHERE o.firm_space_id = c.firm_space_id
  AND o.client_space_id IS NOT NULL
  AND o.client_space_id = c.client_space_id
  AND o.invitee_client_id IS NULL
  AND o.client_id IS NULL;

--------------------------------------------------------------------------------
-- 6) Uniqueness for pending rows (same as former invitee_clients firm+email)
--------------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS clients_firm_pending_invitee_email_key
  ON firm.clients (firm_space_id, lower(trim(invitee_email)))
  WHERE client_space_id IS NULL AND invitee_email IS NOT NULL;
