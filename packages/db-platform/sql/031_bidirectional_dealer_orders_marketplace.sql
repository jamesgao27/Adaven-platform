-- Bidirectional Factory ↔ Dealer (Vouchap firm.clients / firm.orders / marketplace).
-- Dealer enrollment links a consumer space. Orders are shared. Published SKUs are Marketplace.

ALTER TABLE provider.orders
  ADD COLUMN IF NOT EXISTS request_origin TEXT NOT NULL DEFAULT 'provider_manual';

ALTER TABLE provider.orders
  DROP CONSTRAINT IF EXISTS provider_orders_request_origin_check;

ALTER TABLE provider.orders
  ADD CONSTRAINT provider_orders_request_origin_check
  CHECK (request_origin IN ('provider_manual', 'consumer_marketplace'));

COMMENT ON COLUMN provider.orders.request_origin IS
  'provider_manual = Factory created (was firm_manual); consumer_marketplace = Dealer Marketplace.';

CREATE OR REPLACE FUNCTION provider.sync_order_consumer_space()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider
AS $$
BEGIN
  IF NEW.consumer_space_id IS NOT NULL
     AND (OLD.consumer_space_id IS DISTINCT FROM NEW.consumer_space_id) THEN
    UPDATE provider.orders
    SET consumer_space_id = NEW.consumer_space_id
    WHERE consumer_id = NEW.id
      AND (consumer_space_id IS NULL OR consumer_space_id IS DISTINCT FROM NEW.consumer_space_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS provider_consumers_sync_order_space ON provider.consumers;
CREATE TRIGGER provider_consumers_sync_order_space
  AFTER UPDATE OF consumer_space_id ON provider.consumers
  FOR EACH ROW
  EXECUTE FUNCTION provider.sync_order_consumer_space();

-- SKU: Factory sees all; enrolled Dealer sees published only (Marketplace uses DEFINER RPC for all factories).
DROP POLICY IF EXISTS skus_select ON provider.skus;
DROP POLICY IF EXISTS skus_select_provider ON provider.skus;
DROP POLICY IF EXISTS skus_select_enrolled_published ON provider.skus;
CREATE POLICY skus_select_provider ON provider.skus
  FOR SELECT TO authenticated
  USING (public.auth_user_shares_space(provider_space_id));

CREATE POLICY skus_select_enrolled_published ON provider.skus
  FOR SELECT TO authenticated
  USING (
    is_published = TRUE
    AND public.auth_user_consumer_can_see_provider_space(provider_space_id)
  );

-- Orders: Factory or linked Dealer space. Dealer may insert (Marketplace) and cancel onboarding.
DROP POLICY IF EXISTS orders_insert ON provider.orders;
CREATE POLICY orders_insert ON provider.orders
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_user_shares_space(provider_space_id)
    OR (
      consumer_space_id IS NOT NULL
      AND public.auth_user_shares_space(consumer_space_id)
    )
  );

DROP POLICY IF EXISTS orders_update ON provider.orders;
CREATE POLICY orders_update ON provider.orders
  FOR UPDATE TO authenticated
  USING (
    public.auth_user_shares_space(provider_space_id)
    OR (
      consumer_space_id IS NOT NULL
      AND public.auth_user_shares_space(consumer_space_id)
      AND status = 'onboarding'
    )
  )
  WITH CHECK (
    public.auth_user_shares_space(provider_space_id)
    OR (
      consumer_space_id IS NOT NULL
      AND public.auth_user_shares_space(consumer_space_id)
      AND status IN ('onboarding', 'cancelled')
    )
  );

DROP POLICY IF EXISTS order_lines_insert ON provider.order_lines;
CREATE POLICY order_lines_insert ON provider.order_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM provider.orders o
      WHERE o.id = order_id
        AND (
          public.auth_user_shares_space(o.provider_space_id)
          OR (
            o.consumer_space_id IS NOT NULL
            AND public.auth_user_shares_space(o.consumer_space_id)
          )
        )
    )
  );

CREATE OR REPLACE FUNCTION provider.auth_user_is_consumer_space_member()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_spaces us
      INNER JOIN public.spaces sp ON sp.id = us.space_id
      WHERE us.user_id = auth.uid()
        AND sp.kind = 'consumer'
    );
$$;

CREATE OR REPLACE FUNCTION provider.list_published_skus_for_marketplace()
RETURNS TABLE (
  id UUID,
  provider_space_id UUID,
  factory_name TEXT,
  name TEXT,
  description TEXT,
  image_url TEXT,
  is_published BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, provider
AS $$
  SELECT
    s.id,
    s.provider_space_id,
    COALESCE(sp.name, '')::TEXT AS factory_name,
    COALESCE(s.name, '')::TEXT AS name,
    s.description,
    s.image_url,
    s.is_published,
    s.created_at,
    s.updated_at
  FROM provider.skus s
  INNER JOIN public.spaces sp ON sp.id = s.provider_space_id AND sp.kind = 'provider'
  WHERE s.is_published = TRUE
    AND provider.auth_user_is_consumer_space_member()
  ORDER BY s.created_at DESC;
$$;

COMMENT ON FUNCTION provider.list_published_skus_for_marketplace() IS
  'Dealer space members: all published Factory SKUs (was firm.list_published_skus_for_client_catalog).';

REVOKE ALL ON FUNCTION provider.list_published_skus_for_marketplace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provider.list_published_skus_for_marketplace() TO authenticated;
GRANT EXECUTE ON FUNCTION provider.auth_user_is_consumer_space_member() TO authenticated, service_role;

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
    SELECT name INTO v_space_name FROM public.spaces WHERE id = p_consumer_space_id;
    INSERT INTO provider.consumers (
      provider_space_id, consumer_space_id, display_name, status
    ) VALUES (
      v_provider, p_consumer_space_id, COALESCE(v_space_name, 'Dealer'), 'approved'
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
  'Dealer: enroll with Factory if needed, create shared onboarding order (multi-SKU lines).';

REVOKE ALL ON FUNCTION provider.consumer_create_order_from_published_skus(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provider.consumer_create_order_from_published_skus(UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION provider.create_dealer_with_space(
  p_provider_space_id UUID,
  p_dealer_name TEXT,
  p_contact_name TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider, consumer
AS $$
DECLARE
  v_uid UUID;
  v_email TEXT;
  v_inviter_email TEXT;
  v_name TEXT;
  v_space UUID;
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

  SELECT COALESCE(au.email, '') INTO v_inviter_email FROM auth.users au WHERE au.id = v_uid;

  INSERT INTO public.users (id, email, name)
  VALUES (
    v_uid,
    COALESCE(v_inviter_email, ''),
    split_part(COALESCE(NULLIF(v_inviter_email, ''), 'user'), '@', 1)
  )
  ON CONFLICT (id) DO NOTHING;

  IF v_email IS NULL THEN
    INSERT INTO provider.consumers (
      provider_space_id, consumer_space_id, display_name, contact_name, contact_email, status
    ) VALUES (
      p_provider_space_id, NULL, v_name, NULLIF(TRIM(COALESCE(p_contact_name, '')), ''), NULL, 'pending'
    )
    RETURNING id INTO v_enrollment;
    RETURN v_enrollment;
  END IF;

  INSERT INTO public.spaces (name, kind)
  VALUES (v_name, 'consumer')
  RETURNING id INTO v_space;

  INSERT INTO consumer.consumers (space_id, status) VALUES (v_space, 'pending');

  INSERT INTO public.space_invitations (
    space_id, inviter_id, inviter_email, invitee_email, space_name, invite_as_admin, status, created_at
  ) VALUES (
    v_space, v_uid, v_inviter_email, v_email, v_name, TRUE, 'pending', NOW()
  );

  INSERT INTO provider.consumers (
    provider_space_id, consumer_space_id, display_name, contact_name, contact_email, status
  ) VALUES (
    p_provider_space_id, v_space, v_name, NULLIF(TRIM(COALESCE(p_contact_name, '')), ''), v_email, 'approved'
  )
  RETURNING id INTO v_enrollment;

  RETURN v_enrollment;
END;
$$;

COMMENT ON FUNCTION provider.create_dealer_with_space(UUID, TEXT, TEXT, TEXT) IS
  'Factory: create dealer. With email → consumer space + admin invite + linked enrollment (was firm_create_client_on_behalf). Without email → pending row.';

REVOKE ALL ON FUNCTION provider.create_dealer_with_space(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provider.create_dealer_with_space(UUID, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION provider.claim_pending_dealer(
  p_enrollment_id UUID,
  p_consumer_space_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider
AS $$
DECLARE
  v_uid UUID;
  v_email TEXT;
  r provider.consumers%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
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

  SELECT * INTO r FROM provider.consumers WHERE id = p_enrollment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dealer record not found';
  END IF;
  IF r.consumer_space_id IS NOT NULL THEN
    RAISE EXCEPTION 'Dealer is already linked to a space';
  END IF;

  SELECT LOWER(TRIM(COALESCE(au.email, ''))) INTO v_email FROM auth.users au WHERE au.id = v_uid;
  IF r.contact_email IS NULL OR LOWER(TRIM(r.contact_email)) IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'Invite email does not match this account';
  END IF;

  UPDATE provider.consumers
  SET consumer_space_id = p_consumer_space_id, status = 'approved'
  WHERE id = p_enrollment_id;
END;
$$;

COMMENT ON FUNCTION provider.claim_pending_dealer(UUID, UUID) IS
  'Dealer space member whose email matches pending enrollment claims it (writes consumer_space_id; orders backfill).';

REVOKE ALL ON FUNCTION provider.claim_pending_dealer(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provider.claim_pending_dealer(UUID, UUID) TO authenticated;
