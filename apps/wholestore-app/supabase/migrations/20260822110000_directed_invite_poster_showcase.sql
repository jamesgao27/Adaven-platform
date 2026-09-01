-- Directed invite binds a poster. Marketplace: unbound = showcase (apply only); bound = store (order).

ALTER TABLE provider.consumers
  ADD COLUMN IF NOT EXISTS poster_id UUID REFERENCES provider.posters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_provider_consumers_poster
  ON provider.consumers (poster_id)
  WHERE poster_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_provider_consumers_linked_space
  ON provider.consumers (provider_space_id, consumer_space_id)
  WHERE consumer_space_id IS NOT NULL;

COMMENT ON COLUMN provider.consumers.poster_id IS
  'Poster attached to a directed invite or a dealer application.';

CREATE OR REPLACE FUNCTION provider.marketplace_visible_poster_id(p_provider_space_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, provider
AS $$
  SELECT p.id
  FROM provider.posters p
  WHERE p.provider_space_id = p_provider_space_id
    AND p.is_published
    AND (
      p.is_marketplace_featured
      OR (
        p.is_system_default
        AND NOT EXISTS (
          SELECT 1
          FROM provider.posters f
          WHERE f.provider_space_id = p.provider_space_id
            AND f.is_marketplace_featured
            AND f.is_published
        )
      )
    )
  ORDER BY p.is_marketplace_featured DESC, p.is_system_default DESC
  LIMIT 1;
$$;

DROP FUNCTION IF EXISTS provider.create_dealer_with_space(UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION provider.create_dealer_with_space(
  p_provider_space_id UUID,
  p_dealer_name TEXT,
  p_contact_name TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL,
  p_poster_id UUID DEFAULT NULL
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
  v_poster provider.posters%ROWTYPE;
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
  IF p_poster_id IS NULL THEN
    RAISE EXCEPTION 'A published poster is required for a directed invite';
  END IF;

  SELECT * INTO v_poster FROM provider.posters WHERE id = p_poster_id;
  IF NOT FOUND OR v_poster.is_published IS NOT TRUE THEN
    RAISE EXCEPTION 'Directed invite must use a published poster';
  END IF;
  IF v_poster.provider_space_id IS DISTINCT FROM p_provider_space_id THEN
    RAISE EXCEPTION 'Poster does not belong to this factory';
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
        contact_name = NULLIF(TRIM(COALESCE(p_contact_name, '')), ''),
        creator_user_id = COALESCE(creator_user_id, v_uid),
        poster_id = p_poster_id
    WHERE id = v_enrollment;
    RETURN v_enrollment;
  END IF;

  INSERT INTO provider.consumers (
    provider_space_id, consumer_space_id, display_name, contact_name, contact_email,
    status, creator_user_id, poster_id
  ) VALUES (
    p_provider_space_id,
    NULL,
    v_name,
    NULLIF(TRIM(COALESCE(p_contact_name, '')), ''),
    v_email,
    'pending',
    v_uid,
    p_poster_id
  )
  RETURNING id INTO v_enrollment;

  RETURN v_enrollment;
END;
$$;

COMMENT ON FUNCTION provider.create_dealer_with_space(UUID, TEXT, TEXT, TEXT, UUID) IS
  'Factory: pending dealer only. Requires a published poster. Never creates a consumer space.';

GRANT EXECUTE ON FUNCTION provider.create_dealer_with_space(UUID, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION provider.dealer_apply_to_factory(
  p_provider_space_id UUID,
  p_consumer_space_id UUID
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
  v_poster UUID;
  v_status TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_provider_space_id IS NULL OR p_consumer_space_id IS NULL THEN
    RAISE EXCEPTION 'factory and dealer space are required';
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
  IF NOT EXISTS (SELECT 1 FROM public.spaces WHERE id = p_provider_space_id AND kind = 'provider') THEN
    RAISE EXCEPTION 'Not a factory space';
  END IF;

  v_poster := provider.marketplace_visible_poster_id(p_provider_space_id);
  IF v_poster IS NULL THEN
    RAISE EXCEPTION 'This factory has no published poster';
  END IF;

  SELECT c.id, c.status INTO v_enrollment, v_status
  FROM provider.consumers c
  WHERE c.provider_space_id = p_provider_space_id
    AND c.consumer_space_id = p_consumer_space_id
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF v_enrollment IS NOT NULL THEN
    UPDATE provider.consumers
    SET poster_id = COALESCE(poster_id, v_poster)
    WHERE id = v_enrollment AND poster_id IS NULL;
    RETURN v_enrollment;
  END IF;

  SELECT LOWER(TRIM(COALESCE(au.email, ''))) INTO v_email FROM auth.users au WHERE au.id = v_uid;
  SELECT name INTO v_name FROM public.spaces WHERE id = p_consumer_space_id;

  IF v_email IS NOT NULL AND v_email <> '' THEN
    SELECT c.id INTO v_enrollment
    FROM provider.consumers c
    WHERE c.provider_space_id = p_provider_space_id
      AND c.consumer_space_id IS NULL
      AND lower(trim(c.contact_email)) = v_email
    ORDER BY c.created_at DESC
    LIMIT 1;
    IF v_enrollment IS NOT NULL THEN
      UPDATE provider.consumers
      SET consumer_space_id = p_consumer_space_id,
          status = 'approved',
          poster_id = COALESCE(poster_id, v_poster)
      WHERE id = v_enrollment;
      RETURN v_enrollment;
    END IF;
  END IF;

  INSERT INTO provider.consumers (
    provider_space_id, consumer_space_id, display_name, contact_email, status, poster_id
  ) VALUES (
    p_provider_space_id,
    p_consumer_space_id,
    COALESCE(v_name, 'Dealer'),
    NULLIF(v_email, ''),
    'pending',
    v_poster
  )
  RETURNING id INTO v_enrollment;

  RETURN v_enrollment;
END;
$$;

COMMENT ON FUNCTION provider.dealer_apply_to_factory(UUID, UUID) IS
  'Dealer: apply from a factory showcase. Existing factory email invite is claimed as approved; otherwise pending until Factory approves.';

GRANT EXECUTE ON FUNCTION provider.dealer_apply_to_factory(UUID, UUID) TO authenticated;

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
  v_status TEXT;
  v_order UUID;
  v_line JSONB;
  v_sku provider.skus%ROWTYPE;
  v_qty NUMERIC;
  v_sort INT := 0;
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

  SELECT c.id, c.status INTO v_enrollment, v_status
  FROM provider.consumers c
  WHERE c.provider_space_id = v_provider
    AND c.consumer_space_id = p_consumer_space_id
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF v_enrollment IS NULL OR v_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'You can order only after this factory accepts you as a dealer';
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
  'Dealer store order. Requires an approved enrollment. Showcase factories cannot sell.';

DROP FUNCTION IF EXISTS provider.list_marketplace_factory_posters();
CREATE OR REPLACE FUNCTION provider.list_marketplace_factory_posters()
RETURNS TABLE (
  provider_space_id UUID,
  factory_name TEXT,
  poster_id UUID,
  poster_name TEXT,
  poster_description TEXT,
  image_url TEXT,
  is_system_default BOOLEAN,
  sku_count BIGINT,
  relation_status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, provider
AS $$
  WITH visible AS (
    SELECT DISTINCT ON (p.provider_space_id)
      p.provider_space_id,
      COALESCE(sp.name, '')::TEXT AS factory_name,
      p.id AS poster_id,
      COALESCE(p.name, '')::TEXT AS poster_name,
      p.description AS poster_description,
      p.image_url,
      p.is_system_default
    FROM provider.posters p
    INNER JOIN public.spaces sp ON sp.id = p.provider_space_id AND sp.kind = 'provider'
    WHERE p.is_published
      AND (
        p.is_marketplace_featured
        OR (
          p.is_system_default
          AND NOT EXISTS (
            SELECT 1
            FROM provider.posters f
            WHERE f.provider_space_id = p.provider_space_id
              AND f.is_marketplace_featured
              AND f.is_published
          )
        )
      )
      AND provider.auth_user_is_consumer_space_member()
    ORDER BY p.provider_space_id, p.is_marketplace_featured DESC, p.is_system_default DESC
  )
  SELECT
    v.provider_space_id,
    v.factory_name,
    v.poster_id,
    v.poster_name,
    v.poster_description,
    v.image_url,
    v.is_system_default,
    (
      SELECT COUNT(*)::BIGINT
      FROM provider.poster_skus ps
      INNER JOIN provider.skus s ON s.id = ps.sku_id AND s.is_published
      WHERE ps.poster_id = v.poster_id
    ) AS sku_count,
    COALESCE((
      SELECT CASE
        WHEN c.status = 'approved' THEN 'enrolled'
        ELSE 'pending'
      END
      FROM provider.consumers c
      INNER JOIN public.user_spaces us ON us.space_id = c.consumer_space_id AND us.user_id = auth.uid()
      INNER JOIN public.spaces ds ON ds.id = us.space_id AND ds.kind = 'consumer'
      WHERE c.provider_space_id = v.provider_space_id
      ORDER BY CASE WHEN c.status = 'approved' THEN 0 ELSE 1 END, c.created_at DESC
      LIMIT 1
    ), 'none') AS relation_status
  FROM visible v
  ORDER BY v.factory_name;
$$;

GRANT EXECUTE ON FUNCTION provider.list_marketplace_factory_posters() TO authenticated;

DROP FUNCTION IF EXISTS provider.get_marketplace_factory_poster(UUID);
CREATE OR REPLACE FUNCTION provider.get_marketplace_factory_poster(p_provider_space_id UUID)
RETURNS TABLE (
  provider_space_id UUID,
  factory_name TEXT,
  poster_id UUID,
  poster_name TEXT,
  poster_description TEXT,
  image_url TEXT,
  is_system_default BOOLEAN,
  relation_status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, provider
AS $$
  SELECT
    p.provider_space_id,
    COALESCE(sp.name, '')::TEXT AS factory_name,
    p.id AS poster_id,
    COALESCE(p.name, '')::TEXT AS poster_name,
    p.description AS poster_description,
    p.image_url,
    p.is_system_default,
    COALESCE((
      SELECT CASE
        WHEN c.status = 'approved' THEN 'enrolled'
        ELSE 'pending'
      END
      FROM provider.consumers c
      INNER JOIN public.user_spaces us ON us.space_id = c.consumer_space_id AND us.user_id = auth.uid()
      INNER JOIN public.spaces ds ON ds.id = us.space_id AND ds.kind = 'consumer'
      WHERE c.provider_space_id = p.provider_space_id
      ORDER BY CASE WHEN c.status = 'approved' THEN 0 ELSE 1 END, c.created_at DESC
      LIMIT 1
    ), 'none') AS relation_status
  FROM provider.posters p
  INNER JOIN public.spaces sp ON sp.id = p.provider_space_id AND sp.kind = 'provider'
  WHERE p.provider_space_id = p_provider_space_id
    AND p.id = provider.marketplace_visible_poster_id(p_provider_space_id)
    AND provider.auth_user_is_consumer_space_member();
$$;

GRANT EXECUTE ON FUNCTION provider.get_marketplace_factory_poster(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
