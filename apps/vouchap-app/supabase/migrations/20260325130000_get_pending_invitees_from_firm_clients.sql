-- Pending invitee discovery uses firm.clients (client_space_id IS NULL) instead of scanning invitee_clients only.
SET search_path = public, firm;

DROP FUNCTION IF EXISTS public.get_pending_invitees_for_email(text);

CREATE OR REPLACE FUNCTION public.get_pending_invitees_for_email(p_email text)
RETURNS TABLE (
  firm_space_id uuid,
  firm_name text,
  invitee_client_id uuid,
  invitee_client_name text,
  invitee_email text,
  sku_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, firm
STABLE
AS $$
  SELECT
    c.firm_space_id,
    s.name AS firm_name,
    c.id AS invitee_client_id,
    c.invitee_client_name,
    c.invitee_email,
    (SELECT o.sku_id FROM firm.orders o
     WHERE o.firm_space_id = c.firm_space_id
       AND (o.client_id = c.id OR o.invitee_client_id = c.id)
       AND o.client_space_id IS NULL
     LIMIT 1) AS sku_id
  FROM firm.clients c
  JOIN public.spaces s ON s.id = c.firm_space_id
  WHERE LOWER(TRIM(COALESCE(c.invitee_email, ''))) = LOWER(TRIM(COALESCE(p_email, '')))
    AND c.client_space_id IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM firm.orders o
        WHERE o.firm_space_id = c.firm_space_id
          AND (o.client_id = c.id OR o.invitee_client_id = c.id)
          AND o.client_space_id IS NULL
      )
      OR NOT EXISTS (
        SELECT 1 FROM firm.orders o
        WHERE o.firm_space_id = c.firm_space_id
          AND (o.client_id = c.id OR o.invitee_client_id = c.id)
      )
    );
$$;

COMMENT ON FUNCTION public.get_pending_invitees_for_email(text) IS
  'Client by email: pending firm.clients rows (client_space_id null), same return shape; sku_id from a pending order if any.';
