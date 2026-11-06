-- An invite link must be able to preview its SKU before the visitor has an account.
-- The previous check returned false whenever auth.uid() was null, so the template never appeared.

CREATE OR REPLACE FUNCTION provider._consumer_can_preview_sku(
  p_sku_id uuid,
  p_consumer_id uuid,
  p_invite_token text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'provider', 'consumer'
AS $function$
DECLARE
  v_uid uuid;
  v_email text;
  v_provider_space_id uuid;
BEGIN
  IF p_sku_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT s.provider_space_id INTO v_provider_space_id FROM provider.skus s WHERE s.id = p_sku_id;
  IF v_provider_space_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_invite_token IS NOT NULL AND length(trim(p_invite_token)) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM provider.consumer_invite_tokens t
      WHERE t.token = trim(p_invite_token)
        AND (t.is_active IS NULL OR t.is_active = true)
        AND (t.expires_at IS NULL OR t.expires_at > now())
        AND t.sku_id = p_sku_id
        AND t.provider_space_id = v_provider_space_id
    ) THEN
      RETURN true;
    END IF;
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_spaces us
    WHERE us.user_id = v_uid AND us.space_id = v_provider_space_id
  ) THEN
    RETURN true;
  END IF;

  SELECT LOWER(TRIM(COALESCE(u.email, ''))) INTO v_email
  FROM public.users u
  WHERE u.id = v_uid
  LIMIT 1;

  IF p_consumer_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM provider.consumers c
      INNER JOIN provider.orders o ON o.consumer_id = c.id AND o.provider_space_id = c.provider_space_id
      WHERE c.id = p_consumer_id
        AND c.consumer_space_id IS NULL
        AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = LOWER(TRIM(COALESCE(v_email, '')))
        AND o.sku_id = p_sku_id
        AND o.consumer_space_id IS NULL
    ) THEN
      RETURN true;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM provider.consumers c
      INNER JOIN public.user_spaces us ON us.space_id = c.consumer_space_id AND us.user_id = v_uid
      INNER JOIN provider.orders o ON o.consumer_id = c.id AND o.provider_space_id = c.provider_space_id
      WHERE c.id = p_consumer_id
        AND c.consumer_space_id IS NOT NULL
        AND o.sku_id = p_sku_id
    ) THEN
      RETURN true;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM provider.orders o
    WHERE o.sku_id = p_sku_id
      AND o.provider_space_id = v_provider_space_id
      AND provider.auth_user_can_select_order(o.id)
  ) THEN
    RETURN true;
  END IF;

  IF length(trim(COALESCE(v_email, ''))) > 0 AND EXISTS (
    SELECT 1
    FROM provider.consumers c
    INNER JOIN provider.orders o ON o.consumer_id = c.id AND o.provider_space_id = c.provider_space_id
    WHERE c.provider_space_id = v_provider_space_id
      AND LOWER(TRIM(COALESCE(c.invitee_email, ''))) = LOWER(TRIM(COALESCE(v_email, '')))
      AND o.sku_id = p_sku_id
      AND (
        (c.consumer_space_id IS NULL AND o.consumer_space_id IS NULL)
        OR (
          o.consumer_space_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.user_spaces us2
            WHERE us2.user_id = v_uid AND us2.space_id = o.consumer_space_id
          )
        )
      )
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;
