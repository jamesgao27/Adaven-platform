-- Vouchap: SKU space_target firm/client never matched spaces.kind provider/consumer,
-- so registration trial orders (CLIENT_TRIAL_30) stayed listed but get_space_entitlements
-- returned no active_subscription (0 recognition included).
-- Same fix as Portalflow 20260917190000 (subscription matching only).

UPDATE crm.sku_edition
SET data_limits = jsonb_set(data_limits, '{space_target}', to_jsonb('provider'::text), true),
    updated_at = now()
WHERE data_limits->>'space_target' = 'firm';

UPDATE crm.sku_edition
SET data_limits = jsonb_set(data_limits, '{space_target}', to_jsonb('consumer'::text), true),
    updated_at = now()
WHERE data_limits->>'space_target' = 'client';

CREATE OR REPLACE FUNCTION crm._active_space_subscription_row(p_space_id uuid)
RETURNS TABLE (
  order_id uuid,
  sku_code text,
  started_at timestamptz,
  expires_at timestamptz,
  is_trial boolean,
  recognition_included_per_month integer,
  engagement_included_per_year integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'crm'
AS $$
  SELECT
    so.id,
    se.code,
    so.started_at,
    so.expires_at,
    COALESCE(se.is_trial, false),
    (se.data_limits->>'recognition_included_per_month')::int,
    COALESCE(
      NULLIF((se.data_limits->>'engagement_included_per_subscription_year')::text, '')::int,
      NULLIF((se.data_limits->>'engagements_included')::text, '')::int,
      NULLIF((se.data_limits->>'engagement_credits_included')::text, '')::int
    )
  FROM crm.space_orders so
  INNER JOIN crm.sku_edition se ON se.id = so.sku_id
  INNER JOIN public.spaces sp ON sp.id = so.space_id
  WHERE so.space_id = p_space_id
    AND so.status = 'active'
    AND so.expires_at IS NOT NULL
    AND so.expires_at > now()
    AND COALESCE(se.data_limits->>'billing_kind', '') = 'space_subscription'
    AND COALESCE(se.data_limits->>'space_target', 'any') IN (
      'any',
      sp.kind::text,
      CASE sp.kind::text
        WHEN 'provider' THEN 'firm'
        WHEN 'consumer' THEN 'client'
        WHEN 'firm' THEN 'provider'
        WHEN 'client' THEN 'consumer'
        ELSE sp.kind::text
      END
    )
  ORDER BY (NOT COALESCE(se.is_trial, false)) DESC, so.created_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION crm._active_space_subscription_row(uuid) TO authenticated, service_role;
