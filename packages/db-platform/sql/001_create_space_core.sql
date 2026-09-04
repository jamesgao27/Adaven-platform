-- Generic platform create_space_core (kernel kinds only).
-- Wholestore applies 010_wholestore_provider_consumer.sql which replaces this with a
-- kind-aware version that also inserts provider.providers / consumer.consumers.

DROP FUNCTION IF EXISTS public.create_space_core(TEXT, TEXT, UUID);

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
  'Platform: insert spaces + user_spaces + current_space_id. p_kind is provider | consumer. Product seeds belong in onSpaceCreated / product RPCs.';

GRANT EXECUTE ON FUNCTION public.create_space_core(TEXT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_space_core(TEXT, TEXT, UUID, TEXT) TO service_role;
