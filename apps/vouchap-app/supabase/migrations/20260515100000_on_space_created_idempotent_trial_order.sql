-- Prevent duplicate CRM trial space_orders when spaces INSERT is retried or a second
-- registration-path insert targets the same space (same sku + source=registration).

BEGIN;

SET search_path = public, crm;

CREATE OR REPLACE FUNCTION crm.on_space_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = crm, public
AS $$
DECLARE
  v_ops_id uuid;
  v_sku_id uuid;
  v_sku_code text;
BEGIN
  SELECT id INTO v_ops_id FROM crm.ops_users ORDER BY created_at ASC LIMIT 1;
  IF v_ops_id IS NOT NULL THEN
    INSERT INTO crm.ops_assignments (ops_user_id, space_id, role)
    VALUES (v_ops_id, NEW.id, 'primary')
    ON CONFLICT (space_id) DO UPDATE SET
      ops_user_id = EXCLUDED.ops_user_id,
      role = EXCLUDED.role;
  END IF;

  v_sku_code := CASE WHEN NEW.kind = 'firm' THEN 'FIRM_TRIAL_30' ELSE 'CLIENT_TRIAL_30' END;
  SELECT se.id INTO v_sku_id FROM crm.sku_edition se WHERE se.code = v_sku_code LIMIT 1;

  IF v_sku_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM crm.space_orders so
      INNER JOIN crm.sku_edition se2 ON se2.id = so.sku_id
      WHERE so.space_id = NEW.id
        AND so.status = 'active'
        AND so.source = 'registration'
        AND COALESCE(se2.data_limits->>'billing_kind', '') = 'space_subscription'
    ) THEN
      INSERT INTO crm.space_orders (space_id, sku_id, status, started_at, expires_at, source, metadata)
      VALUES (NEW.id, v_sku_id, 'active', now(), now() + interval '30 days', 'registration', '{}'::jsonb);
    END IF;
  ELSE
    RAISE WARNING 'crm.on_space_created: missing SKU % for space %', v_sku_code, NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION crm.on_space_created() IS
  'public.spaces AFTER INSERT: ops_assignments + at most one active registration trial space_order (CLIENT_TRIAL_30 / FIRM_TRIAL_30).';

COMMIT;
