-- Phase B-1: add invitee_client_id to firm.orders and public.projects
-- without changing existing client_space_id-based behaviour.
--
-- 1) Add nullable invitee_client_id columns
-- 2) Backfill from firm.clients.created_contact_email -> firm.invitee_clients
-- 3) Backfill projects from their orders

SET search_path = firm, public;

-- 1) Add columns (nullable, FK to firm.invitee_clients)
ALTER TABLE firm.orders
  ADD COLUMN IF NOT EXISTS invitee_client_id UUID NULL
    REFERENCES firm.invitee_clients(id) ON DELETE SET NULL;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS invitee_client_id UUID NULL
    REFERENCES firm.invitee_clients(id) ON DELETE SET NULL;

COMMENT ON COLUMN firm.orders.invitee_client_id IS
  'Optional link to firm.invitee_clients: which invitee this order is for (before/alongside client_space_id).';

COMMENT ON COLUMN public.projects.invitee_client_id IS
  'Optional link to firm.invitee_clients: which invitee this project is for (before/alongside client_space_id).';

-- 2) Backfill orders.invitee_client_id from clients.created_contact_email / invitee_clients
--    Only when invitee_client_id is currently NULL.
UPDATE firm.orders o
SET invitee_client_id = ic.id
FROM firm.clients c
JOIN firm.invitee_clients ic
  ON ic.firm_space_id = c.firm_space_id
 AND ic.invitee_email = LOWER(TRIM(c.created_contact_email))
WHERE o.invitee_client_id IS NULL
  AND o.firm_space_id = c.firm_space_id
  AND o.client_space_id = c.client_space_id
  AND c.created_contact_email IS NOT NULL
  AND TRIM(c.created_contact_email) <> '';

-- 3) Backfill projects.invitee_client_id from their orders
UPDATE public.projects p
SET invitee_client_id = o.invitee_client_id
FROM firm.orders o
WHERE p.invitee_client_id IS NULL
  AND p.order_id = o.id
  AND o.invitee_client_id IS NOT NULL;

