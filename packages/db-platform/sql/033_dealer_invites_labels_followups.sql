-- Factory dealer CRM: labels, follow-ups, open-invite tokens.
-- Maps Vouchap firm.clients.labels / last_follow_up_at / invite_token_id,
-- firm.client_follow_ups, firm.client_invite_tokens.
-- Open-invite accept is SECURITY DEFINER so Factory still cannot table-insert orders.

ALTER TABLE provider.consumers
  ADD COLUMN IF NOT EXISTS labels TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_follow_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invite_token_id UUID,
  ADD COLUMN IF NOT EXISTS creator_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN provider.consumers.labels IS 'Factory tags (was firm.clients.labels). First tag is the Status pill.';
COMMENT ON COLUMN provider.consumers.last_follow_up_at IS 'Latest follow-up timestamp (was firm.clients.last_follow_up_at).';
COMMENT ON COLUMN provider.consumers.invite_token_id IS 'Set when enrollment is created via open invite.';
COMMENT ON COLUMN provider.consumers.creator_user_id IS 'Factory member who created the pending/email invite row.';

CREATE TABLE IF NOT EXISTS provider.dealer_invite_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  provider_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  inviter_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sku_id UUID NOT NULL REFERENCES provider.skus(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  max_dealers INT
);

CREATE INDEX IF NOT EXISTS idx_dealer_invite_tokens_space
  ON provider.dealer_invite_tokens (provider_space_id, created_at DESC);

COMMENT ON TABLE provider.dealer_invite_tokens IS
  'Open invite (QR / link). Was firm.client_invite_tokens. sku_id is the published catalog SKU attached on accept.';

ALTER TABLE provider.consumers
  DROP CONSTRAINT IF EXISTS provider_consumers_invite_token_id_fkey;
ALTER TABLE provider.consumers
  ADD CONSTRAINT provider_consumers_invite_token_id_fkey
  FOREIGN KEY (invite_token_id) REFERENCES provider.dealer_invite_tokens(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_provider_consumers_invite_token
  ON provider.consumers (invite_token_id)
  WHERE invite_token_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS provider.dealer_follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  consumer_id UUID NOT NULL REFERENCES provider.consumers(id) ON DELETE CASCADE,
  consumer_space_id UUID REFERENCES public.spaces(id) ON DELETE SET NULL,
  content TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'note'
    CHECK (kind IN ('note', 'order_created', 'order_started', 'order_completed', 'order_cancelled')),
  reference_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_dealer_follow_ups_consumer
  ON provider.dealer_follow_ups (consumer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_follow_ups_space
  ON provider.dealer_follow_ups (provider_space_id, created_at DESC);

COMMENT ON TABLE provider.dealer_follow_ups IS
  'Factory follow-up notes and order events (was firm.client_follow_ups).';

ALTER TABLE provider.dealer_invite_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider.dealer_follow_ups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dealer_invite_tokens_select ON provider.dealer_invite_tokens;
CREATE POLICY dealer_invite_tokens_select ON provider.dealer_invite_tokens
  FOR SELECT TO authenticated
  USING (public.auth_user_shares_space(provider_space_id));

DROP POLICY IF EXISTS dealer_invite_tokens_insert ON provider.dealer_invite_tokens;
CREATE POLICY dealer_invite_tokens_insert ON provider.dealer_invite_tokens
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_shares_space(provider_space_id) AND inviter_user_id = auth.uid());

DROP POLICY IF EXISTS dealer_invite_tokens_update ON provider.dealer_invite_tokens;
CREATE POLICY dealer_invite_tokens_update ON provider.dealer_invite_tokens
  FOR UPDATE TO authenticated
  USING (public.auth_user_shares_space(provider_space_id))
  WITH CHECK (public.auth_user_shares_space(provider_space_id));

DROP POLICY IF EXISTS dealer_invite_tokens_delete ON provider.dealer_invite_tokens;
CREATE POLICY dealer_invite_tokens_delete ON provider.dealer_invite_tokens
  FOR DELETE TO authenticated
  USING (public.auth_user_shares_space(provider_space_id));

DROP POLICY IF EXISTS dealer_follow_ups_select ON provider.dealer_follow_ups;
CREATE POLICY dealer_follow_ups_select ON provider.dealer_follow_ups
  FOR SELECT TO authenticated
  USING (public.auth_user_shares_space(provider_space_id));

DROP POLICY IF EXISTS dealer_follow_ups_insert ON provider.dealer_follow_ups;
CREATE POLICY dealer_follow_ups_insert ON provider.dealer_follow_ups
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_shares_space(provider_space_id) AND kind = 'note');

DROP POLICY IF EXISTS dealer_follow_ups_update ON provider.dealer_follow_ups;
CREATE POLICY dealer_follow_ups_update ON provider.dealer_follow_ups
  FOR UPDATE TO authenticated
  USING (false);

DROP POLICY IF EXISTS dealer_follow_ups_delete ON provider.dealer_follow_ups;
CREATE POLICY dealer_follow_ups_delete ON provider.dealer_follow_ups
  FOR DELETE TO authenticated
  USING (public.is_admin_of_space(provider_space_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON provider.dealer_invite_tokens TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider.dealer_follow_ups TO authenticated;
GRANT ALL ON provider.dealer_invite_tokens TO service_role;
GRANT ALL ON provider.dealer_follow_ups TO service_role;

CREATE OR REPLACE FUNCTION provider.set_dealer_last_follow_up_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider
AS $$
BEGIN
  UPDATE provider.consumers
  SET last_follow_up_at = NEW.created_at
  WHERE id = NEW.consumer_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dealer_follow_ups_set_last ON provider.dealer_follow_ups;
CREATE TRIGGER trg_dealer_follow_ups_set_last
  AFTER INSERT ON provider.dealer_follow_ups
  FOR EACH ROW EXECUTE FUNCTION provider.set_dealer_last_follow_up_at();

CREATE OR REPLACE FUNCTION provider.order_insert_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider
AS $$
BEGIN
  INSERT INTO provider.dealer_follow_ups (
    provider_space_id, consumer_id, consumer_space_id, content, kind, reference_id, created_by
  ) VALUES (
    NEW.provider_space_id, NEW.consumer_id, NEW.consumer_space_id,
    'Order created', 'order_created', NEW.id, NEW.created_by
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_insert_follow_up ON provider.orders;
CREATE TRIGGER trg_order_insert_follow_up
  AFTER INSERT ON provider.orders
  FOR EACH ROW EXECUTE FUNCTION provider.order_insert_follow_up();

CREATE OR REPLACE FUNCTION provider.order_update_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'processing' THEN
      INSERT INTO provider.dealer_follow_ups (
        provider_space_id, consumer_id, consumer_space_id, content, kind, reference_id, created_by
      ) VALUES (
        NEW.provider_space_id, NEW.consumer_id, NEW.consumer_space_id,
        'Order started', 'order_started', NEW.id, NEW.created_by
      );
    ELSIF NEW.status = 'completed' THEN
      INSERT INTO provider.dealer_follow_ups (
        provider_space_id, consumer_id, consumer_space_id, content, kind, reference_id, created_by
      ) VALUES (
        NEW.provider_space_id, NEW.consumer_id, NEW.consumer_space_id,
        'Order completed', 'order_completed', NEW.id, NEW.created_by
      );
    ELSIF NEW.status = 'cancelled' THEN
      INSERT INTO provider.dealer_follow_ups (
        provider_space_id, consumer_id, consumer_space_id, content, kind, reference_id, created_by
      ) VALUES (
        NEW.provider_space_id, NEW.consumer_id, NEW.consumer_space_id,
        'Order cancelled', 'order_cancelled', NEW.id, NEW.created_by
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_update_follow_up ON provider.orders;
CREATE TRIGGER trg_order_update_follow_up
  AFTER UPDATE OF status ON provider.orders
  FOR EACH ROW EXECUTE FUNCTION provider.order_update_follow_up();

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
        contact_name = NULLIF(TRIM(COALESCE(p_contact_name, '')), ''),
        creator_user_id = COALESCE(creator_user_id, v_uid)
    WHERE id = v_enrollment;
    RETURN v_enrollment;
  END IF;

  INSERT INTO provider.consumers (
    provider_space_id, consumer_space_id, display_name, contact_name, contact_email, status, creator_user_id
  ) VALUES (
    p_provider_space_id,
    NULL,
    v_name,
    NULLIF(TRIM(COALESCE(p_contact_name, '')), ''),
    v_email,
    'pending',
    v_uid
  )
  RETURNING id INTO v_enrollment;

  RETURN v_enrollment;
END;
$$;

CREATE OR REPLACE FUNCTION public.dealer_open_invite_joined_counts(p_provider_space_id UUID)
RETURNS TABLE (invite_token_id UUID, joined_count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, provider
STABLE
AS $$
  SELECT c.invite_token_id, COUNT(*)::BIGINT
  FROM provider.consumers c
  WHERE c.provider_space_id = p_provider_space_id
    AND c.invite_token_id IS NOT NULL
    AND public.auth_user_shares_space(p_provider_space_id)
  GROUP BY c.invite_token_id;
$$;

CREATE OR REPLACE FUNCTION public.dealer_get_invite_info(p_token TEXT)
RETURNS TABLE (
  provider_space_id UUID,
  factory_name TEXT,
  inviter_user_id UUID,
  sku_id UUID,
  sku_name TEXT,
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
    t.sku_id,
    sku.name AS sku_name,
    t.id AS token_id
  FROM provider.dealer_invite_tokens t
  LEFT JOIN public.spaces s ON s.id = t.provider_space_id
  LEFT JOIN provider.skus sku ON sku.id = t.sku_id
  WHERE t.token = p_token
    AND t.is_active = TRUE
    AND (t.expires_at IS NULL OR t.expires_at > NOW())
    AND (
      t.max_dealers IS NULL
      OR (
        SELECT COUNT(*)::BIGINT
        FROM provider.consumers c
        WHERE c.invite_token_id = t.id
      ) < t.max_dealers
    );
$$;

CREATE OR REPLACE FUNCTION public.dealer_accept_invite_token(
  p_token TEXT,
  p_consumer_space_id UUID
)
RETURNS TABLE (
  provider_space_id UUID,
  consumer_space_id UUID,
  inviter_user_id UUID,
  sku_id UUID,
  order_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider, consumer
AS $$
DECLARE
  v_uid UUID;
  v_token provider.dealer_invite_tokens%ROWTYPE;
  v_sku provider.skus%ROWTYPE;
  v_enrollment UUID;
  v_order UUID;
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

  SELECT * INTO v_sku FROM provider.skus WHERE id = v_token.sku_id;
  IF NOT FOUND OR v_sku.is_published IS NOT TRUE THEN
    RAISE EXCEPTION 'Catalog SKU is not published';
  END IF;
  IF v_sku.provider_space_id IS DISTINCT FROM v_token.provider_space_id THEN
    RAISE EXCEPTION 'SKU does not belong to this factory';
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

  INSERT INTO provider.orders (
    provider_space_id, consumer_id, consumer_space_id, status, created_by, request_origin
  ) VALUES (
    v_token.provider_space_id, v_enrollment, p_consumer_space_id, 'onboarding', v_uid, 'consumer_marketplace'
  )
  RETURNING id INTO v_order;

  INSERT INTO provider.order_lines (order_id, sku_id, quantity, sort_order)
  VALUES (v_order, v_token.sku_id, 1, 0);

  RETURN QUERY SELECT
    v_token.provider_space_id,
    p_consumer_space_id,
    v_token.inviter_user_id,
    v_token.sku_id,
    v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dealer_open_invite_joined_counts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_get_invite_info(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_accept_invite_token(TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
