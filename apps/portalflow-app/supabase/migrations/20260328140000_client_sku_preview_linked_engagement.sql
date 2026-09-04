-- After claim, client is a member of client_space but not firm_space; allow SKU / sku_items preview
-- when they have a firm.orders row (linked engagement) using that SKU.
SET search_path = public, firm;

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

  -- Linked engagement: user is member of client_space on an order that references this SKU
  IF EXISTS (
    SELECT 1
    FROM firm.orders o
    INNER JOIN public.user_spaces us ON us.space_id = o.client_space_id AND us.user_id = v_uid
    WHERE o.sku_id = p_sku_id
      AND o.client_space_id IS NOT NULL
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION firm._client_can_preview_sku(uuid, uuid, text) IS
  'Internal: preview allowed for firm member, pending invitee+order, open-invite token, or client_space member with a linked order for that SKU.';

DROP FUNCTION IF EXISTS public.get_firm_sku_items_preview_for_client(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.get_firm_sku_items_preview_for_client(
  p_sku_id uuid,
  p_firm_client_id uuid DEFAULT NULL,
  p_invite_token text DEFAULT NULL
)
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
BEGIN
  IF NOT firm._client_can_preview_sku(p_sku_id, p_firm_client_id, p_invite_token) THEN
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
  WHERE si.sku_id = p_sku_id
  ORDER BY si.sort_order ASC NULLS LAST, si.created_at ASC;
END;
$$;

COMMENT ON FUNCTION public.get_firm_sku_items_preview_for_client(uuid, uuid, text) IS
  'Authenticated: sku_items (incl. depends) for preview; same eligibility as SKU header RPC.';

GRANT EXECUTE ON FUNCTION public.get_firm_sku_items_preview_for_client(uuid, uuid, text) TO authenticated;
