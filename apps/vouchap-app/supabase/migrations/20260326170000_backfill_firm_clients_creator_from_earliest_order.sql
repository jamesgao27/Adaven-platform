-- Backfill firm.clients.creator_user_id for rows still NULL: use created_by on the
-- earliest firm.orders row for that firm–client (after invite_token backfill in 20260326160000).
--
-- Preview (run in SQL editor before applying migration):
-- SELECT cl.id, cl.firm_space_id, cl.client_space_id, o.id AS order_id, o.created_at, o.created_by
-- FROM firm.clients cl
-- INNER JOIN firm.orders o ON o.firm_space_id = cl.firm_space_id AND o.created_by IS NOT NULL
--   AND ((cl.client_space_id IS NOT NULL AND (o.client_space_id = cl.client_space_id OR o.client_id = cl.id))
--     OR (cl.client_space_id IS NULL AND o.client_id = cl.id))
-- WHERE cl.creator_user_id IS NULL
-- ORDER BY cl.id, o.created_at ASC NULLS LAST, o.id ASC;
SET search_path = public, firm;

UPDATE firm.clients c
SET creator_user_id = src.created_by
FROM (
  SELECT DISTINCT ON (cl.id)
    cl.id AS client_row_id,
    o.created_by
  FROM firm.clients cl
  INNER JOIN firm.orders o
    ON o.firm_space_id = cl.firm_space_id
    AND o.created_by IS NOT NULL
    AND (
      (
        cl.client_space_id IS NOT NULL
        AND (
          o.client_space_id = cl.client_space_id
          OR o.client_id = cl.id
        )
      )
      OR (
        cl.client_space_id IS NULL
        AND o.client_id = cl.id
      )
    )
  WHERE cl.creator_user_id IS NULL
  ORDER BY
    cl.id,
    o.created_at ASC NULLS LAST,
    o.id ASC
) AS src
WHERE c.id = src.client_row_id;

COMMENT ON COLUMN firm.clients.creator_user_id IS
  'User who created this client row. Open invite: token inviter. RPC adds: caller. Backfilled from invite_token.inviter_user_id, else earliest matching firm.orders.created_by.';
