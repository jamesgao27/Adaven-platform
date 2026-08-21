-- Phase C-1: migration-mode using single firm.orders table
-- Goal:
--   - Allow firms to create "pending" orders BEFORE a client space exists.
--   - Represent pending vs. formal orders in ONE table:
--       * Pending: client_space_id IS NULL AND invitee_client_id IS NOT NULL
--       * Formal:  client_space_id IS NOT NULL (current behaviour)
--   - Keep existing flows intact; this is additive.

SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) Relax constraint: allow firm.orders.client_space_id to be NULL
--    - This enables true "pending" orders without a bound client space.
--------------------------------------------------------------------------------

ALTER TABLE firm.orders
  ALTER COLUMN client_space_id DROP NOT NULL;

COMMENT ON COLUMN firm.orders.client_space_id IS
'Client space for this order; NULL when the order is still pending for an invitee (see invitee_client_id).';

--------------------------------------------------------------------------------
-- 2) Helper index for pending orders by invitee (firm-side queries / dashboards)
--------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS firm_orders_pending_by_invitee_idx
  ON firm.orders (firm_space_id, invitee_client_id)
  WHERE client_space_id IS NULL AND invitee_client_id IS NOT NULL;

--------------------------------------------------------------------------------
-- 3) RPC: public.firm_create_pending_order_for_invitee
--    - For firm members who want to start service for an invitee,
--      but do NOT want to create a client space yet.
--    - Writes into:
--        * firm.invitee_clients (upsert)
--        * firm.orders (client_space_id = NULL, invitee_client_id set)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.firm_create_pending_order_for_invitee(
  p_firm_space_id UUID,
  p_client_name   TEXT,
  p_contact_name  TEXT,
  p_contact_email TEXT,
  p_sku_id        UUID
)
RETURNS TABLE (
  order_id         UUID,
  firm_space_id    UUID,
  invitee_client_id UUID,
  invitee_email    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id UUID;
  v_client_name   TEXT;
  v_contact_name  TEXT;
  v_contact_email TEXT;
  v_invitee_id    UUID;
  v_now           TIMESTAMPTZ := now();
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Ensure caller is a member of the firm space
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_spaces us
    WHERE us.space_id = p_firm_space_id
      AND us.user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Only firm members can create pending orders';
  END IF;

  v_client_name   := NULLIF(TRIM(p_client_name), '');
  v_contact_name  := NULLIF(TRIM(p_contact_name), '');
  v_contact_email := NULLIF(LOWER(TRIM(p_contact_email)), '');

  IF v_contact_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required for pending orders';
  END IF;

  -- Upsert invitee_clients for this firm + invitee_email
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
    invitee_client_name   = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
    invitee_contact_name  = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
    invitee_contact_email = COALESCE(EXCLUDED.invitee_contact_email, firm.invitee_clients.invitee_contact_email),
    updated_at            = v_now;

  SELECT id INTO v_invitee_id
  FROM firm.invitee_clients
  WHERE firm_space_id = p_firm_space_id
    AND invitee_email = v_contact_email
  LIMIT 1;

  -- Insert pending order into firm.orders (client_space_id is NULL)
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
  RETURNING
    id,
    firm_space_id,
    invitee_client_id
  INTO
    order_id,
    firm_space_id,
    invitee_client_id;

  invitee_email := v_contact_email;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.firm_create_pending_order_for_invitee(UUID, TEXT, TEXT, TEXT, UUID) IS
'Firm 迁移模式：为某 invitee 预创建 pending order（写入 firm.orders，client_space_id 为空，仅由 firm 可见），并更新 firm.invitee_clients。';

--------------------------------------------------------------------------------
-- 4) RPC: firm.migrate_pending_orders_to_client_space
--    - When a real client space is available (e.g. client self-registers),
--      bind all pending orders for an invitee to that client space.
--    - Works on the SAME firm.orders rows:
--        * client_space_id: NULL → p_client_space_id
--        * status: kept as-is (typically onboarding)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION firm.migrate_pending_orders_to_client_space(
  p_firm_space_id     UUID,
  p_invitee_client_id UUID,
  p_client_space_id   UUID
)
RETURNS TABLE (
  order_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Ensure caller is a member of the firm space
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_spaces us
    WHERE us.space_id = p_firm_space_id
      AND us.user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Only firm members can migrate pending orders';
  END IF;

  -- Bind all pending orders for this invitee to the real client space
  RETURN QUERY
  UPDATE firm.orders o
  SET
    client_space_id = p_client_space_id,
    updated_at = now()
  WHERE o.firm_space_id = p_firm_space_id
    AND o.invitee_client_id = p_invitee_client_id
    AND o.client_space_id IS NULL
  RETURNING o.id AS order_id;
END;
$$;

COMMENT ON FUNCTION firm.migrate_pending_orders_to_client_space(UUID, UUID, UUID) IS
'Firm 迁移模式：将某 invitee 的所有 pending orders（client_space_id 为空）绑定到指定 client_space_id，直接在 firm.orders 上原地更新。';

