-- Client may read firm.sku_items via RLS but not firm.skus; sku-id preview RPCs still use _client_can_preview_sku
-- and can deny while items load. These RPCs only require: caller is a member of the order's client_space.
SET search_path = public, firm;

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
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR p_order_id IS NULL THEN
    RETURN;
  END IF;

  SELECT o.sku_id INTO v_sku_id
  FROM firm.orders o
  INNER JOIN public.user_spaces us ON us.space_id = o.client_space_id AND us.user_id = v_uid
  WHERE o.id = p_order_id
    AND o.client_space_id IS NOT NULL
    AND o.sku_id IS NOT NULL;

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
  'Authenticated: SKU header for an order when caller belongs to order.client_space (no firm.skus RLS).';

DROP FUNCTION IF EXISTS public.get_firm_sku_items_preview_for_order_client(uuid);
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
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR p_order_id IS NULL THEN
    RETURN;
  END IF;

  SELECT o.sku_id INTO v_sku_id
  FROM firm.orders o
  INNER JOIN public.user_spaces us ON us.space_id = o.client_space_id AND us.user_id = v_uid
  WHERE o.id = p_order_id
    AND o.client_space_id IS NOT NULL
    AND o.sku_id IS NOT NULL;

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
  'Authenticated: sku_items for the order SKU when caller belongs to order.client_space.';

GRANT EXECUTE ON FUNCTION public.get_firm_sku_preview_for_order_client(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_firm_sku_items_preview_for_order_client(uuid) TO authenticated;
