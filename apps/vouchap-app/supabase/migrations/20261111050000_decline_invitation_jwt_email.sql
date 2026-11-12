-- Invitees can decline pending invitations even when public.users.email is
-- missing/out of sync (common right after signup / OAuth).

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

  SELECT LOWER(TRIM(COALESCE(
    NULLIF(u.email, ''),
    NULLIF(au.email, ''),
    NULLIF(auth.jwt() ->> 'email', ''),
    ''
  )))
    INTO v_email
  FROM auth.users au
  LEFT JOIN public.users u ON u.id = au.id
  WHERE au.id = v_user_id;

  IF v_email IS NULL OR v_email = '' THEN
    v_email := LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')));
  END IF;

  SELECT * INTO v_inv
  FROM public.space_invitations
  WHERE id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;
  IF v_inv.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Invitation has already been used or cancelled';
  END IF;
  IF v_email IS DISTINCT FROM LOWER(TRIM(v_inv.invitee_email)) THEN
    RAISE EXCEPTION 'Email does not match invitation';
  END IF;

  UPDATE public.space_invitations
  SET status = 'declined'
  WHERE id = p_invitation_id
    AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION public.decline_space_invitation(UUID)
  TO authenticated, service_role;

-- Keep existing SELECT policies; only widen UPDATE email matching to JWT email.
DROP POLICY IF EXISTS space_invitations_update ON public.space_invitations;
CREATE POLICY space_invitations_update ON public.space_invitations
  FOR UPDATE TO authenticated
  USING (
    inviter_id = auth.uid()
    OR public.is_admin_of_space(space_id)
    OR LOWER(invitee_email) = LOWER(COALESCE(
      (SELECT email FROM public.users WHERE id = auth.uid()),
      auth.jwt() ->> 'email',
      ''
    ))
  );
