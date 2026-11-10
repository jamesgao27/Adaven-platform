-- Vouchap already has remove_space_member and is_admin_of_space.
-- The members-list admin toggle calls set_space_member_admin.

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

GRANT EXECUTE ON FUNCTION public.set_space_member_admin(UUID, UUID, BOOLEAN)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.leave_space(UUID)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
