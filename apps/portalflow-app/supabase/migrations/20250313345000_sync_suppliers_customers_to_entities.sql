-- Run before 20250313350000_drop_suppliers_customers.sql.
-- Idempotent sync: suppliers + customers → entities, and backfill entity_id on receipts/invoices/inbound/outbound.
-- Logic from repo root: sync-entities-from-suppliers-customers.sql
SET search_path = public;

-- § 1  suppliers → entities（同 ID 以 updated_at 较新的为准）
DO $$
DECLARE
  inserted_count INT := 0;
  updated_count  INT := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'suppliers'
  ) THEN
    RAISE NOTICE '[§1] suppliers 表不存在，跳过';
    RETURN;
  END IF;

  INSERT INTO entities (
    id, space_id, name, tax_number, phone, address,
    is_ai_recognized, merged_into_id, created_at, updated_at
  )
  SELECT
    s.id, s.space_id, s.name, s.tax_number, s.phone, s.address,
    s.is_ai_recognized,
    NULL::uuid,
    s.created_at, s.updated_at
  FROM suppliers s
  WHERE NOT EXISTS (SELECT 1 FROM entities e WHERE e.id = s.id)
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  UPDATE entities e
  SET
    name             = s.name,
    tax_number       = s.tax_number,
    phone            = s.phone,
    address          = s.address,
    is_ai_recognized = s.is_ai_recognized,
    merged_into_id   = e.merged_into_id,
    updated_at       = s.updated_at
  FROM suppliers s
  WHERE e.id = s.id
    AND s.updated_at > e.updated_at;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  RAISE NOTICE '[§1] suppliers → entities: inserted %, updated %', inserted_count, updated_count;
END $$;

-- § 2  customers → entities + 临时映射 customer_id → entity_id
DROP TABLE IF EXISTS _cust_entity_map;
CREATE TEMP TABLE _cust_entity_map (
  customer_id UUID PRIMARY KEY,
  entity_id   UUID NOT NULL
);

DO $$
DECLARE
  r              RECORD;
  eid            UUID;
  inserted_count INT := 0;
  updated_count  INT := 0;
  mapped_count   INT := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'customers'
  ) THEN
    RAISE NOTICE '[§2] customers 表不存在，跳过';
    RETURN;
  END IF;

  FOR r IN
    SELECT id, space_id, name, tax_number, phone, address, is_ai_recognized, created_at, updated_at
    FROM customers
  LOOP
    eid := NULL;
    SELECT id INTO eid FROM entities WHERE id = r.id LIMIT 1;

    IF eid IS NOT NULL THEN
      UPDATE entities
      SET
        name             = r.name,
        tax_number       = COALESCE(r.tax_number, tax_number),
        phone            = COALESCE(r.phone, phone),
        address          = COALESCE(r.address, address),
        is_ai_recognized = r.is_ai_recognized,
        updated_at       = r.updated_at
      WHERE id = r.id
        AND r.updated_at > updated_at;

      IF FOUND THEN updated_count := updated_count + 1; END IF;

    ELSE
      SELECT id INTO eid FROM entities WHERE space_id = r.space_id AND name = r.name LIMIT 1;

      IF eid IS NOT NULL THEN
        UPDATE entities
        SET
          tax_number = COALESCE(r.tax_number, tax_number),
          phone      = COALESCE(r.phone, phone),
          address    = COALESCE(r.address, address),
          updated_at = r.updated_at
        WHERE id = eid
          AND r.updated_at > updated_at;

        IF FOUND THEN updated_count := updated_count + 1; END IF;

      ELSE
        INSERT INTO entities (
          id, space_id, name, tax_number, phone, address,
          is_ai_recognized, created_at, updated_at
        )
        VALUES (
          r.id, r.space_id, r.name, r.tax_number, r.phone, r.address,
          r.is_ai_recognized, r.created_at, r.updated_at
        )
        ON CONFLICT (id) DO NOTHING;

        eid := r.id;
        inserted_count := inserted_count + 1;
      END IF;
    END IF;

    IF eid IS NOT NULL THEN
      INSERT INTO _cust_entity_map (customer_id, entity_id)
      VALUES (r.id, eid)
      ON CONFLICT (customer_id) DO UPDATE SET entity_id = EXCLUDED.entity_id;
      mapped_count := mapped_count + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '[§2] customers → entities: inserted %, updated %, mapped %', inserted_count, updated_count, mapped_count;
END $$;

-- § 3  四类记账单 entity_id 回填（仅当旧列存在且 entity_id 为空时）
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receipts_entity_id
  ON receipts(entity_id) WHERE entity_id IS NOT NULL;

DO $$
DECLARE cnt INT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'receipts' AND column_name = 'supplier_id'
  ) THEN
    UPDATE receipts r
    SET entity_id = r.supplier_id
    FROM entities e
    WHERE r.entity_id IS NULL
      AND r.supplier_id IS NOT NULL
      AND r.supplier_id = e.id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'receipts' AND column_name = 'supplier_customer_id'
  ) THEN
    UPDATE receipts r
    SET entity_id = m.entity_id
    FROM _cust_entity_map m
    WHERE r.entity_id IS NULL
      AND r.supplier_customer_id IS NOT NULL
      AND r.supplier_customer_id = m.customer_id;
  END IF;
END $$;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_entity_id
  ON invoices(entity_id) WHERE entity_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'customer_id'
  ) THEN
    UPDATE invoices i
    SET entity_id = COALESCE(
      (SELECT e.id FROM entities e WHERE e.id = i.customer_id LIMIT 1),
      (SELECT m.entity_id FROM _cust_entity_map m WHERE m.customer_id = i.customer_id LIMIT 1)
    )
    WHERE i.entity_id IS NULL
      AND i.customer_id IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'customer_supplier_id'
  ) THEN
    UPDATE invoices i
    SET entity_id = i.customer_supplier_id
    FROM entities e
    WHERE i.entity_id IS NULL
      AND i.customer_supplier_id IS NOT NULL
      AND i.customer_supplier_id = e.id;
  END IF;
END $$;

ALTER TABLE inbound
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inbound_entity_id
  ON inbound(entity_id) WHERE entity_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inbound' AND column_name = 'supplier_id'
  ) THEN
    UPDATE inbound i
    SET entity_id = i.supplier_id
    FROM entities e
    WHERE i.entity_id IS NULL
      AND i.supplier_id IS NOT NULL
      AND i.supplier_id = e.id;
  END IF;
END $$;

ALTER TABLE outbound
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_outbound_entity_id
  ON outbound(entity_id) WHERE entity_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'outbound' AND column_name = 'customer_id'
  ) THEN
    UPDATE outbound o
    SET entity_id = COALESCE(
      (SELECT e.id FROM entities e WHERE e.id = o.customer_id LIMIT 1),
      (SELECT m.entity_id FROM _cust_entity_map m WHERE m.customer_id = o.customer_id LIMIT 1)
    )
    WHERE o.entity_id IS NULL
      AND o.customer_id IS NOT NULL;
  END IF;
END $$;

DROP TABLE IF EXISTS _cust_entity_map;
