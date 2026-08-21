-- Platform kernel: create space + membership only.
-- No CRM trial, Firm SKU, or category seeds. Vouchap keeps create_space_with_user as the product wrapper.

CREATE OR REPLACE FUNCTION public.create_space_core(
  p_space_name TEXT,
  p_space_address TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_space_id UUID;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.spaces (name, address)
  VALUES (
    p_space_name,
    NULLIF(TRIM(p_space_address), '')
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

COMMENT ON FUNCTION public.create_space_core(TEXT, TEXT, UUID) IS
  'Platform: insert spaces + user_spaces + current_space_id. Product seeds belong in onSpaceCreated / product RPCs.';

GRANT EXECUTE ON FUNCTION public.create_space_core(TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_space_core(TEXT, TEXT, UUID) TO service_role;
