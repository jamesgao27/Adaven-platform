-- Remove (uuid, uuid) overloads that accepted an arbitrary user_id — callers could probe other users' order access.
-- Keep behavior: predicates still match firm_orders_select / engaged-client SKU rules for auth.uid() only.
SET search_path = public, firm;

--------------------------------------------------------------------------------
-- Single-arg: only session user (no cross-user probe API).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION firm.auth_user_can_select_order(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, firm
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM firm.orders o
      WHERE o.id = p_order_id
        AND (
          firm.can_access_order(auth.uid(), o.id, false)
          OR (
            o.client_space_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.user_spaces us
              WHERE us.space_id = o.client_space_id
                AND us.user_id = auth.uid()
            )
          )
        )
    );
$$;

COMMENT ON FUNCTION firm.auth_user_can_select_order(uuid) IS
  'True if auth.uid() may SELECT this order (firm_orders_select); keep in sync with policy.';

--------------------------------------------------------------------------------
-- Two-arg SKU gate: session user only (replaces three-arg with p_user_id).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION firm.auth_user_can_select_sku_as_engaged_client(
  p_sku_id uuid,
  p_firm_space_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, firm
AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_sku_id IS NOT NULL
    AND p_firm_space_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM firm.orders o
        WHERE o.sku_id = p_sku_id
          AND o.firm_space_id = p_firm_space_id
          AND firm.auth_user_can_select_order(o.id)
      )
      OR EXISTS (
        SELECT 1
        FROM firm.clients c
        INNER JOIN firm.orders o ON o.client_id = c.id AND o.firm_space_id = c.firm_space_id
        WHERE c.firm_space_id = p_firm_space_id
          AND o.sku_id = p_sku_id
          AND length(trim(COALESCE(
            (SELECT LOWER(TRIM(COALESCE(u.email, ''))) FROM public.users u WHERE u.id = auth.uid() LIMIT 1),
            ''
          ))) > 0
          AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = (
            SELECT LOWER(TRIM(COALESCE(u.email, '')))
            FROM public.users u WHERE u.id = auth.uid() LIMIT 1
          )
          AND (
            (c.client_space_id IS NULL AND o.client_space_id IS NULL)
            OR (
              o.client_space_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM public.user_spaces us2
                WHERE us2.user_id = auth.uid() AND us2.space_id = o.client_space_id
              )
            )
          )
      )
    );
$$;

COMMENT ON FUNCTION firm.auth_user_can_select_sku_as_engaged_client(uuid, uuid) IS
  'auth.uid() may read SKU row: visible order for this sku+firm, or matching invitee_email (pending/linked).';

--------------------------------------------------------------------------------
-- Policies: switch to new signatures, then drop old overloads.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS firm_skus_select_engaged_client ON firm.skus;
CREATE POLICY firm_skus_select_engaged_client ON firm.skus FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND firm.auth_user_can_select_sku_as_engaged_client(firm.skus.id, firm.skus.firm_space_id)
  );

DROP POLICY IF EXISTS firm_sku_items_select_engaged_client ON firm.sku_items;
CREATE POLICY firm_sku_items_select_engaged_client ON firm.sku_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM firm.skus s
      WHERE s.id = firm.sku_items.sku_id
        AND firm.auth_user_can_select_sku_as_engaged_client(s.id, s.firm_space_id)
    )
  );

DROP POLICY IF EXISTS "spaces_select_client_via_order_firm" ON public.spaces;
CREATE POLICY "spaces_select_client_via_order_firm" ON public.spaces
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM firm.orders o
        WHERE o.firm_space_id = spaces.id
          AND firm.auth_user_can_select_order(o.id)
      )
      OR EXISTS (
        SELECT 1
        FROM firm.orders o
        INNER JOIN firm.clients c ON c.id = o.client_id AND c.firm_space_id = o.firm_space_id
        WHERE o.firm_space_id = spaces.id
          AND o.client_space_id IS NULL
          AND c.client_space_id IS NULL
          AND length(trim(COALESCE(
            (SELECT LOWER(TRIM(COALESCE(u.email, ''))) FROM public.users u WHERE u.id = auth.uid() LIMIT 1),
            ''
          ))) > 0
          AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = (
            SELECT LOWER(TRIM(COALESCE(u.email, '')))
            FROM public.users u WHERE u.id = auth.uid() LIMIT 1
          )
      )
    )
  );

COMMENT ON POLICY "spaces_select_client_via_order_firm" ON public.spaces IS
  'Clients may read firm space name if they may SELECT an order for that firm, or are pending invitee on an unlinked order.';

--------------------------------------------------------------------------------
-- Preview gates (rebind to single-arg order helper).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION firm._client_can_preview_sku(
  p_sku_id uuid,
  p_firm_client_id uuid,
  p_invite_token text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
STABLE
AS $$
DECLARE
  v_uid uuid;
  v_email text;
  v_firm_space_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR p_sku_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT s.firm_space_id INTO v_firm_space_id FROM firm.skus s WHERE s.id = p_sku_id;
  IF v_firm_space_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.user_id = v_uid AND us.space_id = v_firm_space_id
  ) THEN
    RETURN true;
  END IF;

  SELECT LOWER(TRIM(COALESCE(u.email, ''))) INTO v_email
  FROM public.users u
  WHERE u.id = v_uid
  LIMIT 1;

  IF p_firm_client_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM firm.clients c
      INNER JOIN firm.orders o ON o.client_id = c.id AND o.firm_space_id = c.firm_space_id
      WHERE c.id = p_firm_client_id
        AND c.client_space_id IS NULL
        AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = LOWER(TRIM(COALESCE(v_email, '')))
        AND o.sku_id = p_sku_id
        AND o.client_space_id IS NULL
    ) THEN
      RETURN true;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM firm.clients c
      INNER JOIN public.user_spaces us ON us.space_id = c.client_space_id AND us.user_id = v_uid
      INNER JOIN firm.orders o ON o.client_id = c.id AND o.firm_space_id = c.firm_space_id
      WHERE c.id = p_firm_client_id
        AND c.client_space_id IS NOT NULL
        AND o.sku_id = p_sku_id
    ) THEN
      RETURN true;
    END IF;
  END IF;

  IF p_invite_token IS NOT NULL AND length(trim(p_invite_token)) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM firm.client_invite_tokens t
      WHERE t.token = trim(p_invite_token)
        AND (t.is_active IS NULL OR t.is_active = true)
        AND (t.expires_at IS NULL OR t.expires_at > now())
        AND t.sku_id = p_sku_id
        AND t.firm_space_id = v_firm_space_id
    ) THEN
      RETURN true;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM firm.orders o
    WHERE o.sku_id = p_sku_id
      AND o.firm_space_id = v_firm_space_id
      AND firm.auth_user_can_select_order(o.id)
  ) THEN
    RETURN true;
  END IF;

  IF length(trim(COALESCE(v_email, ''))) > 0 AND EXISTS (
    SELECT 1
    FROM firm.clients c
    INNER JOIN firm.orders o ON o.client_id = c.id AND o.firm_space_id = c.firm_space_id
    WHERE c.firm_space_id = v_firm_space_id
      AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = LOWER(TRIM(COALESCE(v_email, '')))
      AND o.sku_id = p_sku_id
      AND (
        (c.client_space_id IS NULL AND o.client_space_id IS NULL)
        OR (
          o.client_space_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.user_spaces us2
            WHERE us2.user_id = v_uid AND us2.space_id = o.client_space_id
          )
        )
      )
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_firm_sku_preview_for_order_client(p_order_id uuid)
RETURNS TABLE (
  name text,
  description text,
  image_url text,
  tax_country text,
  tax_scenario text,
  tags jsonb,
  is_published boolean,
  template_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
STABLE
AS $$
DECLARE
  v_uid uuid;
  v_sku_id uuid;
  v_email text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR p_order_id IS NULL THEN
    RETURN;
  END IF;

  SELECT LOWER(TRIM(COALESCE(u.email, ''))) INTO v_email
  FROM public.users u
  WHERE u.id = v_uid
  LIMIT 1;

  SELECT o.sku_id INTO v_sku_id
  FROM firm.orders o
  WHERE o.id = p_order_id
    AND o.sku_id IS NOT NULL
    AND (
      firm.auth_user_can_select_order(p_order_id)
      OR (
        o.client_space_id IS NULL
        AND length(trim(COALESCE(v_email, ''))) > 0
        AND EXISTS (
          SELECT 1 FROM firm.clients c
          WHERE c.id = o.client_id
            AND c.firm_space_id = o.firm_space_id
            AND c.client_space_id IS NULL
            AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = v_email
        )
      )
    );

  IF v_sku_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    s.name,
    s.description,
    s.image_url,
    s.tax_country,
    s.tax_scenario,
    s.tags,
    s.is_published,
    s.template_status::text
  FROM firm.skus s
  WHERE s.id = v_sku_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_firm_sku_items_preview_for_order_client(p_order_id uuid)
RETURNS TABLE (
  id uuid,
  sku_id uuid,
  parent_id uuid,
  item_kind text,
  initial_responsible_side text,
  title text,
  description text,
  sort_order int,
  depends_on_id uuid,
  depends_on_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
STABLE
AS $$
DECLARE
  v_uid uuid;
  v_sku_id uuid;
  v_email text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR p_order_id IS NULL THEN
    RETURN;
  END IF;

  SELECT LOWER(TRIM(COALESCE(u.email, ''))) INTO v_email
  FROM public.users u
  WHERE u.id = v_uid
  LIMIT 1;

  SELECT o.sku_id INTO v_sku_id
  FROM firm.orders o
  WHERE o.id = p_order_id
    AND o.sku_id IS NOT NULL
    AND (
      firm.auth_user_can_select_order(p_order_id)
      OR (
        o.client_space_id IS NULL
        AND length(trim(COALESCE(v_email, ''))) > 0
        AND EXISTS (
          SELECT 1 FROM firm.clients c
          WHERE c.id = o.client_id
            AND c.firm_space_id = o.firm_space_id
            AND c.client_space_id IS NULL
            AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = v_email
        )
      )
    );

  IF v_sku_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    si.id,
    si.sku_id,
    si.parent_id,
    si.item_kind::text,
    si.initial_responsible_side::text,
    si.title,
    si.description,
    si.sort_order,
    si.depends_on_id,
    COALESCE(si.depends_on_ids, '{}'::uuid[])
  FROM firm.sku_items si
  WHERE si.sku_id = v_sku_id
  ORDER BY si.sort_order ASC NULLS LAST, si.created_at ASC;
END;
$$;

--------------------------------------------------------------------------------
-- Drop superseded overloads (must run last).
--------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS firm.auth_user_can_select_order(uuid, uuid);
DROP FUNCTION IF EXISTS firm.auth_user_can_select_sku_as_engaged_client(uuid, uuid, uuid);
