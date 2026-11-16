-- Wholestore simplified showcase (our-pies style): accent + top/bottom images + SKU order.
-- Apply only on Wholestore project foyecolycmxcneflpant.

-- ---------------------------------------------------------------------------
-- Poster band fields + SKU category for middle-band tag chips
-- ---------------------------------------------------------------------------
ALTER TABLE provider.posters
  ADD COLUMN IF NOT EXISTS accent_color TEXT,
  ADD COLUMN IF NOT EXISTS top_image_url TEXT,
  ADD COLUMN IF NOT EXISTS bottom_image_url TEXT;

COMMENT ON COLUMN provider.posters.accent_color IS 'Showcase accent (e.g. #6C5CE7).';
COMMENT ON COLUMN provider.posters.top_image_url IS 'Top band image (smaller hero strip).';
COMMENT ON COLUMN provider.posters.bottom_image_url IS 'Bottom band image.';

ALTER TABLE provider.skus
  ADD COLUMN IF NOT EXISTS category TEXT;

COMMENT ON COLUMN provider.skus.category IS 'Optional tag for storefront grouping (e.g. CHICKEN, BEEF).';

-- ---------------------------------------------------------------------------
-- Resolve showcase for a dealer enrollment (assigned → featured → default)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION provider.resolve_dealer_showcase_id(
  p_provider_space_id UUID,
  p_consumer_space_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, provider
AS $$
DECLARE
  v_poster UUID;
BEGIN
  IF p_consumer_space_id IS NOT NULL THEN
    SELECT c.poster_id INTO v_poster
    FROM provider.consumers c
    WHERE c.provider_space_id = p_provider_space_id
      AND c.consumer_space_id = p_consumer_space_id
      AND c.status = 'approved'
    ORDER BY c.created_at DESC
    LIMIT 1;
  END IF;

  IF v_poster IS NOT NULL AND EXISTS (
    SELECT 1 FROM provider.posters p
    WHERE p.id = v_poster AND p.provider_space_id = p_provider_space_id
  ) THEN
    RETURN v_poster;
  END IF;

  RETURN provider.marketplace_visible_poster_id(p_provider_space_id);
END;
$$;

GRANT EXECUTE ON FUNCTION provider.resolve_dealer_showcase_id(UUID, UUID) TO authenticated, service_role;

-- Assign showcase to approved dealer (one active showcase per dealer)
CREATE OR REPLACE FUNCTION provider.assign_showcase_to_consumer(
  p_consumer_id UUID,
  p_poster_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider
AS $$
DECLARE
  v_consumer provider.consumers%ROWTYPE;
  v_poster provider.posters%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_consumer FROM provider.consumers WHERE id = p_consumer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dealer not found';
  END IF;
  IF NOT public.auth_user_shares_space(v_consumer.provider_space_id) THEN
    RAISE EXCEPTION 'Not a member of this vendor space';
  END IF;

  IF p_poster_id IS NULL THEN
    UPDATE provider.consumers SET poster_id = NULL WHERE id = p_consumer_id;
    RETURN;
  END IF;

  SELECT * INTO v_poster FROM provider.posters WHERE id = p_poster_id;
  IF NOT FOUND OR v_poster.provider_space_id IS DISTINCT FROM v_consumer.provider_space_id THEN
    RAISE EXCEPTION 'Showcase does not belong to this vendor';
  END IF;

  UPDATE provider.consumers SET poster_id = p_poster_id WHERE id = p_consumer_id;
END;
$$;

REVOKE ALL ON FUNCTION provider.assign_showcase_to_consumer(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provider.assign_showcase_to_consumer(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Open invite accept: persist consumers.poster_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_accept_consumer_invite_token(
  p_token TEXT,
  p_consumer_space_id UUID
)
RETURNS TABLE (
  provider_space_id UUID,
  consumer_space_id UUID,
  inviter_user_id UUID,
  poster_id UUID,
  enrollment_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider, consumer
AS $$
DECLARE
  v_uid UUID;
  v_token provider.consumer_invite_tokens%ROWTYPE;
  v_poster provider.posters%ROWTYPE;
  v_enrollment UUID;
  v_joined BIGINT;
  v_space_name TEXT;
  v_email TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_token IS NULL OR p_consumer_space_id IS NULL THEN
    RAISE EXCEPTION 'token and consumer_space_id are required';
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

  SELECT * INTO v_token FROM provider.consumer_invite_tokens WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid dealer invite token';
  END IF;
  IF v_token.is_active IS FALSE THEN
    RAISE EXCEPTION 'Dealer invite token is inactive';
  END IF;
  IF v_token.expires_at IS NOT NULL AND v_token.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Dealer invite token has expired';
  END IF;

  SELECT COUNT(*)::BIGINT INTO v_joined
  FROM provider.consumers c
  WHERE c.invite_token_id = v_token.id;
  IF v_token.max_consumers IS NOT NULL AND v_joined >= v_token.max_consumers THEN
    RAISE EXCEPTION 'Dealer invite token has reached its maximum usage';
  END IF;

  SELECT * INTO v_poster FROM provider.posters WHERE id = v_token.poster_id;
  IF NOT FOUND OR v_poster.is_published IS NOT TRUE THEN
    RAISE EXCEPTION 'Invite poster is not published';
  END IF;
  IF v_poster.provider_space_id IS DISTINCT FROM v_token.provider_space_id THEN
    RAISE EXCEPTION 'Poster does not belong to this factory';
  END IF;

  SELECT c.id INTO v_enrollment
  FROM provider.consumers c
  WHERE c.provider_space_id = v_token.provider_space_id
    AND c.consumer_space_id = p_consumer_space_id
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF v_enrollment IS NULL THEN
    SELECT LOWER(TRIM(COALESCE(au.email, ''))) INTO v_email FROM auth.users au WHERE au.id = v_uid;
    IF v_email IS NOT NULL AND v_email <> '' THEN
      SELECT c.id INTO v_enrollment
      FROM provider.consumers c
      WHERE c.provider_space_id = v_token.provider_space_id
        AND c.consumer_space_id IS NULL
        AND lower(trim(c.contact_email)) = v_email
      ORDER BY c.created_at DESC
      LIMIT 1;
      IF v_enrollment IS NOT NULL THEN
        UPDATE provider.consumers
        SET consumer_space_id = p_consumer_space_id,
            status = 'approved',
            invite_token_id = COALESCE(invite_token_id, v_token.id),
            poster_id = v_token.poster_id
        WHERE id = v_enrollment;
      END IF;
    END IF;
  END IF;

  IF v_enrollment IS NULL THEN
    SELECT name INTO v_space_name FROM public.spaces WHERE id = p_consumer_space_id;
    INSERT INTO provider.consumers (
      provider_space_id, consumer_space_id, display_name, contact_email, status,
      invite_token_id, creator_user_id, poster_id
    ) VALUES (
      v_token.provider_space_id,
      p_consumer_space_id,
      COALESCE(v_space_name, 'Dealer'),
      NULLIF(v_email, ''),
      'approved',
      v_token.id,
      v_token.inviter_user_id,
      v_token.poster_id
    )
    RETURNING id INTO v_enrollment;
  ELSE
    UPDATE provider.consumers
    SET invite_token_id = COALESCE(invite_token_id, v_token.id),
        poster_id = v_token.poster_id,
        status = CASE WHEN status = 'pending' THEN 'approved' ELSE status END
    WHERE id = v_enrollment;
  END IF;

  RETURN QUERY SELECT
    v_token.provider_space_id,
    p_consumer_space_id,
    v_token.inviter_user_id,
    v_token.poster_id,
    v_enrollment;
END;
$$;

GRANT EXECUTE ON FUNCTION public.provider_accept_consumer_invite_token(TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Dealer storefront payload: resolved showcase + priced SKUs in poster order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION provider.get_dealer_storefront(
  p_consumer_space_id UUID,
  p_provider_space_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, provider
AS $$
DECLARE
  v_uid UUID;
  v_enrollment UUID;
  v_status TEXT;
  v_poster_id UUID;
  v_poster provider.posters%ROWTYPE;
  v_list UUID;
  v_skus JSONB := '[]'::JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.user_id = v_uid AND us.space_id = p_consumer_space_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this dealer space';
  END IF;

  SELECT c.id, c.status INTO v_enrollment, v_status
  FROM provider.consumers c
  WHERE c.provider_space_id = p_provider_space_id
    AND c.consumer_space_id = p_consumer_space_id
  ORDER BY c.created_at DESC
  LIMIT 1;

  v_poster_id := provider.resolve_dealer_showcase_id(p_provider_space_id, p_consumer_space_id);
  IF v_poster_id IS NULL THEN
    RETURN jsonb_build_object(
      'poster', NULL,
      'relation_status', CASE
        WHEN v_enrollment IS NULL THEN 'none'
        WHEN v_status = 'approved' THEN 'enrolled'
        WHEN v_status = 'pending' THEN 'pending'
        ELSE 'none'
      END,
      'skus', '[]'::JSONB
    );
  END IF;

  SELECT * INTO v_poster FROM provider.posters WHERE id = v_poster_id;

  IF v_status = 'approved' AND v_enrollment IS NOT NULL THEN
    v_list := provider.resolve_price_list_id(p_provider_space_id, v_enrollment);
    IF v_list IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(row_to_json(x)::JSONB ORDER BY x.sort_order), '[]'::JSONB)
      INTO v_skus
      FROM (
        SELECT
          s.id AS sku_id,
          s.name,
          s.description,
          s.image_url,
          s.sku_code,
          s.category,
          s.qty_on_hand,
          pli.unit_price,
          pli.moq,
          pl.currency,
          ps.sort_order
        FROM provider.poster_skus ps
        INNER JOIN provider.skus s ON s.id = ps.sku_id
        INNER JOIN provider.price_list_items pli
          ON pli.sku_id = s.id AND pli.price_list_id = v_list
        INNER JOIN provider.price_lists pl ON pl.id = pli.price_list_id
        WHERE ps.poster_id = v_poster_id
          AND s.is_published IS TRUE
          AND s.provider_space_id = p_provider_space_id
      ) x;
    END IF;
  ELSE
    -- Browse-only: published SKUs on the public showcase (no prices)
    SELECT COALESCE(jsonb_agg(row_to_json(x)::JSONB ORDER BY x.sort_order), '[]'::JSONB)
    INTO v_skus
    FROM (
      SELECT
        s.id AS sku_id,
        s.name,
        s.description,
        s.image_url,
        s.sku_code,
        s.category,
        s.qty_on_hand,
        NULL::NUMERIC AS unit_price,
        NULL::NUMERIC AS moq,
        NULL::TEXT AS currency,
        ps.sort_order
      FROM provider.poster_skus ps
      INNER JOIN provider.skus s ON s.id = ps.sku_id
      WHERE ps.poster_id = v_poster_id
        AND s.is_published IS TRUE
        AND s.provider_space_id = p_provider_space_id
    ) x;
  END IF;

  RETURN jsonb_build_object(
    'poster', jsonb_build_object(
      'id', v_poster.id,
      'provider_space_id', v_poster.provider_space_id,
      'name', v_poster.name,
      'description', v_poster.description,
      'image_url', v_poster.image_url,
      'accent_color', v_poster.accent_color,
      'top_image_url', v_poster.top_image_url,
      'bottom_image_url', v_poster.bottom_image_url,
      'is_published', v_poster.is_published,
      'is_marketplace_featured', v_poster.is_marketplace_featured,
      'is_system_default', v_poster.is_system_default
    ),
    'relation_status', CASE
      WHEN v_enrollment IS NULL THEN 'none'
      WHEN v_status = 'approved' THEN 'enrolled'
      WHEN v_status = 'pending' THEN 'pending'
      ELSE 'none'
    END,
    'skus', COALESCE(v_skus, '[]'::JSONB)
  );
END;
$$;

REVOKE ALL ON FUNCTION provider.get_dealer_storefront(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provider.get_dealer_storefront(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
