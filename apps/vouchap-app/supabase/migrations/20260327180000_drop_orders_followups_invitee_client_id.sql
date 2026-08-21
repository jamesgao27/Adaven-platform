-- Single source of truth: firm.orders.client_id and firm.client_follow_ups.client_id only.
-- Backfill, replace RPCs/triggers, drop firm.orders.invitee_client_id and firm.client_follow_ups.invitee_client_id.
SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) Backfill firm.orders.client_id (must satisfy orders_client_id_fkey → firm.clients)
--
-- invitee_client_id may point at firm.invitee_clients.id; firm.clients row for a claimed
-- invitee is not always the same UUID (phase-1 merge joins by firm_space + client_space).
-- Blind copy invitee_client_id → client_id violates FK when no firm.clients row has that id.
--------------------------------------------------------------------------------

DO $repair_orders_client$
BEGIN
  IF to_regclass('firm.invitee_clients') IS NOT NULL THEN
    -- Same as phase-1: pending invitee rows use id = invitee_clients.id
    INSERT INTO firm.clients (
      id,
      firm_space_id,
      client_space_id,
      invitee_email,
      invitee_client_name,
      invitee_contact_name,
      created_at,
      updated_at
    )
    SELECT
      ic.id,
      ic.firm_space_id,
      NULL::uuid,
      ic.invitee_email,
      ic.invitee_client_name,
      ic.invitee_contact_name,
      ic.created_at,
      ic.updated_at
    FROM firm.invitee_clients ic
    WHERE ic.clients_space_id IS NULL
      AND EXISTS (
        SELECT 1 FROM firm.orders o
        WHERE o.invitee_client_id = ic.id
          AND o.client_id IS NULL
      )
      AND NOT EXISTS (SELECT 1 FROM firm.clients fc WHERE fc.id = ic.id);

    -- Same join as 20260325100000 §5: map order → firm.clients via invitee_clients
    UPDATE firm.orders o
    SET client_id = c.id
    FROM firm.invitee_clients ic
    JOIN firm.clients c ON c.firm_space_id = ic.firm_space_id
      AND (
        (ic.clients_space_id IS NOT NULL AND c.client_space_id = ic.clients_space_id)
        OR (ic.clients_space_id IS NULL AND c.id = ic.id)
      )
    WHERE o.invitee_client_id = ic.id
      AND o.client_id IS NULL;
  END IF;
END;
$repair_orders_client$;

-- Remaining: invitee_client_id already equals firm.clients.id (no invitee_clients table / already merged id)
UPDATE firm.orders o
SET client_id = o.invitee_client_id
WHERE o.client_id IS NULL
  AND o.invitee_client_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM firm.clients c WHERE c.id = o.invitee_client_id);

-- Still broken: no firm.clients target (dangling invitee ref). Drop order; children CASCADE.
DELETE FROM firm.orders o
WHERE o.client_id IS NULL
  AND o.invitee_client_id IS NOT NULL;

UPDATE firm.client_follow_ups cfu
SET client_id = cfu.invitee_client_id
WHERE cfu.client_id IS NULL
  AND cfu.invitee_client_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM firm.clients c WHERE c.id = cfu.invitee_client_id);

DELETE FROM firm.client_follow_ups cfu
WHERE cfu.client_id IS NULL
  AND cfu.invitee_client_id IS NOT NULL;

--------------------------------------------------------------------------------
-- 2) can_access_client (orders.client_id only)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION firm.can_access_client(
  p_user_id uuid,
  p_firm_space_id uuid,
  p_client_space_id uuid,
  p_for_write boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, firm
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM firm.orders o
    WHERE o.firm_space_id = p_firm_space_id
      AND o.client_space_id = p_client_space_id
      AND firm.can_access_order(p_user_id, o.id, p_for_write)
  )
  OR EXISTS (
    SELECT 1
    FROM firm.orders o
    JOIN firm.clients c ON c.id = o.client_id
    WHERE o.firm_space_id = p_firm_space_id
      AND o.client_id IS NOT NULL
      AND c.client_space_id IS NOT NULL
      AND c.client_space_id = p_client_space_id
      AND firm.can_access_order(p_user_id, o.id, p_for_write)
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN firm.orders o ON o.id = p.order_id
    WHERE p.client_space_id = p_client_space_id
      AND o.firm_space_id = p_firm_space_id
      AND p.order_id IS NOT NULL
      AND firm.can_access_order(p_user_id, o.id, p_for_write)
  );
$$;

COMMENT ON FUNCTION firm.can_access_client(uuid, uuid, uuid, boolean) IS
  'True if user can access any firm order for this client (order.client_space_id, orders.client_id→clients.client_space_id, or project.client_space_id).';

--------------------------------------------------------------------------------
-- 3) Order → follow-up triggers (pending path: client_id only)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION firm.on_order_insert_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, firm
AS $$
BEGIN
  IF NEW.client_space_id IS NOT NULL THEN
    PERFORM firm.touch_client(NEW.firm_space_id, NEW.client_space_id, NEW.created_at);
    INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
    VALUES (NEW.firm_space_id, NEW.client_space_id, 'Order created', 'order_created', NEW.id, NEW.created_by);
  ELSIF NEW.client_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM firm.clients c WHERE c.id = NEW.client_id) THEN
    INSERT INTO firm.client_follow_ups (firm_space_id, client_id, content, kind, reference_id, created_by)
    VALUES (NEW.firm_space_id, NEW.client_id, 'Order created', 'order_created', NEW.id, NEW.created_by);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION firm.on_order_update_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, firm
AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.client_space_id IS NOT NULL THEN
    PERFORM firm.touch_client(NEW.firm_space_id, NEW.client_space_id, NEW.updated_at);

    IF NEW.status = 'completed' THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, NEW.client_space_id, 'Order completed', 'order_completed', NEW.id, NEW.created_by);

    ELSIF NEW.status = 'cancelled' THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, NEW.client_space_id, 'Order cancelled', 'order_cancelled', NEW.id, NEW.created_by);

    ELSIF OLD.status = 'onboarding' AND NEW.status NOT IN ('onboarding', 'cancelled') THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, NEW.client_space_id, 'Service started', 'order_started', NEW.id, NEW.created_by);
    END IF;

  ELSIF NEW.client_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM firm.clients c WHERE c.id = NEW.client_id) THEN
    IF NEW.status = 'completed' THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, client_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, NEW.client_id, 'Order completed', 'order_completed', NEW.id, NEW.created_by);

    ELSIF NEW.status = 'cancelled' THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, client_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, NEW.client_id, 'Order cancelled', 'order_cancelled', NEW.id, NEW.created_by);

    ELSIF OLD.status = 'onboarding' AND NEW.status NOT IN ('onboarding', 'cancelled') THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, client_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, NEW.client_id, 'Service started', 'order_started', NEW.id, NEW.created_by);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

--------------------------------------------------------------------------------
-- 4) client_follow_ups CHECK + drop invitee_client_id
--------------------------------------------------------------------------------

ALTER TABLE firm.client_follow_ups DROP CONSTRAINT IF EXISTS client_follow_ups_client_or_invitee;

ALTER TABLE firm.client_follow_ups
  ADD CONSTRAINT client_follow_ups_space_or_pending_client CHECK (
    (client_space_id IS NOT NULL AND client_id IS NULL)
    OR (client_space_id IS NULL AND client_id IS NOT NULL)
  );

ALTER TABLE firm.client_follow_ups DROP CONSTRAINT IF EXISTS client_follow_ups_invitee_client_id_fkey;

DROP INDEX IF EXISTS idx_firm_client_follow_ups_invitee_client_id;

ALTER TABLE firm.client_follow_ups DROP COLUMN IF EXISTS invitee_client_id;

--------------------------------------------------------------------------------
-- 5) firm.orders: index + drop invitee_client_id
--------------------------------------------------------------------------------

DROP INDEX IF EXISTS firm_orders_pending_by_invitee_idx;

CREATE INDEX IF NOT EXISTS firm_orders_pending_by_client_idx
  ON firm.orders (firm_space_id, client_id)
  WHERE client_space_id IS NULL AND client_id IS NOT NULL;

COMMENT ON COLUMN firm.orders.client_space_id IS
  'Client space; NULL for pending orders. Link pending rows via orders.client_id → firm.clients.';

ALTER TABLE firm.orders DROP COLUMN IF EXISTS invitee_client_id;

--------------------------------------------------------------------------------
-- 6) RPCs
--------------------------------------------------------------------------------

-- CREATE OR REPLACE cannot rename parameters (e.g. p_invitee_client_id → p_firm_client_id).
DROP FUNCTION IF EXISTS public.migrate_pending_orders_to_client_space(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS firm.migrate_pending_orders_to_client_space(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION firm.migrate_pending_orders_to_client_space(
  p_firm_space_id uuid,
  p_firm_client_id uuid,
  p_client_space_id uuid
)
RETURNS TABLE (order_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id uuid;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.space_id = p_firm_space_id AND us.user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Only firm members can migrate pending orders';
  END IF;

  RETURN QUERY
  UPDATE firm.orders o
  SET client_space_id = p_client_space_id, updated_at = now()
  WHERE o.firm_space_id = p_firm_space_id
    AND o.client_id = p_firm_client_id
    AND o.client_space_id IS NULL
  RETURNING o.id AS order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.migrate_pending_orders_to_client_space(
  p_firm_space_id uuid,
  p_firm_client_id uuid,
  p_client_space_id uuid
)
RETURNS TABLE (order_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, firm
AS $$
  SELECT * FROM firm.migrate_pending_orders_to_client_space(p_firm_space_id, p_firm_client_id, p_client_space_id);
$$;

DROP FUNCTION IF EXISTS public.invitee_claim_engagement(uuid, uuid);
CREATE OR REPLACE FUNCTION public.invitee_claim_engagement(
  p_firm_client_id uuid,
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

  UPDATE firm.clients
  SET client_space_id = p_client_space_id, updated_at = now()
  WHERE id = p_firm_client_id
    AND firm_space_id = v_firm_space_id
    AND client_space_id IS NULL;

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

DROP FUNCTION IF EXISTS public.get_pending_invitees_for_email(text);
CREATE OR REPLACE FUNCTION public.get_pending_invitees_for_email(p_email text)
RETURNS TABLE (
  firm_space_id uuid,
  firm_name text,
  firm_client_id uuid,
  invitee_client_name text,
  invitee_email text,
  sku_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, firm
STABLE
AS $$
  SELECT
    c.firm_space_id,
    s.name AS firm_name,
    c.id AS firm_client_id,
    c.invitee_client_name,
    c.invitee_email,
    (SELECT o.sku_id FROM firm.orders o
     WHERE o.firm_space_id = c.firm_space_id
       AND o.client_id = c.id
       AND o.client_space_id IS NULL
     LIMIT 1) AS sku_id
  FROM firm.clients c
  JOIN public.spaces s ON s.id = c.firm_space_id
  WHERE LOWER(TRIM(COALESCE(c.invitee_email, ''))) = LOWER(TRIM(COALESCE(p_email, '')))
    AND c.client_space_id IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM firm.orders o
        WHERE o.firm_space_id = c.firm_space_id
          AND o.client_id = c.id
          AND o.client_space_id IS NULL
      )
      OR NOT EXISTS (
        SELECT 1 FROM firm.orders o
        WHERE o.firm_space_id = c.firm_space_id
          AND o.client_id = c.id
      )
    );
$$;

-- RETURNS TABLE column rename (invitee_client_id → firm_client_id) changes row type; REPLACE is not enough.
DROP FUNCTION IF EXISTS public.firm_create_invitee_only(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.firm_create_pending_order_for_invitee(uuid, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.firm_create_invitee_only(
  p_firm_space_id uuid,
  p_client_name text,
  p_contact_name text,
  p_contact_email text
)
RETURNS TABLE (firm_client_id uuid, invitee_email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id uuid;
  v_contact_email text;
  v_now timestamptz := now();
  v_id uuid;
  v_name text;
  v_contact text;
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

  v_name := COALESCE(NULLIF(TRIM(p_client_name), ''), NULLIF(TRIM(p_contact_name), ''), 'Client');
  v_contact := NULLIF(TRIM(COALESCE(p_contact_name, '')), '');

  SELECT c.id INTO v_id
  FROM firm.clients c
  WHERE c.firm_space_id = p_firm_space_id
    AND c.client_space_id IS NULL
    AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = v_contact_email
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO firm.clients (
      firm_space_id, client_space_id, invitee_email, invitee_client_name, invitee_contact_name,
      creator_user_id, created_at, updated_at
    )
    VALUES (p_firm_space_id, NULL, v_contact_email, v_name, v_contact, v_caller_id, v_now, v_now)
    RETURNING id INTO v_id;
  ELSE
    UPDATE firm.clients
    SET
      invitee_client_name = COALESCE(v_name, invitee_client_name),
      invitee_contact_name = COALESCE(v_contact, invitee_contact_name),
      updated_at = v_now
    WHERE id = v_id;
  END IF;

  RETURN QUERY SELECT v_id, v_contact_email::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.firm_create_pending_order_for_invitee(
  p_firm_space_id uuid,
  p_client_name text,
  p_contact_name text,
  p_contact_email text,
  p_sku_id uuid
)
RETURNS TABLE (
  order_id uuid,
  firm_space_id uuid,
  firm_client_id uuid,
  invitee_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id uuid;
  v_client_name text;
  v_contact_name text;
  v_contact_email text;
  v_firm_client_id uuid;
  v_order_id uuid;
  v_now timestamptz := now();
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

  v_client_name := NULLIF(TRIM(p_client_name), '');
  v_contact_name := NULLIF(TRIM(p_contact_name), '');
  v_contact_email := NULLIF(LOWER(TRIM(p_contact_email)), '');
  IF v_contact_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required for pending orders';
  END IF;

  SELECT c.id INTO v_firm_client_id
  FROM firm.clients c
  WHERE c.firm_space_id = p_firm_space_id
    AND c.client_space_id IS NULL
    AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = v_contact_email
  LIMIT 1;

  IF v_firm_client_id IS NULL THEN
    INSERT INTO firm.clients (
      firm_space_id, client_space_id, invitee_email, invitee_client_name, invitee_contact_name,
      creator_user_id, created_at, updated_at
    )
    VALUES (
      p_firm_space_id, NULL, v_contact_email,
      COALESCE(v_client_name, v_contact_name, 'Client'), v_contact_name,
      v_caller_id, v_now, v_now
    )
    RETURNING id INTO v_firm_client_id;
  ELSE
    UPDATE firm.clients
    SET
      invitee_client_name = COALESCE(v_client_name, invitee_client_name),
      invitee_contact_name = COALESCE(v_contact_name, invitee_contact_name),
      updated_at = v_now
    WHERE id = v_firm_client_id;
  END IF;

  INSERT INTO firm.orders (
    firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by, client_id
  )
  VALUES (
    p_firm_space_id, NULL, p_sku_id, 'onboarding', NULL, v_now, v_now, v_caller_id, v_firm_client_id
  )
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_order_id, p_firm_space_id, v_firm_client_id, v_contact_email;
END;
$$;

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
  v_order_id uuid;
  v_joined bigint;
BEGIN
  IF p_token IS NULL OR p_client_space_id IS NULL OR p_client_user_id IS NULL THEN
    RAISE EXCEPTION 'token, client_space_id and client_user_id are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_token_record FROM firm.client_invite_tokens WHERE token = p_token;

  IF NOT FOUND OR v_token_record.is_active IS FALSE THEN
    RAISE EXCEPTION 'Invalid or inactive client invite token' USING ERRCODE = '22023';
  END IF;

  IF v_token_record.expires_at IS NOT NULL AND v_token_record.expires_at <= v_now THEN
    RAISE EXCEPTION 'Client invite token has expired' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::bigint INTO v_joined FROM firm.clients c WHERE c.invite_token_id = v_token_record.id;

  IF v_token_record.max_clients IS NOT NULL AND v_joined >= v_token_record.max_clients THEN
    RAISE EXCEPTION 'Client invite token has reached its maximum usage' USING ERRCODE = '22023';
  END IF;

  INSERT INTO firm.clients (firm_space_id, client_space_id, invite_token_id, creator_user_id)
  VALUES (v_token_record.firm_space_id, p_client_space_id, v_token_record.id, v_token_record.inviter_user_id)
  ON CONFLICT (firm_space_id, client_space_id)
  DO UPDATE SET
    invite_token_id = COALESCE(firm.clients.invite_token_id, EXCLUDED.invite_token_id),
    creator_user_id = COALESCE(firm.clients.creator_user_id, EXCLUDED.creator_user_id);

  INSERT INTO firm.orders (
    firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by
  )
  VALUES (
    v_token_record.firm_space_id, p_client_space_id, v_token_record.sku_id,
    'onboarding', NULL, v_now, v_now, p_client_user_id
  )
  ON CONFLICT (firm_space_id, client_space_id, sku_id, status)
  DO UPDATE SET updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_order_id;

  INSERT INTO firm.order_managers (firm_space_id, manager_user_id, order_id, created_at)
  VALUES (v_token_record.firm_space_id, v_token_record.inviter_user_id, v_order_id, v_now)
  ON CONFLICT (order_id) DO UPDATE SET manager_user_id = EXCLUDED.manager_user_id;

  SELECT COUNT(*)::bigint INTO v_joined FROM firm.clients c WHERE c.invite_token_id = v_token_record.id;

  IF v_token_record.max_clients IS NOT NULL AND v_joined >= v_token_record.max_clients THEN
    UPDATE firm.client_invite_tokens t SET is_active = false WHERE t.id = v_token_record.id;
  END IF;

  RETURN QUERY
  SELECT v_token_record.firm_space_id, p_client_space_id, v_token_record.inviter_user_id, v_token_record.sku_id;
END;
$$;
