-- CRM catalog cleanup: remove legacy VCH_* / CLIENT_SUB and obsolete sku_addon rows.
-- Also remove sku_edition rows that are not in the current platform allowlist and have
-- no space_orders (experimental catalog rows). If you introduce a custom SKU code, add
-- it to the allowlist below or ensure at least one space_order references it.

BEGIN;

SET search_path = public, crm;

-- ---------------------------------------------------------------------------
-- 1) space_orders pointing at legacy SaaS / old client subscription SKUs
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2) sku_edition: explicit legacy codes (safe after step 1)
-- ---------------------------------------------------------------------------
DELETE FROM crm.sku_edition se
WHERE se.code IN (
  'VCH_TRIAL',
  'VCH_BASIC',
  'VCH_BIZ',
  'VCH_FLOW',
  'VCH_ELITE',
  'CLIENT_SUB'
);

-- ---------------------------------------------------------------------------
-- 3) sku_edition: drop catalog rows not in current product set and never ordered
--    (see 20260512100000_subscription_entitlements_orders.sql + space-orders-sku-helpers.ts)
-- ---------------------------------------------------------------------------
DELETE FROM crm.sku_edition se
WHERE se.code NOT IN (
  'CLIENT_RECOGNITION_BASE',
  'FIRM_CLIENT_SIGNING_BONUS',
  'FIRM_ANNUAL',
  'CLIENT_TRIAL_30',
  'FIRM_TRIAL_30',
  'CLIENT_PAID_MONTHLY',
  'RECOGNITION_CREDIT_PACK',
  'ENGAGEMENT_CREDIT_PACK'
)
AND NOT EXISTS (SELECT 1 FROM crm.space_orders o WHERE o.sku_id = se.id);

-- ---------------------------------------------------------------------------
-- 4) sku_addon: only reference packs from current spec (crm-sku-seed.sql)
-- ---------------------------------------------------------------------------
DELETE FROM crm.sku_addon a
WHERE a.code NOT IN (
  'ENGAGEMENT_CREDITS_REF',
  'CLIENT_RECOGNITION_CREDITS_REF'
);

COMMIT;
