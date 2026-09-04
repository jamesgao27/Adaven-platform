-- Open invite vs firm-created invitee:
-- 1) Open invite (client_invite_tokens → firm.accept_client_invite_token): only firm.clients +
--    clients_assignee + onboarding order on client_space_id; never insert/update firm.invitee_clients.
-- 2) Firm-side invitee (invitee_clients + pending orders): unchanged; invitee_claim_engagement
--    links space, updates invitee_clients.clients_space_id, migrates orders; also sync projects
--    and ensure claimant is admin on the client space.

SET search_path = public, firm;

--------------------------------------------------------------------------------
-- firm.accept_client_invite_token: remove invitee_clients + order.invitee_client_id
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION firm.accept_client_invite_token(
  p_token text,
  p_client_space_id uuid,
  p_client_user_id uuid
)
RETURNS TABLE (
  firm_space_id uuid,
  client_space_id uuid,
  inviter_user_id uuid,
  sku_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = firm, public
AS $$
#variable_conflict use_column
DECLARE
  v_token_record firm.client_invite_tokens%ROWTYPE;
  v_now timestamptz := now();
  v_out_firm_space_id uuid;
  v_out_client_space_id uuid;
  v_out_inviter_user_id uuid;
  v_out_sku_id uuid;
BEGIN
  IF p_token IS NULL OR p_client_space_id IS NULL OR p_client_user_id IS NULL THEN
    RAISE EXCEPTION 'token, client_space_id and client_user_id are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_token_record
  FROM firm.client_invite_tokens
  WHERE token = p_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid client invite token'
      USING ERRCODE = '22023';
  END IF;

  IF v_token_record.is_active IS FALSE THEN
    RAISE EXCEPTION 'Client invite token is inactive'
      USING ERRCODE = '22023';
  END IF;

  IF v_token_record.expires_at IS NOT NULL AND v_token_record.expires_at <= v_now THEN
    RAISE EXCEPTION 'Client invite token has expired'
      USING ERRCODE = '22023';
  END IF;

  IF v_token_record.max_clients IS NOT NULL
     AND v_token_record.current_clients >= v_token_record.max_clients THEN
    RAISE EXCEPTION 'Client invite token has reached its maximum usage'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO firm.clients (firm_space_id, client_space_id)
  VALUES (v_token_record.firm_space_id, p_client_space_id)
  ON CONFLICT (firm_space_id, client_space_id) DO NOTHING;

  INSERT INTO firm.clients_assignee (firm_space_id, user_id, client_space_id, created_at)
  VALUES (
    v_token_record.firm_space_id,
    v_token_record.inviter_user_id,
    p_client_space_id,
    v_now
  )
  ON CONFLICT (firm_space_id, user_id, client_space_id) WHERE (client_space_id IS NOT NULL)
  DO NOTHING;

  BEGIN
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
      v_token_record.firm_space_id,
      p_client_space_id,
      v_token_record.sku_id,
      'onboarding',
      NULL,
      v_now,
      v_now,
      p_client_user_id,
      NULL
    )
    ON CONFLICT (firm_space_id, client_space_id, sku_id, status)
    DO NOTHING;
  EXCEPTION
    WHEN SQLSTATE '42P10' THEN
      BEGIN
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
          v_token_record.firm_space_id,
          p_client_space_id,
          v_token_record.sku_id,
          'onboarding',
          NULL,
          v_now,
          v_now,
          p_client_user_id,
          NULL
        );
      EXCEPTION
        WHEN unique_violation THEN
          NULL;
      END;
  END;

  UPDATE firm.client_invite_tokens cit
  SET current_clients = cit.current_clients + 1,
      is_active = CASE
        WHEN cit.max_clients IS NOT NULL AND cit.current_clients + 1 >= cit.max_clients THEN FALSE
        ELSE cit.is_active
      END
  WHERE cit.id = v_token_record.id;

  v_out_firm_space_id  := v_token_record.firm_space_id;
  v_out_client_space_id := p_client_space_id;
  v_out_inviter_user_id := v_token_record.inviter_user_id;
  v_out_sku_id          := v_token_record.sku_id;
  firm_space_id         := v_out_firm_space_id;
  client_space_id       := v_out_client_space_id;
  inviter_user_id       := v_out_inviter_user_id;
  sku_id                := v_out_sku_id;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION firm.accept_client_invite_token(text, uuid, uuid) IS
  'Open invite: firm.clients + assignee + onboarding order (invitee_client_id NULL). Does not write firm.invitee_clients.';

COMMENT ON FUNCTION public.firm_accept_client_invite_token(text, uuid, uuid) IS
  'Consumes open-invite token; wraps firm.accept_client_invite_token (no invitee_clients rows).';

--------------------------------------------------------------------------------
-- invitee_claim_engagement: restore projects + user_spaces (firm-created invitee path)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.invitee_claim_engagement(
  p_invitee_client_id uuid,
  p_client_space_id uuid
)
RETURNS TABLE (client_space_id uuid, firm_space_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_uid uuid;
  v_email text;
  v_invitee_email text;
  v_firm_space_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT ic.firm_space_id, LOWER(TRIM(COALESCE(ic.invitee_email, '')))
  INTO v_firm_space_id, v_invitee_email
  FROM firm.invitee_clients ic
  WHERE ic.id = p_invitee_client_id;

  IF v_firm_space_id IS NULL THEN
    RAISE EXCEPTION 'Invitee not found';
  END IF;

  SELECT LOWER(TRIM(COALESCE(u.email, (SELECT email FROM auth.users WHERE id = v_uid LIMIT 1), '')))
  INTO v_email
  FROM public.users u
  WHERE u.id = v_uid
  LIMIT 1;
  v_email := COALESCE(v_email, '');

  IF v_email <> v_invitee_email THEN
    RAISE EXCEPTION 'This engagement is for a different email address';
  END IF;

  INSERT INTO firm.clients (firm_space_id, client_space_id)
  VALUES (v_firm_space_id, p_client_space_id)
  ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key DO NOTHING;

  UPDATE firm.invitee_clients
  SET clients_space_id = p_client_space_id, updated_at = now()
  WHERE id = p_invitee_client_id;

  UPDATE firm.clients_assignee
  SET client_space_id = p_client_space_id,
      invitee_client_id = NULL
  WHERE invitee_client_id = p_invitee_client_id;

  UPDATE firm.orders o
  SET client_space_id = p_client_space_id, updated_at = now()
  WHERE o.firm_space_id = v_firm_space_id
    AND o.invitee_client_id = p_invitee_client_id
    AND o.client_space_id IS NULL;

  UPDATE public.projects pr
  SET client_space_id = p_client_space_id, updated_at = now()
  WHERE pr.order_id IN (
    SELECT o.id FROM firm.orders o
    WHERE o.firm_space_id = v_firm_space_id
      AND o.invitee_client_id = p_invitee_client_id
      AND o.client_space_id = p_client_space_id
  );

  INSERT INTO public.user_spaces (space_id, user_id, is_admin)
  VALUES (p_client_space_id, v_uid, true)
  ON CONFLICT (space_id, user_id) DO UPDATE SET is_admin = true;

  RETURN QUERY SELECT p_client_space_id, v_firm_space_id;
END;
$$;

COMMENT ON FUNCTION public.invitee_claim_engagement(uuid, uuid) IS
  'Firm-created invitee: link client space, update invitee_clients.clients_space_id, migrate orders/projects, add user to client space.';
