-- Wholestore: ERP connection + catalog sync fields + price lists (MOQ) + order ERP push.
-- Apply only on Wholestore project foyecolycmxcneflpant.

-- ---------------------------------------------------------------------------
-- SKU ERP snapshot fields
-- ---------------------------------------------------------------------------
ALTER TABLE provider.skus
  ADD COLUMN IF NOT EXISTS sku_code TEXT,
  ADD COLUMN IF NOT EXISTS external_product_id TEXT,
  ADD COLUMN IF NOT EXISTS external_source TEXT,
  ADD COLUMN IF NOT EXISTS qty_on_hand NUMERIC(14, 3),
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_provider_skus_space_code
  ON provider.skus (provider_space_id, sku_code)
  WHERE sku_code IS NOT NULL;

COMMENT ON COLUMN provider.skus.sku_code IS 'External / portal readable product code (e.g. PP-PIE-…).';
COMMENT ON COLUMN provider.skus.external_product_id IS 'ERP-native product id.';
COMMENT ON COLUMN provider.skus.external_source IS 'mock | finale | …; null = manual portal SKU.';
COMMENT ON COLUMN provider.skus.qty_on_hand IS 'Cached ERP on-hand quantity from last sync.';

-- ---------------------------------------------------------------------------
-- ERP connections (one per provider space)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider.erp_connections (
  provider_space_id UUID PRIMARY KEY REFERENCES public.spaces(id) ON DELETE CASCADE,
  erp_provider TEXT NOT NULL DEFAULT 'mock'
    CHECK (erp_provider IN ('mock', 'finale')),
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('disconnected', 'connected', 'error')),
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  credentials_enc TEXT,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS provider_erp_connections_set_updated_at ON provider.erp_connections;
CREATE TRIGGER provider_erp_connections_set_updated_at
  BEFORE UPDATE ON provider.erp_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE provider.erp_connections IS
  'Per-vendor ERP connector. Credentials encrypted server-side; clients never read secrets.';

ALTER TABLE provider.erp_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_connections_select ON provider.erp_connections;
CREATE POLICY erp_connections_select ON provider.erp_connections
  FOR SELECT TO authenticated
  USING (public.auth_user_shares_space(provider_space_id));

DROP POLICY IF EXISTS erp_connections_write ON provider.erp_connections;
CREATE POLICY erp_connections_insert ON provider.erp_connections
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_shares_space(provider_space_id));

CREATE POLICY erp_connections_update ON provider.erp_connections
  FOR UPDATE TO authenticated
  USING (public.auth_user_shares_space(provider_space_id))
  WITH CHECK (public.auth_user_shares_space(provider_space_id));

CREATE POLICY erp_connections_delete ON provider.erp_connections
  FOR DELETE TO authenticated
  USING (public.is_admin_of_space(provider_space_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON provider.erp_connections TO authenticated;
GRANT ALL ON provider.erp_connections TO service_role;

-- ---------------------------------------------------------------------------
-- Price lists
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider.price_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default',
  currency TEXT NOT NULL DEFAULT 'USD',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_price_lists_space
  ON provider.price_lists (provider_space_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_provider_price_lists_one_default
  ON provider.price_lists (provider_space_id)
  WHERE is_default;

DROP TRIGGER IF EXISTS provider_price_lists_set_updated_at ON provider.price_lists;
CREATE TRIGGER provider_price_lists_set_updated_at
  BEFORE UPDATE ON provider.price_lists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS provider.price_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id UUID NOT NULL REFERENCES provider.price_lists(id) ON DELETE CASCADE,
  sku_id UUID NOT NULL REFERENCES provider.skus(id) ON DELETE CASCADE,
  unit_price NUMERIC(14, 4) NOT NULL CHECK (unit_price >= 0),
  moq NUMERIC(14, 3) NOT NULL DEFAULT 1 CHECK (moq > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (price_list_id, sku_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_price_list_items_list
  ON provider.price_list_items (price_list_id);
CREATE INDEX IF NOT EXISTS idx_provider_price_list_items_sku
  ON provider.price_list_items (sku_id);

DROP TRIGGER IF EXISTS provider_price_list_items_set_updated_at ON provider.price_list_items;
CREATE TRIGGER provider_price_list_items_set_updated_at
  BEFORE UPDATE ON provider.price_list_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS provider.consumer_price_lists (
  consumer_id UUID PRIMARY KEY REFERENCES provider.consumers(id) ON DELETE CASCADE,
  price_list_id UUID NOT NULL REFERENCES provider.price_lists(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS provider_consumer_price_lists_set_updated_at ON provider.consumer_price_lists;
CREATE TRIGGER provider_consumer_price_lists_set_updated_at
  BEFORE UPDATE ON provider.consumer_price_lists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE provider.price_lists IS 'Vendor price books; one may be is_default per space.';
COMMENT ON TABLE provider.price_list_items IS 'Per-SKU unit price and MOQ within a price list.';
COMMENT ON TABLE provider.consumer_price_lists IS
  'Active price list for a dealer enrollment; fallback is space default list.';

ALTER TABLE provider.price_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider.price_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider.consumer_price_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS price_lists_select ON provider.price_lists;
CREATE POLICY price_lists_select ON provider.price_lists
  FOR SELECT TO authenticated
  USING (
    public.auth_user_shares_space(provider_space_id)
    OR EXISTS (
      SELECT 1
      FROM provider.consumers c
      INNER JOIN public.user_spaces us ON us.space_id = c.consumer_space_id AND us.user_id = auth.uid()
      WHERE c.provider_space_id = price_lists.provider_space_id
        AND c.status = 'approved'
        AND (
          EXISTS (
            SELECT 1 FROM provider.consumer_price_lists cpl
            WHERE cpl.consumer_id = c.id AND cpl.price_list_id = price_lists.id
          )
          OR (
            price_lists.is_default
            AND NOT EXISTS (SELECT 1 FROM provider.consumer_price_lists cpl2 WHERE cpl2.consumer_id = c.id)
          )
        )
    )
  );

DROP POLICY IF EXISTS price_lists_write ON provider.price_lists;
CREATE POLICY price_lists_insert ON provider.price_lists
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_shares_space(provider_space_id));
CREATE POLICY price_lists_update ON provider.price_lists
  FOR UPDATE TO authenticated
  USING (public.auth_user_shares_space(provider_space_id))
  WITH CHECK (public.auth_user_shares_space(provider_space_id));
CREATE POLICY price_lists_delete ON provider.price_lists
  FOR DELETE TO authenticated
  USING (public.is_admin_of_space(provider_space_id));

DROP POLICY IF EXISTS price_list_items_select ON provider.price_list_items;
CREATE POLICY price_list_items_select ON provider.price_list_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM provider.price_lists pl
      WHERE pl.id = price_list_items.price_list_id
        AND (
          public.auth_user_shares_space(pl.provider_space_id)
          OR EXISTS (
            SELECT 1
            FROM provider.consumers c
            INNER JOIN public.user_spaces us ON us.space_id = c.consumer_space_id AND us.user_id = auth.uid()
            WHERE c.provider_space_id = pl.provider_space_id
              AND c.status = 'approved'
              AND (
                EXISTS (
                  SELECT 1 FROM provider.consumer_price_lists cpl
                  WHERE cpl.consumer_id = c.id AND cpl.price_list_id = pl.id
                )
                OR (
                  pl.is_default
                  AND NOT EXISTS (SELECT 1 FROM provider.consumer_price_lists cpl2 WHERE cpl2.consumer_id = c.id)
                )
              )
          )
        )
    )
  );

CREATE POLICY price_list_items_insert ON provider.price_list_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM provider.price_lists pl
      WHERE pl.id = price_list_id AND public.auth_user_shares_space(pl.provider_space_id)
    )
  );
CREATE POLICY price_list_items_update ON provider.price_list_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM provider.price_lists pl
      WHERE pl.id = price_list_id AND public.auth_user_shares_space(pl.provider_space_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM provider.price_lists pl
      WHERE pl.id = price_list_id AND public.auth_user_shares_space(pl.provider_space_id)
    )
  );
CREATE POLICY price_list_items_delete ON provider.price_list_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM provider.price_lists pl
      WHERE pl.id = price_list_id AND public.auth_user_shares_space(pl.provider_space_id)
    )
  );

DROP POLICY IF EXISTS consumer_price_lists_select ON provider.consumer_price_lists;
CREATE POLICY consumer_price_lists_select ON provider.consumer_price_lists
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM provider.consumers c
      WHERE c.id = consumer_price_lists.consumer_id
        AND (
          public.auth_user_shares_space(c.provider_space_id)
          OR (c.consumer_space_id IS NOT NULL AND public.auth_user_shares_space(c.consumer_space_id))
        )
    )
  );

CREATE POLICY consumer_price_lists_insert ON provider.consumer_price_lists
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM provider.consumers c
      WHERE c.id = consumer_id AND public.auth_user_shares_space(c.provider_space_id)
    )
  );
CREATE POLICY consumer_price_lists_update ON provider.consumer_price_lists
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM provider.consumers c
      WHERE c.id = consumer_id AND public.auth_user_shares_space(c.provider_space_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM provider.consumers c
      WHERE c.id = consumer_id AND public.auth_user_shares_space(c.provider_space_id)
    )
  );
CREATE POLICY consumer_price_lists_delete ON provider.consumer_price_lists
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM provider.consumers c
      WHERE c.id = consumer_id AND public.is_admin_of_space(c.provider_space_id)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON provider.price_lists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider.price_list_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider.consumer_price_lists TO authenticated;
GRANT ALL ON provider.price_lists TO service_role;
GRANT ALL ON provider.price_list_items TO service_role;
GRANT ALL ON provider.consumer_price_lists TO service_role;

-- ---------------------------------------------------------------------------
-- Orders: ERP push fields; order lines: price snapshot
-- ---------------------------------------------------------------------------
ALTER TABLE provider.orders
  ADD COLUMN IF NOT EXISTS external_order_id TEXT,
  ADD COLUMN IF NOT EXISTS erp_push_status TEXT DEFAULT 'pending'
    CHECK (erp_push_status IS NULL OR erp_push_status IN ('pending', 'pushed', 'failed')),
  ADD COLUMN IF NOT EXISTS erp_pushed_at TIMESTAMPTZ;

ALTER TABLE provider.order_lines
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(14, 4),
  ADD COLUMN IF NOT EXISTS moq_applied NUMERIC(14, 3);

COMMENT ON COLUMN provider.orders.external_order_id IS 'ERP sales order id; one portal order maps to at most one.';
COMMENT ON COLUMN provider.order_lines.unit_price IS 'Unit price frozen from the dealer price list at order time.';

-- ---------------------------------------------------------------------------
-- Resolve price list for a dealer enrollment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION provider.resolve_price_list_id(
  p_provider_space_id UUID,
  p_consumer_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, provider
AS $$
DECLARE
  v_list UUID;
BEGIN
  SELECT cpl.price_list_id INTO v_list
  FROM provider.consumer_price_lists cpl
  WHERE cpl.consumer_id = p_consumer_id;

  IF v_list IS NOT NULL THEN
    RETURN v_list;
  END IF;

  SELECT pl.id INTO v_list
  FROM provider.price_lists pl
  WHERE pl.provider_space_id = p_provider_space_id
    AND pl.is_default
  ORDER BY pl.created_at
  LIMIT 1;

  RETURN v_list;
END;
$$;

GRANT EXECUTE ON FUNCTION provider.resolve_price_list_id(UUID, UUID) TO authenticated, service_role;

-- Dealer-facing shop catalog with prices from resolved list
CREATE OR REPLACE FUNCTION provider.list_dealer_shop_skus(
  p_consumer_space_id UUID,
  p_provider_space_id UUID
)
RETURNS TABLE (
  sku_id UUID,
  name TEXT,
  description TEXT,
  image_url TEXT,
  sku_code TEXT,
  qty_on_hand NUMERIC,
  unit_price NUMERIC,
  moq NUMERIC,
  currency TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, provider
AS $$
DECLARE
  v_uid UUID;
  v_enrollment UUID;
  v_list UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.user_id = v_uid AND us.space_id = p_consumer_space_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this dealer space';
  END IF;

  SELECT c.id INTO v_enrollment
  FROM provider.consumers c
  WHERE c.provider_space_id = p_provider_space_id
    AND c.consumer_space_id = p_consumer_space_id
    AND c.status = 'approved'
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF v_enrollment IS NULL THEN
    RAISE EXCEPTION 'You can shop only after this vendor accepts you as a dealer';
  END IF;

  v_list := provider.resolve_price_list_id(p_provider_space_id, v_enrollment);
  IF v_list IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.name,
    s.description,
    s.image_url,
    s.sku_code,
    s.qty_on_hand,
    pli.unit_price,
    pli.moq,
    pl.currency
  FROM provider.price_list_items pli
  INNER JOIN provider.price_lists pl ON pl.id = pli.price_list_id
  INNER JOIN provider.skus s ON s.id = pli.sku_id
  WHERE pli.price_list_id = v_list
    AND s.is_published IS TRUE
    AND s.provider_space_id = p_provider_space_id
  ORDER BY s.name;
END;
$$;

REVOKE ALL ON FUNCTION provider.list_dealer_shop_skus(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provider.list_dealer_shop_skus(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Order create: price list + MOQ + unit_price snapshot; erp_push_status pending
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION provider.consumer_create_order_from_published_skus(
  p_consumer_space_id UUID,
  p_lines JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, provider, consumer
AS $$
DECLARE
  v_uid UUID;
  v_provider UUID;
  v_enrollment UUID;
  v_status TEXT;
  v_order UUID;
  v_line JSONB;
  v_sku provider.skus%ROWTYPE;
  v_qty NUMERIC;
  v_sort INT := 0;
  v_list UUID;
  v_unit NUMERIC;
  v_moq NUMERIC;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_consumer_space_id IS NULL OR p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 1 THEN
    RAISE EXCEPTION 'Invalid arguments';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_spaces us
    INNER JOIN public.spaces sp ON sp.id = us.space_id
    WHERE us.user_id = v_uid
      AND us.space_id = p_consumer_space_id
      AND sp.kind = 'consumer'
  ) THEN
    RAISE EXCEPTION 'Not a member of this dealer space';
  END IF;

  SELECT * INTO v_sku
  FROM provider.skus
  WHERE id = (p_lines->0->>'sku_id')::UUID;
  IF NOT FOUND OR v_sku.is_published IS NOT TRUE THEN
    RAISE EXCEPTION 'SKU is not published';
  END IF;
  v_provider := v_sku.provider_space_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_sku FROM provider.skus WHERE id = (v_line->>'sku_id')::UUID;
    IF NOT FOUND OR v_sku.is_published IS NOT TRUE THEN
      RAISE EXCEPTION 'SKU is not published';
    END IF;
    IF v_sku.provider_space_id IS DISTINCT FROM v_provider THEN
      RAISE EXCEPTION 'All SKUs on one order must belong to the same factory';
    END IF;
  END LOOP;

  SELECT c.id, c.status INTO v_enrollment, v_status
  FROM provider.consumers c
  WHERE c.provider_space_id = v_provider
    AND c.consumer_space_id = p_consumer_space_id
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF v_enrollment IS NULL OR v_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'You can order only after this factory accepts you as a dealer';
  END IF;

  v_list := provider.resolve_price_list_id(v_provider, v_enrollment);
  IF v_list IS NULL THEN
    RAISE EXCEPTION 'No price list is available for this store';
  END IF;

  INSERT INTO provider.orders (
    provider_space_id, consumer_id, consumer_space_id, status, created_by, request_origin, erp_push_status
  ) VALUES (
    v_provider, v_enrollment, p_consumer_space_id, 'onboarding', v_uid, 'consumer_marketplace', 'pending'
  )
  RETURNING id INTO v_order;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := GREATEST(COALESCE((v_line->>'quantity')::NUMERIC, 1), 0.001);
    SELECT pli.unit_price, pli.moq INTO v_unit, v_moq
    FROM provider.price_list_items pli
    WHERE pli.price_list_id = v_list
      AND pli.sku_id = (v_line->>'sku_id')::UUID;
    IF v_unit IS NULL THEN
      RAISE EXCEPTION 'SKU is not on your price list';
    END IF;
    IF v_qty < v_moq THEN
      RAISE EXCEPTION 'Quantity is below MOQ for a SKU';
    END IF;
    INSERT INTO provider.order_lines (order_id, sku_id, quantity, sort_order, unit_price, moq_applied)
    VALUES (v_order, (v_line->>'sku_id')::UUID, v_qty, v_sort, v_unit, v_moq);
    v_sort := v_sort + 1;
  END LOOP;

  RETURN v_order;
END;
$$;

COMMENT ON FUNCTION provider.consumer_create_order_from_published_skus(UUID, JSONB) IS
  'Dealer store order. Requires approved enrollment, price list coverage, and quantity >= MOQ.';
