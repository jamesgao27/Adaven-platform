-- Platform kernel for a new app Supabase project.
-- Tables: public.users, public.spaces, public.user_spaces, public.space_invitations
-- No product catalogs / receipts / orders.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  logo_url TEXT,
  kind TEXT NOT NULL DEFAULT 'consumer'
    CHECK (kind IN ('provider', 'consumer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.spaces IS 'Tenant workspace. Kernel kind is provider | consumer; product UIs map labels (Firm/Client, Vendor/Dealer, …).';
COMMENT ON COLUMN public.spaces.kind IS 'Kernel only: provider (supplies) or consumer (is served). Product copy must not introduce a third kind.';

DROP TRIGGER IF EXISTS spaces_set_updated_at ON public.spaces;
CREATE TRIGGER spaces_set_updated_at
  BEFORE UPDATE ON public.spaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  logo_url TEXT,
  current_space_id UUID REFERENCES public.spaces(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, space_id)
);

CREATE TABLE IF NOT EXISTS public.space_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  inviter_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  inviter_email TEXT,
  invitee_email TEXT NOT NULL,
  space_name TEXT,
  invite_as_admin BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled', 'declined', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS space_invitations_space_email_uidx
  ON public.space_invitations (space_id, lower(invitee_email));

CREATE INDEX IF NOT EXISTS idx_users_current_space_id ON public.users (current_space_id);
CREATE INDEX IF NOT EXISTS idx_user_spaces_user_id ON public.user_spaces (user_id);
CREATE INDEX IF NOT EXISTS idx_user_spaces_space_id ON public.user_spaces (space_id);
CREATE INDEX IF NOT EXISTS idx_space_invitations_invitee ON public.space_invitations (invitee_email);
CREATE INDEX IF NOT EXISTS idx_space_invitations_space ON public.space_invitations (space_id);
CREATE INDEX IF NOT EXISTS idx_spaces_kind ON public.spaces (kind);

-- New auth user → public.users (two-step register: no space yet)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(
      NEW.raw_user_meta_data->>'name',
      split_part(COALESCE(NEW.email, 'user'), '@', 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.auth_user_shares_space(p_space_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_spaces
      WHERE user_id = auth.uid() AND space_id = p_space_id
    );
$$;

CREATE OR REPLACE FUNCTION public.auth_user_can_see_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.uid() IS NOT NULL)
    AND (
      p_user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.user_spaces a
        JOIN public.user_spaces b ON a.space_id = b.space_id
        WHERE a.user_id = auth.uid() AND b.user_id = p_user_id
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_of_space(p_space_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_spaces
    WHERE user_id = auth.uid() AND space_id = p_space_id AND is_admin = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_by_id(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  email TEXT,
  name TEXT,
  logo_url TEXT,
  current_space_id UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.email, u.name, u.logo_url, u.current_space_id, u.created_at
  FROM public.users u
  WHERE u.id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_user_current_space(p_user_id UUID, p_space_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Can only update own record';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_spaces WHERE user_id = p_user_id AND space_id = p_space_id
  ) THEN
    RAISE EXCEPTION 'User does not belong to this space';
  END IF;
  UPDATE public.users SET current_space_id = p_space_id WHERE id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_space_member_users(p_space_id UUID)
RETURNS TABLE (
  id UUID,
  email TEXT,
  name TEXT,
  current_space_id UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.auth_user_shares_space(p_space_id) THEN
    RAISE EXCEPTION 'User does not belong to this space';
  END IF;
  RETURN QUERY
  SELECT u.id, u.email, u.name, u.current_space_id, u.created_at
  FROM public.users u
  JOIN public.user_spaces us ON u.id = us.user_id
  WHERE us.space_id = p_space_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_space_members_with_last_signin(p_space_id UUID)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  last_sign_in_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.auth_user_shares_space(p_space_id) THEN
    RAISE EXCEPTION 'User does not belong to this space';
  END IF;
  RETURN QUERY
  SELECT u.id, u.email, au.last_sign_in_at
  FROM public.user_spaces us
  JOIN public.users u ON u.id = us.user_id
  LEFT JOIN auth.users au ON au.id = u.id
  WHERE us.space_id = p_space_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_space_invitation(
  p_space_id UUID,
  p_inviter_id UUID,
  p_inviter_email TEXT,
  p_invitee_email TEXT,
  p_space_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation_id UUID;
  v_normalized_email TEXT := LOWER(TRIM(p_invitee_email));
  v_existing_id UUID;
  v_final_space_name TEXT;
BEGIN
  IF p_inviter_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Can only create invitations as self';
  END IF;
  IF NOT public.is_admin_of_space(p_space_id) THEN
    RAISE EXCEPTION 'Only space admins can invite';
  END IF;

  v_final_space_name := NULLIF(TRIM(COALESCE(p_space_name, '')), '');
  IF v_final_space_name IS NULL THEN
    SELECT name INTO v_final_space_name FROM public.spaces WHERE id = p_space_id;
  END IF;
  v_final_space_name := COALESCE(v_final_space_name, 'a space');

  SELECT id INTO v_existing_id
  FROM public.space_invitations
  WHERE space_id = p_space_id AND LOWER(TRIM(invitee_email)) = v_normalized_email
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.space_invitations
    SET
      status = 'pending',
      inviter_id = p_inviter_id,
      inviter_email = p_inviter_email,
      space_name = v_final_space_name,
      created_at = NOW(),
      accepted_at = NULL
    WHERE id = v_existing_id
    RETURNING id INTO v_invitation_id;
  ELSE
    INSERT INTO public.space_invitations (
      space_id, inviter_id, inviter_email, invitee_email, space_name, status, created_at
    ) VALUES (
      p_space_id, p_inviter_id, p_inviter_email, v_normalized_email, v_final_space_name, 'pending', NOW()
    )
    RETURNING id INTO v_invitation_id;
  END IF;

  RETURN v_invitation_id;
END;
$$;

ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spaces_select_member ON public.spaces;
CREATE POLICY spaces_select_member ON public.spaces
  FOR SELECT TO authenticated
  USING (public.auth_user_shares_space(id));

DROP POLICY IF EXISTS spaces_insert_authenticated ON public.spaces;
CREATE POLICY spaces_insert_authenticated ON public.spaces
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS spaces_update_member ON public.spaces;
CREATE POLICY spaces_update_member ON public.spaces
  FOR UPDATE TO authenticated
  USING (public.auth_user_shares_space(id))
  WITH CHECK (public.auth_user_shares_space(id));

DROP POLICY IF EXISTS users_select_visible ON public.users;
CREATE POLICY users_select_visible ON public.users
  FOR SELECT TO authenticated
  USING (public.auth_user_can_see_user(id));

DROP POLICY IF EXISTS users_insert_self ON public.users;
CREATE POLICY users_insert_self ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS users_update_self ON public.users;
CREATE POLICY users_update_self ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS user_spaces_select_related ON public.user_spaces;
CREATE POLICY user_spaces_select_related ON public.user_spaces
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.auth_user_shares_space(space_id)
  );

DROP POLICY IF EXISTS user_spaces_insert_self ON public.user_spaces;
CREATE POLICY user_spaces_insert_self ON public.user_spaces
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_spaces_update_admin ON public.user_spaces;
CREATE POLICY user_spaces_update_admin ON public.user_spaces
  FOR UPDATE TO authenticated
  USING (public.is_admin_of_space(space_id));

DROP POLICY IF EXISTS user_spaces_delete_admin_or_self ON public.user_spaces;
CREATE POLICY user_spaces_delete_admin_or_self ON public.user_spaces
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_of_space(space_id));

DROP POLICY IF EXISTS space_invitations_select ON public.space_invitations;
CREATE POLICY space_invitations_select ON public.space_invitations
  FOR SELECT TO authenticated
  USING (
    inviter_id = auth.uid()
    OR public.auth_user_shares_space(space_id)
    OR LOWER(invitee_email) = LOWER(COALESCE((SELECT email FROM public.users WHERE id = auth.uid()), ''))
  );

DROP POLICY IF EXISTS space_invitations_insert_admin ON public.space_invitations;
CREATE POLICY space_invitations_insert_admin ON public.space_invitations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of_space(space_id) AND inviter_id = auth.uid());

DROP POLICY IF EXISTS space_invitations_update ON public.space_invitations;
CREATE POLICY space_invitations_update ON public.space_invitations
  FOR UPDATE TO authenticated
  USING (
    inviter_id = auth.uid()
    OR public.is_admin_of_space(space_id)
    OR LOWER(invitee_email) = LOWER(COALESCE((SELECT email FROM public.users WHERE id = auth.uid()), ''))
  );

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spaces TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.users TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_spaces TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.space_invitations TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_user_by_id(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_user_current_space(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_space_member_users(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_space_members_with_last_signin(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_space_invitation(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_of_space(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_user_shares_space(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_user_can_see_user(UUID) TO authenticated, service_role;
