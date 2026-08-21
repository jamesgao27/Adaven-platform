-- Add client without SKU: only create invitee_client (no order, no client space).
-- That email later sees "link space with [Firm]" with empty SKU preview; firm can add SKU later.
-- Also: get_pending_invitees_for_email includes invitees with zero orders; invitee_claim_engagement allows 0 pending orders.
SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) RPC: firm_create_invitee_only — upsert firm.invitee_clients only (no order)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.firm_create_invitee_only(
  p_firm_space_id   UUID,
  p_client_name    TEXT,
  p_contact_name   TEXT,
  p_contact_email  TEXT
)
RETURNS TABLE (invitee_client_id UUID, invitee_email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id UUID;
  v_contact_email TEXT;
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
    RAISE EXCEPTION 'Only firm members can add invitees';
  END IF;

  v_contact_email := NULLIF(LOWER(TRIM(COALESCE(p_contact_email, ''))), '');
  IF v_contact_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required';
  END IF;

  INSERT INTO firm.invitee_clients (
    firm_space_id,
    invitee_email,
    invitee_client_name,
    invitee_contact_name,
    invitee_contact_email
  )
  VALUES (
    p_firm_space_id,
    v_contact_email,
    COALESCE(NULLIF(TRIM(p_client_name), ''), NULLIF(TRIM(p_contact_name), ''), 'Client'),
    NULLIF(TRIM(COALESCE(p_contact_name, '')), ''),
    v_contact_email
  )
  ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET
    invitee_client_name   = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
    invitee_contact_name  = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
    invitee_contact_email = COALESCE(EXCLUDED.invitee_contact_email, firm.invitee_clients.invitee_contact_email),
    updated_at            = v_now;

  RETURN QUERY
  SELECT ic.id, ic.invitee_contact_email
  FROM firm.invitee_clients ic
  WHERE ic.firm_space_id = p_firm_space_id AND ic.invitee_email = v_contact_email
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.firm_create_invitee_only(UUID, TEXT, TEXT, TEXT) IS
  'Firm: create/update invitee_client only (no order). Used when Add client without SKU; client can later link space with empty SKU preview.';

--------------------------------------------------------------------------------
-- 2) get_pending_invitees_for_email: include invitees with zero orders (invitee-only)
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_pending_invitees_for_email(text);

CREATE OR REPLACE FUNCTION public.get_pending_invitees_for_email(p_email text)
RETURNS TABLE (
  firm_space_id uuid,
  firm_name text,
  invitee_client_id uuid,
  invitee_client_name text,
  invitee_contact_email text,
  sku_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, firm
STABLE
AS $$
  SELECT
    ic.firm_space_id,
    s.name AS firm_name,
    ic.id AS invitee_client_id,
    ic.invitee_client_name,
    ic.invitee_contact_email,
    (SELECT o.sku_id FROM firm.orders o
     WHERE o.firm_space_id = ic.firm_space_id
       AND o.invitee_client_id = ic.id
       AND o.client_space_id IS NULL
     LIMIT 1) AS sku_id
  FROM firm.invitee_clients ic
  JOIN public.spaces s ON s.id = ic.firm_space_id
  WHERE LOWER(TRIM(COALESCE(ic.invitee_contact_email, ''))) = LOWER(TRIM(COALESCE(p_email, '')))
    AND (
      EXISTS (
        SELECT 1 FROM firm.orders o
        WHERE o.firm_space_id = ic.firm_space_id
          AND o.invitee_client_id = ic.id
          AND o.client_space_id IS NULL
      )
      OR NOT EXISTS (
        SELECT 1 FROM firm.orders o
        WHERE o.firm_space_id = ic.firm_space_id
          AND o.invitee_client_id = ic.id
      )
    );
$$;

COMMENT ON FUNCTION public.get_pending_invitees_for_email(text) IS
  'Client by email: pending invitees (with or without pending orders). With orders: sku_id for preview; without: sku_id null, still show "link space with [Firm]".';

--------------------------------------------------------------------------------
-- 3) invitee_claim_engagement: allow 0 pending orders (invitee-only link)
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

  SELECT ic.firm_space_id, LOWER(TRIM(COALESCE(ic.invitee_contact_email, '')))
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

  INSERT INTO firm.clients (firm_space_id, client_space_id, status)
  VALUES (v_firm_space_id, p_client_space_id, 'active')
  ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key DO NOTHING;

  -- Migrate pending orders if any (invitee-only has 0 orders; skip updates)
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
  'Client claim: link space to firm (with or without pending orders). Writes firm.clients, migrates pending orders if any, updates projects, adds user to client space.';
