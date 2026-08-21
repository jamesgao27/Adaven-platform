-- Pending invitee row: expose first pending order id so link/setup can use order-scoped SKU RPC after claim.
SET search_path = public, firm;

DROP FUNCTION IF EXISTS public.get_pending_invitees_for_email(text);
CREATE OR REPLACE FUNCTION public.get_pending_invitees_for_email(p_email text)
RETURNS TABLE (
  firm_space_id uuid,
  firm_name text,
  firm_client_id uuid,
  invitee_client_name text,
  invitee_email text,
  sku_id uuid,
  order_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, firm
STABLE
AS $$
  SELECT
    c.firm_space_id,
    s.name AS firm_name,
    c.id AS firm_client_id,
    c.invitee_client_name,
    c.invitee_email,
    (SELECT o.sku_id FROM firm.orders o
     WHERE o.firm_space_id = c.firm_space_id
       AND o.client_id = c.id
       AND o.client_space_id IS NULL
     ORDER BY o.created_at ASC
     LIMIT 1) AS sku_id,
    (SELECT o.id FROM firm.orders o
     WHERE o.firm_space_id = c.firm_space_id
       AND o.client_id = c.id
       AND o.client_space_id IS NULL
     ORDER BY o.created_at ASC
     LIMIT 1) AS order_id
  FROM firm.clients c
  JOIN public.spaces s ON s.id = c.firm_space_id
  WHERE LOWER(TRIM(COALESCE(c.invitee_email, ''))) = LOWER(TRIM(COALESCE(p_email, '')))
    AND c.client_space_id IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM firm.orders o
        WHERE o.firm_space_id = c.firm_space_id
          AND o.client_id = c.id
          AND o.client_space_id IS NULL
      )
      OR NOT EXISTS (
        SELECT 1 FROM firm.orders o
        WHERE o.firm_space_id = c.firm_space_id
          AND o.client_id = c.id
      )
    );
$$;

COMMENT ON FUNCTION public.get_pending_invitees_for_email(text) IS
  'Client by email: pending firm.clients; sku_id + order_id from earliest pending order if any.';
