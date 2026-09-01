-- No on-behalf dealer spaces. Factory cannot insert orders (Vouchap still allows firm-created orders).
-- Dealers own their space; Factory records pending enrollment; Marketplace / claim links it.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_provider_consumers_pending_email
  ON provider.consumers (provider_space_id, lower(trim(contact_email)))
  WHERE consumer_space_id IS NULL AND contact_email IS NOT NULL;

COMMENT ON INDEX provider.uniq_provider_consumers_pending_email IS
  'One pending dealer per factory email (was firm.clients pending invitee_email unique).';

-- Direct table inserts: Factory must not create orders. Marketplace RPC is SECURITY DEFINER.
DROP POLICY IF EXISTS orders_insert ON provider.orders;
CREATE POLICY orders_insert ON provider.orders
  FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS order_lines_insert ON provider.order_lines;
CREATE POLICY order_lines_insert ON provider.order_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM provider.orders o
      WHERE o.id = order_id
        AND public.auth_user_shares_space(o.provider_space_id)
    )
  );

CREATE OR REPLACE FUNCTION provider.create_dealer_with_space(
  p_provider_space_id UUID,
  p_dealer_name TEXT,
  p_contact_name TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider
AS $$
DECLARE
  v_uid UUID;
  v_email TEXT;
  v_name TEXT;
  v_enrollment UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.auth_user_shares_space(p_provider_space_id) THEN
    RAISE EXCEPTION 'Not a member of this factory space';
  END IF;
  v_name := NULLIF(TRIM(COALESCE(p_dealer_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Dealer name is required';
  END IF;
  v_email := NULLIF(LOWER(TRIM(COALESCE(p_contact_email, ''))), '');
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required so the dealer can claim this record';
  END IF;

  SELECT c.id INTO v_enrollment
  FROM provider.consumers c
  WHERE c.provider_space_id = p_provider_space_id
    AND lower(trim(c.contact_email)) = v_email
  ORDER BY c.consumer_space_id NULLS LAST, c.created_at DESC
  LIMIT 1;

  IF v_enrollment IS NOT NULL THEN
    UPDATE provider.consumers
    SET display_name = v_name,
        contact_name = NULLIF(TRIM(COALESCE(p_contact_name, '')), '')
    WHERE id = v_enrollment;
    RETURN v_enrollment;
  END IF;

  INSERT INTO provider.consumers (
    provider_space_id, consumer_space_id, display_name, contact_name, contact_email, status
  ) VALUES (
    p_provider_space_id,
    NULL,
    v_name,
    NULLIF(TRIM(COALESCE(p_contact_name, '')), ''),
    v_email,
    'pending'
  )
  RETURNING id INTO v_enrollment;

  RETURN v_enrollment;
END;
$$;

COMMENT ON FUNCTION provider.create_dealer_with_space(UUID, TEXT, TEXT, TEXT) IS
  'Factory: pending dealer only. Never creates a consumer space (Vouchap invitee / no on-behalf).';

CREATE OR REPLACE FUNCTION provider.consumer_create_order_from_published_skus(
  p_consumer_space_id UUID,
  p_lines JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider, consumer
AS $$
DECLARE
  v_uid UUID;
  v_provider UUID;
  v_enrollment UUID;
  v_order UUID;
  v_line JSONB;
  v_sku provider.skus%ROWTYPE;
  v_qty NUMERIC;
  v_sort INT := 0;
  v_space_name TEXT;
  v_email TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_consumer_space_id IS NULL OR p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 1 THEN
    RAISE EXCEPTION 'Invalid arguments';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_spaces us
    INNER JOIN public.spaces sp ON sp.id = us.space_id
    WHERE us.user_id = v_uid
      AND us.space_id = p_consumer_space_id
      AND sp.kind = 'consumer'
  ) THEN
    RAISE EXCEPTION 'Not a member of this dealer space';
  END IF;

  SELECT * INTO v_sku
  FROM provider.skus
  WHERE id = (p_lines->0->>'sku_id')::UUID;
  IF NOT FOUND OR v_sku.is_published IS NOT TRUE THEN
    RAISE EXCEPTION 'SKU is not published';
  END IF;
  v_provider := v_sku.provider_space_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_sku FROM provider.skus WHERE id = (v_line->>'sku_id')::UUID;
    IF NOT FOUND OR v_sku.is_published IS NOT TRUE THEN
      RAISE EXCEPTION 'SKU is not published';
    END IF;
    IF v_sku.provider_space_id IS DISTINCT FROM v_provider THEN
      RAISE EXCEPTION 'All SKUs on one order must belong to the same factory';
    END IF;
  END LOOP;

  SELECT c.id INTO v_enrollment
  FROM provider.consumers c
  WHERE c.provider_space_id = v_provider
    AND c.consumer_space_id = p_consumer_space_id
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF v_enrollment IS NULL THEN
    SELECT LOWER(TRIM(COALESCE(au.email, ''))) INTO v_email FROM auth.users au WHERE au.id = v_uid;
    IF v_email IS NOT NULL AND v_email <> '' THEN
      SELECT c.id INTO v_enrollment
      FROM provider.consumers c
      WHERE c.provider_space_id = v_provider
        AND c.consumer_space_id IS NULL
        AND lower(trim(c.contact_email)) = v_email
      ORDER BY c.created_at DESC
      LIMIT 1;
      IF v_enrollment IS NOT NULL THEN
        UPDATE provider.consumers
        SET consumer_space_id = p_consumer_space_id, status = 'approved'
        WHERE id = v_enrollment;
      END IF;
    END IF;
  END IF;

  IF v_enrollment IS NULL THEN
    SELECT name INTO v_space_name FROM public.spaces WHERE id = p_consumer_space_id;
    INSERT INTO provider.consumers (
      provider_space_id, consumer_space_id, display_name, contact_name, contact_email, status
    ) VALUES (
      v_provider, p_consumer_space_id, COALESCE(v_space_name, 'Dealer'), NULL, NULLIF(v_email, ''), 'approved'
    )
    RETURNING id INTO v_enrollment;
  END IF;

  INSERT INTO provider.orders (
    provider_space_id, consumer_id, consumer_space_id, status, created_by, request_origin
  ) VALUES (
    v_provider, v_enrollment, p_consumer_space_id, 'onboarding', v_uid, 'consumer_marketplace'
  )
  RETURNING id INTO v_order;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := GREATEST(COALESCE((v_line->>'quantity')::NUMERIC, 1), 0.001);
    INSERT INTO provider.order_lines (order_id, sku_id, quantity, sort_order)
    VALUES (v_order, (v_line->>'sku_id')::UUID, v_qty, v_sort);
    v_sort := v_sort + 1;
  END LOOP;

  RETURN v_order;
END;
$$;

COMMENT ON FUNCTION provider.consumer_create_order_from_published_skus(UUID, JSONB) IS
  'Dealer Marketplace: only order-create path. Claims pending enrollment by email, never factory-created.';

CREATE OR REPLACE FUNCTION provider.list_pending_dealers_for_me()
RETURNS TABLE (
  id UUID,
  provider_space_id UUID,
  factory_name TEXT,
  dealer_name TEXT,
  contact_email TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, provider
AS $$
  SELECT
    c.id,
    c.provider_space_id,
    COALESCE(sp.name, '')::TEXT AS factory_name,
    COALESCE(c.display_name, '')::TEXT AS dealer_name,
    c.contact_email,
    c.created_at
  FROM provider.consumers c
  INNER JOIN public.spaces sp ON sp.id = c.provider_space_id AND sp.kind = 'provider'
  WHERE c.consumer_space_id IS NULL
    AND c.contact_email IS NOT NULL
    AND lower(trim(c.contact_email)) = (
      SELECT lower(trim(COALESCE(au.email, ''))) FROM auth.users au WHERE au.id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_spaces us
      INNER JOIN public.spaces d ON d.id = us.space_id
      WHERE us.user_id = auth.uid()
        AND d.kind = 'consumer'
    )
  ORDER BY c.created_at DESC;
$$;

COMMENT ON FUNCTION provider.list_pending_dealers_for_me() IS
  'Dealer: pending factory enrollments matching this account email (claim with own space).';

REVOKE ALL ON FUNCTION provider.list_pending_dealers_for_me() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provider.list_pending_dealers_for_me() TO authenticated;
