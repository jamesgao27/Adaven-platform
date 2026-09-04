-- Seed FIRM_ANNUAL / CLIENT_SUB and add-on packs (idempotent). Run after 20260413140000_*.
-- Ops may still manage rows in Supabase; this aligns new environments.

BEGIN;

SET search_path = crm, public;

INSERT INTO crm.sku_edition (
  code, name, description, feature_modules, data_limits, period_type, quota_period,
  price_monthly, price_yearly, currency, is_trial, sort_order
)
VALUES (
    'FIRM_ANNUAL',
    'Firm Annual',
    'USD99/year. Includes 50 concurrent engagements (non-completed, non-cancelled). Add capacity via space_orders.metadata.engagement_addon_slots.',
    '{"expenses": true, "income": true, "inbound": true, "outbound": true}'::jsonb,
    '{"engagements_included": 50, "billing_role": "firm"}'::jsonb,
    'year',
    'year',
    NULL,
    99.00,
    'USD',
    false,
    40
  ),
  (
    'CLIENT_SUB',
    'Client Subscription',
    '10 included AI recognitions/month; credits beyond; monthly cap 100 when any linked firm engagement is processing.',
    '{"expenses": true, "income": true, "inbound": true, "outbound": true}'::jsonb,
    '{"recognition_included_per_month": 10, "billing_role": "client"}'::jsonb,
    'month',
    'month',
    NULL,
    NULL,
    'USD',
    false,
    45
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  feature_modules = EXCLUDED.feature_modules,
  data_limits = EXCLUDED.data_limits,
  period_type = EXCLUDED.period_type,
  quota_period = EXCLUDED.quota_period,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  currency = EXCLUDED.currency,
  is_trial = EXCLUDED.is_trial,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO crm.sku_addon (code, name, description, units, price, currency, is_active, sort_order)
VALUES
  ('ENG_PACK_50', 'Engagement pack 50', '50 extra engagement slots (whole pack).', 50, 495.00, 'USD', true, 10),
  ('ENG_PACK_100', 'Engagement pack 100', '100 extra engagement slots (whole pack).', 100, 790.00, 'USD', true, 11),
  ('ENG_PACK_200', 'Engagement pack 200', '200 extra engagement slots (whole pack).', 200, 1300.00, 'USD', true, 12),
  ('ENG_PACK_500', 'Engagement pack 500', '500 extra engagement slots (whole pack).', 500, 2450.00, 'USD', true, 13),
  ('CLIENT_CREDIT_100', 'Client recognition credits 100', '100 prepaid credits (reference $10 pack). Grant via metadata.recognition_credits_added.', 100, 10.00, 'USD', true, 20)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  units = EXCLUDED.units,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

COMMIT;
