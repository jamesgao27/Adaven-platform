-- App: space members can list CRM orders for their current space (RLS on crm.space_orders is ops-only).

CREATE OR REPLACE FUNCTION crm.list_space_orders_for_space_member(p_space_id uuid)
RETURNS TABLE (
  id uuid,
  sku_code text,
  sku_name text,
  status text,
  started_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz,
  source text,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_spaces us
    WHERE us.user_id = auth.uid()
      AND us.space_id = p_space_id
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    so.id,
    se.code::text,
    se.name::text,
    so.status::text,
    so.started_at,
    so.expires_at,
    so.created_at,
    so.source::text,
    so.metadata
  FROM crm.space_orders so
  JOIN crm.sku_edition se ON se.id = so.sku_id
  WHERE so.space_id = p_space_id
  ORDER BY so.created_at DESC;
END;
$$;

COMMENT ON FUNCTION crm.list_space_orders_for_space_member(uuid) IS 'Returns space_orders for p_space_id when auth.uid() is a member of that space (public.user_spaces).';

GRANT EXECUTE ON FUNCTION crm.list_space_orders_for_space_member(uuid) TO authenticated;
