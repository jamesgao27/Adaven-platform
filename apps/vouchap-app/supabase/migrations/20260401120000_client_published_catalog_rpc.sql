-- Client: browse published service templates (cross-firm) and start onboarding orders without firm-space INSERT rights.

SET search_path = public, firm;

--------------------------------------------------------------------------------
-- Helpers: caller must belong to at least one client-type space
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION firm.auth_user_is_client_space_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, firm
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_spaces us
      INNER JOIN public.spaces sp ON sp.id = us.space_id
      WHERE us.user_id = auth.uid()
        AND sp.kind = 'client'
    );
$$;

COMMENT ON FUNCTION firm.auth_user_is_client_space_member() IS
  'True if auth.uid() is a member of at least one client (household/business) space.';

--------------------------------------------------------------------------------
-- Published SKU (client catalog): must match firm "Published" template — not legacy is_published with private/draft
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION firm.is_sku_published_catalog(p_sku firm.skus)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(p_sku.template_status, '') = 'published'
    AND COALESCE(p_sku.is_published, false) = true;
$$;

--------------------------------------------------------------------------------
-- List published SKUs for client marketplace (firm name from spaces)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION firm.list_published_skus_for_client_catalog()
RETURNS TABLE (
  id uuid,
  firm_space_id uuid,
  firm_name text,
  name text,
  description text,
  image_url text,
  tax_country text,
  tax_scenario text,
  tags jsonb,
  template_status text,
  is_published boolean,
  items_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, firm
AS $$
  SELECT
    s.id,
    s.firm_space_id,
    COALESCE(sp.name, '')::text AS firm_name,
    COALESCE(s.name, '')::text AS name,
    COALESCE(s.description, '')::text AS description,
    COALESCE(s.image_url, '')::text AS image_url,
    s.tax_country::text,
    s.tax_scenario::text,
    COALESCE(to_jsonb(s.tags), '[]'::jsonb) AS tags,
    s.template_status::text,
    COALESCE(s.is_published, false) AS is_published,
    COALESCE(ic.cnt, 0::bigint) AS items_count,
    s.created_at,
    s.updated_at
  FROM firm.skus s
  INNER JOIN public.spaces sp ON sp.id = s.firm_space_id AND sp.kind = 'firm'
  LEFT JOIN (
    SELECT si.sku_id, COUNT(*)::bigint AS cnt
    FROM firm.sku_items si
    GROUP BY si.sku_id
  ) ic ON ic.sku_id = s.id
  WHERE firm.is_sku_published_catalog(s)
    AND firm.auth_user_is_client_space_member()
  ORDER BY s.created_at DESC;
$$;

COMMENT ON FUNCTION firm.list_published_skus_for_client_catalog() IS
  'Authenticated users who belong to a client space can list all published firm SKUs (catalog/marketplace).';

REVOKE ALL ON FUNCTION firm.list_published_skus_for_client_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION firm.list_published_skus_for_client_catalog() TO authenticated;

--------------------------------------------------------------------------------
-- Client creates onboarding order from a published SKU (DEFINER INSERT bypasses firm_orders_insert)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION firm.client_create_onboarding_order_from_published_sku(
  p_client_space_id uuid,
  p_sku_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_uid uuid;
  v_firm uuid;
  v_client_row_id uuid;
  v_order_id uuid;
  r_sku firm.skus%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_client_space_id IS NULL OR p_sku_id IS NULL THEN
    RAISE EXCEPTION 'Invalid arguments';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_spaces us
    INNER JOIN public.spaces sp ON sp.id = us.space_id
    WHERE us.user_id = v_uid
      AND us.space_id = p_client_space_id
      AND sp.kind = 'client'
  ) THEN
    RAISE EXCEPTION 'Not a member of this client space';
  END IF;

  SELECT * INTO r_sku FROM firm.skus WHERE id = p_sku_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SKU not found';
  END IF;

  IF NOT firm.is_sku_published_catalog(r_sku) THEN
    RAISE EXCEPTION 'SKU is not published';
  END IF;

  v_firm := r_sku.firm_space_id;

  SELECT c.id INTO v_client_row_id
  FROM firm.clients c
  WHERE c.firm_space_id = v_firm
    AND c.client_space_id = p_client_space_id
  ORDER BY c.created_at DESC NULLS LAST
  LIMIT 1;

  INSERT INTO firm.orders (
    firm_space_id,
    client_space_id,
    client_id,
    sku_id,
    status,
    created_by,
    tax_country,
    tax_scenario,
    tags
  ) VALUES (
    v_firm,
    p_client_space_id,
    v_client_row_id,
    p_sku_id,
    'onboarding',
    v_uid,
    r_sku.tax_country,
    r_sku.tax_scenario,
    r_sku.tags
  )
  RETURNING id INTO v_order_id;

  RETURN v_order_id;
END;
$$;

COMMENT ON FUNCTION firm.client_create_onboarding_order_from_published_sku(uuid, uuid) IS
  'Client space member: create onboarding order for a published SKU (links firm.clients when present).';

REVOKE ALL ON FUNCTION firm.client_create_onboarding_order_from_published_sku(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION firm.client_create_onboarding_order_from_published_sku(uuid, uuid) TO authenticated;
