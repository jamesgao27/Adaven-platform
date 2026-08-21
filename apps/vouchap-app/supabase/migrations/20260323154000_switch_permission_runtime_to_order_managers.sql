SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) Runtime permission helpers
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION firm.can_access_order(
  p_user_id uuid,
  p_order_id uuid,
  p_for_write boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, firm
AS $$
  WITH target_order AS (
    SELECT o.*
    FROM firm.orders o
    WHERE o.id = p_order_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM target_order o
    WHERE
      EXISTS (
        SELECT 1
        FROM public.user_spaces us
        WHERE us.space_id = o.firm_space_id
          AND us.user_id = p_user_id
          AND us.is_admin = true
      )
      OR EXISTS (
        SELECT 1
        FROM firm.order_managers om
        WHERE om.order_id = o.id
          AND om.manager_user_id = p_user_id
      )
      OR EXISTS (
        SELECT 1
        FROM firm.permission_role_members prm
        JOIN firm.permission_roles pr ON pr.id = prm.role_id
        WHERE prm.firm_space_id = o.firm_space_id
          AND prm.user_id = p_user_id
          AND (
            CASE
              WHEN p_for_write THEN
                COALESCE(pr.order_permissions ->> 'all', 'false') = 'true'
                OR COALESCE(pr.order_permissions ->> 'edit', 'false') = 'true'
                OR COALESCE(pr.order_permissions ->> 'update', 'false') = 'true'
                OR COALESCE(pr.order_permissions ->> 'manage', 'false') = 'true'
              ELSE
                COALESCE(pr.order_permissions ->> 'all', 'false') = 'true'
                OR COALESCE(pr.order_permissions ->> 'view', 'false') = 'true'
                OR COALESCE(pr.order_permissions ->> 'read', 'false') = 'true'
                OR COALESCE(pr.order_permissions ->> 'list', 'false') = 'true'
            END
          )
          AND NOT EXISTS (
            SELECT 1
            FROM firm.permission_role_scope prs
            WHERE prs.role_id = pr.id
              AND prs.dimension = 'season'
              AND prs.scope_mode = 'include'
              AND (
                o.tax_season_label_id IS NULL
                OR NOT (o.tax_season_label_id = ANY (prs.label_ids))
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM firm.permission_role_scope prs
            WHERE prs.role_id = pr.id
              AND prs.dimension = 'country'
              AND prs.scope_mode = 'include'
              AND (
                o.tax_country_label_id IS NULL
                OR NOT (o.tax_country_label_id = ANY (prs.label_ids))
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM firm.permission_role_scope prs
            WHERE prs.role_id = pr.id
              AND prs.dimension = 'scenario'
              AND prs.scope_mode = 'include'
              AND (
                o.tax_scenario_label_id IS NULL
                OR NOT (o.tax_scenario_label_id = ANY (prs.label_ids))
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM firm.permission_role_scope prs
            WHERE prs.role_id = pr.id
              AND prs.dimension = 'custom'
              AND prs.scope_mode = 'include'
              AND (
                cardinality(COALESCE(o.custom_label_ids, ARRAY[]::uuid[])) = 0
                OR NOT (COALESCE(o.custom_label_ids, ARRAY[]::uuid[]) && prs.label_ids)
              )
          )
      )
  );
$$;

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
  );
$$;

CREATE OR REPLACE FUNCTION firm.can_access_project(
  p_user_id uuid,
  p_project_id uuid,
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
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.order_id IS NOT NULL
      AND firm.can_access_order(p_user_id, p.order_id, p_for_write)
  );
$$;

--------------------------------------------------------------------------------
-- 2) Orders auto-manager sync (fallback to creator)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION firm.ensure_order_manager_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_manager_id uuid;
BEGIN
  IF NEW.id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT us.user_id INTO v_manager_id
  FROM public.user_spaces us
  WHERE us.space_id = NEW.firm_space_id
    AND us.user_id = NEW.created_by
  LIMIT 1;

  IF v_manager_id IS NULL THEN
    SELECT us.user_id INTO v_manager_id
    FROM public.user_spaces us
    WHERE us.space_id = NEW.firm_space_id
    ORDER BY us.is_admin DESC, us.user_id
    LIMIT 1;
  END IF;

  IF v_manager_id IS NOT NULL THEN
    INSERT INTO firm.order_managers (firm_space_id, manager_user_id, order_id, created_at)
    VALUES (NEW.firm_space_id, v_manager_id, NEW.id, COALESCE(NEW.created_at, now()))
    ON CONFLICT (order_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_ensure_order_manager_after_insert ON firm.orders;
CREATE TRIGGER tr_ensure_order_manager_after_insert
  AFTER INSERT ON firm.orders
  FOR EACH ROW
  EXECUTE FUNCTION firm.ensure_order_manager_after_insert();

--------------------------------------------------------------------------------
-- 3) RLS switch to order-based authorization
--------------------------------------------------------------------------------

DROP POLICY IF EXISTS firm_clients_select ON firm.clients;
DROP POLICY IF EXISTS firm_clients_update ON firm.clients;
DROP POLICY IF EXISTS firm_clients_delete ON firm.clients;

CREATE POLICY firm_clients_select ON firm.clients
  FOR SELECT TO authenticated
  USING (
    firm.can_access_client(auth.uid(), firm.clients.firm_space_id, firm.clients.client_space_id, false)
  );

CREATE POLICY firm_clients_update ON firm.clients
  FOR UPDATE TO authenticated
  USING (
    firm.can_access_client(auth.uid(), firm.clients.firm_space_id, firm.clients.client_space_id, true)
  );

CREATE POLICY firm_clients_delete ON firm.clients
  FOR DELETE TO authenticated
  USING (
    firm.can_access_client(auth.uid(), firm.clients.firm_space_id, firm.clients.client_space_id, true)
  );

DROP POLICY IF EXISTS firm_orders_select ON firm.orders;
DROP POLICY IF EXISTS firm_orders_update ON firm.orders;
DROP POLICY IF EXISTS firm_orders_delete ON firm.orders;

CREATE POLICY firm_orders_select ON firm.orders
  FOR SELECT TO authenticated
  USING (
    firm.can_access_order(auth.uid(), firm.orders.id, false)
    OR (
      firm.orders.client_space_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.user_spaces us
        WHERE us.space_id = firm.orders.client_space_id
          AND us.user_id = auth.uid()
      )
    )
  );

CREATE POLICY firm_orders_update ON firm.orders
  FOR UPDATE TO authenticated
  USING (firm.can_access_order(auth.uid(), firm.orders.id, true));

CREATE POLICY firm_orders_delete ON firm.orders
  FOR DELETE TO authenticated
  USING (firm.can_access_order(auth.uid(), firm.orders.id, true));

DROP POLICY IF EXISTS public_projects_select ON public.projects;
DROP POLICY IF EXISTS public_projects_insert ON public.projects;
DROP POLICY IF EXISTS public_projects_update ON public.projects;
DROP POLICY IF EXISTS public_projects_delete ON public.projects;

CREATE POLICY public_projects_select ON public.projects
  FOR SELECT TO authenticated
  USING (
    (
      public.projects.order_id IS NOT NULL
      AND firm.can_access_order(auth.uid(), public.projects.order_id, false)
    )
    OR EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = public.projects.client_space_id
        AND us.user_id = auth.uid()
    )
  );

CREATE POLICY public_projects_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (
    public.projects.order_id IS NOT NULL
    AND firm.can_access_order(auth.uid(), public.projects.order_id, true)
  );

CREATE POLICY public_projects_update ON public.projects
  FOR UPDATE TO authenticated
  USING (
    public.projects.order_id IS NOT NULL
    AND firm.can_access_order(auth.uid(), public.projects.order_id, true)
  );

CREATE POLICY public_projects_delete ON public.projects
  FOR DELETE TO authenticated
  USING (
    public.projects.order_id IS NOT NULL
    AND firm.can_access_order(auth.uid(), public.projects.order_id, true)
  );

--------------------------------------------------------------------------------
-- 4) Replace RPCs that still wrote to clients_assignee
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
    invitee_client_name = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
    invitee_contact_name = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
    invitee_contact_email = COALESCE(EXCLUDED.invitee_contact_email, firm.invitee_clients.invitee_contact_email),
    updated_at = v_now;

  RETURN QUERY
  SELECT ic.id, ic.invitee_contact_email
  FROM firm.invitee_clients ic
  WHERE ic.firm_space_id = p_firm_space_id
    AND ic.invitee_email = v_contact_email
  LIMIT 1;
END;
$$;

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
    COALESCE(v_client_name, v_contact_name, 'Client'),
    v_contact_name,
    v_contact_email
  )
  ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET
    invitee_client_name = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
    invitee_contact_name = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
    invitee_contact_email = COALESCE(EXCLUDED.invitee_contact_email, firm.invitee_clients.invitee_contact_email),
    updated_at = v_now;

  SELECT id INTO v_invitee_id
  FROM firm.invitee_clients
  WHERE firm_space_id = p_firm_space_id AND invitee_email = v_contact_email
  LIMIT 1;

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
  )
  RETURNING id INTO v_order_id;

  RETURN QUERY
  SELECT v_order_id, p_firm_space_id, v_invitee_id, v_contact_email;
END;
$$;

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

  INSERT INTO firm.clients (firm_space_id, client_space_id)
  VALUES (p_firm_space_id, v_client_space_id)
  ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key DO NOTHING;

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
    invitee_client_name = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
    invitee_contact_name = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
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

DROP FUNCTION IF EXISTS firm.accept_client_invite_token(text, uuid, uuid);
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

  SELECT * INTO v_token_record
  FROM firm.client_invite_tokens
  WHERE token = p_token;

  IF NOT FOUND OR v_token_record.is_active IS FALSE THEN
    RAISE EXCEPTION 'Invalid or inactive client invite token' USING ERRCODE = '22023';
  END IF;

  IF v_token_record.expires_at IS NOT NULL AND v_token_record.expires_at <= v_now THEN
    RAISE EXCEPTION 'Client invite token has expired' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::bigint INTO v_joined
  FROM firm.clients c
  WHERE c.invite_token_id = v_token_record.id;

  IF v_token_record.max_clients IS NOT NULL AND v_joined >= v_token_record.max_clients THEN
    RAISE EXCEPTION 'Client invite token has reached its maximum usage' USING ERRCODE = '22023';
  END IF;

  INSERT INTO firm.clients (firm_space_id, client_space_id, invite_token_id)
  VALUES (v_token_record.firm_space_id, p_client_space_id, v_token_record.id)
  ON CONFLICT (firm_space_id, client_space_id)
  DO UPDATE SET invite_token_id = COALESCE(firm.clients.invite_token_id, EXCLUDED.invite_token_id);

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
  DO UPDATE SET updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_order_id;

  INSERT INTO firm.order_managers (firm_space_id, manager_user_id, order_id, created_at)
  VALUES (v_token_record.firm_space_id, v_token_record.inviter_user_id, v_order_id, v_now)
  ON CONFLICT (order_id) DO UPDATE
  SET manager_user_id = EXCLUDED.manager_user_id;

  SELECT COUNT(*)::bigint INTO v_joined
  FROM firm.clients c
  WHERE c.invite_token_id = v_token_record.id;

  IF v_token_record.max_clients IS NOT NULL AND v_joined >= v_token_record.max_clients THEN
    UPDATE firm.client_invite_tokens t
    SET is_active = false
    WHERE t.id = v_token_record.id;
  END IF;

  RETURN QUERY
  SELECT v_token_record.firm_space_id, p_client_space_id, v_token_record.inviter_user_id, v_token_record.sku_id;
END;
$$;

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

  IF COALESCE(v_email, '') <> COALESCE(v_invitee_email, '') THEN
    RAISE EXCEPTION 'This engagement is for a different email address';
  END IF;

  INSERT INTO firm.clients (firm_space_id, client_space_id)
  VALUES (v_firm_space_id, p_client_space_id)
  ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key DO NOTHING;

  UPDATE firm.invitee_clients
  SET clients_space_id = p_client_space_id, updated_at = now()
  WHERE id = p_invitee_client_id;

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
  );

  INSERT INTO public.user_spaces (space_id, user_id, is_admin)
  VALUES (p_client_space_id, v_uid, true)
  ON CONFLICT (space_id, user_id) DO UPDATE SET is_admin = true;

  RETURN QUERY SELECT p_client_space_id, v_firm_space_id;
END;
$$;
