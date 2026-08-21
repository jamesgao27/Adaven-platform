-- Open invite: record which token created each firm.clients row (invite_token_id).
-- Joined count per token = COUNT(clients WHERE invite_token_id = token.id).
-- Remove client_invite_tokens.current_clients (denormalized counter).

SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) Schema: firm.clients.invite_token_id
--------------------------------------------------------------------------------

ALTER TABLE firm.clients
  ADD COLUMN IF NOT EXISTS invite_token_id UUID REFERENCES firm.client_invite_tokens(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_firm_clients_invite_token_id
  ON firm.clients (invite_token_id)
  WHERE invite_token_id IS NOT NULL;

COMMENT ON COLUMN firm.clients.invite_token_id IS
  'Set when the client row is created via open invite (firm.accept_client_invite_token). NULL for invitee-claim / on-behalf paths.';

--------------------------------------------------------------------------------
-- 2) Landing page: max_clients uses COUNT(clients) not current_clients
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.firm_get_client_invite_info(p_token text)
RETURNS TABLE (
  firm_space_id uuid,
  firm_name text,
  inviter_user_id uuid,
  sku_id uuid,
  token_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = firm, public
STABLE
AS $$
  SELECT
    t.firm_space_id,
    s.name AS firm_name,
    t.inviter_user_id,
    t.sku_id,
    t.id AS token_id
  FROM firm.client_invite_tokens t
  LEFT JOIN public.spaces s ON s.id = t.firm_space_id
  WHERE t.token = p_token
    AND t.is_active = true
    AND (t.expires_at IS NULL OR t.expires_at > now())
    AND (
      t.max_clients IS NULL
      OR (
        SELECT COUNT(*)::bigint
        FROM firm.clients c
        WHERE c.invite_token_id = t.id
      ) < t.max_clients
    );
$$;

COMMENT ON FUNCTION public.firm_get_client_invite_info(text) IS
  'Open-invite token info when valid: active, not expired, under max_clients (count firm.clients by invite_token_id).';

--------------------------------------------------------------------------------
-- 3) firm.accept_client_invite_token: set invite_token_id; cap via COUNT; drop counter update
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
  v_joined bigint;
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

  SELECT COUNT(*)::bigint INTO v_joined
  FROM firm.clients c
  WHERE c.invite_token_id = v_token_record.id;

  IF v_token_record.max_clients IS NOT NULL AND v_joined >= v_token_record.max_clients THEN
    RAISE EXCEPTION 'Client invite token has reached its maximum usage'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO firm.clients (firm_space_id, client_space_id, invite_token_id)
  VALUES (v_token_record.firm_space_id, p_client_space_id, v_token_record.id)
  ON CONFLICT (firm_space_id, client_space_id)
  DO UPDATE SET
    invite_token_id = COALESCE(firm.clients.invite_token_id, EXCLUDED.invite_token_id);

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

  SELECT COUNT(*)::bigint INTO v_joined
  FROM firm.clients c
  WHERE c.invite_token_id = v_token_record.id;

  IF v_token_record.max_clients IS NOT NULL AND v_joined >= v_token_record.max_clients THEN
    UPDATE firm.client_invite_tokens t
    SET is_active = false
    WHERE t.id = v_token_record.id;
  END IF;

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
  'Open invite: firm.clients (invite_token_id set), assignee, onboarding order; caps via COUNT(clients); may set token inactive.';

--------------------------------------------------------------------------------
-- 4) Firm UI: joined counts for all firm members (not filtered by assignee RLS)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.firm_open_invite_joined_counts(p_firm_space_id uuid)
RETURNS TABLE (
  invite_token_id uuid,
  joined_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.space_id = p_firm_space_id AND us.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not a member of this firm space';
  END IF;

  RETURN QUERY
  SELECT c.invite_token_id, COUNT(*)::bigint AS joined_count
  FROM firm.clients c
  WHERE c.firm_space_id = p_firm_space_id
    AND c.invite_token_id IS NOT NULL
  GROUP BY c.invite_token_id;
END;
$$;

COMMENT ON FUNCTION public.firm_open_invite_joined_counts(uuid) IS
  'Per open-invite token: number of firm.clients rows with that invite_token_id (firm members only).';

GRANT EXECUTE ON FUNCTION public.firm_open_invite_joined_counts(uuid) TO authenticated;

--------------------------------------------------------------------------------
-- 5) Drop denormalized counter
--------------------------------------------------------------------------------

ALTER TABLE firm.client_invite_tokens
  DROP COLUMN IF EXISTS current_clients;
