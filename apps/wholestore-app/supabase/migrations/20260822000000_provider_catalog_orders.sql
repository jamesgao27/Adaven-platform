-- Provider catalog + orders (Wholestore). Maps Vouchap firm.clients / firm.orders / firm.skus.
-- Differences: SKU has no items; an order has many SKUs via provider.order_lines.

ALTER TABLE provider.consumers
  ALTER COLUMN consumer_space_id DROP NOT NULL;

ALTER TABLE provider.consumers
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT;

ALTER TABLE provider.consumers
  DROP CONSTRAINT IF EXISTS consumers_provider_space_id_consumer_space_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_provider_consumers_enrollment
  ON provider.consumers (provider_space_id, consumer_space_id)
  WHERE consumer_space_id IS NOT NULL;

COMMENT ON COLUMN provider.consumers.consumer_space_id IS
  'Dealer space when claimed; null = pending dealer record (was firm.clients.client_space_id).';
COMMENT ON COLUMN provider.consumers.contact_name IS 'Contact person (was firm.clients invitee_contact_name).';
COMMENT ON COLUMN provider.consumers.contact_email IS 'Contact email (was firm.clients invitee_email).';

CREATE TABLE IF NOT EXISTS provider.skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'New SKU',
  description TEXT,
  image_url TEXT,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_skus_space ON provider.skus (provider_space_id);

COMMENT ON TABLE provider.skus IS
  'Factory SKU catalog. Simplified vs firm.skus: no sku_items / WBS / tax classification.';

DROP TRIGGER IF EXISTS provider_skus_set_updated_at ON provider.skus;
CREATE TRIGGER provider_skus_set_updated_at
  BEFORE UPDATE ON provider.skus
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS provider.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  consumer_id UUID NOT NULL REFERENCES provider.consumers(id) ON DELETE CASCADE,
  consumer_space_id UUID REFERENCES public.spaces(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'onboarding'
    CHECK (status IN ('onboarding', 'processing', 'completed', 'cancelled')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_orders_space ON provider.orders (provider_space_id);
CREATE INDEX IF NOT EXISTS idx_provider_orders_consumer ON provider.orders (consumer_id);

COMMENT ON TABLE provider.orders IS
  'Factory order (was firm.orders / engagement). Lines live in provider.order_lines (multi-SKU).';

DROP TRIGGER IF EXISTS provider_orders_set_updated_at ON provider.orders;
CREATE TRIGGER provider_orders_set_updated_at
  BEFORE UPDATE ON provider.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS provider.order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES provider.orders(id) ON DELETE CASCADE,
  sku_id UUID NOT NULL REFERENCES provider.skus(id) ON DELETE RESTRICT,
  quantity NUMERIC(12, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, sku_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_order_lines_order ON provider.order_lines (order_id);

COMMENT ON TABLE provider.order_lines IS
  'Order line items. Vouchap engagements are 1:1 sku_id; Wholestore orders are 1:N SKUs.';

ALTER TABLE provider.skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider.order_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skus_select ON provider.skus;
CREATE POLICY skus_select ON provider.skus
  FOR SELECT TO authenticated
  USING (
    public.auth_user_shares_space(provider_space_id)
    OR public.auth_user_consumer_can_see_provider_space(provider_space_id)
  );

DROP POLICY IF EXISTS skus_write ON provider.skus;
CREATE POLICY skus_insert ON provider.skus
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_shares_space(provider_space_id));

DROP POLICY IF EXISTS skus_update ON provider.skus;
CREATE POLICY skus_update ON provider.skus
  FOR UPDATE TO authenticated
  USING (public.auth_user_shares_space(provider_space_id))
  WITH CHECK (public.auth_user_shares_space(provider_space_id));

DROP POLICY IF EXISTS skus_delete ON provider.skus;
CREATE POLICY skus_delete ON provider.skus
  FOR DELETE TO authenticated
  USING (public.is_admin_of_space(provider_space_id));

DROP POLICY IF EXISTS orders_select ON provider.orders;
CREATE POLICY orders_select ON provider.orders
  FOR SELECT TO authenticated
  USING (
    public.auth_user_shares_space(provider_space_id)
    OR (consumer_space_id IS NOT NULL AND public.auth_user_shares_space(consumer_space_id))
  );

DROP POLICY IF EXISTS orders_insert ON provider.orders;
CREATE POLICY orders_insert ON provider.orders
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_shares_space(provider_space_id));

DROP POLICY IF EXISTS orders_update ON provider.orders;
CREATE POLICY orders_update ON provider.orders
  FOR UPDATE TO authenticated
  USING (public.auth_user_shares_space(provider_space_id))
  WITH CHECK (public.auth_user_shares_space(provider_space_id));

DROP POLICY IF EXISTS orders_delete ON provider.orders;
CREATE POLICY orders_delete ON provider.orders
  FOR DELETE TO authenticated
  USING (public.is_admin_of_space(provider_space_id));

DROP POLICY IF EXISTS order_lines_select ON provider.order_lines;
CREATE POLICY order_lines_select ON provider.order_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM provider.orders o
      WHERE o.id = order_id
        AND (
          public.auth_user_shares_space(o.provider_space_id)
          OR (o.consumer_space_id IS NOT NULL AND public.auth_user_shares_space(o.consumer_space_id))
        )
    )
  );

DROP POLICY IF EXISTS order_lines_insert ON provider.order_lines;
CREATE POLICY order_lines_insert ON provider.order_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM provider.orders o
      WHERE o.id = order_id AND public.auth_user_shares_space(o.provider_space_id)
    )
  );

DROP POLICY IF EXISTS order_lines_update ON provider.order_lines;
CREATE POLICY order_lines_update ON provider.order_lines
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM provider.orders o
      WHERE o.id = order_id AND public.auth_user_shares_space(o.provider_space_id)
    )
  );

DROP POLICY IF EXISTS order_lines_delete ON provider.order_lines;
CREATE POLICY order_lines_delete ON provider.order_lines
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM provider.orders o
      WHERE o.id = order_id AND public.auth_user_shares_space(o.provider_space_id)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON provider.skus TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider.orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider.order_lines TO authenticated;
GRANT ALL ON provider.skus TO service_role;
GRANT ALL ON provider.orders TO service_role;
GRANT ALL ON provider.order_lines TO service_role;
