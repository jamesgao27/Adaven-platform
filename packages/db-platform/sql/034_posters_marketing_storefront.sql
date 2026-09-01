-- Posters (Marketing) + exclusive-store Marketplace + open invite bound to a poster.
-- Poster ≈ Vouchap firm.skus (cover / intro / publish). Product SKU stays provider.skus.
-- M:N via provider.poster_skus. Accepting an invite enrolls only — no order.

CREATE TABLE IF NOT EXISTS provider.posters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  description TEXT,
  image_url TEXT,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  is_marketplace_featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_system_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posters_provider_space
  ON provider.posters (provider_space_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS posters_one_default_per_factory
  ON provider.posters (provider_space_id)
  WHERE is_system_default;

CREATE UNIQUE INDEX IF NOT EXISTS posters_one_featured_per_factory
  ON provider.posters (provider_space_id)
  WHERE is_marketplace_featured;

COMMENT ON TABLE provider.posters IS
  'Factory marketing posters. One system default per factory hangs all published SKUs. Optional featured poster is shown on Marketplace.';

CREATE TABLE IF NOT EXISTS provider.poster_skus (
  poster_id UUID NOT NULL REFERENCES provider.posters(id) ON DELETE CASCADE,
  sku_id UUID NOT NULL REFERENCES provider.skus(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (poster_id, sku_id)
);

CREATE INDEX IF NOT EXISTS idx_poster_skus_sku ON provider.poster_skus (sku_id);

COMMENT ON TABLE provider.poster_skus IS
  'M:N poster ↔ catalog SKU. Independent of orders.order_lines.';

ALTER TABLE provider.posters ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider.poster_skus ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS posters_select ON provider.posters;
CREATE POLICY posters_select ON provider.posters
  FOR SELECT TO authenticated
  USING (public.auth_user_shares_space(provider_space_id));

DROP POLICY IF EXISTS posters_insert ON provider.posters;
CREATE POLICY posters_insert ON provider.posters
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_shares_space(provider_space_id));

DROP POLICY IF EXISTS posters_update ON provider.posters;
CREATE POLICY posters_update ON provider.posters
  FOR UPDATE TO authenticated
  USING (public.auth_user_shares_space(provider_space_id))
  WITH CHECK (public.auth_user_shares_space(provider_space_id));

DROP POLICY IF EXISTS posters_delete ON provider.posters;
CREATE POLICY posters_delete ON provider.posters
  FOR DELETE TO authenticated
  USING (public.auth_user_shares_space(provider_space_id) AND is_system_default = FALSE);

DROP POLICY IF EXISTS poster_skus_select ON provider.poster_skus;
CREATE POLICY poster_skus_select ON provider.poster_skus
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM provider.posters p
      WHERE p.id = poster_id AND public.auth_user_shares_space(p.provider_space_id)
    )
  );

DROP POLICY IF EXISTS poster_skus_write ON provider.poster_skus;
CREATE POLICY poster_skus_write ON provider.poster_skus
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM provider.posters p
      WHERE p.id = poster_id
        AND public.auth_user_shares_space(p.provider_space_id)
        AND p.is_system_default = FALSE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM provider.posters p
      WHERE p.id = poster_id
        AND public.auth_user_shares_space(p.provider_space_id)
        AND p.is_system_default = FALSE
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON provider.posters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider.poster_skus TO authenticated;
GRANT ALL ON provider.posters TO service_role;
GRANT ALL ON provider.poster_skus TO service_role;

CREATE OR REPLACE FUNCTION provider.set_poster_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_posters_updated_at ON provider.posters;
CREATE TRIGGER trg_posters_updated_at
  BEFORE UPDATE ON provider.posters
  FOR EACH ROW EXECUTE FUNCTION provider.set_poster_updated_at();

CREATE OR REPLACE FUNCTION provider.unset_other_featured_posters()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider
AS $$
BEGIN
  IF NEW.is_marketplace_featured THEN
    UPDATE provider.posters
    SET is_marketplace_featured = FALSE
    WHERE provider_space_id = NEW.provider_space_id
      AND id <> NEW.id
      AND is_marketplace_featured;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_posters_single_featured ON provider.posters;
CREATE TRIGGER trg_posters_single_featured
  BEFORE INSERT OR UPDATE OF is_marketplace_featured ON provider.posters
  FOR EACH ROW
  WHEN (NEW.is_marketplace_featured)
  EXECUTE FUNCTION provider.unset_other_featured_posters();

CREATE OR REPLACE FUNCTION provider.ensure_default_poster(p_provider_space_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider
AS $$
DECLARE
  v_id UUID;
  v_name TEXT;
  v_desc TEXT;
  v_has_featured BOOLEAN;
BEGIN
  IF p_provider_space_id IS NULL THEN
    RAISE EXCEPTION 'provider_space_id is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.spaces WHERE id = p_provider_space_id AND kind = 'provider') THEN
    RAISE EXCEPTION 'Not a factory space';
  END IF;

  SELECT id INTO v_id
  FROM provider.posters
  WHERE provider_space_id = p_provider_space_id AND is_system_default
  LIMIT 1;

  IF v_id IS NULL THEN
    SELECT s.name, s.address INTO v_name, v_desc
    FROM public.spaces s
    WHERE s.id = p_provider_space_id;

    SELECT EXISTS (
      SELECT 1 FROM provider.posters
      WHERE provider_space_id = p_provider_space_id AND is_marketplace_featured
    ) INTO v_has_featured;

    INSERT INTO provider.posters (
      provider_space_id, name, description, is_published, is_system_default, is_marketplace_featured
    ) VALUES (
      p_provider_space_id,
      COALESCE(NULLIF(TRIM(v_name), ''), 'Store'),
      NULLIF(TRIM(COALESCE(v_desc, '')), ''),
      TRUE,
      TRUE,
      NOT v_has_featured
    )
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO provider.poster_skus (poster_id, sku_id, sort_order)
  SELECT v_id, s.id, 0
  FROM provider.skus s
  WHERE s.provider_space_id = p_provider_space_id
    AND s.is_published
  ON CONFLICT DO NOTHING;

  DELETE FROM provider.poster_skus ps
  USING provider.skus s
  WHERE ps.poster_id = v_id
    AND ps.sku_id = s.id
    AND s.is_published IS NOT TRUE;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION provider.ensure_default_poster(UUID) IS
  'Idempotent: one default poster per factory, attached to every published SKU.';

CREATE OR REPLACE FUNCTION public.ensure_factory_default_poster(p_provider_space_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider
AS $$
BEGIN
  IF NOT public.auth_user_shares_space(p_provider_space_id) THEN
    RAISE EXCEPTION 'Not a member of this factory';
  END IF;
  RETURN provider.ensure_default_poster(p_provider_space_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_factory_default_poster(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION provider.sync_sku_to_default_poster()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider
AS $$
DECLARE
  v_poster UUID;
  v_space UUID;
  v_published BOOLEAN;
  v_sku UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_space := OLD.provider_space_id;
    v_sku := OLD.id;
    v_published := FALSE;
  ELSE
    v_space := NEW.provider_space_id;
    v_sku := NEW.id;
    v_published := NEW.is_published;
  END IF;

  v_poster := provider.ensure_default_poster(v_space);

  IF v_published THEN
    INSERT INTO provider.poster_skus (poster_id, sku_id, sort_order)
    VALUES (v_poster, v_sku, 0)
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM provider.poster_skus
    WHERE poster_id = v_poster AND sku_id = v_sku;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_skus_sync_default_poster ON provider.skus;
CREATE TRIGGER trg_skus_sync_default_poster
  AFTER INSERT OR UPDATE OF is_published OR DELETE ON provider.skus
  FOR EACH ROW EXECUTE FUNCTION provider.sync_sku_to_default_poster();

-- Default poster SKU rows are written by DEFINER functions (bypass RLS).
-- Recreate poster_skus write policy after table exists; default poster stays factory-owned via SELECT.

CREATE OR REPLACE FUNCTION public.create_space_core(
  p_space_name TEXT,
  p_space_address TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_kind TEXT DEFAULT 'consumer'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider, consumer
AS $$
DECLARE
  v_user_id UUID;
  v_space_id UUID;
  v_kind TEXT;
  v_email TEXT;
  v_name TEXT;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_kind := COALESCE(NULLIF(TRIM(LOWER(p_kind)), ''), 'consumer');
  IF v_kind NOT IN ('provider', 'consumer') THEN
    RAISE EXCEPTION 'kind must be provider or consumer';
  END IF;

  INSERT INTO public.spaces (name, address, kind)
  VALUES (
    p_space_name,
    NULLIF(TRIM(COALESCE(p_space_address, '')), ''),
    v_kind
  )
  RETURNING id INTO v_space_id;

  IF v_kind = 'provider' THEN
    INSERT INTO provider.providers (space_id, status)
    VALUES (v_space_id, 'pending');
    PERFORM provider.ensure_default_poster(v_space_id);
  ELSE
    INSERT INTO consumer.consumers (space_id, status)
    VALUES (v_space_id, 'pending');
  END IF;

  SELECT COALESCE(au.email, ''), COALESCE(au.raw_user_meta_data->>'name', split_part(COALESCE(au.email, 'user'), '@', 1))
    INTO v_email, v_name
  FROM auth.users au
  WHERE au.id = v_user_id;

  INSERT INTO public.users (id, email, name, current_space_id)
  VALUES (v_user_id, COALESCE(v_email, ''), v_name, v_space_id)
  ON CONFLICT (id) DO UPDATE SET current_space_id = EXCLUDED.current_space_id;

  INSERT INTO public.user_spaces (user_id, space_id, is_admin)
  VALUES (v_user_id, v_space_id, TRUE)
  ON CONFLICT (user_id, space_id) DO NOTHING;

  UPDATE public.users SET current_space_id = v_space_id WHERE id = v_user_id;

  RETURN v_space_id;
END;
$$;

COMMENT ON FUNCTION public.create_space_core(TEXT, TEXT, UUID, TEXT) IS
  'Wholestore: create space + admin membership + provider/consumer row. Factory spaces get a default poster.';

-- Backfill existing factories
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.spaces WHERE kind = 'provider'
  LOOP
    PERFORM provider.ensure_default_poster(r.id);
  END LOOP;
END $$;

-- Open invite: drop sku_id, require poster_id
ALTER TABLE provider.dealer_invite_tokens
  ADD COLUMN IF NOT EXISTS poster_id UUID REFERENCES provider.posters(id) ON DELETE RESTRICT;

UPDATE provider.dealer_invite_tokens t
SET poster_id = p.id
FROM provider.posters p
WHERE t.poster_id IS NULL
  AND p.provider_space_id = t.provider_space_id
  AND p.is_system_default;

DELETE FROM provider.dealer_invite_tokens WHERE poster_id IS NULL;

ALTER TABLE provider.dealer_invite_tokens
  ALTER COLUMN poster_id SET NOT NULL;

ALTER TABLE provider.dealer_invite_tokens
  DROP COLUMN IF EXISTS sku_id;

COMMENT ON TABLE provider.dealer_invite_tokens IS
  'Open invite (QR / link). poster_id is required. Accept enrolls the dealer — does not create an order.';

CREATE OR REPLACE FUNCTION provider.invite_requires_published_poster()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM provider.posters p
    WHERE p.id = NEW.poster_id
      AND p.provider_space_id = NEW.provider_space_id
      AND p.is_published
  ) THEN
    RAISE EXCEPTION 'Open invite must use a published poster from this factory';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invite_requires_published_poster ON provider.dealer_invite_tokens;
CREATE TRIGGER trg_invite_requires_published_poster
  BEFORE INSERT OR UPDATE OF poster_id, provider_space_id ON provider.dealer_invite_tokens
  FOR EACH ROW EXECUTE FUNCTION provider.invite_requires_published_poster();

DROP FUNCTION IF EXISTS public.dealer_get_invite_info(TEXT);
CREATE OR REPLACE FUNCTION public.dealer_get_invite_info(p_token TEXT)
RETURNS TABLE (
  provider_space_id UUID,
  factory_name TEXT,
  inviter_user_id UUID,
  poster_id UUID,
  poster_name TEXT,
  poster_description TEXT,
  sku_summary TEXT,
  token_id UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, provider
STABLE
AS $$
  SELECT
    t.provider_space_id,
    s.name AS factory_name,
    t.inviter_user_id,
    t.poster_id,
    p.name AS poster_name,
    p.description AS poster_description,
    (
      SELECT string_agg(sku.name, ', ' ORDER BY sku.name)
      FROM provider.poster_skus ps
      INNER JOIN provider.skus sku ON sku.id = ps.sku_id AND sku.is_published
      WHERE ps.poster_id = t.poster_id
    ) AS sku_summary,
    t.id AS token_id
  FROM provider.dealer_invite_tokens t
  LEFT JOIN public.spaces s ON s.id = t.provider_space_id
  LEFT JOIN provider.posters p ON p.id = t.poster_id
  WHERE t.token = p_token
    AND t.is_active = TRUE
    AND (t.expires_at IS NULL OR t.expires_at > NOW())
    AND p.is_published = TRUE
    AND (
      t.max_dealers IS NULL
      OR (
        SELECT COUNT(*)::BIGINT
        FROM provider.consumers c
        WHERE c.invite_token_id = t.id
      ) < t.max_dealers
    );
$$;

DROP FUNCTION IF EXISTS public.dealer_accept_invite_token(TEXT, UUID);
CREATE OR REPLACE FUNCTION public.dealer_accept_invite_token(
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
  v_token provider.dealer_invite_tokens%ROWTYPE;
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

  SELECT * INTO v_token FROM provider.dealer_invite_tokens WHERE token = p_token;
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
  IF v_token.max_dealers IS NOT NULL AND v_joined >= v_token.max_dealers THEN
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
            invite_token_id = COALESCE(invite_token_id, v_token.id)
        WHERE id = v_enrollment;
      END IF;
    END IF;
  END IF;

  IF v_enrollment IS NULL THEN
    SELECT name INTO v_space_name FROM public.spaces WHERE id = p_consumer_space_id;
    INSERT INTO provider.consumers (
      provider_space_id, consumer_space_id, display_name, contact_email, status, invite_token_id, creator_user_id
    ) VALUES (
      v_token.provider_space_id,
      p_consumer_space_id,
      COALESCE(v_space_name, 'Dealer'),
      NULLIF(v_email, ''),
      'approved',
      v_token.id,
      v_token.inviter_user_id
    )
    RETURNING id INTO v_enrollment;
  ELSIF NOT EXISTS (
    SELECT 1 FROM provider.consumers c WHERE c.id = v_enrollment AND c.invite_token_id IS NOT NULL
  ) THEN
    UPDATE provider.consumers SET invite_token_id = v_token.id WHERE id = v_enrollment AND invite_token_id IS NULL;
  END IF;

  RETURN QUERY SELECT
    v_token.provider_space_id,
    p_consumer_space_id,
    v_token.inviter_user_id,
    v_token.poster_id,
    v_enrollment;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dealer_get_invite_info(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_accept_invite_token(TEXT, UUID) TO authenticated;

-- Marketplace: one poster per factory (featured published, else default published)
CREATE OR REPLACE FUNCTION provider.list_marketplace_factory_posters()
RETURNS TABLE (
  provider_space_id UUID,
  factory_name TEXT,
  poster_id UUID,
  poster_name TEXT,
  poster_description TEXT,
  image_url TEXT,
  is_system_default BOOLEAN,
  sku_count BIGINT
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
    ) AS sku_count
  FROM visible v
  ORDER BY v.factory_name;
$$;

COMMENT ON FUNCTION provider.list_marketplace_factory_posters() IS
  'Dealer: one intro poster per factory (featured if published, else default). Exclusive-store step 1.';

CREATE OR REPLACE FUNCTION provider.list_store_skus_for_factory(p_provider_space_id UUID)
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
  WITH vis AS (
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
    LIMIT 1
  )
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
  INNER JOIN vis ON TRUE
  INNER JOIN provider.poster_skus ps ON ps.poster_id = vis.id AND ps.sku_id = s.id
  INNER JOIN public.spaces sp ON sp.id = s.provider_space_id AND sp.kind = 'provider'
  WHERE s.is_published
    AND s.provider_space_id = p_provider_space_id
    AND provider.auth_user_is_consumer_space_member()
  ORDER BY s.name;
$$;

COMMENT ON FUNCTION provider.list_store_skus_for_factory(UUID) IS
  'Dealer: published SKUs on the factory Marketplace poster (storefront step 2).';

CREATE OR REPLACE FUNCTION provider.get_marketplace_factory_poster(p_provider_space_id UUID)
RETURNS TABLE (
  provider_space_id UUID,
  factory_name TEXT,
  poster_id UUID,
  poster_name TEXT,
  poster_description TEXT,
  image_url TEXT,
  is_system_default BOOLEAN
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
    p.is_system_default
  FROM provider.posters p
  INNER JOIN public.spaces sp ON sp.id = p.provider_space_id AND sp.kind = 'provider'
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
    AND provider.auth_user_is_consumer_space_member()
  ORDER BY p.is_marketplace_featured DESC, p.is_system_default DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION provider.list_marketplace_factory_posters() FROM PUBLIC;
REVOKE ALL ON FUNCTION provider.list_store_skus_for_factory(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION provider.get_marketplace_factory_poster(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provider.list_marketplace_factory_posters() TO authenticated;
GRANT EXECUTE ON FUNCTION provider.list_store_skus_for_factory(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION provider.get_marketplace_factory_poster(UUID) TO authenticated;

COMMENT ON FUNCTION provider.list_published_skus_for_marketplace() IS
  'Reserved for a future multi-factory SKU grid. Current Marketplace UI uses list_marketplace_factory_posters + list_store_skus_for_factory.';

NOTIFY pgrst, 'reload schema';
