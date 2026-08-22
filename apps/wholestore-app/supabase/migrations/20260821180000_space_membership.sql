-- Space membership: invite accept/decline, remove, last-admin, role toggle.
-- Apply after 000_kernel.sql. Safe to re-run (CREATE OR REPLACE / DROP POLICY).

-- Only space admins may update space profile (name/address/logo).
DROP POLICY IF EXISTS spaces_update_member ON public.spaces;
DROP POLICY IF EXISTS spaces_update_admin ON public.spaces;
CREATE POLICY spaces_update_admin ON public.spaces
  FOR UPDATE TO authenticated
  USING (public.is_admin_of_space(id))
  WITH CHECK (public.is_admin_of_space(id));

-- Recreate invitation RPC with invite-as-admin.
DROP FUNCTION IF EXISTS public.create_space_invitation(UUID, UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_space_invitation(UUID, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_space_invitation(
  p_space_id UUID,
  p_inviter_id UUID,
  p_inviter_email TEXT,
  p_invitee_email TEXT,
  p_space_name TEXT DEFAULT NULL,
  p_invite_as_admin BOOLEAN DEFAULT FALSE
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
  IF v_normalized_email = '' THEN
    RAISE EXCEPTION 'Invitee email is required';
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
      invite_as_admin = COALESCE(p_invite_as_admin, FALSE),
      created_at = NOW(),
      accepted_at = NULL
    WHERE id = v_existing_id
    RETURNING id INTO v_invitation_id;
  ELSE
    INSERT INTO public.space_invitations (
      space_id, inviter_id, inviter_email, invitee_email, space_name,
      invite_as_admin, status, created_at
    ) VALUES (
      p_space_id, p_inviter_id, p_inviter_email, v_normalized_email, v_final_space_name,
      COALESCE(p_invite_as_admin, FALSE), 'pending', NOW()
    )
    RETURNING id INTO v_invitation_id;
  END IF;

  RETURN v_invitation_id;
END;
$$;

-- Readable by invitees before they join the space (anon + authenticated).
CREATE OR REPLACE FUNCTION public.get_space_invitation_by_id(p_invitation_id UUID)
RETURNS TABLE (
  id UUID,
  space_id UUID,
  inviter_id UUID,
  inviter_email TEXT,
  invitee_email TEXT,
  space_name TEXT,
  invite_as_admin BOOLEAN,
  status TEXT,
  created_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.id,
    i.space_id,
    i.inviter_id,
    i.inviter_email,
    i.invitee_email,
    i.space_name,
    i.invite_as_admin,
    i.status,
    i.created_at,
    i.accepted_at
  FROM public.space_invitations i
  WHERE i.id = p_invitation_id;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_invitations_for_email(p_email TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  space_id UUID,
  inviter_id UUID,
  inviter_email TEXT,
  invitee_email TEXT,
  space_name TEXT,
  invite_as_admin BOOLEAN,
  status TEXT,
  created_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  v_email := LOWER(TRIM(COALESCE(p_email, '')));
  IF v_email = '' THEN
    SELECT LOWER(TRIM(COALESCE(u.email, au.email, '')))
      INTO v_email
    FROM auth.users au
    LEFT JOIN public.users u ON u.id = au.id
    WHERE au.id = auth.uid();
  END IF;
  IF v_email IS NULL OR v_email = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.space_id,
    i.inviter_id,
    i.inviter_email,
    i.invitee_email,
    i.space_name,
    i.invite_as_admin,
    i.status,
    i.created_at,
    i.accepted_at
  FROM public.space_invitations i
  WHERE i.status = 'pending'
    AND LOWER(TRIM(i.invitee_email)) = v_email
  ORDER BY i.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_space_invitation(p_invitation_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_email TEXT;
  v_inv public.space_invitations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT COALESCE(u.email, au.email, '')
    INTO v_email
  FROM auth.users au
  LEFT JOIN public.users u ON u.id = au.id
  WHERE au.id = v_user_id;

  SELECT * INTO v_inv
  FROM public.space_invitations
  WHERE id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;
  IF v_inv.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Invitation has already been used or cancelled';
  END IF;
  IF LOWER(TRIM(v_email)) IS DISTINCT FROM LOWER(TRIM(v_inv.invitee_email)) THEN
    RAISE EXCEPTION 'Email does not match invitation';
  END IF;

  INSERT INTO public.users (id, email, name, current_space_id)
  SELECT
    v_user_id,
    COALESCE(au.email, v_inv.invitee_email),
    COALESCE(au.raw_user_meta_data->>'name', split_part(COALESCE(au.email, v_inv.invitee_email), '@', 1)),
    v_inv.space_id
  FROM auth.users au
  WHERE au.id = v_user_id
  ON CONFLICT (id) DO UPDATE SET
    current_space_id = EXCLUDED.current_space_id;

  INSERT INTO public.user_spaces (user_id, space_id, is_admin)
  VALUES (v_user_id, v_inv.space_id, COALESCE(v_inv.invite_as_admin, FALSE))
  ON CONFLICT (user_id, space_id) DO UPDATE SET
    is_admin = public.user_spaces.is_admin OR EXCLUDED.is_admin;

  UPDATE public.space_invitations
  SET status = 'accepted', accepted_at = NOW()
  WHERE space_id = v_inv.space_id
    AND LOWER(TRIM(invitee_email)) = LOWER(TRIM(v_inv.invitee_email))
    AND status = 'pending';

  UPDATE public.users SET current_space_id = v_inv.space_id WHERE id = v_user_id;

  RETURN v_inv.space_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_space_invitation(p_invitation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_email TEXT;
  v_inv public.space_invitations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT COALESCE(u.email, au.email, '')
    INTO v_email
  FROM auth.users au
  LEFT JOIN public.users u ON u.id = au.id
  WHERE au.id = v_user_id;

  SELECT * INTO v_inv
  FROM public.space_invitations
  WHERE id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;
  IF v_inv.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Invitation has already been used or cancelled';
  END IF;
  IF LOWER(TRIM(v_email)) IS DISTINCT FROM LOWER(TRIM(v_inv.invitee_email)) THEN
    RAISE EXCEPTION 'Email does not match invitation';
  END IF;

  UPDATE public.space_invitations
  SET status = 'declined'
  WHERE id = p_invitation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_space_member(p_target_user_id UUID, p_space_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_user_id UUID := auth.uid();
  v_target_is_admin BOOLEAN;
  v_admin_count INTEGER;
  v_email TEXT;
BEGIN
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_admin_of_space(p_space_id) THEN
    RAISE EXCEPTION 'Only space admins can remove members';
  END IF;
  IF v_current_user_id = p_target_user_id THEN
    RAISE EXCEPTION 'Cannot remove yourself';
  END IF;

  SELECT is_admin INTO v_target_is_admin
  FROM public.user_spaces
  WHERE user_id = p_target_user_id AND space_id = p_space_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User is not a member of this space';
  END IF;

  IF v_target_is_admin THEN
    SELECT COUNT(*) INTO v_admin_count
    FROM public.user_spaces
    WHERE space_id = p_space_id AND is_admin = TRUE AND user_id <> p_target_user_id;
    IF v_admin_count < 1 THEN
      RAISE EXCEPTION 'Cannot remove the last admin';
    END IF;
  END IF;

  SELECT email INTO v_email FROM public.users WHERE id = p_target_user_id;

  DELETE FROM public.user_spaces
  WHERE user_id = p_target_user_id AND space_id = p_space_id;

  UPDATE public.users
  SET current_space_id = NULL
  WHERE id = p_target_user_id AND current_space_id = p_space_id;

  IF v_email IS NOT NULL THEN
    UPDATE public.space_invitations
    SET status = 'removed'
    WHERE space_id = p_space_id
      AND LOWER(TRIM(invitee_email)) = LOWER(TRIM(v_email))
      AND status IN ('accepted', 'pending');
  END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_space_member_admin(
  p_target_user_id UUID,
  p_space_id UUID,
  p_is_admin BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_user_id UUID := auth.uid();
  v_admin_count INTEGER;
BEGIN
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_admin_of_space(p_space_id) THEN
    RAISE EXCEPTION 'Only space admins can change roles';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_spaces
    WHERE user_id = p_target_user_id AND space_id = p_space_id
  ) THEN
    RAISE EXCEPTION 'User is not a member of this space';
  END IF;

  IF p_is_admin IS NOT TRUE THEN
    SELECT COUNT(*) INTO v_admin_count
    FROM public.user_spaces
    WHERE space_id = p_space_id AND is_admin = TRUE AND user_id <> p_target_user_id;
    IF v_admin_count < 1 THEN
      RAISE EXCEPTION 'Cannot remove the last admin';
    END IF;
  END IF;

  UPDATE public.user_spaces
  SET is_admin = COALESCE(p_is_admin, FALSE)
  WHERE user_id = p_target_user_id AND space_id = p_space_id;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_space(p_space_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_admin_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT is_admin INTO v_is_admin
  FROM public.user_spaces
  WHERE user_id = v_user_id AND space_id = p_space_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User is not a member of this space';
  END IF;

  IF v_is_admin THEN
    SELECT COUNT(*) INTO v_admin_count
    FROM public.user_spaces
    WHERE space_id = p_space_id AND is_admin = TRUE AND user_id <> v_user_id;
    IF v_admin_count < 1 THEN
      RAISE EXCEPTION 'Cannot leave as the last admin. Transfer admin first.';
    END IF;
  END IF;

  DELETE FROM public.user_spaces
  WHERE user_id = v_user_id AND space_id = p_space_id;

  UPDATE public.users
  SET current_space_id = NULL
  WHERE id = v_user_id AND current_space_id = p_space_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_space_invitation(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_space_invitation_by_id(UUID)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pending_invitations_for_email(TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_space_invitation(UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_space_invitation(UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_space_member(UUID, UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_space_member_admin(UUID, UUID, BOOLEAN)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.leave_space(UUID)
  TO authenticated, service_role;
