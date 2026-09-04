SET search_path = public, firm;

-- Restore firm.can_access_client to the 20260323154000 version (order.client_space_id only).

CREATE OR REPLACE FUNCTION firm.can_access_client(
  p_user_id uuid,
  p_firm_space_id uuid,
  p_client_space_id uuid,
  p_for_write boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, firm
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM firm.orders o
    WHERE o.firm_space_id = p_firm_space_id
      AND o.client_space_id = p_client_space_id
      AND firm.can_access_order(p_user_id, o.id, p_for_write)
  );
$$;
