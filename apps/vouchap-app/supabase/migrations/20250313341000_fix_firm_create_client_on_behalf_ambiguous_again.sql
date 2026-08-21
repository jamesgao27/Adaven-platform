-- Fix: "column reference firm_space_id is ambiguous".
-- 1) firm_create_client_on_behalf: RETURNS TABLE (client_space_id, ...) creates output variables
--    that shadow table columns; use out_* and #variable_conflict use_column.
-- 2) firm_create_pending_order_for_invitee: same issue (RETURNS TABLE has firm_space_id);
--    Add client with service template calls this RPC, not create_client_on_behalf. Use out_* and
--    #variable_conflict use_column.

SET search_path = public, firm;

DROP FUNCTION IF EXISTS public.firm_create_client_on_behalf(uuid, text, text, text, uuid, boolean);

CREATE OR REPLACE FUNCTION public.firm_create_client_on_behalf(
  p_firm_space_id uuid,
  p_client_name text,
  p_contact_name text,
  p_contact_email text,
  p_sku_id uuid DEFAULT NULL,
  p_create_invitation boolean DEFAULT true
)
RETURNS TABLE (
  out_client_space_id uuid,
  out_invitation_id uuid,
  out_space_name text,
  out_invitee_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
#variable_conflict use_column
DECLARE
  v_caller_id uuid;
  v_space_name text;
  v_client_space_id uuid;
  v_invitation_id uuid;
  v_inviter_email text;
  v_inviter_name text;
  v_now timestamptz := now();
  v_normalized_name text;
  v_existing_space_id uuid;
  v_existing_invitation_id uuid;
  v_created_contact_name text := NULLIF(TRIM(p_contact_name), '');
  v_created_contact_email text := NULLIF(LOWER(TRIM(p_contact_email)), '');
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

  v_space_name := COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, 'Client Space');
  v_normalized_name := LOWER(v_space_name);
  IF v_created_contact_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required';
  END IF;

  -- Find existing client by space name (spaces.name) under this firm
  SELECT c.client_space_id INTO v_existing_space_id
  FROM firm.clients c
  JOIN public.spaces s ON s.id = c.client_space_id AND s.kind = 'client'
  WHERE c.firm_space_id = p_firm_space_id
    AND LOWER(TRIM(COALESCE(s.name, ''))) = v_normalized_name
  ORDER BY
    CASE WHEN EXISTS (
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
    UPDATE firm.clients SET updated_at = v_now
    WHERE firm.clients.firm_space_id = p_firm_space_id AND firm.clients.client_space_id = v_client_space_id;
  ELSE
    INSERT INTO public.spaces (name, address, kind)
    VALUES (v_space_name, NULL, 'client')
    RETURNING id INTO v_client_space_id;

    INSERT INTO firm.clients (firm_space_id, client_space_id)
    VALUES (p_firm_space_id, v_client_space_id)
    ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key
    DO UPDATE SET updated_at = v_now;
  END IF;

  INSERT INTO firm.invitee_clients (
    firm_space_id,
    invitee_email,
    invitee_client_name,
    invitee_contact_name
  )
  VALUES (
    p_firm_space_id,
    v_created_contact_email,
    COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, v_space_name),
    v_created_contact_name
  )
  ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET
    invitee_client_name   = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
    invitee_contact_name  = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
    updated_at            = v_now;

  INSERT INTO firm.clients_assignee (firm_space_id, user_id, client_space_id, created_at)
  VALUES (p_firm_space_id, v_caller_id, v_client_space_id, v_now)
  ON CONFLICT (firm_space_id, user_id, client_space_id) WHERE (client_space_id IS NOT NULL) DO NOTHING;

  IF p_sku_id IS NOT NULL THEN
    INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by)
    VALUES (p_firm_space_id, v_client_space_id, p_sku_id, 'onboarding', NULL, v_now, v_now, v_caller_id)
    ON CONFLICT (firm_space_id, client_space_id, sku_id, status) DO NOTHING;
  END IF;

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
    ELSIF p_create_invitation THEN
      INSERT INTO public.space_invitations (
        space_id, inviter_id, inviter_email, invitee_email, space_name, status, created_at, invite_as_admin, inviter_name
      )
      VALUES (
        v_client_space_id, v_caller_id, v_inviter_email, v_created_contact_email, v_space_name,
        'pending', v_now, true, v_inviter_name
      )
      RETURNING id INTO v_invitation_id;
    ELSE
      v_invitation_id := NULL;
    END IF;
  ELSE
    v_invitation_id := NULL;
  END IF;

  RETURN QUERY SELECT v_client_space_id, v_invitation_id, v_space_name, v_created_contact_email;
END;
$$;

COMMENT ON FUNCTION public.firm_create_client_on_behalf(uuid, text, text, text, uuid, boolean) IS
  'Firm create client space and link; name/contact from space + invitee_clients. Returns out_* columns to avoid PL/pgSQL ambiguity.';

--------------------------------------------------------------------------------
-- firm_create_pending_order_for_invitee (called when Add client + service template → Create Engagement)
--------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.firm_create_pending_order_for_invitee(uuid, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.firm_create_pending_order_for_invitee(
  p_firm_space_id uuid,
  p_client_name   text,
  p_contact_name  text,
  p_contact_email text,
  p_sku_id        uuid
)
RETURNS TABLE (
  out_order_id          uuid,
  out_firm_space_id      uuid,
  out_invitee_client_id uuid,
  out_invitee_email     text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
#variable_conflict use_column
DECLARE
  v_caller_id uuid;
  v_client_name   text;
  v_contact_name  text;
  v_contact_email text;
  v_invitee_id    uuid;
  v_now           timestamptz := now();
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.space_id = p_firm_space_id AND us.user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Only firm members can create pending orders';
  END IF;

  v_client_name   := NULLIF(TRIM(p_client_name), '');
  v_contact_name  := NULLIF(TRIM(p_contact_name), '');
  v_contact_email := NULLIF(LOWER(TRIM(p_contact_email)), '');

  IF v_contact_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required for pending orders';
  END IF;

  INSERT INTO firm.invitee_clients (
    firm_space_id,
    invitee_email,
    invitee_client_name,
    invitee_contact_name
  )
  VALUES (
    p_firm_space_id,
    v_contact_email,
    COALESCE(v_client_name, v_contact_name, 'Client'),
    v_contact_name
  )
  ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET
    invitee_client_name   = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
    invitee_contact_name  = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
    updated_at            = v_now;

  SELECT id INTO v_invitee_id
  FROM firm.invitee_clients ic
  WHERE ic.firm_space_id = p_firm_space_id AND ic.invitee_email = v_contact_email
  LIMIT 1;

  INSERT INTO firm.clients_assignee (firm_space_id, user_id, invitee_client_id)
  VALUES (p_firm_space_id, v_caller_id, v_invitee_id)
  ON CONFLICT (firm_space_id, invitee_client_id) WHERE (invitee_client_id IS NOT NULL)
  DO UPDATE SET user_id = v_caller_id;

  INSERT INTO firm.orders (
    firm_space_id,
    client_space_id,
    sku_id,
    status,
    due_at,
    created_at,
    updated_at,
    created_by,
    invitee_client_id
  )
  VALUES (
    p_firm_space_id,
    NULL,
    p_sku_id,
    'onboarding',
    NULL,
    v_now,
    v_now,
    v_caller_id,
    v_invitee_id
  );

  RETURN QUERY
  SELECT o.id, p_firm_space_id, v_invitee_id, v_contact_email
  FROM firm.orders o
  WHERE o.firm_space_id = p_firm_space_id
    AND o.invitee_client_id = v_invitee_id
    AND o.client_space_id IS NULL
  ORDER BY o.created_at DESC
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.firm_create_pending_order_for_invitee(uuid, text, text, text, uuid) IS
  'Firm: create pending order for invitee (Add client with template). Returns out_* to avoid firm_space_id ambiguity.';
