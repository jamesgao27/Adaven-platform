-- Fix: column reference "client_space_id" is ambiguous (PL/pgSQL output vs firm.clients column).
-- 1. Use RETURN QUERY SELECT so return values use variables only.
-- 2. Use ON CONFLICT ON CONSTRAINT so we never reference the output column name "client_space_id"
--    in conflict targets (avoids ambiguity in PL/pgSQL).

CREATE OR REPLACE FUNCTION public.firm_create_client_on_behalf(
  p_firm_space_id UUID,
  p_client_name TEXT,
  p_contact_name TEXT,
  p_contact_email TEXT,
  p_sku_id UUID DEFAULT NULL
)
RETURNS TABLE (
  client_space_id UUID,
  invitation_id UUID,
  space_name TEXT,
  invitee_email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id UUID;
  v_space_name TEXT;
  v_client_space_id UUID;
  v_invitation_id UUID;
  v_inviter_email TEXT;
  v_inviter_name TEXT;
  v_now TIMESTAMPTZ := now();
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.space_id = p_firm_space_id AND us.user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Only firm members can create clients on behalf';
  END IF;

  v_space_name := COALESCE(NULLIF(TRIM(p_client_name), ''), NULLIF(TRIM(p_contact_name), ''), 'Client Space');
  IF NULLIF(TRIM(LOWER(p_contact_email)), '') IS NULL THEN
    RAISE EXCEPTION 'Contact email is required';
  END IF;

  INSERT INTO public.spaces (name, address, kind)
  VALUES (v_space_name, NULL, 'client')
  RETURNING id INTO v_client_space_id;

  INSERT INTO firm.clients (firm_space_id, client_space_id, status, display_name)
  VALUES (
    p_firm_space_id,
    v_client_space_id,
    'active',
    COALESCE(NULLIF(TRIM(p_client_name), ''), NULLIF(TRIM(p_contact_name), ''), v_space_name)
  )
  ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key
  DO UPDATE SET
    display_name = COALESCE(NULLIF(TRIM(EXCLUDED.display_name), ''), firm.clients.display_name),
    status = 'active',
    updated_at = v_now;

  INSERT INTO firm.member_clients (firm_space_id, user_id, client_space_id, created_at)
  VALUES (p_firm_space_id, v_caller_id, v_client_space_id, v_now)
  ON CONFLICT ON CONSTRAINT member_clients_firm_space_id_user_id_client_space_id_key DO NOTHING;

  IF p_sku_id IS NOT NULL THEN
    INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by)
    VALUES (p_firm_space_id, v_client_space_id, p_sku_id, 'onboarding', NULL, v_now, v_now, v_caller_id);
  END IF;

  SELECT u.name, COALESCE(u.email, (SELECT email FROM auth.users WHERE id = v_caller_id LIMIT 1))
  INTO v_inviter_name, v_inviter_email
  FROM public.users u
  WHERE u.id = v_caller_id
  LIMIT 1;
  v_inviter_email := COALESCE(v_inviter_email, '');
  v_inviter_name  := NULLIF(TRIM(v_inviter_name), '');

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'space_invitations') THEN
    INSERT INTO public.space_invitations (
      space_id,
      inviter_id,
      inviter_email,
      invitee_email,
      space_name,
      status,
      created_at,
      invite_as_admin,
      inviter_name
    )
    VALUES (
      v_client_space_id,
      v_caller_id,
      v_inviter_email,
      LOWER(TRIM(p_contact_email)),
      v_space_name,
      'pending',
      v_now,
      true,
      v_inviter_name
    )
    RETURNING id INTO v_invitation_id;
  ELSE
    v_invitation_id := NULL;
  END IF;

  RETURN QUERY SELECT v_client_space_id, v_invitation_id, v_space_name, LOWER(TRIM(p_contact_email));
END;
$$;
