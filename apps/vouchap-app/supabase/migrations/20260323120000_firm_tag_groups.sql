-- Tag-based groups + retained clients_assignee (OR visibility): firm members see a client/order if they are
-- in a linked permission group OR are the direct assignee (firm.clients_assignee).

SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) Tables
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS firm.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,
  group_color TEXT NOT NULL DEFAULT '#6C5CE7',
  is_system_admin BOOLEAN NOT NULL DEFAULT false,
  admin_creator_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (firm_space_id, group_name)
);

CREATE UNIQUE INDEX IF NOT EXISTS firm_groups_one_admin_per_space
  ON firm.groups (firm_space_id)
  WHERE is_system_admin = true;

COMMENT ON TABLE firm.groups IS 'Firm permission groups (tags). is_system_admin identifies the built-in Admin group.';
COMMENT ON COLUMN firm.groups.admin_creator_user_id IS 'Firm space creator; cannot be removed from Admin group (enforced by trigger).';

CREATE TABLE IF NOT EXISTS firm.group_members (
  group_id UUID NOT NULL REFERENCES firm.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS firm.group_clients (
  group_id UUID NOT NULL REFERENCES firm.groups(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES firm.clients(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_firm_group_clients_client ON firm.group_clients (client_id);

CREATE TABLE IF NOT EXISTS firm.group_invitees (
  group_id UUID NOT NULL REFERENCES firm.groups(id) ON DELETE CASCADE,
  invitee_client_id UUID NOT NULL REFERENCES firm.invitee_clients(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, invitee_client_id)
);

CREATE INDEX IF NOT EXISTS idx_firm_group_invitees_invitee ON firm.group_invitees (invitee_client_id);

--------------------------------------------------------------------------------
-- 2) Helpers (SECURITY DEFINER for RPCs / triggers)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION firm.link_client_to_user_groups(
  p_firm_space_id uuid,
  p_client_id uuid,
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
BEGIN
  INSERT INTO firm.group_clients (group_id, client_id)
  SELECT gm.group_id, p_client_id
  FROM firm.group_members gm
  INNER JOIN firm.groups g ON g.id = gm.group_id AND g.firm_space_id = p_firm_space_id
  WHERE gm.user_id = p_user_id
  ON CONFLICT DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM firm.group_clients WHERE client_id = p_client_id) THEN
    INSERT INTO firm.group_clients (group_id, client_id)
    SELECT g.id, p_client_id
    FROM firm.groups g
    WHERE g.firm_space_id = p_firm_space_id AND g.is_system_admin = true
    LIMIT 1
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION firm.link_invitee_to_user_groups(
  p_firm_space_id uuid,
  p_invitee_client_id uuid,
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
BEGIN
  INSERT INTO firm.group_invitees (group_id, invitee_client_id)
  SELECT gm.group_id, p_invitee_client_id
  FROM firm.group_members gm
  INNER JOIN firm.groups g ON g.id = gm.group_id AND g.firm_space_id = p_firm_space_id
  WHERE gm.user_id = p_user_id
  ON CONFLICT DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM firm.group_invitees WHERE invitee_client_id = p_invitee_client_id) THEN
    INSERT INTO firm.group_invitees (group_id, invitee_client_id)
    SELECT g.id, p_invitee_client_id
    FROM firm.groups g
    WHERE g.firm_space_id = p_firm_space_id AND g.is_system_admin = true
    LIMIT 1
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.firm_bootstrap_admin_group(
  p_firm_space_id uuid,
  p_creator_user_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_gid uuid;
BEGIN
  INSERT INTO firm.groups (firm_space_id, group_name, group_color, is_system_admin, admin_creator_user_id)
  VALUES (p_firm_space_id, 'Admin', '#2D3436', true, p_creator_user_id)
  ON CONFLICT (firm_space_id, group_name) DO NOTHING;

  SELECT id INTO v_gid FROM firm.groups
  WHERE firm_space_id = p_firm_space_id AND is_system_admin = true
  LIMIT 1;

  IF v_gid IS NULL THEN
    RETURN;
  END IF;

  UPDATE firm.groups
  SET admin_creator_user_id = COALESCE(admin_creator_user_id, p_creator_user_id)
  WHERE id = v_gid;

  INSERT INTO firm.group_members (group_id, user_id)
  VALUES (v_gid, p_creator_user_id)
  ON CONFLICT DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.firm_bootstrap_admin_group(uuid, uuid) IS
  'Creates Admin group for a firm space and ensures creator is a member (new firm registration).';

CREATE OR REPLACE FUNCTION firm.prevent_remove_admin_creator_from_group()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, firm
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM firm.groups g
    WHERE g.id = OLD.group_id
      AND g.is_system_admin = true
      AND g.admin_creator_user_id IS NOT NULL
      AND g.admin_creator_user_id = OLD.user_id
  ) THEN
    RAISE EXCEPTION 'Cannot remove the firm creator from the Admin group'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_group_members_prevent_admin_creator_remove ON firm.group_members;
CREATE TRIGGER tr_group_members_prevent_admin_creator_remove
  BEFORE DELETE ON firm.group_members
  FOR EACH ROW
  EXECUTE FUNCTION firm.prevent_remove_admin_creator_from_group();

--------------------------------------------------------------------------------
-- 3) Backfill Admin + migrate clients_assignee → legacy groups
--------------------------------------------------------------------------------

INSERT INTO firm.groups (firm_space_id, group_name, group_color, is_system_admin, admin_creator_user_id)
SELECT
  s.id,
  'Admin',
  '#2D3436',
  true,
  (
    SELECT us.user_id
    FROM public.user_spaces us
    WHERE us.space_id = s.id AND us.is_admin = true
    ORDER BY us.user_id ASC
    LIMIT 1
  )
FROM public.spaces s
WHERE s.kind = 'firm'
ON CONFLICT (firm_space_id, group_name) DO NOTHING;

UPDATE firm.groups g
SET admin_creator_user_id = sub.u
FROM (
  SELECT s.id AS space_id,
    (
      SELECT us.user_id FROM public.user_spaces us
      WHERE us.space_id = s.id AND us.is_admin = true
      ORDER BY us.user_id ASC LIMIT 1
    ) AS u
  FROM public.spaces s
  WHERE s.kind = 'firm'
) sub
WHERE g.firm_space_id = sub.space_id
  AND g.is_system_admin = true
  AND g.admin_creator_user_id IS NULL
  AND sub.u IS NOT NULL;

INSERT INTO firm.group_members (group_id, user_id)
SELECT g.id, us.user_id
FROM firm.groups g
JOIN public.user_spaces us ON us.space_id = g.firm_space_id AND us.is_admin = true
WHERE g.is_system_admin = true
ON CONFLICT DO NOTHING;

-- Ensure firm.clients rows exist for every client_space referenced by orders or old assignees (orphan engagements)
INSERT INTO firm.clients (firm_space_id, client_space_id)
SELECT DISTINCT o.firm_space_id, o.client_space_id
FROM firm.orders o
WHERE o.client_space_id IS NOT NULL
ON CONFLICT (firm_space_id, client_space_id) DO NOTHING;

INSERT INTO firm.clients (firm_space_id, client_space_id)
SELECT DISTINCT ca.firm_space_id, ca.client_space_id
FROM firm.clients_assignee ca
WHERE ca.client_space_id IS NOT NULL
ON CONFLICT (firm_space_id, client_space_id) DO NOTHING;

-- Legacy groups per (firm, user) for former client assignees
INSERT INTO firm.groups (firm_space_id, group_name, group_color, is_system_admin)
SELECT DISTINCT ca.firm_space_id, 'Legacy ' || ca.user_id::text, '#95A5A6', false
FROM firm.clients_assignee ca
WHERE ca.client_space_id IS NOT NULL
ON CONFLICT (firm_space_id, group_name) DO NOTHING;

INSERT INTO firm.group_members (group_id, user_id)
SELECT g.id, u.user_id
FROM firm.groups g
JOIN (
  SELECT DISTINCT firm_space_id, user_id
  FROM firm.clients_assignee
  WHERE client_space_id IS NOT NULL
) u ON u.firm_space_id = g.firm_space_id AND g.group_name = 'Legacy ' || u.user_id::text
ON CONFLICT DO NOTHING;

INSERT INTO firm.group_clients (group_id, client_id)
SELECT g.id, c.id
FROM firm.clients c
JOIN firm.clients_assignee ca
  ON ca.firm_space_id = c.firm_space_id AND ca.client_space_id = c.client_space_id
JOIN firm.groups g
  ON g.firm_space_id = ca.firm_space_id AND g.group_name = 'Legacy ' || ca.user_id::text
WHERE ca.client_space_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Invitee legacy
INSERT INTO firm.groups (firm_space_id, group_name, group_color, is_system_admin)
SELECT DISTINCT ca.firm_space_id, 'LegacyI ' || ca.user_id::text, '#B2BEC3', false
FROM firm.clients_assignee ca
WHERE ca.invitee_client_id IS NOT NULL
ON CONFLICT (firm_space_id, group_name) DO NOTHING;

INSERT INTO firm.group_members (group_id, user_id)
SELECT g.id, u.user_id
FROM firm.groups g
JOIN (
  SELECT DISTINCT firm_space_id, user_id
  FROM firm.clients_assignee
  WHERE invitee_client_id IS NOT NULL
) u ON u.firm_space_id = g.firm_space_id AND g.group_name = 'LegacyI ' || u.user_id::text
ON CONFLICT DO NOTHING;

INSERT INTO firm.group_invitees (group_id, invitee_client_id)
SELECT g.id, ca.invitee_client_id
FROM firm.clients_assignee ca
JOIN firm.groups g
  ON g.firm_space_id = ca.firm_space_id AND g.group_name = 'LegacyI ' || ca.user_id::text
WHERE ca.invitee_client_id IS NOT NULL
ON CONFLICT DO NOTHING;

--------------------------------------------------------------------------------
-- 4) RLS: new tables (firm members read; admins write)
--------------------------------------------------------------------------------

ALTER TABLE firm.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm.group_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm.group_invitees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS firm_groups_select ON firm.groups;
CREATE POLICY firm_groups_select ON firm.groups
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.groups.firm_space_id AND us.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS firm_groups_mutate_admin ON firm.groups;
CREATE POLICY firm_groups_mutate_admin ON firm.groups
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.groups.firm_space_id AND us.user_id = auth.uid() AND us.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.groups.firm_space_id AND us.user_id = auth.uid() AND us.is_admin = true
    )
  );

DROP POLICY IF EXISTS firm_group_members_select ON firm.group_members;
CREATE POLICY firm_group_members_select ON firm.group_members
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM firm.groups g
      JOIN public.user_spaces us ON us.space_id = g.firm_space_id AND us.user_id = auth.uid()
      WHERE g.id = firm.group_members.group_id
    )
  );

DROP POLICY IF EXISTS firm_group_members_mutate_admin ON firm.group_members;
CREATE POLICY firm_group_members_mutate_admin ON firm.group_members
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM firm.groups g
      JOIN public.user_spaces us ON us.space_id = g.firm_space_id AND us.user_id = auth.uid() AND us.is_admin = true
      WHERE g.id = firm.group_members.group_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM firm.groups g
      JOIN public.user_spaces us ON us.space_id = g.firm_space_id AND us.user_id = auth.uid() AND us.is_admin = true
      WHERE g.id = firm.group_members.group_id
    )
  );

DROP POLICY IF EXISTS firm_group_clients_select ON firm.group_clients;
CREATE POLICY firm_group_clients_select ON firm.group_clients
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM firm.groups g
      JOIN public.user_spaces us ON us.space_id = g.firm_space_id AND us.user_id = auth.uid()
      WHERE g.id = firm.group_clients.group_id
    )
  );

DROP POLICY IF EXISTS firm_group_clients_mutate_admin ON firm.group_clients;
CREATE POLICY firm_group_clients_mutate_admin ON firm.group_clients
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM firm.groups g
      JOIN public.user_spaces us ON us.space_id = g.firm_space_id AND us.user_id = auth.uid() AND us.is_admin = true
      WHERE g.id = firm.group_clients.group_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM firm.groups g
      JOIN public.user_spaces us ON us.space_id = g.firm_space_id AND us.user_id = auth.uid() AND us.is_admin = true
      WHERE g.id = firm.group_clients.group_id
    )
  );

DROP POLICY IF EXISTS firm_group_invitees_select ON firm.group_invitees;
CREATE POLICY firm_group_invitees_select ON firm.group_invitees
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM firm.groups g
      JOIN public.user_spaces us ON us.space_id = g.firm_space_id AND us.user_id = auth.uid()
      WHERE g.id = firm.group_invitees.group_id
    )
  );

DROP POLICY IF EXISTS firm_group_invitees_mutate_admin ON firm.group_invitees;
CREATE POLICY firm_group_invitees_mutate_admin ON firm.group_invitees
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM firm.groups g
      JOIN public.user_spaces us ON us.space_id = g.firm_space_id AND us.user_id = auth.uid() AND us.is_admin = true
      WHERE g.id = firm.group_invitees.group_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM firm.groups g
      JOIN public.user_spaces us ON us.space_id = g.firm_space_id AND us.user_id = auth.uid() AND us.is_admin = true
      WHERE g.id = firm.group_invitees.group_id
    )
  );

-- Prevent deleting the system Admin group
CREATE OR REPLACE FUNCTION firm.prevent_delete_system_admin_group()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, firm
AS $$
BEGIN
  IF OLD.is_system_admin = true THEN
    RAISE EXCEPTION 'Cannot delete the Admin group'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_groups_prevent_delete_admin ON firm.groups;
CREATE TRIGGER tr_groups_prevent_delete_admin
  BEFORE DELETE ON firm.groups
  FOR EACH ROW
  EXECUTE FUNCTION firm.prevent_delete_system_admin_group();

--------------------------------------------------------------------------------
-- 5) Replace firm.clients / firm.orders RLS (permission groups OR clients_assignee)
--------------------------------------------------------------------------------

DROP POLICY IF EXISTS firm_clients_select ON firm.clients;
CREATE POLICY firm_clients_select ON firm.clients
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR EXISTS (
      SELECT 1 FROM firm.group_clients gc
      JOIN firm.group_members gm ON gm.group_id = gc.group_id AND gm.user_id = auth.uid()
      WHERE gc.client_id = firm.clients.id
    )
    OR EXISTS (
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.clients.firm_space_id
        AND ca.client_space_id = firm.clients.client_space_id
        AND ca.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS firm_clients_update ON firm.clients;
CREATE POLICY firm_clients_update ON firm.clients
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR EXISTS (
      SELECT 1 FROM firm.group_clients gc
      JOIN firm.group_members gm ON gm.group_id = gc.group_id AND gm.user_id = auth.uid()
      WHERE gc.client_id = firm.clients.id
    )
    OR EXISTS (
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.clients.firm_space_id
        AND ca.client_space_id = firm.clients.client_space_id
        AND ca.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS firm_clients_delete ON firm.clients;
CREATE POLICY firm_clients_delete ON firm.clients
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR EXISTS (
      SELECT 1 FROM firm.group_clients gc
      JOIN firm.group_members gm ON gm.group_id = gc.group_id AND gm.user_id = auth.uid()
      WHERE gc.client_id = firm.clients.id
    )
    OR EXISTS (
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.clients.firm_space_id
        AND ca.client_space_id = firm.clients.client_space_id
        AND ca.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS firm_orders_select ON firm.orders;
CREATE POLICY firm_orders_select ON firm.orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.orders.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR EXISTS (
      SELECT 1 FROM firm.clients c
      JOIN firm.group_clients gc ON gc.client_id = c.id
      JOIN firm.group_members gm ON gm.group_id = gc.group_id AND gm.user_id = auth.uid()
      WHERE c.firm_space_id = firm.orders.firm_space_id
        AND firm.orders.client_space_id IS NOT NULL
        AND c.client_space_id = firm.orders.client_space_id
    )
    OR EXISTS (
      SELECT 1 FROM firm.group_invitees gi
      JOIN firm.group_members gm ON gm.group_id = gi.group_id AND gm.user_id = auth.uid()
      WHERE firm.orders.invitee_client_id IS NOT NULL
        AND gi.invitee_client_id = firm.orders.invitee_client_id
    )
    OR EXISTS (
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.orders.firm_space_id
        AND ca.user_id = auth.uid()
        AND (
          (firm.orders.client_space_id IS NOT NULL AND ca.client_space_id = firm.orders.client_space_id)
          OR (firm.orders.invitee_client_id IS NOT NULL AND ca.invitee_client_id = firm.orders.invitee_client_id)
        )
    )
    OR (
      firm.orders.client_space_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.user_spaces us
        WHERE us.space_id = firm.orders.client_space_id
          AND us.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS firm_orders_update ON firm.orders;
CREATE POLICY firm_orders_update ON firm.orders
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.orders.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR EXISTS (
      SELECT 1 FROM firm.clients c
      JOIN firm.group_clients gc ON gc.client_id = c.id
      JOIN firm.group_members gm ON gm.group_id = gc.group_id AND gm.user_id = auth.uid()
      WHERE c.firm_space_id = firm.orders.firm_space_id
        AND firm.orders.client_space_id IS NOT NULL
        AND c.client_space_id = firm.orders.client_space_id
    )
    OR EXISTS (
      SELECT 1 FROM firm.group_invitees gi
      JOIN firm.group_members gm ON gm.group_id = gi.group_id AND gm.user_id = auth.uid()
      WHERE firm.orders.invitee_client_id IS NOT NULL
        AND gi.invitee_client_id = firm.orders.invitee_client_id
    )
    OR EXISTS (
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.orders.firm_space_id
        AND ca.user_id = auth.uid()
        AND (
          (firm.orders.client_space_id IS NOT NULL AND ca.client_space_id = firm.orders.client_space_id)
          OR (firm.orders.invitee_client_id IS NOT NULL AND ca.invitee_client_id = firm.orders.invitee_client_id)
        )
    )
  );

DROP POLICY IF EXISTS firm_orders_delete ON firm.orders;
CREATE POLICY firm_orders_delete ON firm.orders
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.orders.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
    OR EXISTS (
      SELECT 1 FROM firm.clients c
      JOIN firm.group_clients gc ON gc.client_id = c.id
      JOIN firm.group_members gm ON gm.group_id = gc.group_id AND gm.user_id = auth.uid()
      WHERE c.firm_space_id = firm.orders.firm_space_id
        AND firm.orders.client_space_id IS NOT NULL
        AND c.client_space_id = firm.orders.client_space_id
    )
    OR EXISTS (
      SELECT 1 FROM firm.group_invitees gi
      JOIN firm.group_members gm ON gm.group_id = gi.group_id AND gm.user_id = auth.uid()
      WHERE firm.orders.invitee_client_id IS NOT NULL
        AND gi.invitee_client_id = firm.orders.invitee_client_id
    )
    OR EXISTS (
      SELECT 1 FROM firm.clients_assignee ca
      WHERE ca.firm_space_id = firm.orders.firm_space_id
        AND ca.user_id = auth.uid()
        AND (
          (firm.orders.client_space_id IS NOT NULL AND ca.client_space_id = firm.orders.client_space_id)
          OR (firm.orders.invitee_client_id IS NOT NULL AND ca.invitee_client_id = firm.orders.invitee_client_id)
        )
    )
  );

COMMENT ON POLICY firm_clients_select ON firm.clients IS 'Firm admin all; members via groups OR clients_assignee.';
COMMENT ON POLICY firm_orders_select ON firm.orders IS 'Firm admin all; members via groups OR assignee; client-space members own orders.';

--------------------------------------------------------------------------------
-- 6) Keep firm.clients_assignee; refresh RLS policies (admin-only mutate)
--------------------------------------------------------------------------------

ALTER TABLE firm.clients_assignee ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clients_assignee_select_firm_members ON firm.clients_assignee;
DROP POLICY IF EXISTS clients_assignee_insert_firm_admin ON firm.clients_assignee;
DROP POLICY IF EXISTS clients_assignee_update_firm_admin ON firm.clients_assignee;
DROP POLICY IF EXISTS clients_assignee_delete_firm_admin ON firm.clients_assignee;

CREATE POLICY clients_assignee_select_firm_members ON firm.clients_assignee
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients_assignee.firm_space_id AND us.user_id = auth.uid()
    )
  );

CREATE POLICY clients_assignee_insert_firm_admin ON firm.clients_assignee
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients_assignee.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

CREATE POLICY clients_assignee_update_firm_admin ON firm.clients_assignee
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients_assignee.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients_assignee.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

CREATE POLICY clients_assignee_delete_firm_admin ON firm.clients_assignee
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.space_id = firm.clients_assignee.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

--------------------------------------------------------------------------------
-- 7) accept_client_invite_token: group link + clients_assignee (inviter as assignee)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION firm.accept_client_invite_token(
  p_token text,
  p_client_space_id uuid,
  p_client_user_id uuid
)
RETURNS TABLE (
  firm_space_id uuid,
  client_space_id uuid,
  inviter_user_id uuid,
  sku_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = firm, public
AS $$
#variable_conflict use_column
DECLARE
  v_token_record firm.client_invite_tokens%ROWTYPE;
  v_now timestamptz := now();
  v_out_firm_space_id uuid;
  v_out_client_space_id uuid;
  v_out_inviter_user_id uuid;
  v_out_sku_id uuid;
  v_joined bigint;
  v_client_pk uuid;
BEGIN
  IF p_token IS NULL OR p_client_space_id IS NULL OR p_client_user_id IS NULL THEN
    RAISE EXCEPTION 'token, client_space_id and client_user_id are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_token_record
  FROM firm.client_invite_tokens
  WHERE token = p_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid client invite token'
      USING ERRCODE = '22023';
  END IF;

  IF v_token_record.is_active IS FALSE THEN
    RAISE EXCEPTION 'Client invite token is inactive'
      USING ERRCODE = '22023';
  END IF;

  IF v_token_record.expires_at IS NOT NULL AND v_token_record.expires_at <= v_now THEN
    RAISE EXCEPTION 'Client invite token has expired'
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::bigint INTO v_joined
  FROM firm.clients c
  WHERE c.invite_token_id = v_token_record.id;

  IF v_token_record.max_clients IS NOT NULL AND v_joined >= v_token_record.max_clients THEN
    RAISE EXCEPTION 'Client invite token has reached its maximum usage'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO firm.clients (firm_space_id, client_space_id, invite_token_id)
  VALUES (v_token_record.firm_space_id, p_client_space_id, v_token_record.id)
  ON CONFLICT (firm_space_id, client_space_id)
  DO UPDATE SET
    invite_token_id = COALESCE(firm.clients.invite_token_id, EXCLUDED.invite_token_id);

  SELECT c.id INTO v_client_pk
  FROM firm.clients c
  WHERE c.firm_space_id = v_token_record.firm_space_id
    AND c.client_space_id = p_client_space_id
  LIMIT 1;

  PERFORM firm.link_client_to_user_groups(
    v_token_record.firm_space_id,
    v_client_pk,
    v_token_record.inviter_user_id
  );

  INSERT INTO firm.clients_assignee (firm_space_id, user_id, client_space_id, created_at)
  SELECT v_token_record.firm_space_id, v_token_record.inviter_user_id, p_client_space_id, v_now
  WHERE NOT EXISTS (
    SELECT 1 FROM firm.clients_assignee ca
    WHERE ca.firm_space_id = v_token_record.firm_space_id
      AND ca.user_id = v_token_record.inviter_user_id
      AND ca.client_space_id = p_client_space_id
  );

  BEGIN
    INSERT INTO firm.orders (
      firm_space_id,
      client_space_id,
      sku_id,
      status,
      due_at,
      created_at,
      updated_at,
      created_by,
      invitee_client_id
    )
    VALUES (
      v_token_record.firm_space_id,
      p_client_space_id,
      v_token_record.sku_id,
      'onboarding',
      NULL,
      v_now,
      v_now,
      p_client_user_id,
      NULL
    )
    ON CONFLICT (firm_space_id, client_space_id, sku_id, status)
    DO NOTHING;
  EXCEPTION
    WHEN SQLSTATE '42P10' THEN
      BEGIN
        INSERT INTO firm.orders (
          firm_space_id,
          client_space_id,
          sku_id,
          status,
          due_at,
          created_at,
          updated_at,
          created_by,
          invitee_client_id
        )
        VALUES (
          v_token_record.firm_space_id,
          p_client_space_id,
          v_token_record.sku_id,
          'onboarding',
          NULL,
          v_now,
          v_now,
          p_client_user_id,
          NULL
        );
      EXCEPTION
        WHEN unique_violation THEN
          NULL;
      END;
  END;

  SELECT COUNT(*)::bigint INTO v_joined
  FROM firm.clients c
  WHERE c.invite_token_id = v_token_record.id;

  IF v_token_record.max_clients IS NOT NULL AND v_joined >= v_token_record.max_clients THEN
    UPDATE firm.client_invite_tokens t
    SET is_active = false
    WHERE t.id = v_token_record.id;
  END IF;

  v_out_firm_space_id  := v_token_record.firm_space_id;
  v_out_client_space_id := p_client_space_id;
  v_out_inviter_user_id := v_token_record.inviter_user_id;
  v_out_sku_id          := v_token_record.sku_id;
  firm_space_id         := v_out_firm_space_id;
  client_space_id       := v_out_client_space_id;
  inviter_user_id       := v_out_inviter_user_id;
  sku_id                := v_out_sku_id;
  RETURN NEXT;
END;
$$;

--------------------------------------------------------------------------------
-- 8) invitee_claim_engagement
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.invitee_claim_engagement(
  p_invitee_client_id uuid,
  p_client_space_id uuid
)
RETURNS TABLE (client_space_id uuid, firm_space_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_uid uuid;
  v_email text;
  v_invitee_email text;
  v_firm_space_id uuid;
  v_client_pk uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT ic.firm_space_id, LOWER(TRIM(COALESCE(ic.invitee_email, '')))
  INTO v_firm_space_id, v_invitee_email
  FROM firm.invitee_clients ic
  WHERE ic.id = p_invitee_client_id;

  IF v_firm_space_id IS NULL THEN
    RAISE EXCEPTION 'Invitee not found';
  END IF;

  SELECT LOWER(TRIM(COALESCE(u.email, (SELECT email FROM auth.users WHERE id = v_uid LIMIT 1), '')))
  INTO v_email
  FROM public.users u
  WHERE u.id = v_uid
  LIMIT 1;
  v_email := COALESCE(v_email, '');

  IF v_email <> v_invitee_email THEN
    RAISE EXCEPTION 'This engagement is for a different email address';
  END IF;

  INSERT INTO firm.clients (firm_space_id, client_space_id)
  VALUES (v_firm_space_id, p_client_space_id)
  ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key DO NOTHING;

  SELECT c.id INTO v_client_pk
  FROM firm.clients c
  WHERE c.firm_space_id = v_firm_space_id AND c.client_space_id = p_client_space_id
  LIMIT 1;

  UPDATE firm.invitee_clients
  SET clients_space_id = p_client_space_id, updated_at = now()
  WHERE id = p_invitee_client_id;

  INSERT INTO firm.group_clients (group_id, client_id)
  SELECT gi.group_id, v_client_pk
  FROM firm.group_invitees gi
  WHERE gi.invitee_client_id = p_invitee_client_id
  ON CONFLICT DO NOTHING;

  DELETE FROM firm.group_invitees WHERE invitee_client_id = p_invitee_client_id;

  UPDATE firm.orders o
  SET client_space_id = p_client_space_id, updated_at = now()
  WHERE o.firm_space_id = v_firm_space_id
    AND o.invitee_client_id = p_invitee_client_id
    AND o.client_space_id IS NULL;

  UPDATE public.projects pr
  SET client_space_id = p_client_space_id, updated_at = now()
  WHERE pr.order_id IN (
    SELECT o.id FROM firm.orders o
    WHERE o.firm_space_id = v_firm_space_id
      AND o.invitee_client_id = p_invitee_client_id
      AND o.client_space_id = p_client_space_id
  );

  INSERT INTO public.user_spaces (space_id, user_id, is_admin)
  VALUES (p_client_space_id, v_uid, true)
  ON CONFLICT (space_id, user_id) DO UPDATE SET is_admin = true;

  RETURN QUERY SELECT p_client_space_id, v_firm_space_id;
END;
$$;

--------------------------------------------------------------------------------
-- 9) firm_create_client_on_behalf, pending order, invitee_only
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.firm_create_client_on_behalf(
  p_firm_space_id uuid,
  p_client_name text,
  p_contact_name text,
  p_contact_email text,
  p_sku_id uuid DEFAULT NULL,
  p_create_invitation boolean DEFAULT true
)
RETURNS TABLE (
  out_client_space_id uuid,
  out_invitation_id uuid,
  out_space_name text,
  out_invitee_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
#variable_conflict use_column
DECLARE
  v_caller_id uuid;
  v_space_name text;
  v_client_space_id uuid;
  v_invitation_id uuid;
  v_inviter_email text;
  v_inviter_name text;
  v_now timestamptz := now();
  v_normalized_name text;
  v_existing_space_id uuid;
  v_existing_invitation_id uuid;
  v_created_contact_name text := NULLIF(TRIM(p_contact_name), '');
  v_created_contact_email text := NULLIF(LOWER(TRIM(p_contact_email)), '');
  v_client_pk uuid;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.space_id = p_firm_space_id AND us.user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Only firm members can create clients on behalf';
  END IF;

  v_space_name := COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, 'Client Space');
  v_normalized_name := LOWER(v_space_name);
  IF v_created_contact_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required';
  END IF;

  SELECT c.client_space_id INTO v_existing_space_id
  FROM firm.clients c
  JOIN public.spaces s ON s.id = c.client_space_id AND s.kind = 'client'
  WHERE c.firm_space_id = p_firm_space_id
    AND LOWER(TRIM(COALESCE(s.name, ''))) = v_normalized_name
  ORDER BY
    CASE WHEN EXISTS (
      SELECT 1 FROM public.space_invitations si
      WHERE si.space_id = c.client_space_id
        AND si.invitee_email = v_created_contact_email
        AND si.status = 'pending'
    ) THEN 0 ELSE 1 END,
    (SELECT COUNT(*) FROM public.user_spaces us WHERE us.space_id = c.client_space_id) ASC,
    c.created_at DESC
  LIMIT 1;

  IF v_existing_space_id IS NOT NULL THEN
    v_client_space_id := v_existing_space_id;
    UPDATE public.spaces SET name = v_space_name WHERE id = v_client_space_id;
    UPDATE firm.clients SET updated_at = v_now
    WHERE firm.clients.firm_space_id = p_firm_space_id AND firm.clients.client_space_id = v_client_space_id;
  ELSE
    INSERT INTO public.spaces (name, address, kind)
    VALUES (v_space_name, NULL, 'client')
    RETURNING id INTO v_client_space_id;

    INSERT INTO firm.clients (firm_space_id, client_space_id)
    VALUES (p_firm_space_id, v_client_space_id)
    ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key
    DO UPDATE SET updated_at = v_now;
  END IF;

  SELECT c.id INTO v_client_pk
  FROM firm.clients c
  WHERE c.firm_space_id = p_firm_space_id AND c.client_space_id = v_client_space_id
  LIMIT 1;

  PERFORM firm.link_client_to_user_groups(p_firm_space_id, v_client_pk, v_caller_id);

  INSERT INTO firm.invitee_clients (
    firm_space_id,
    invitee_email,
    invitee_client_name,
    invitee_contact_name
  )
  VALUES (
    p_firm_space_id,
    v_created_contact_email,
    COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, v_space_name),
    v_created_contact_name
  )
  ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET
    invitee_client_name   = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
    invitee_contact_name  = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
    updated_at            = v_now;

  IF p_sku_id IS NOT NULL THEN
    INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by)
    VALUES (p_firm_space_id, v_client_space_id, p_sku_id, 'onboarding', NULL, v_now, v_now, v_caller_id)
    ON CONFLICT (firm_space_id, client_space_id, sku_id, status) DO NOTHING;
  END IF;

  SELECT u.name, COALESCE(u.email, (SELECT email FROM auth.users WHERE id = v_caller_id LIMIT 1))
  INTO v_inviter_name, v_inviter_email
  FROM public.users u
  WHERE u.id = v_caller_id
  LIMIT 1;
  v_inviter_email := COALESCE(v_inviter_email, '');
  v_inviter_name  := NULLIF(TRIM(v_inviter_name), '');

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'space_invitations') THEN
    SELECT si.id INTO v_existing_invitation_id
    FROM public.space_invitations si
    WHERE si.space_id = v_client_space_id
      AND si.invitee_email = v_created_contact_email
      AND si.status = 'pending'
    ORDER BY si.created_at DESC
    LIMIT 1;

    IF v_existing_invitation_id IS NOT NULL THEN
      v_invitation_id := v_existing_invitation_id;
    ELSIF p_create_invitation THEN
      INSERT INTO public.space_invitations (
        space_id, inviter_id, inviter_email, invitee_email, space_name, status, created_at, invite_as_admin, inviter_name
      )
      VALUES (
        v_client_space_id, v_caller_id, v_inviter_email, v_created_contact_email, v_space_name,
        'pending', v_now, true, v_inviter_name
      )
      RETURNING id INTO v_invitation_id;
    ELSE
      v_invitation_id := NULL;
    END IF;
  ELSE
    v_invitation_id := NULL;
  END IF;

  RETURN QUERY SELECT v_client_space_id, v_invitation_id, v_space_name, v_created_contact_email;
END;
$$;

CREATE OR REPLACE FUNCTION public.firm_create_pending_order_for_invitee(
  p_firm_space_id uuid,
  p_client_name   text,
  p_contact_name  text,
  p_contact_email text,
  p_sku_id        uuid
)
RETURNS TABLE (
  out_order_id          uuid,
  out_firm_space_id      uuid,
  out_invitee_client_id uuid,
  out_invitee_email     text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
#variable_conflict use_column
DECLARE
  v_caller_id uuid;
  v_client_name   text;
  v_contact_name  text;
  v_contact_email text;
  v_invitee_id    uuid;
  v_now           timestamptz := now();
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.space_id = p_firm_space_id AND us.user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Only firm members can create pending orders';
  END IF;

  v_client_name   := NULLIF(TRIM(p_client_name), '');
  v_contact_name  := NULLIF(TRIM(p_contact_name), '');
  v_contact_email := NULLIF(LOWER(TRIM(p_contact_email)), '');

  IF v_contact_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required for pending orders';
  END IF;

  INSERT INTO firm.invitee_clients (
    firm_space_id,
    invitee_email,
    invitee_client_name,
    invitee_contact_name
  )
  VALUES (
    p_firm_space_id,
    v_contact_email,
    COALESCE(v_client_name, v_contact_name, 'Client'),
    v_contact_name
  )
  ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET
    invitee_client_name   = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
    invitee_contact_name  = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
    updated_at            = v_now;

  SELECT id INTO v_invitee_id
  FROM firm.invitee_clients ic
  WHERE ic.firm_space_id = p_firm_space_id AND ic.invitee_email = v_contact_email
  LIMIT 1;

  PERFORM firm.link_invitee_to_user_groups(p_firm_space_id, v_invitee_id, v_caller_id);

  INSERT INTO firm.orders (
    firm_space_id,
    client_space_id,
    sku_id,
    status,
    due_at,
    created_at,
    updated_at,
    created_by,
    invitee_client_id
  )
  VALUES (
    p_firm_space_id,
    NULL,
    p_sku_id,
    'onboarding',
    NULL,
    v_now,
    v_now,
    v_caller_id,
    v_invitee_id
  );

  RETURN QUERY
  SELECT o.id, p_firm_space_id, v_invitee_id, v_contact_email
  FROM firm.orders o
  WHERE o.firm_space_id = p_firm_space_id
    AND o.invitee_client_id = v_invitee_id
    AND o.client_space_id IS NULL
  ORDER BY o.created_at DESC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.firm_create_invitee_only(
  p_firm_space_id   UUID,
  p_client_name    TEXT,
  p_contact_name   TEXT,
  p_contact_email  TEXT
)
RETURNS TABLE (invitee_client_id UUID, invitee_email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id UUID;
  v_contact_email TEXT;
  v_now TIMESTAMPTZ := now();
  v_invitee_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.space_id = p_firm_space_id AND us.user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Only firm members can add invitees';
  END IF;

  v_contact_email := NULLIF(LOWER(TRIM(COALESCE(p_contact_email, ''))), '');
  IF v_contact_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required';
  END IF;

  INSERT INTO firm.invitee_clients (
    firm_space_id,
    invitee_email,
    invitee_client_name,
    invitee_contact_name
  )
  VALUES (
    p_firm_space_id,
    v_contact_email,
    COALESCE(NULLIF(TRIM(p_client_name), ''), NULLIF(TRIM(p_contact_name), ''), 'Client'),
    NULLIF(TRIM(COALESCE(p_contact_name, '')), '')
  )
  ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET
    invitee_client_name   = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name),
    invitee_contact_name  = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name),
    updated_at            = v_now;

  SELECT ic.id INTO v_invitee_id
  FROM firm.invitee_clients ic
  WHERE ic.firm_space_id = p_firm_space_id AND ic.invitee_email = v_contact_email
  LIMIT 1;

  PERFORM firm.link_invitee_to_user_groups(p_firm_space_id, v_invitee_id, v_caller_id);

  RETURN QUERY
  SELECT ic.id, ic.invitee_email
  FROM firm.invitee_clients ic
  WHERE ic.firm_space_id = p_firm_space_id AND ic.invitee_email = v_contact_email
  LIMIT 1;
END;
$$;

--------------------------------------------------------------------------------
-- 10) New firm registration: bootstrap Admin group
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_space_with_user(
  p_space_name TEXT,
  p_space_address TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_kind TEXT DEFAULT 'client',
  p_firm_verification_url TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_user_id UUID;
  v_space_id UUID;
  v_kind TEXT;
  v_verification_url TEXT;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_kind := COALESCE(NULLIF(TRIM(LOWER(p_kind)), ''), 'client');
  IF v_kind NOT IN ('client', 'firm') THEN
    RAISE EXCEPTION 'kind must be client or firm';
  END IF;

  IF v_kind = 'firm' THEN
    IF p_firm_verification_url IS NULL OR TRIM(p_firm_verification_url) = '' THEN
      RAISE EXCEPTION 'Firm registration requires verification attachment URL';
    END IF;
    v_verification_url := TRIM(p_firm_verification_url);
  ELSE
    v_verification_url := NULL;
  END IF;

  INSERT INTO public.spaces (name, address, kind)
  VALUES (
    p_space_name,
    NULLIF(TRIM(p_space_address), ''),
    v_kind
  )
  RETURNING id INTO v_space_id;

  IF v_kind = 'firm' THEN
    INSERT INTO firm.firms (space_id, status, verification_attachment_url)
    VALUES (v_space_id, 'pending', v_verification_url);
  END IF;

  INSERT INTO public.user_spaces (user_id, space_id, is_admin)
  VALUES (v_user_id, v_space_id, true)
  ON CONFLICT DO NOTHING;

  UPDATE public.users
  SET current_space_id = v_space_id
  WHERE id = v_user_id;

  IF v_kind = 'firm' THEN
    PERFORM firm.apply_preset_skus_to_firm(v_space_id);
    PERFORM public.firm_bootstrap_admin_group(v_space_id, v_user_id);
  END IF;

  RETURN v_space_id;
END;
$$;

--------------------------------------------------------------------------------
-- 11) Realtime: group_clients
--------------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'firm' AND tablename = 'group_clients'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE firm.group_clients;
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 12) When a user becomes firm admin, add them to the Admin group
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION firm.on_user_spaces_promote_firm_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
BEGIN
  IF NEW.is_admin IS TRUE AND (TG_OP = 'INSERT' OR COALESCE(OLD.is_admin, false) IS DISTINCT FROM true) THEN
    IF EXISTS (SELECT 1 FROM public.spaces s WHERE s.id = NEW.space_id AND s.kind = 'firm') THEN
      INSERT INTO firm.group_members (group_id, user_id)
      SELECT g.id, NEW.user_id
      FROM firm.groups g
      WHERE g.firm_space_id = NEW.space_id AND g.is_system_admin = true
      LIMIT 1
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_user_spaces_promote_firm_admin ON public.user_spaces;
CREATE TRIGGER tr_user_spaces_promote_firm_admin
  AFTER INSERT OR UPDATE OF is_admin ON public.user_spaces
  FOR EACH ROW
  EXECUTE FUNCTION firm.on_user_spaces_promote_firm_admin();
