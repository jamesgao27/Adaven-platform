SET search_path = public, firm;

-- Backfill missing firm.order_managers rows for historical orders.
-- Priority for manager selection:
-- 1) latest existing manager on the same normalized client
-- 2) order.created_by
-- 3) first admin/member of the firm space
--
-- Notes:
-- - Do NOT overwrite existing order_managers rows.
-- - Normalize client key as:
--   a) orders.client_id
--   b) fallback map from orders.client_space_id -> firm.clients.id (same firm_space)

WITH orders_norm AS (
  SELECT
    o.id AS order_id,
    o.firm_space_id,
    o.created_by,
    o.created_at,
    o.updated_at,
    COALESCE(
      o.client_id,
      (
        SELECT c.id
        FROM firm.clients c
        WHERE c.firm_space_id = o.firm_space_id
          AND c.client_space_id = o.client_space_id
        ORDER BY c.created_at DESC
        LIMIT 1
      )
    ) AS norm_client_id
  FROM firm.orders o
),
latest_manager_by_client AS (
  SELECT
    t.norm_client_id,
    t.manager_user_id
  FROM (
    SELECT
      onorm.norm_client_id,
      om.manager_user_id,
      ROW_NUMBER() OVER (
        PARTITION BY onorm.norm_client_id
        ORDER BY COALESCE(onorm.updated_at, onorm.created_at) DESC, onorm.order_id DESC
      ) AS rn
    FROM orders_norm onorm
    JOIN firm.order_managers om ON om.order_id = onorm.order_id
    WHERE onorm.norm_client_id IS NOT NULL
  ) t
  WHERE t.rn = 1
),
fallback_user_by_space AS (
  SELECT
    us.space_id,
    (
      ARRAY_AGG(us.user_id ORDER BY us.is_admin DESC, us.created_at ASC NULLS LAST, us.user_id ASC)
    )[1] AS user_id
  FROM public.user_spaces us
  GROUP BY us.space_id
),
to_backfill AS (
  SELECT
    onorm.order_id,
    onorm.firm_space_id,
    COALESCE(
      lm.manager_user_id,
      onorm.created_by,
      fbs.user_id
    ) AS manager_user_id,
    COALESCE(onorm.created_at, now()) AS created_at
  FROM orders_norm onorm
  LEFT JOIN firm.order_managers om_exist ON om_exist.order_id = onorm.order_id
  LEFT JOIN latest_manager_by_client lm ON lm.norm_client_id = onorm.norm_client_id
  LEFT JOIN fallback_user_by_space fbs ON fbs.space_id = onorm.firm_space_id
  WHERE om_exist.id IS NULL
)
INSERT INTO firm.order_managers (firm_space_id, manager_user_id, order_id, created_at)
SELECT
  b.firm_space_id,
  b.manager_user_id,
  b.order_id,
  b.created_at
FROM to_backfill b
WHERE b.manager_user_id IS NOT NULL
ON CONFLICT (order_id) DO NOTHING;

