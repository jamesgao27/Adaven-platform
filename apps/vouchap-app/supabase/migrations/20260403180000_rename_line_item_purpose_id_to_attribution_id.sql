-- receipt_items / invoice_items: rename purpose_id → attribution_id and FK to public.attributions(id).
-- Values already reference attributions.id (legacy column name); this aligns schema with app semantics.

BEGIN;

-- Drop FK constraints on purpose_id (constraint names differ across environments).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tc.table_name::text AS tbl, tc.constraint_name::text AS cname
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_schema = kcu.constraint_schema
     AND tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name IN ('receipt_items', 'invoice_items')
      AND kcu.column_name = 'purpose_id'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.cname);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'receipt_items' AND column_name = 'purpose_id'
  ) THEN
    ALTER TABLE public.receipt_items RENAME COLUMN purpose_id TO attribution_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoice_items' AND column_name = 'purpose_id'
  ) THEN
    ALTER TABLE public.invoice_items RENAME COLUMN purpose_id TO attribution_id;
  END IF;
END $$;

-- FK to attributions (skip if constraint already exists)
DO $$
BEGIN
  ALTER TABLE public.receipt_items
    ADD CONSTRAINT receipt_items_attribution_id_fkey
    FOREIGN KEY (attribution_id) REFERENCES public.attributions (id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.invoice_items
    ADD CONSTRAINT invoice_items_attribution_id_fkey
    FOREIGN KEY (attribution_id) REFERENCES public.attributions (id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.receipt_items.attribution_id IS 'References public.attributions.id (source / attribution for the line).';
COMMENT ON COLUMN public.invoice_items.attribution_id IS 'References public.attributions.id (source / attribution for the line).';

COMMIT;
