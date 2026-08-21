-- Same firm + same organization name: reuse existing client space; same or different contact email supported.
-- - Same org + same email: idempotent (return existing pending invitation or create one).
-- - Same org + different email: add another invitation to the same space (same company, multiple contacts).

SET search_path = public, firm;

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
  v_normalized_name TEXT;
  v_existing_space_id UUID;
  v_existing_invitation_id UUID;
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
  v_normalized_name := LOWER(TRIM(v_space_name));
  IF NULLIF(TRIM(LOWER(p_contact_email)), '') IS NULL THEN
    RAISE EXCEPTION 'Contact email is required';
  END IF;

  -- Try to find existing client space for this firm with same organization name (normalized).
  -- Prefer: 1) space that already has a pending invitation for this email (idempotent), 2) space with no members yet, 3) newest.
  SELECT c.client_space_id INTO v_existing_space_id
  FROM firm.clients c
  JOIN public.spaces s ON s.id = c.client_space_id AND s.kind = 'client'
  WHERE c.firm_space_id = p_firm_space_id
    AND LOWER(TRIM(COALESCE(c.display_name, ''))) = v_normalized_name
  ORDER BY
    CASE WHEN EXISTS (
      SELECT 1 FROM public.space_invitations si
      WHERE si.space_id = c.client_space_id
        AND si.invitee_email = LOWER(TRIM(p_contact_email))
        AND si.status = 'pending'
    ) THEN 0 ELSE 1 END,
    (SELECT COUNT(*) FROM public.user_spaces us WHERE us.space_id = c.client_space_id) ASC,
    c.created_at DESC
  LIMIT 1;

  IF v_existing_space_id IS NOT NULL THEN
    -- Reuse existing client space (same organization)
    v_client_space_id := v_existing_space_id;

    -- Keep space name in sync with latest submission
    UPDATE public.spaces SET name = v_space_name WHERE id = v_client_space_id;

    -- Update firm.clients display_name if we have a better one (longer or non-empty)
    UPDATE firm.clients
    SET display_name = COALESCE(NULLIF(TRIM(p_client_name), ''), NULLIF(TRIM(p_contact_name), ''), display_name),
        updated_at = v_now
    WHERE firm_space_id = p_firm_space_id AND client_space_id = v_client_space_id;

    -- Ensure caller is in member_clients for this client
    INSERT INTO firm.member_clients (firm_space_id, user_id, client_space_id, created_at)
    VALUES (p_firm_space_id, v_caller_id, v_client_space_id, v_now)
    ON CONFLICT ON CONSTRAINT member_clients_firm_space_id_user_id_client_space_id_key DO NOTHING;

    -- Optional order (idempotent by existing logic if any)
    IF p_sku_id IS NOT NULL THEN
      INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by)
      VALUES (p_firm_space_id, v_client_space_id, p_sku_id, 'onboarding', NULL, v_now, v_now, v_caller_id)
      ON CONFLICT (firm_space_id, client_space_id, sku_id, status) DO NOTHING;
    END IF;
  ELSE
    -- No existing org: create new client space and client row
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
  END IF;

  -- Invitation: idempotent for same space + same email (return existing pending); else insert (same org, different contact)
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
      AND si.invitee_email = LOWER(TRIM(p_contact_email))
      AND si.status = 'pending'
    ORDER BY si.created_at DESC
    LIMIT 1;

    IF v_existing_invitation_id IS NOT NULL THEN
      v_invitation_id := v_existing_invitation_id;
    ELSE
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
    END IF;
  ELSE
    v_invitation_id := NULL;
  END IF;

  RETURN QUERY SELECT v_client_space_id, v_invitation_id, v_space_name, LOWER(TRIM(p_contact_email));
END;
$$;

COMMENT ON FUNCTION public.firm_create_client_on_behalf(UUID, TEXT, TEXT, TEXT, UUID) IS
  'Firm 代建 client 空间：同一 firm 同一组织名复用已有 client space；同邮箱返回已有 pending 邀请，不同邮箱追加邀请（同一公司多联系人）';
