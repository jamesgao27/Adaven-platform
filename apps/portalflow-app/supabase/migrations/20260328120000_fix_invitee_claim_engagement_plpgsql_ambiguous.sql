-- invitee_claim_engagement RETURNS TABLE (client_space_id, firm_space_id) defines PL/pgSQL
-- variables with those names; UPDATE firm.clients ... WHERE firm_space_id = ... is then
-- ambiguous vs table columns. Prefer SQL column resolution (same pattern as firm.accept_client_invite_token).
SET search_path = public, firm;

CREATE OR REPLACE FUNCTION public.invitee_claim_engagement(
  p_firm_client_id uuid,
  p_client_space_id uuid
)
RETURNS TABLE (client_space_id uuid, firm_space_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid;
  v_email text;
  v_invitee_email text;
  v_firm_space_id uuid;
  v_row_cs uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT c.firm_space_id,
         LOWER(TRIM(COALESCE(c.invitee_email, ''))),
         c.client_space_id
  INTO v_firm_space_id, v_invitee_email, v_row_cs
  FROM firm.clients c
  WHERE c.id = p_firm_client_id;

  IF v_firm_space_id IS NULL THEN
    RAISE EXCEPTION 'Invitee not found';
  END IF;

  IF v_row_cs IS NOT NULL THEN
    RAISE EXCEPTION 'Engagement already claimed';
  END IF;

  SELECT LOWER(TRIM(COALESCE(u.email, (SELECT email FROM auth.users WHERE id = v_uid LIMIT 1), '')))
  INTO v_email
  FROM public.users u
  WHERE u.id = v_uid
  LIMIT 1;

  IF COALESCE(v_email, '') <> COALESCE(v_invitee_email, '') THEN
    RAISE EXCEPTION 'This engagement is for a different email address';
  END IF;

  UPDATE firm.clients fc
  SET client_space_id = p_client_space_id, updated_at = now()
  WHERE fc.id = p_firm_client_id
    AND fc.firm_space_id = v_firm_space_id
    AND fc.client_space_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Could not claim engagement';
  END IF;

  INSERT INTO firm.clients (firm_space_id, client_space_id)
  VALUES (v_firm_space_id, p_client_space_id)
  ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key DO NOTHING;

  UPDATE firm.orders o
  SET client_space_id = p_client_space_id, updated_at = now()
  WHERE o.firm_space_id = v_firm_space_id
    AND o.client_space_id IS NULL
    AND o.client_id = p_firm_client_id;

  UPDATE public.projects pr
  SET client_space_id = p_client_space_id, updated_at = now()
  WHERE pr.order_id IN (
    SELECT o.id FROM firm.orders o
    WHERE o.firm_space_id = v_firm_space_id AND o.client_id = p_firm_client_id
  );

  INSERT INTO public.user_spaces (space_id, user_id, is_admin)
  VALUES (p_client_space_id, v_uid, true)
  ON CONFLICT (space_id, user_id) DO UPDATE SET is_admin = true;

  RETURN QUERY SELECT p_client_space_id, v_firm_space_id;
END;
$$;

COMMENT ON FUNCTION public.invitee_claim_engagement(uuid, uuid) IS
  'Claim pending engagement: firm.clients row id = p_firm_client_id; migrates orders/projects by orders.client_id.';
