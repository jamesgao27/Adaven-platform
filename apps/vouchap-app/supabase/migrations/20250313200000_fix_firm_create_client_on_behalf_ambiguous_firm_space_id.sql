-- Fix: column reference "firm_space_id" is ambiguous (PL/pgSQL output/table column).
-- Return type changed to out_* columns, so we must DROP before CREATE.

SET search_path = public, firm;

DROP FUNCTION IF EXISTS public.firm_create_client_on_behalf(uuid, text, text, text, uuid, boolean);
DROP FUNCTION IF EXISTS public.firm_create_client_on_behalf(uuid, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.firm_create_client_on_behalf(
  p_firm_space_id UUID,
  p_client_name TEXT,
  p_contact_name TEXT,
  p_contact_email TEXT,
  p_sku_id UUID DEFAULT NULL,
  p_create_invitation BOOLEAN DEFAULT true
)
RETURNS TABLE (
  out_client_space_id UUID,
  out_invitation_id UUID,
  out_space_name TEXT,
  out_invitee_email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id UUID;
  v_space_name TEXT;
  v_client_space_id UUID;
  v_invitation_id UUID;
  v_inviter_email TEXT;
  v_inviter_name TEXT;
  v_now TIMESTAMPTZ := now();
  v_normalized_name TEXT;
  v_existing_space_id UUID;
  v_existing_invitation_id UUID;
  v_created_contact_name TEXT := NULLIF(TRIM(p_contact_name), '');
  v_created_contact_email TEXT := NULLIF(LOWER(TRIM(COALESCE(p_contact_email, ''))), '');
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

  IF COALESCE(p_create_invitation, true) AND v_created_contact_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required when sending an invite';
  END IF;

  v_space_name := COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, 'Client Space');
  v_normalized_name := LOWER(v_space_name);

  SELECT c.client_space_id INTO v_existing_space_id
  FROM firm.clients c
  JOIN public.spaces s ON s.id = c.client_space_id AND s.kind = 'client'
  WHERE c.firm_space_id = p_firm_space_id
    AND LOWER(TRIM(COALESCE(c.created_client_name, ''))) = v_normalized_name
  ORDER BY
    CASE WHEN v_created_contact_email IS NOT NULL AND EXISTS (
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

    UPDATE firm.clients
    SET created_client_name = COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, created_client_name),
        created_contact_name = COALESCE(v_created_contact_name, created_contact_name),
        created_contact_email = COALESCE(v_created_contact_email, created_contact_email),
        updated_at = v_now
    WHERE firm.clients.firm_space_id = p_firm_space_id AND firm.clients.client_space_id = v_client_space_id;

    EXECUTE 'INSERT INTO firm.member_clients (firm_space_id, user_id, client_space_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT ON CONSTRAINT member_clients_firm_space_id_user_id_client_space_id_key DO NOTHING'
      USING p_firm_space_id, v_caller_id, v_client_space_id, v_now;

    IF p_sku_id IS NOT NULL THEN
      EXECUTE 'INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT ON CONSTRAINT firm_orders_unique_active_per_sku DO NOTHING'
        USING p_firm_space_id, v_client_space_id, p_sku_id, 'onboarding', NULL, v_now, v_now, v_caller_id;
    END IF;
  ELSE
    INSERT INTO public.spaces (name, address, kind)
    VALUES (v_space_name, NULL, 'client')
    RETURNING id INTO v_client_space_id;

    EXECUTE 'INSERT INTO firm.clients (firm_space_id, client_space_id, status, created_client_name, created_contact_name, created_contact_email) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key DO UPDATE SET created_client_name = COALESCE(NULLIF(TRIM(EXCLUDED.created_client_name), ''''), firm.clients.created_client_name), created_contact_name = COALESCE(EXCLUDED.created_contact_name, firm.clients.created_contact_name), created_contact_email = COALESCE(EXCLUDED.created_contact_email, firm.clients.created_contact_email), status = ''active'', updated_at = $7'
      USING p_firm_space_id, v_client_space_id, 'active', COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, v_space_name), v_created_contact_name, v_created_contact_email, v_now;

    EXECUTE 'INSERT INTO firm.member_clients (firm_space_id, user_id, client_space_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT ON CONSTRAINT member_clients_firm_space_id_user_id_client_space_id_key DO NOTHING'
      USING p_firm_space_id, v_caller_id, v_client_space_id, v_now;

    IF p_sku_id IS NOT NULL THEN
      EXECUTE 'INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)'
        USING p_firm_space_id, v_client_space_id, p_sku_id, 'onboarding', NULL, v_now, v_now, v_caller_id;
    END IF;
  END IF;

  v_invitation_id := NULL;
  IF COALESCE(p_create_invitation, true) AND v_created_contact_email IS NOT NULL THEN
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
      ELSE
        INSERT INTO public.space_invitations (
          space_id, inviter_id, inviter_email, invitee_email, space_name, status, created_at, invite_as_admin, inviter_name
        )
        VALUES (
          v_client_space_id, v_caller_id, v_inviter_email, v_created_contact_email, v_space_name,
          'pending', v_now, true, v_inviter_name
        )
        RETURNING id INTO v_invitation_id;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT v_client_space_id, v_invitation_id, v_space_name, COALESCE(v_created_contact_email, '');
END;
$$;

-- RPC returns out_* columns to avoid PL/pgSQL ambiguity with table columns; frontend maps to client_space_id etc.

COMMENT ON FUNCTION public.firm_create_client_on_behalf(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN) IS
  'Firm 代建 client：可选 p_create_invitation=false 仅创建 space/client/order 不创建邀请；true 时需 contact_email 并创建 space_invitation。修复 firm_space_id 歧义。';

--------------------------------------------------------------------------------
-- 2) 5-parameter overload (used when RPC is invoked with 5 args or extra param ignored)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.firm_create_client_on_behalf(
  p_firm_space_id UUID,
  p_client_name TEXT,
  p_contact_name TEXT,
  p_contact_email TEXT,
  p_sku_id UUID DEFAULT NULL
)
RETURNS TABLE (
  out_client_space_id UUID,
  out_invitation_id UUID,
  out_space_name TEXT,
  out_invitee_email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id UUID;
  v_space_name TEXT;
  v_client_space_id UUID;
  v_invitation_id UUID;
  v_inviter_email TEXT;
  v_inviter_name TEXT;
  v_now TIMESTAMPTZ := now();
  v_normalized_name TEXT;
  v_existing_space_id UUID;
  v_existing_invitation_id UUID;
  v_created_contact_name TEXT := NULLIF(TRIM(p_contact_name), '');
  v_created_contact_email TEXT := NULLIF(LOWER(TRIM(p_contact_email)), '');
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
    AND LOWER(TRIM(COALESCE(c.created_client_name, ''))) = v_normalized_name
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

    UPDATE firm.clients
    SET created_client_name = COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, created_client_name),
        created_contact_name = COALESCE(v_created_contact_name, created_contact_name),
        created_contact_email = COALESCE(v_created_contact_email, created_contact_email),
        updated_at = v_now
    WHERE firm.clients.firm_space_id = p_firm_space_id AND firm.clients.client_space_id = v_client_space_id;
  ELSE
    INSERT INTO public.spaces (name, address, kind)
    VALUES (v_space_name, NULL, 'client')
    RETURNING id INTO v_client_space_id;

    EXECUTE 'INSERT INTO firm.clients (firm_space_id, client_space_id, status, created_client_name, created_contact_name, created_contact_email) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT ON CONSTRAINT clients_firm_space_id_client_space_id_key DO UPDATE SET created_client_name = COALESCE(NULLIF(TRIM(EXCLUDED.created_client_name), ''''), firm.clients.created_client_name), created_contact_name = COALESCE(EXCLUDED.created_contact_name, firm.clients.created_contact_name), created_contact_email = COALESCE(EXCLUDED.created_contact_email, firm.clients.created_contact_email), status = ''active'', updated_at = $7'
      USING p_firm_space_id, v_client_space_id, 'active', COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, v_space_name), v_created_contact_name, v_created_contact_email, v_now;
  END IF;

  EXECUTE 'INSERT INTO firm.invitee_clients (firm_space_id, invitee_email, invitee_client_name, invitee_contact_name, invitee_contact_email) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET invitee_client_name = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name), invitee_contact_name = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name), invitee_contact_email = COALESCE(EXCLUDED.invitee_contact_email, firm.invitee_clients.invitee_contact_email), updated_at = $6'
    USING p_firm_space_id, v_created_contact_email, COALESCE(NULLIF(TRIM(p_client_name), ''), v_created_contact_name, v_space_name), v_created_contact_name, v_created_contact_email, v_now;

  SELECT id INTO v_invitee_id
  FROM firm.invitee_clients
  WHERE firm.invitee_clients.firm_space_id = p_firm_space_id
    AND firm.invitee_clients.invitee_email = v_created_contact_email
  LIMIT 1;

  EXECUTE 'INSERT INTO firm.member_clients (firm_space_id, user_id, client_space_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT ON CONSTRAINT member_clients_firm_space_id_user_id_client_space_id_key DO NOTHING'
    USING p_firm_space_id, v_caller_id, v_client_space_id, v_now;

  IF p_sku_id IS NOT NULL THEN
    EXECUTE 'INSERT INTO firm.orders (firm_space_id, client_space_id, sku_id, status, due_at, created_at, updated_at, created_by, invitee_client_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT ON CONSTRAINT firm_orders_unique_active_per_sku DO NOTHING'
      USING p_firm_space_id, v_client_space_id, p_sku_id, 'onboarding', NULL, v_now, v_now, v_caller_id, v_invitee_id;
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
    ELSE
      INSERT INTO public.space_invitations (
        space_id, inviter_id, inviter_email, invitee_email, space_name, status, created_at, invite_as_admin, inviter_name
      )
      VALUES (
        v_client_space_id, v_caller_id, v_inviter_email, v_created_contact_email, v_space_name,
        'pending', v_now, true, v_inviter_name
      )
      RETURNING id INTO v_invitation_id;
    END IF;
  ELSE
    v_invitation_id := NULL;
  END IF;

  RETURN QUERY SELECT v_client_space_id, v_invitation_id, v_space_name, v_created_contact_email;
END;
$$;

COMMENT ON FUNCTION public.firm_create_client_on_behalf(UUID, TEXT, TEXT, TEXT, UUID) IS
  'Firm 代建 client 空间：同一 firm 同一组织名复用已有 client space；写入 created_client_name/created_contact_* 与 invitee_clients，并为新订单设置 invitee_client_id。返回 out_* 列名避免歧义。';

--------------------------------------------------------------------------------
-- 3) firm_create_pending_order_for_invitee (不代建：仅创建 pending order) 同样存在
--    RETURNS TABLE (firm_space_id, ...) 与 ON CONFLICT (firm_space_id, invitee_email) / RETURNING firm_space_id 歧义，一并修复。
--------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.firm_create_pending_order_for_invitee(uuid, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.firm_create_pending_order_for_invitee(
  p_firm_space_id UUID,
  p_client_name   TEXT,
  p_contact_name  TEXT,
  p_contact_email TEXT,
  p_sku_id        UUID
)
RETURNS TABLE (
  out_order_id         UUID,
  out_firm_space_id    UUID,
  out_invitee_client_id UUID,
  out_invitee_email    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm
AS $$
DECLARE
  v_caller_id UUID;
  v_client_name   TEXT;
  v_contact_name  TEXT;
  v_contact_email TEXT;
  v_invitee_id    UUID;
  v_now           TIMESTAMPTZ := now();
  v_order_id      UUID;
  v_firm_space_id UUID;
  v_invitee_client_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_spaces us
    WHERE us.space_id = p_firm_space_id
      AND us.user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'Only firm members can create pending orders';
  END IF;

  v_client_name   := NULLIF(TRIM(p_client_name), '');
  v_contact_name  := NULLIF(TRIM(p_contact_name), '');
  v_contact_email := NULLIF(LOWER(TRIM(p_contact_email)), '');

  IF v_contact_email IS NULL THEN
    RAISE EXCEPTION 'Contact email is required for pending orders';
  END IF;

  EXECUTE 'INSERT INTO firm.invitee_clients (firm_space_id, invitee_email, invitee_client_name, invitee_contact_name, invitee_contact_email) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (firm_space_id, invitee_email) DO UPDATE SET invitee_client_name = COALESCE(EXCLUDED.invitee_client_name, firm.invitee_clients.invitee_client_name), invitee_contact_name = COALESCE(EXCLUDED.invitee_contact_name, firm.invitee_clients.invitee_contact_name), invitee_contact_email = COALESCE(EXCLUDED.invitee_contact_email, firm.invitee_clients.invitee_contact_email), updated_at = $6'
    USING p_firm_space_id, v_contact_email, COALESCE(v_client_name, v_contact_name, 'Client'), v_contact_name, v_contact_email, v_now;

  SELECT id INTO v_invitee_id
  FROM firm.invitee_clients
  WHERE firm.invitee_clients.firm_space_id = p_firm_space_id
    AND firm.invitee_clients.invitee_email = v_contact_email
  LIMIT 1;

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
  )
  RETURNING id, firm_space_id, invitee_client_id
  INTO v_order_id, v_firm_space_id, v_invitee_client_id;

  out_order_id := v_order_id;
  out_firm_space_id := v_firm_space_id;
  out_invitee_client_id := v_invitee_client_id;
  out_invitee_email := v_contact_email;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.firm_create_pending_order_for_invitee(UUID, TEXT, TEXT, TEXT, UUID) IS
'Firm 迁移模式：为某 invitee 预创建 pending order（写入 firm.orders，client_space_id 为空，仅由 firm 可见），并更新 firm.invitee_clients。返回 out_* 列名避免歧义。';

--------------------------------------------------------------------------------
-- 4) 订单触发器：pending order 的 client_space_id 为 NULL，不写入 client_follow_ups
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION firm.on_order_insert_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, firm
AS $$
BEGIN
  IF NEW.client_space_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM firm.touch_client(NEW.firm_space_id, NEW.client_space_id, NEW.created_at);
  INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
  VALUES (NEW.firm_space_id, NEW.client_space_id, 'Order created', 'order_created', NEW.id, NEW.created_by);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION firm.on_order_update_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, firm
AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.client_space_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM firm.touch_client(NEW.firm_space_id, NEW.client_space_id, NEW.updated_at);
  IF NEW.status = 'completed' THEN
    INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
    VALUES (NEW.firm_space_id, NEW.client_space_id, 'Order completed', 'order_completed', NEW.id, NULL);
  ELSIF NEW.status = 'cancelled' THEN
    INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
    VALUES (NEW.firm_space_id, NEW.client_space_id, 'Order cancelled', 'order_cancelled', NEW.id, NULL);
  ELSIF OLD.status = 'onboarding' AND NEW.status NOT IN ('onboarding', 'cancelled') THEN
    INSERT INTO firm.client_follow_ups (firm_space_id, client_space_id, content, kind, reference_id, created_by)
    VALUES (NEW.firm_space_id, NEW.client_space_id, 'Service started', 'order_started', NEW.id, NULL);
  END IF;
  RETURN NEW;
END;
$$;
