-- Add p_create_invitation to firm_create_client_on_behalf.
-- When false: contact_email is optional; no space_invitation row is created (create space + client + order only).

SET search_path = public, firm;

CREATE OR REPLACE FUNCTION public.firm_create_client_on_behalf(
  p_firm_space_id UUID,
  p_client_name TEXT,
  p_contact_name TEXT,
  p_contact_email TEXT,
  p_sku_id UUID DEFAULT NULL,
  p_create_invitation BOOLEAN DEFAULT true
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
  v_normalized_name TEXT;
  v_existing_space_id UUID;
  v_existing_invitation_id UUID;
  v_created_contact_name TEXT := NULLIF(TRIM(p_contact_name), '');
  v_created_contact_email TEXT := NULLIF(LOWER(TRIM(COALESCE(p_contact_email, ''))), '');
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

  IF COALESCE(p_create_invitation, true) AND v_created_contact_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required when sending an invite';
  END IF;

  v_space_name := COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, 'Client Space');
  v_normalized_name := LOWER(v_space_name);

  SELECT c.client_space_id INTO v_existing_space_id
  FROM firm.clients c
  JOIN public.spaces s ON s.id = c.client_space_id AND s.kind = 'client'
  WHERE c.firm_space_id = p_firm_space_id
    AND LOWER(TRIM(COALESCE(c.created_client_name, ''))) = v_normalized_name
  ORDER BY
    CASE WHEN v_created_contact_email IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.space_invitations si
      WHERE si.space_id = c.client_space_id
        AND si.invitee_email = v_created_contact_email
        AND si.status = 'pending'
    ) THEN 0 ELSE 1 END,
    (SELECT COUNT(*) FROM public.user_spaces us WHERE us.space_id = c.client_space_id) ASC,
    c.created_at DESC
  LIMIT 1;

  IF v_existing_space_id IS NOT NULL THEN
    v_client_space_id := v_existing_space_id;

    UPDATE public.spaces SET name = v_space_name WHERE id = v_client_space_id;

    UPDATE firm.clients
    SET created_client_name = COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, created_client_name),
        created_contact_name = COALESCE(v_created_contact_name, created_contact_name),
        created_contact_email = COALESCE(v_created_contact_email, created_contact_email),
        updated_at = v_now
    WHERE firm_space_id = p_firm_space_id AND client_space_id = v_client_space_id;

    INSERT INTO firm.member_clients (firm_space_id, user_id, client_space_id, created_at)
    VALUES (p_firm_space_id, v_caller_id, v_client_space_id, v_now)
    ON CONFLICT ON CONSTRAINT member_clients_firm_space_id_user_id_client_space_id_key DO NOTHING;

    IF p_sku_id IS NOT NULL THEN
      INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by)
      VALUES (p_firm_space_id, v_client_space_id, p_sku_id, 'onboarding', NULL, v_now, v_now, v_caller_id)
      ON CONFLICT (firm_space_id, client_space_id, sku_id, status) DO NOTHING;
    END IF;
  ELSE
    INSERT INTO public.spaces (name, address, kind)
    VALUES (v_space_name, NULL, 'client')
    RETURNING id INTO v_client_space_id;

    INSERT INTO firm.clients (firm_space_id, client_space_id, status, created_client_name, created_contact_name, created_contact_email)
    VALUES (
      p_firm_space_id,
      v_client_space_id,
      'active',
      COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, v_space_name),
      v_created_contact_name,
      v_created_contact_email
    )
    ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key
    DO UPDATE SET
      created_client_name = COALESCE(NULLIF(TRIM(EXCLUDED.created_client_name), ''), firm.clients.created_client_name),
      created_contact_name = COALESCE(EXCLUDED.created_contact_name, firm.clients.created_contact_name),
      created_contact_email = COALESCE(EXCLUDED.created_contact_email, firm.clients.created_contact_email),
      status = 'active',
      updated_at = v_now;

    INSERT INTO firm.member_clients (firm_space_id, user_id, client_space_id, created_at)
    VALUES (p_firm_space_id, v_caller_id, v_client_space_id, v_now)
    ON CONFLICT ON CONSTRAINT member_clients_firm_space_id_user_id_client_space_id_key DO NOTHING;

    IF p_sku_id IS NOT NULL THEN
      INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by)
      VALUES (p_firm_space_id, v_client_space_id, p_sku_id, 'onboarding', NULL, v_now, v_now, v_caller_id);
    END IF;
  END IF;

  v_invitation_id := NULL;
  IF COALESCE(p_create_invitation, true) AND v_created_contact_email IS NOT NULL THEN
    SELECT u.name, COALESCE(u.email, (SELECT email FROM auth.users WHERE id = v_caller_id LIMIT 1))
    INTO v_inviter_name, v_inviter_email
    FROM public.users u
    WHERE u.id = v_caller_id
    LIMIT 1;
    v_inviter_email := COALESCE(v_inviter_email, '');
    v_inviter_name  := NULLIF(TRIM(v_inviter_name), '');

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'space_invitations') THEN
      SELECT si.id INTO v_existing_invitation_id
      FROM public.space_invitations si
      WHERE si.space_id = v_client_space_id
        AND si.invitee_email = v_created_contact_email
        AND si.status = 'pending'
      ORDER BY si.created_at DESC
      LIMIT 1;

      IF v_existing_invitation_id IS NOT NULL THEN
        v_invitation_id := v_existing_invitation_id;
      ELSE
        INSERT INTO public.space_invitations (
          space_id, inviter_id, inviter_email, invitee_email, space_name, status, created_at, invite_as_admin, inviter_name
        )
        VALUES (
          v_client_space_id, v_caller_id, v_inviter_email, v_created_contact_email, v_space_name,
          'pending', v_now, true, v_inviter_name
        )
        RETURNING id INTO v_invitation_id;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT v_client_space_id, v_invitation_id, v_space_name, COALESCE(v_created_contact_email, '');
END;
$$;

COMMENT ON FUNCTION public.firm_create_client_on_behalf(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN) IS
  'Firm 代建 client：可选 p_create_invitation=false 仅创建 space/client/order 不创建邀请；true 时需 contact_email 并创建 space_invitation';
