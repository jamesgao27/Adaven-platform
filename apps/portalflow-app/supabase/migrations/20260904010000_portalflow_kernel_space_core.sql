-- Portalflow (new empty Supabase): kernel create_space_core with provider|consumer,
-- product wrapper create_space_with_user calls core then writes firm.* / CRM seeds.
-- Do not apply this on live Vouchap (giuacjbfsyrristkigmz).

DROP FUNCTION IF EXISTS public.create_space_core(TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.create_space_core(TEXT, TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.create_space_core(
  p_space_name TEXT,
  p_space_address TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_kind TEXT DEFAULT 'consumer'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_space_id UUID;
  v_kind TEXT;
  v_email TEXT;
  v_name TEXT;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_kind := COALESCE(NULLIF(TRIM(LOWER(p_kind)), ''), 'consumer');
  IF v_kind NOT IN ('provider', 'consumer') THEN
    RAISE EXCEPTION 'kind must be provider or consumer';
  END IF;

  INSERT INTO public.spaces (name, address, kind)
  VALUES (
    p_space_name,
    NULLIF(TRIM(COALESCE(p_space_address, '')), ''),
    v_kind
  )
  RETURNING id INTO v_space_id;

  SELECT COALESCE(au.email, ''),
         COALESCE(au.raw_user_meta_data->>'name', split_part(COALESCE(au.email, 'user'), '@', 1))
    INTO v_email, v_name
  FROM auth.users au
  WHERE au.id = v_user_id;

  INSERT INTO public.users (id, email, name, current_space_id)
  VALUES (v_user_id, COALESCE(v_email, ''), v_name, v_space_id)
  ON CONFLICT (id) DO UPDATE SET current_space_id = EXCLUDED.current_space_id;

  INSERT INTO public.user_spaces (user_id, space_id, is_admin)
  VALUES (v_user_id, v_space_id, true)
  ON CONFLICT DO NOTHING;

  UPDATE public.users
  SET current_space_id = v_space_id
  WHERE id = v_user_id;

  RETURN v_space_id;
END;
$$;

COMMENT ON FUNCTION public.create_space_core(TEXT, TEXT, UUID, TEXT) IS
  'Kernel: spaces + user_spaces + current_space_id. kind is provider | consumer. Product overlay is create_space_with_user / onSpaceCreated.';

GRANT EXECUTE ON FUNCTION public.create_space_core(TEXT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_space_core(TEXT, TEXT, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.create_space_with_user(
  p_space_name TEXT,
  p_space_address TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_kind TEXT DEFAULT 'consumer',
  p_firm_verification_url TEXT DEFAULT NULL,
  p_client_profile_type TEXT DEFAULT 'household'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, firm, crm
AS $$
DECLARE
  v_user_id UUID;
  v_space_id UUID;
  v_kind TEXT;
  v_verification_url TEXT;
  v_client_profile_type TEXT;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_kind := COALESCE(NULLIF(TRIM(LOWER(p_kind)), ''), 'consumer');
  IF v_kind NOT IN ('consumer', 'provider') THEN
    RAISE EXCEPTION 'kind must be consumer or provider';
  END IF;

  v_client_profile_type := COALESCE(NULLIF(TRIM(LOWER(p_client_profile_type)), ''), 'household');
  IF v_client_profile_type NOT IN ('household', 'business') THEN
    RAISE EXCEPTION 'client_profile_type must be household or business';
  END IF;

  IF v_kind = 'provider' THEN
    IF p_firm_verification_url IS NULL OR TRIM(p_firm_verification_url) = '' THEN
      RAISE EXCEPTION 'Firm registration requires verification attachment URL';
    END IF;
    v_verification_url := TRIM(p_firm_verification_url);
  ELSE
    v_verification_url := NULL;
  END IF;

  v_space_id := public.create_space_core(p_space_name, p_space_address, v_user_id, v_kind);

  UPDATE public.spaces
  SET client_profile_type = CASE
    WHEN v_kind = 'consumer' THEN v_client_profile_type
    ELSE 'household'
  END
  WHERE id = v_space_id;

  IF v_kind = 'provider' THEN
    INSERT INTO firm.firms (space_id, status, verification_attachment_url)
    VALUES (v_space_id, 'pending', v_verification_url);
    PERFORM firm.apply_preset_skus_to_firm(v_space_id);
    PERFORM public.firm_bootstrap_admin_group(v_space_id, v_user_id);
  ELSE
    PERFORM crm.apply_client_tag_presets_to_space(v_space_id, v_client_profile_type);
  END IF;

  RETURN v_space_id;
END;
$$;

COMMENT ON FUNCTION public.create_space_with_user(TEXT, TEXT, UUID, TEXT, TEXT, TEXT) IS
  'Portalflow product wrapper: create_space_core then Firm row / SKU presets or Client CRM presets.';
