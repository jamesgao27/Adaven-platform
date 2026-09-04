-- Legacy VCH_* / CLIENT_SUB rows often remain because 20260413143000 only deletes sku_edition
-- when no space_orders reference them. Remove those historical orders, then drop obsolete catalog rows.

BEGIN;

SET search_path = public, crm;

-- 1) Orders pointing at legacy editions (trial / old SaaS tiers / old client sub)
DELETE FROM crm.space_orders o
USING crm.sku_edition e
WHERE o.sku_id = e.id
  AND e.code IN (
    'VCH_TRIAL',
    'VCH_BASIC',
    'VCH_BIZ',
    'VCH_FLOW',
    'VCH_ELITE',
    'CLIENT_SUB'
  );

-- 2) Now safe to remove edition rows if any remain
DELETE FROM crm.sku_edition se
WHERE se.code IN (
  'VCH_TRIAL',
  'VCH_BASIC',
  'VCH_BIZ',
  'VCH_FLOW',
  'VCH_ELITE',
  'CLIENT_SUB'
);

COMMIT;
