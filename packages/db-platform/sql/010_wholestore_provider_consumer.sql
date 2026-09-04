-- Wholestore overlay on the platform kernel (spaces.kind is already provider | consumer).
-- Product UI: Vendor = provider, Dealer = consumer.
-- Table map vs Vouchap product schema (not kernel kinds): firm.* → provider.*; client space extras → consumer.*.
-- No orders, prices, ERP, invoices.

CREATE SCHEMA IF NOT EXISTS provider;
CREATE SCHEMA IF NOT EXISTS consumer;

GRANT USAGE ON SCHEMA provider TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA consumer TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA provider TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA consumer TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA provider TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA consumer TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA provider GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA consumer GRANT ALL ON TABLES TO anon, authenticated, service_role;

-- Factory (provider space) extras — 1:1 with public.spaces where kind = provider
CREATE TABLE IF NOT EXISTS provider.providers (
  space_id UUID PRIMARY KEY REFERENCES public.spaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  verification_attachment_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE provider.providers IS 'Factory extras for a provider space. Name/address live on public.spaces.';
COMMENT ON COLUMN provider.providers.status IS 'pending = awaiting review; approved = Factory can enroll Dealers.';

DROP TRIGGER IF EXISTS providers_set_updated_at ON provider.providers;
CREATE TRIGGER providers_set_updated_at
  BEFORE UPDATE ON provider.providers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Dealer (consumer space) extras — 1:1 with public.spaces where kind = consumer
CREATE TABLE IF NOT EXISTS consumer.consumers (
  space_id UUID PRIMARY KEY REFERENCES public.spaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE consumer.consumers IS 'Dealer extras for a consumer space. Name/address live on public.spaces.';
COMMENT ON COLUMN consumer.consumers.status IS 'Space-level status; enrollment with a Factory is provider.consumers.';

DROP TRIGGER IF EXISTS consumers_set_updated_at ON consumer.consumers;
CREATE TRIGGER consumers_set_updated_at
  BEFORE UPDATE ON consumer.consumers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Factory ↔ Dealer enrollment (was firm.clients)
CREATE TABLE IF NOT EXISTS provider.consumers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  consumer_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_space_id, consumer_space_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_consumers_provider ON provider.consumers (provider_space_id);
CREATE INDEX IF NOT EXISTS idx_provider_consumers_consumer ON provider.consumers (consumer_space_id);

COMMENT ON TABLE provider.consumers IS 'Enrollment: which Dealer (consumer space) belongs to which Factory (provider space). No order data.';
COMMENT ON COLUMN provider.consumers.provider_space_id IS 'Factory space (was firm_space_id).';
COMMENT ON COLUMN provider.consumers.consumer_space_id IS 'Dealer space (was client_space_id).';

DROP TRIGGER IF EXISTS provider_consumers_set_updated_at ON provider.consumers;
CREATE TRIGGER provider_consumers_set_updated_at
  BEFORE UPDATE ON provider.consumers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Factory member ↔ Dealer assignment (was firm.member_clients)
CREATE TABLE IF NOT EXISTS provider.member_consumers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consumer_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_space_id, user_id, consumer_space_id)
);

CREATE INDEX IF NOT EXISTS idx_member_consumers_provider ON provider.member_consumers (provider_space_id);
CREATE INDEX IF NOT EXISTS idx_member_consumers_user ON provider.member_consumers (user_id);

COMMENT ON TABLE provider.member_consumers IS 'Which Factory members may manage a given enrolled Dealer.';

CREATE OR REPLACE FUNCTION public.auth_user_provider_can_see_consumer_space(p_consumer_space_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, provider
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_spaces us
    JOIN provider.consumers c
      ON c.provider_space_id = us.space_id
     AND c.consumer_space_id = p_consumer_space_id
    WHERE us.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_user_consumer_can_see_provider_space(p_provider_space_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, provider
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_spaces us
    JOIN provider.consumers c
      ON c.consumer_space_id = us.space_id
     AND c.provider_space_id = p_provider_space_id
    WHERE us.user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.auth_user_provider_can_see_consumer_space(UUID) IS
  'RLS: current user is in a Factory that enrolled this Dealer space.';
COMMENT ON FUNCTION public.auth_user_consumer_can_see_provider_space(UUID) IS
  'RLS: current user is in a Dealer enrolled with this Factory space.';

DROP POLICY IF EXISTS spaces_select_enrolled ON public.spaces;
CREATE POLICY spaces_select_enrolled ON public.spaces
  FOR SELECT TO authenticated
  USING (
    public.auth_user_provider_can_see_consumer_space(id)
    OR public.auth_user_consumer_can_see_provider_space(id)
  );

DROP POLICY IF EXISTS user_spaces_select_enrolled ON public.user_spaces;
CREATE POLICY user_spaces_select_enrolled ON public.user_spaces
  FOR SELECT TO authenticated
  USING (
    public.auth_user_provider_can_see_consumer_space(space_id)
    OR public.auth_user_consumer_can_see_provider_space(space_id)
  );

ALTER TABLE provider.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumer.consumers ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider.consumers ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider.member_consumers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS providers_select_member ON provider.providers;
CREATE POLICY providers_select_member ON provider.providers
  FOR SELECT TO authenticated
  USING (public.auth_user_shares_space(space_id) OR public.auth_user_consumer_can_see_provider_space(space_id));

DROP POLICY IF EXISTS providers_write_blocked ON provider.providers;
CREATE POLICY providers_write_blocked ON provider.providers
  FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS providers_update_blocked ON provider.providers;
CREATE POLICY providers_update_blocked ON provider.providers
  FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS providers_all_service_role ON provider.providers;
CREATE POLICY providers_all_service_role ON provider.providers
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS consumer_profiles_select ON consumer.consumers;
CREATE POLICY consumer_profiles_select ON consumer.consumers
  FOR SELECT TO authenticated
  USING (public.auth_user_shares_space(space_id) OR public.auth_user_provider_can_see_consumer_space(space_id));

DROP POLICY IF EXISTS consumer_profiles_insert_blocked ON consumer.consumers;
CREATE POLICY consumer_profiles_insert_blocked ON consumer.consumers
  FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS consumer_profiles_update_blocked ON consumer.consumers;
CREATE POLICY consumer_profiles_update_blocked ON consumer.consumers
  FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS consumer_profiles_all_service_role ON consumer.consumers;
CREATE POLICY consumer_profiles_all_service_role ON consumer.consumers
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS enrolled_consumers_select ON provider.consumers;
CREATE POLICY enrolled_consumers_select ON provider.consumers
  FOR SELECT TO authenticated
  USING (
    public.auth_user_shares_space(provider_space_id)
    OR public.auth_user_shares_space(consumer_space_id)
  );

DROP POLICY IF EXISTS enrolled_consumers_insert ON provider.consumers;
CREATE POLICY enrolled_consumers_insert ON provider.consumers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_user_shares_space(provider_space_id)
    OR public.auth_user_shares_space(consumer_space_id)
  );

DROP POLICY IF EXISTS enrolled_consumers_update ON provider.consumers;
CREATE POLICY enrolled_consumers_update ON provider.consumers
  FOR UPDATE TO authenticated
  USING (public.auth_user_shares_space(provider_space_id))
  WITH CHECK (public.auth_user_shares_space(provider_space_id));

DROP POLICY IF EXISTS enrolled_consumers_delete ON provider.consumers;
CREATE POLICY enrolled_consumers_delete ON provider.consumers
  FOR DELETE TO authenticated
  USING (public.is_admin_of_space(provider_space_id));

DROP POLICY IF EXISTS member_consumers_select ON provider.member_consumers;
CREATE POLICY member_consumers_select ON provider.member_consumers
  FOR SELECT TO authenticated
  USING (public.auth_user_shares_space(provider_space_id) OR user_id = auth.uid());

DROP POLICY IF EXISTS member_consumers_insert ON provider.member_consumers;
CREATE POLICY member_consumers_insert ON provider.member_consumers
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of_space(provider_space_id));

DROP POLICY IF EXISTS member_consumers_update ON provider.member_consumers;
CREATE POLICY member_consumers_update ON provider.member_consumers
  FOR UPDATE TO authenticated
  USING (public.is_admin_of_space(provider_space_id));

DROP POLICY IF EXISTS member_consumers_delete ON provider.member_consumers;
CREATE POLICY member_consumers_delete ON provider.member_consumers
  FOR DELETE TO authenticated
  USING (public.is_admin_of_space(provider_space_id));

GRANT SELECT ON provider.providers TO authenticated;
GRANT SELECT ON consumer.consumers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider.consumers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider.member_consumers TO authenticated;
GRANT ALL ON provider.providers TO service_role;
GRANT ALL ON consumer.consumers TO service_role;

GRANT EXECUTE ON FUNCTION public.auth_user_provider_can_see_consumer_space(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_user_consumer_can_see_provider_space(UUID) TO authenticated, service_role;

-- Create space + membership + provider/consumer 1:1 row. No business seeds.
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
  'Wholestore: create space + admin membership + provider.providers or consumer.consumers. No product seeds.';

GRANT EXECUTE ON FUNCTION public.create_space_core(TEXT, TEXT, UUID, TEXT) TO authenticated, service_role;
