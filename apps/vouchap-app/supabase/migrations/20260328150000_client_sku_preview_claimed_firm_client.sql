-- Allow SKU preview when invitee params reference a claimed firm.clients row: user is in that client space
-- and an order for that client uses the SKU (covers edge cases before/without orders.client_space_id aligned).
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

  RETURN false;
END;
$$;

COMMENT ON FUNCTION firm._client_can_preview_sku(uuid, uuid, text) IS
  'Preview: firm member, pending invitee+order, claimed firm_client+order+client_space membership, open-invite token, or any linked order for SKU.';
