-- Marketplace-created engagements: client keeps current flow (browse -> select -> consent),
-- but order only enters processing after firm confirmation.

BEGIN;

SET search_path = public, firm, crm;

ALTER TABLE firm.orders
  ADD COLUMN IF NOT EXISTS request_origin text NOT NULL DEFAULT 'firm_manual',
  ADD COLUMN IF NOT EXISTS client_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS firm_confirmed_at timestamptz;

ALTER TABLE firm.orders DROP CONSTRAINT IF EXISTS firm_orders_request_origin_check;
ALTER TABLE firm.orders
  ADD CONSTRAINT firm_orders_request_origin_check
  CHECK (request_origin IN ('firm_manual', 'client_marketplace'));

COMMENT ON COLUMN firm.orders.request_origin IS
  'firm_manual | client_marketplace';
COMMENT ON COLUMN firm.orders.client_confirmed_at IS
  'Set when client consents on marketplace-created onboarding order.';
COMMENT ON COLUMN firm.orders.firm_confirmed_at IS
  'Set when firm confirms marketplace-created onboarding order and starts processing.';

UPDATE firm.orders
SET request_origin = 'firm_manual'
WHERE request_origin IS NULL OR btrim(request_origin) = '';

CREATE OR REPLACE FUNCTION firm.client_create_onboarding_order_from_published_sku(
  p_client_space_id uuid,
  p_sku_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_uid uuid;
  v_firm uuid;
  v_client_row_id uuid;
  v_order_id uuid;
  r_sku firm.skus%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_client_space_id IS NULL OR p_sku_id IS NULL THEN
    RAISE EXCEPTION 'Invalid arguments';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_spaces us
    INNER JOIN public.spaces sp ON sp.id = us.space_id
    WHERE us.user_id = v_uid
      AND us.space_id = p_client_space_id
      AND sp.kind = 'consumer'
  ) THEN
    RAISE EXCEPTION 'Not a member of this client space';
  END IF;

  SELECT * INTO r_sku FROM firm.skus WHERE id = p_sku_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SKU not found';
  END IF;

  IF NOT firm.is_sku_published_catalog(r_sku) THEN
    RAISE EXCEPTION 'SKU is not published';
  END IF;

  v_firm := r_sku.firm_space_id;

  PERFORM crm.assert_firm_can_create_engagement(v_firm);

  SELECT c.id INTO v_client_row_id
  FROM firm.clients c
  WHERE c.firm_space_id = v_firm
    AND c.client_space_id = p_client_space_id
  ORDER BY c.created_at DESC NULLS LAST
  LIMIT 1;

  INSERT INTO firm.orders (
    firm_space_id,
    client_space_id,
    client_id,
    sku_id,
    status,
    request_origin,
    created_by,
    tax_country,
    tax_scenario,
    tags
  ) VALUES (
    v_firm,
    p_client_space_id,
    v_client_row_id,
    p_sku_id,
    'onboarding',
    'client_marketplace',
    v_uid,
    r_sku.tax_country,
    r_sku.tax_scenario,
    r_sku.tags
  )
  RETURNING id INTO v_order_id;

  RETURN v_order_id;
END;
$$;

COMMENT ON FUNCTION firm.client_create_onboarding_order_from_published_sku(uuid, uuid) IS
  'Client marketplace flow: create onboarding order (request_origin=client_marketplace). Requires firm confirmation to move onboarding -> processing.';

-- Guardrail: for marketplace orders, onboarding -> processing can only be done by firm-space members.
CREATE OR REPLACE FUNCTION firm.enforce_marketplace_order_firm_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
BEGIN
  IF NEW.request_origin = 'client_marketplace'
     AND OLD.status = 'onboarding'
     AND NEW.status = 'processing' THEN
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.user_spaces us
      WHERE us.user_id = auth.uid()
        AND us.space_id = OLD.firm_space_id
    ) THEN
      RAISE EXCEPTION 'FIRM_CONFIRMATION_REQUIRED'
        USING ERRCODE = 'P0001',
              HINT = 'This marketplace engagement must be confirmed by the firm before it can enter processing.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_marketplace_order_firm_confirmation ON firm.orders;
CREATE TRIGGER trg_enforce_marketplace_order_firm_confirmation
  BEFORE UPDATE ON firm.orders
  FOR EACH ROW
  EXECUTE FUNCTION firm.enforce_marketplace_order_firm_confirmation();

COMMIT;
