-- Same email → multiple firm.clients / orders: pending orders keep orders.client_space_id NULL until link.
-- _client_can_preview_sku + order-scoped preview RPCs did not treat that as authorized → SKU header empty while
-- firm.sku_items RLS still allows the checklist (todos). Also add spaces SELECT so clients can read the firm
-- space row for "Services from {firmName}" when they have any claimed firm.clients row for that firm.
SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) SKU preview gate: any matching invitee email in this firm for this SKU
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION firm._client_can_preview_sku(
  p_sku_id uuid,
  p_firm_client_id uuid,
  p_invite_token text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
STABLE
AS $$
DECLARE
  v_uid uuid;
  v_email text;
  v_firm_space_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR p_sku_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT s.firm_space_id INTO v_firm_space_id FROM firm.skus s WHERE s.id = p_sku_id;
  IF v_firm_space_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.user_id = v_uid AND us.space_id = v_firm_space_id
  ) THEN
    RETURN true;
  END IF;

  SELECT LOWER(TRIM(COALESCE(u.email, ''))) INTO v_email
  FROM public.users u
  WHERE u.id = v_uid
  LIMIT 1;

  IF p_firm_client_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM firm.clients c
      INNER JOIN firm.orders o ON o.client_id = c.id AND o.firm_space_id = c.firm_space_id
      WHERE c.id = p_firm_client_id
        AND c.client_space_id IS NULL
        AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = LOWER(TRIM(COALESCE(v_email, '')))
        AND o.sku_id = p_sku_id
        AND o.client_space_id IS NULL
    ) THEN
      RETURN true;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM firm.clients c
      INNER JOIN public.user_spaces us ON us.space_id = c.client_space_id AND us.user_id = v_uid
      INNER JOIN firm.orders o ON o.client_id = c.id AND o.firm_space_id = c.firm_space_id
      WHERE c.id = p_firm_client_id
        AND c.client_space_id IS NOT NULL
        AND o.sku_id = p_sku_id
    ) THEN
      RETURN true;
    END IF;
  END IF;

  IF p_invite_token IS NOT NULL AND length(trim(p_invite_token)) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM firm.client_invite_tokens t
      WHERE t.token = trim(p_invite_token)
        AND (t.is_active IS NULL OR t.is_active = true)
        AND (t.expires_at IS NULL OR t.expires_at > now())
        AND t.sku_id = p_sku_id
        AND t.firm_space_id = v_firm_space_id
    ) THEN
      RETURN true;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM firm.orders o
    INNER JOIN public.user_spaces us ON us.space_id = o.client_space_id AND us.user_id = v_uid
    WHERE o.sku_id = p_sku_id
      AND o.client_space_id IS NOT NULL
  ) THEN
    RETURN true;
  END IF;

  -- Duplicate invitee rows / wrong firmClientId on client: same email, any client row in this firm with an order for this SKU.
  IF length(trim(COALESCE(v_email, ''))) > 0 AND EXISTS (
    SELECT 1
    FROM firm.clients c
    INNER JOIN firm.orders o ON o.client_id = c.id AND o.firm_space_id = c.firm_space_id
    WHERE c.firm_space_id = v_firm_space_id
      AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = LOWER(TRIM(COALESCE(v_email, '')))
      AND o.sku_id = p_sku_id
      AND (
        (c.client_space_id IS NULL AND o.client_space_id IS NULL)
        OR (
          o.client_space_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.user_spaces us2
            WHERE us2.user_id = v_uid AND us2.space_id = o.client_space_id
          )
        )
      )
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION firm._client_can_preview_sku(uuid, uuid, text) IS
  'Preview: firm member, pending/claimed firm_client match, open-invite token, linked order, or same-email invitee orders in firm.';

--------------------------------------------------------------------------------
-- 2) Order-scoped preview: allow pending link (order + client row still unbound to a space)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_firm_sku_preview_for_order_client(p_order_id uuid)
RETURNS TABLE (
  name text,
  description text,
  image_url text,
  tax_country text,
  tax_scenario text,
  tags jsonb,
  is_published boolean,
  template_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
STABLE
AS $$
DECLARE
  v_uid uuid;
  v_sku_id uuid;
  v_email text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR p_order_id IS NULL THEN
    RETURN;
  END IF;

  SELECT LOWER(TRIM(COALESCE(u.email, ''))) INTO v_email
  FROM public.users u
  WHERE u.id = v_uid
  LIMIT 1;

  SELECT o.sku_id INTO v_sku_id
  FROM firm.orders o
  WHERE o.id = p_order_id
    AND o.sku_id IS NOT NULL
    AND (
      firm.can_access_order(v_uid, p_order_id, false)
      OR (
        o.client_space_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.user_spaces us
          WHERE us.space_id = o.client_space_id
            AND us.user_id = v_uid
        )
      )
      OR (
        o.client_space_id IS NULL
        AND length(trim(COALESCE(v_email, ''))) > 0
        AND EXISTS (
          SELECT 1 FROM firm.clients c
          WHERE c.id = o.client_id
            AND c.firm_space_id = o.firm_space_id
            AND c.client_space_id IS NULL
            AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = v_email
        )
      )
    );

  IF v_sku_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    s.name,
    s.description,
    s.image_url,
    s.tax_country,
    s.tax_scenario,
    s.tags,
    s.is_published,
    s.template_status::text
  FROM firm.skus s
  WHERE s.id = v_sku_id;
END;
$$;

COMMENT ON FUNCTION public.get_firm_sku_preview_for_order_client(uuid) IS
  'Authenticated: SKU header when caller may SELECT order (firm perms, client_space membership, or pending invitee email).';

CREATE OR REPLACE FUNCTION public.get_firm_sku_items_preview_for_order_client(p_order_id uuid)
RETURNS TABLE (
  id uuid,
  sku_id uuid,
  parent_id uuid,
  item_kind text,
  initial_responsible_side text,
  title text,
  description text,
  sort_order int,
  depends_on_id uuid,
  depends_on_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
STABLE
AS $$
DECLARE
  v_uid uuid;
  v_sku_id uuid;
  v_email text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR p_order_id IS NULL THEN
    RETURN;
  END IF;

  SELECT LOWER(TRIM(COALESCE(u.email, ''))) INTO v_email
  FROM public.users u
  WHERE u.id = v_uid
  LIMIT 1;

  SELECT o.sku_id INTO v_sku_id
  FROM firm.orders o
  WHERE o.id = p_order_id
    AND o.sku_id IS NOT NULL
    AND (
      firm.can_access_order(v_uid, p_order_id, false)
      OR (
        o.client_space_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.user_spaces us
          WHERE us.space_id = o.client_space_id
            AND us.user_id = v_uid
        )
      )
      OR (
        o.client_space_id IS NULL
        AND length(trim(COALESCE(v_email, ''))) > 0
        AND EXISTS (
          SELECT 1 FROM firm.clients c
          WHERE c.id = o.client_id
            AND c.firm_space_id = o.firm_space_id
            AND c.client_space_id IS NULL
            AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = v_email
        )
      )
    );

  IF v_sku_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    si.id,
    si.sku_id,
    si.parent_id,
    si.item_kind::text,
    si.initial_responsible_side::text,
    si.title,
    si.description,
    si.sort_order,
    si.depends_on_id,
    COALESCE(si.depends_on_ids, '{}'::uuid[])
  FROM firm.sku_items si
  WHERE si.sku_id = v_sku_id
  ORDER BY si.sort_order ASC NULLS LAST, si.created_at ASC;
END;
$$;

COMMENT ON FUNCTION public.get_firm_sku_items_preview_for_order_client(uuid) IS
  'Authenticated: sku_items for order SKU (same access as header RPC).';

--------------------------------------------------------------------------------
-- 3) Client can read firm space name if they belong to a client_space linked in firm.clients
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "spaces_select_client_engaged_firm" ON public.spaces;
CREATE POLICY "spaces_select_client_engaged_firm" ON public.spaces
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_spaces us
      INNER JOIN firm.clients c ON c.client_space_id = us.space_id
      WHERE us.user_id = auth.uid()
        AND c.client_space_id IS NOT NULL
        AND c.firm_space_id = spaces.id
    )
  );

COMMENT ON POLICY "spaces_select_client_engaged_firm" ON public.spaces IS
  'Client members: may SELECT the firm space row for firms that have a claimed firm.clients row tied to their client space (display name).';
