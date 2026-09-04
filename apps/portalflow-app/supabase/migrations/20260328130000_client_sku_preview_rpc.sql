-- Clients claiming an engagement are not firm space members; firm.skus / firm.sku_items RLS blocks direct SELECT.
-- Token + email-claim previews use this definer helper + public RPCs (same checks as invite flow).
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

  RETURN false;
END;
$$;

COMMENT ON FUNCTION firm._client_can_preview_sku(uuid, uuid, text) IS
  'Internal: caller may preview SKU if firm member, pending invitee+order for their email, or valid open-invite token for that SKU.';

DROP FUNCTION IF EXISTS public.get_firm_sku_preview_for_client(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.get_firm_sku_preview_for_client(
  p_sku_id uuid,
  p_firm_client_id uuid DEFAULT NULL,
  p_invite_token text DEFAULT NULL
)
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
BEGIN
  IF NOT firm._client_can_preview_sku(p_sku_id, p_firm_client_id, p_invite_token) THEN
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
  WHERE s.id = p_sku_id;
END;
$$;

COMMENT ON FUNCTION public.get_firm_sku_preview_for_client(uuid, uuid, text) IS
  'Authenticated: SKU header fields for service preview when client is not a firm member (email claim or open-invite token).';

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
  sort_order int
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
    si.sort_order
  FROM firm.sku_items si
  WHERE si.sku_id = p_sku_id
  ORDER BY si.sort_order ASC NULLS LAST, si.created_at ASC;
END;
$$;

COMMENT ON FUNCTION public.get_firm_sku_items_preview_for_client(uuid, uuid, text) IS
  'Authenticated: sku_items tree for service preview (same eligibility as get_firm_sku_preview_for_client).';

GRANT EXECUTE ON FUNCTION public.get_firm_sku_preview_for_client(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_firm_sku_items_preview_for_client(uuid, uuid, text) TO authenticated;
