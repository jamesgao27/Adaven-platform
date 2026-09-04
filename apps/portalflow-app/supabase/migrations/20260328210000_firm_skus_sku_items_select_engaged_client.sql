-- Pure clients are not members of firm_space_id; firm_skus_select / firm_sku_items_select only allow firm space.
-- Add SELECT policies so clients who may see an engagement (same rules as preview RPCs) can read firm.skus / firm.sku_items
-- directly — fixes fetchSkuHeaderFromTable / getSkuItems first path without relying only on RPCs.
-- Helper must NOT read firm.skus (avoids RLS recursion when sku_items policy probes parent sku row).
SET search_path = public, firm;

CREATE OR REPLACE FUNCTION firm.auth_user_can_select_sku_as_engaged_client(
  p_user_id uuid,
  p_sku_id uuid,
  p_firm_space_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, firm
AS $$
  SELECT p_user_id IS NOT NULL
    AND p_sku_id IS NOT NULL
    AND p_firm_space_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM firm.orders o
        WHERE o.sku_id = p_sku_id
          AND o.firm_space_id = p_firm_space_id
          AND firm.auth_user_can_select_order(p_user_id, o.id)
      )
      OR EXISTS (
        SELECT 1
        FROM firm.clients c
        INNER JOIN firm.orders o ON o.client_id = c.id AND o.firm_space_id = c.firm_space_id
        WHERE c.firm_space_id = p_firm_space_id
          AND o.sku_id = p_sku_id
          AND length(trim(COALESCE(
            (SELECT LOWER(TRIM(COALESCE(u.email, ''))) FROM public.users u WHERE u.id = p_user_id LIMIT 1),
            ''
          ))) > 0
          AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = (
            SELECT LOWER(TRIM(COALESCE(u.email, '')))
            FROM public.users u WHERE u.id = p_user_id LIMIT 1
          )
          AND (
            (c.client_space_id IS NULL AND o.client_space_id IS NULL)
            OR (
              o.client_space_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM public.user_spaces us2
                WHERE us2.user_id = p_user_id AND us2.space_id = o.client_space_id
              )
            )
          )
      )
    );
$$;

COMMENT ON FUNCTION firm.auth_user_can_select_sku_as_engaged_client(uuid, uuid, uuid) IS
  'True if user may read this SKU row as client: SELECT on some order with this sku, or invitee_email match (pending or linked order).';

--------------------------------------------------------------------------------
-- firm.skus: existing firm_skus_select unchanged; OR engaged-client path.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS firm_skus_select_engaged_client ON firm.skus;
CREATE POLICY firm_skus_select_engaged_client ON firm.skus FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND firm.auth_user_can_select_sku_as_engaged_client(auth.uid(), firm.skus.id, firm.skus.firm_space_id)
  );

COMMENT ON POLICY firm_skus_select_engaged_client ON firm.skus IS
  'Client / invitee: may SELECT sku rows tied to an order they can see or a matching invitee_email row.';

--------------------------------------------------------------------------------
-- firm.sku_items: probe parent sku by id; parent skus SELECT must pass via engaged-client or firm policy.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS firm_sku_items_select_engaged_client ON firm.sku_items;
CREATE POLICY firm_sku_items_select_engaged_client ON firm.sku_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM firm.skus s
      WHERE s.id = firm.sku_items.sku_id
        AND firm.auth_user_can_select_sku_as_engaged_client(auth.uid(), s.id, s.firm_space_id)
    )
  );

COMMENT ON POLICY firm_sku_items_select_engaged_client ON firm.sku_items IS
  'Client / invitee: sku_items when parent sku is readable via firm_skus_select_engaged_client.';
