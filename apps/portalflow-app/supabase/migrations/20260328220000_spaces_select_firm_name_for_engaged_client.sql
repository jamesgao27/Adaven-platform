-- Client header "Services from {firm}" / "by {firm}" loads public.spaces.name for order.firm_space_id.
-- spaces_select_client_engaged_firm (281900) only works after firm.clients has client_space_id set.
-- Also allow SELECT on the firm space row when the user may SELECT an order for that firm (same as engagement visibility)
-- or is the pending invitee on an unlinked order (invitee_email match).
SET search_path = public, firm;

DROP POLICY IF EXISTS "spaces_select_client_via_order_firm" ON public.spaces;
CREATE POLICY "spaces_select_client_via_order_firm" ON public.spaces
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM firm.orders o
        WHERE o.firm_space_id = spaces.id
          AND firm.auth_user_can_select_order(auth.uid(), o.id)
      )
      OR EXISTS (
        SELECT 1
        FROM firm.orders o
        INNER JOIN firm.clients c ON c.id = o.client_id AND c.firm_space_id = o.firm_space_id
        WHERE o.firm_space_id = spaces.id
          AND o.client_space_id IS NULL
          AND c.client_space_id IS NULL
          AND length(trim(COALESCE(
            (SELECT LOWER(TRIM(COALESCE(u.email, ''))) FROM public.users u WHERE u.id = auth.uid() LIMIT 1),
            ''
          ))) > 0
          AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = (
            SELECT LOWER(TRIM(COALESCE(u.email, '')))
            FROM public.users u WHERE u.id = auth.uid() LIMIT 1
          )
      )
    )
  );

COMMENT ON POLICY "spaces_select_client_via_order_firm" ON public.spaces IS
  'Clients may read firm space name if they may SELECT an order for that firm, or are pending invitee on an unlinked order.';
