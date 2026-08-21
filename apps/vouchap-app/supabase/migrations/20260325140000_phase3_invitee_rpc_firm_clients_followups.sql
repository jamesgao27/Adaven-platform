-- Phase 3 + 5: RPCs use firm.clients (no invitee_clients writes); can_access_client without invitee_clients JOIN;
-- client_follow_ups.client_id (FK firm.clients); order triggers write client_id for pending.
-- Depends on 20260325100000, 20260325110000, 20260325130000.
SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) firm.can_access_client: replace invitee_clients branch with firm.clients via order client keys
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
    JOIN firm.clients c ON c.id = COALESCE(o.client_id, o.invitee_client_id)
    WHERE o.firm_space_id = p_firm_space_id
      AND COALESCE(o.client_id, o.invitee_client_id) IS NOT NULL
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
-- 2) client_follow_ups: add client_id, backfill, relax CHECK, drop FK to invitee_clients
--    client_id FK only when invitee_client_id resolves to firm.clients (orphan invitee-only rows keep invitee_client_id only)
--------------------------------------------------------------------------------

ALTER TABLE firm.client_follow_ups DROP CONSTRAINT IF EXISTS client_follow_ups_client_id_fkey;

ALTER TABLE firm.client_follow_ups
  ADD COLUMN IF NOT EXISTS client_id UUID;

UPDATE firm.client_follow_ups cfu
SET client_id = cfu.invitee_client_id
FROM firm.clients c
WHERE cfu.invitee_client_id IS NOT NULL
  AND cfu.client_id IS NULL
  AND c.id = cfu.invitee_client_id;

ALTER TABLE firm.client_follow_ups
  ADD CONSTRAINT client_follow_ups_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES firm.clients(id) ON DELETE CASCADE;

ALTER TABLE firm.client_follow_ups DROP CONSTRAINT IF EXISTS client_follow_ups_client_or_invitee;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'firm.client_follow_ups'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) LIKE '%invitee_clients%'
  ) LOOP
    EXECUTE format('ALTER TABLE firm.client_follow_ups DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE firm.client_follow_ups
  ADD CONSTRAINT client_follow_ups_client_or_invitee CHECK (
    (client_space_id IS NOT NULL AND client_id IS NULL AND invitee_client_id IS NULL)
    OR (client_space_id IS NULL AND (client_id IS NOT NULL OR invitee_client_id IS NOT NULL))
  );

COMMENT ON COLUMN firm.client_follow_ups.client_id IS 'Pending firm.clients row id; preferred over invitee_client_id until column removed.';

CREATE INDEX IF NOT EXISTS idx_firm_client_follow_ups_client_id
  ON firm.client_follow_ups (client_id)
  WHERE client_id IS NOT NULL;

--------------------------------------------------------------------------------
-- 3) Order follow-up triggers: pending path uses client_id (dual-write invitee_client_id on orders unchanged)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION firm.on_order_insert_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, firm
AS $$
DECLARE
  v_uid uuid;
BEGIN
  IF NEW.client_space_id IS NOT NULL THEN
    PERFORM firm.touch_client(NEW.firm_space_id, NEW.client_space_id, NEW.created_at);
    INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
    VALUES (NEW.firm_space_id, NEW.client_space_id, 'Order created', 'order_created', NEW.id, NEW.created_by);
  ELSIF NEW.client_id IS NOT NULL OR NEW.invitee_client_id IS NOT NULL THEN
    v_uid := COALESCE(NEW.client_id, NEW.invitee_client_id);
    IF EXISTS (SELECT 1 FROM firm.clients c WHERE c.id = v_uid) THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, client_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, v_uid, 'Order created', 'order_created', NEW.id, NEW.created_by);
    ELSIF NEW.invitee_client_id IS NOT NULL THEN
      INSERT INTO firm.client_follow_ups (firm_space_id, invitee_client_id, content, kind, reference_id, created_by)
      VALUES (NEW.firm_space_id, NEW.invitee_client_id, 'Order created', 'order_created', NEW.id, NEW.created_by);
    END IF;
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
DECLARE
  v_uid uuid;
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

  ELSIF NEW.client_id IS NOT NULL OR NEW.invitee_client_id IS NOT NULL THEN
    v_uid := COALESCE(NEW.client_id, NEW.invitee_client_id);
    IF EXISTS (SELECT 1 FROM firm.clients c WHERE c.id = v_uid) THEN
      IF NEW.status = 'completed' THEN
        INSERT INTO firm.client_follow_ups (firm_space_id, client_id, content, kind, reference_id, created_by)
        VALUES (NEW.firm_space_id, v_uid, 'Order completed', 'order_completed', NEW.id, NEW.created_by);

      ELSIF NEW.status = 'cancelled' THEN
        INSERT INTO firm.client_follow_ups (firm_space_id, client_id, content, kind, reference_id, created_by)
        VALUES (NEW.firm_space_id, v_uid, 'Order cancelled', 'order_cancelled', NEW.id, NEW.created_by);

      ELSIF OLD.status = 'onboarding' AND NEW.status NOT IN ('onboarding', 'cancelled') THEN
        INSERT INTO firm.client_follow_ups (firm_space_id, client_id, content, kind, reference_id, created_by)
        VALUES (NEW.firm_space_id, v_uid, 'Service started', 'order_started', NEW.id, NEW.created_by);
      END IF;
    ELSIF NEW.invitee_client_id IS NOT NULL THEN
      IF NEW.status = 'completed' THEN
        INSERT INTO firm.client_follow_ups (firm_space_id, invitee_client_id, content, kind, reference_id, created_by)
        VALUES (NEW.firm_space_id, NEW.invitee_client_id, 'Order completed', 'order_completed', NEW.id, NEW.created_by);

      ELSIF NEW.status = 'cancelled' THEN
        INSERT INTO firm.client_follow_ups (firm_space_id, invitee_client_id, content, kind, reference_id, created_by)
        VALUES (NEW.firm_space_id, NEW.invitee_client_id, 'Order cancelled', 'order_cancelled', NEW.id, NEW.created_by);

      ELSIF OLD.status = 'onboarding' AND NEW.status NOT IN ('onboarding', 'cancelled') THEN
        INSERT INTO firm.client_follow_ups (firm_space_id, invitee_client_id, content, kind, reference_id, created_by)
        VALUES (NEW.firm_space_id, NEW.invitee_client_id, 'Service started', 'order_started', NEW.id, NEW.created_by);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

--------------------------------------------------------------------------------
-- 4) public.invitee_claim_engagement — firm.clients only; no invitee_clients write
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.invitee_claim_engagement(uuid, uuid);
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
  WHERE c.id = p_invitee_client_id;

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
  WHERE id = p_invitee_client_id
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
    AND (o.client_id = p_invitee_client_id OR o.invitee_client_id = p_invitee_client_id);

  UPDATE public.projects pr
  SET client_space_id = p_client_space_id, updated_at = now()
  WHERE pr.order_id IN (
    SELECT o.id FROM firm.orders o
    WHERE o.firm_space_id = v_firm_space_id
      AND (o.client_id = p_invitee_client_id OR o.invitee_client_id = p_invitee_client_id)
  );

  INSERT INTO public.user_spaces (space_id, user_id, is_admin)
  VALUES (p_client_space_id, v_uid, true)
  ON CONFLICT (space_id, user_id) DO UPDATE SET is_admin = true;

  RETURN QUERY SELECT p_client_space_id, v_firm_space_id;
END;
$$;

COMMENT ON FUNCTION public.invitee_claim_engagement(uuid, uuid) IS
  'Claim pending engagement: validates firm.clients pending row; updates orders/projects by client_id or legacy invitee_client_id; no invitee_clients table write.';

--------------------------------------------------------------------------------
-- 5) firm_create_invitee_only — insert firm.clients pending row only
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.firm_create_invitee_only(
  p_firm_space_id uuid,
  p_client_name text,
  p_contact_name text,
  p_contact_email text
)
RETURNS TABLE (invitee_client_id uuid, invitee_email text)
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
      firm_space_id,
      client_space_id,
      invitee_email,
      invitee_client_name,
      invitee_contact_name,
      created_at,
      updated_at
    )
    VALUES (
      p_firm_space_id,
      NULL,
      v_contact_email,
      v_name,
      v_contact,
      v_now,
      v_now
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE firm.clients
    SET
      invitee_client_name = COALESCE(v_name, invitee_client_name),
      invitee_contact_name = COALESCE(v_contact, invitee_contact_name),
      updated_at = v_now
    WHERE id = v_id;
  END IF;

  RETURN QUERY
  SELECT v_id, v_contact_email::text;
END;
$$;

--------------------------------------------------------------------------------
-- 6) firm_create_pending_order_for_invitee — firm.clients + orders.client_id
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.firm_create_pending_order_for_invitee(uuid, text, text, text, uuid);
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
  invitee_client_id uuid,
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
  v_invitee_id uuid;
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

  SELECT c.id INTO v_invitee_id
  FROM firm.clients c
  WHERE c.firm_space_id = p_firm_space_id
    AND c.client_space_id IS NULL
    AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = v_contact_email
  LIMIT 1;

  IF v_invitee_id IS NULL THEN
    INSERT INTO firm.clients (
      firm_space_id,
      client_space_id,
      invitee_email,
      invitee_client_name,
      invitee_contact_name,
      created_at,
      updated_at
    )
    VALUES (
      p_firm_space_id,
      NULL,
      v_contact_email,
      COALESCE(v_client_name, v_contact_name, 'Client'),
      v_contact_name,
      v_now,
      v_now
    )
    RETURNING id INTO v_invitee_id;
  ELSE
    UPDATE firm.clients
    SET
      invitee_client_name = COALESCE(v_client_name, invitee_client_name),
      invitee_contact_name = COALESCE(v_contact_name, invitee_contact_name),
      updated_at = v_now
    WHERE id = v_invitee_id;
  END IF;

  INSERT INTO firm.orders (
    firm_space_id,
    client_space_id,
    sku_id,
    status,
    due_at,
    created_at,
    updated_at,
    created_by,
    invitee_client_id,
    client_id
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
    v_invitee_id,
    v_invitee_id
  )
  RETURNING id INTO v_order_id;

  RETURN QUERY
  SELECT v_order_id, p_firm_space_id, v_invitee_id, v_contact_email;
END;
$$;

--------------------------------------------------------------------------------
-- 7) firm_create_client_on_behalf — invitee snapshot on firm.clients only
--------------------------------------------------------------------------------

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
  client_space_id uuid,
  invitation_id uuid,
  space_name text,
  invitee_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id uuid;
  v_space_name text;
  v_client_space_id uuid;
  v_invitation_id uuid;
  v_inviter_email text;
  v_inviter_name text;
  v_now timestamptz := now();
  v_created_contact_name text := NULLIF(TRIM(p_contact_name), '');
  v_created_contact_email text := NULLIF(LOWER(TRIM(p_contact_email)), '');
  v_order_id uuid;
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

  IF v_created_contact_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required';
  END IF;

  v_space_name := COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, 'Client Space');

  INSERT INTO public.spaces (name, address, kind)
  VALUES (v_space_name, NULL, 'client')
  RETURNING id INTO v_client_space_id;

  INSERT INTO firm.clients (
    firm_space_id,
    client_space_id,
    invitee_email,
    invitee_client_name,
    invitee_contact_name,
    created_at,
    updated_at
  )
  VALUES (
    p_firm_space_id,
    v_client_space_id,
    v_created_contact_email,
    COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, v_space_name),
    v_created_contact_name,
    v_now,
    v_now
  )
  ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key DO UPDATE SET
    invitee_email = COALESCE(EXCLUDED.invitee_email, firm.clients.invitee_email),
    invitee_client_name = COALESCE(EXCLUDED.invitee_client_name, firm.clients.invitee_client_name),
    invitee_contact_name = COALESCE(EXCLUDED.invitee_contact_name, firm.clients.invitee_contact_name),
    updated_at = v_now;

  IF p_sku_id IS NOT NULL THEN
    INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by)
    VALUES (p_firm_space_id, v_client_space_id, p_sku_id, 'onboarding', NULL, v_now, v_now, v_caller_id)
    ON CONFLICT (firm_space_id, client_space_id, sku_id, status)
    DO UPDATE SET updated_at = EXCLUDED.updated_at
    RETURNING id INTO v_order_id;

    INSERT INTO firm.order_managers (firm_space_id, manager_user_id, order_id, created_at)
    VALUES (p_firm_space_id, v_caller_id, v_order_id, v_now)
    ON CONFLICT (order_id) DO NOTHING;
  END IF;

  SELECT u.name, COALESCE(u.email, (SELECT email FROM auth.users WHERE id = v_caller_id LIMIT 1))
  INTO v_inviter_name, v_inviter_email
  FROM public.users u
  WHERE u.id = v_caller_id
  LIMIT 1;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'space_invitations'
  ) AND p_create_invitation THEN
    INSERT INTO public.space_invitations (
      space_id, inviter_id, inviter_email, invitee_email, space_name, status, created_at, invite_as_admin, inviter_name
    )
    VALUES (
      v_client_space_id, v_caller_id, COALESCE(v_inviter_email, ''), v_created_contact_email, v_space_name,
      'pending', v_now, true, NULLIF(TRIM(v_inviter_name), '')
    )
    RETURNING id INTO v_invitation_id;
  ELSE
    v_invitation_id := NULL;
  END IF;

  RETURN QUERY SELECT v_client_space_id, v_invitation_id, v_space_name, v_created_contact_email;
END;
$$;
