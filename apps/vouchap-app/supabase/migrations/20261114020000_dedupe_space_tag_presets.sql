-- 1) PostgREST fails or picks the wrong overload when both (uuid) and (uuid, text)
--    exist for seed_default_categories_purposes_for_space — client then used to insert
--    a divergent English tag catalog on top of CRM emoji presets.
DROP FUNCTION IF EXISTS public.seed_default_categories_purposes_for_space(uuid);

CREATE OR REPLACE FUNCTION public.seed_default_categories_purposes_for_space(
  p_space_id uuid,
  p_space_type text DEFAULT 'household'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'crm'
AS $$
BEGIN
  PERFORM crm.apply_consumer_tag_presets_to_space(p_space_id, p_space_type);
END;
$$;

COMMENT ON FUNCTION public.seed_default_categories_purposes_for_space(uuid, text) IS
  'Seed consumer categories/attributions from crm.preset_* by household/business. Single signature for PostgREST.';

GRANT EXECUTE ON FUNCTION public.seed_default_categories_purposes_for_space(uuid, text)
  TO authenticated, service_role;

-- 2) Delete unused leftover tags that are not in the space's profile preset catalog
--    (legacy English app fallback / wrong-profile seed). Keep user-created or in-use rows.
DELETE FROM public.categories c
USING public.spaces s
WHERE c.space_id = s.id
  AND s.kind = 'consumer'
  AND s.created_at >= '2026-11-11'::timestamptz
  AND NOT EXISTS (
    SELECT 1
    FROM crm.preset_categories pc
    WHERE pc.is_active = true
      AND pc.preset_for = COALESCE(s.client_profile_type, 'household')
      AND pc.name = c.name
      AND pc.scope = c.scope
  )
  AND NOT EXISTS (SELECT 1 FROM public.receipt_items ri WHERE ri.category_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.invoice_items ii WHERE ii.category_id = c.id);

DELETE FROM public.attributions a
USING public.spaces s
WHERE a.space_id = s.id
  AND s.kind = 'consumer'
  AND s.created_at >= '2026-11-11'::timestamptz
  AND NOT EXISTS (
    SELECT 1
    FROM crm.preset_attributions pa
    WHERE pa.is_active = true
      AND pa.preset_for = COALESCE(s.client_profile_type, 'household')
      AND pa.name = a.name
      AND pa.scope = a.scope
  )
  AND NOT EXISTS (SELECT 1 FROM public.receipt_items ri WHERE ri.attribution_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM public.invoice_items ii WHERE ii.attribution_id = a.id);

-- 3) Re-apply profile presets so incomplete seeds (e.g. missing 🍟 Dining) are filled.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, COALESCE(client_profile_type, 'household') AS profile_type
    FROM public.spaces
    WHERE kind = 'consumer'
      AND created_at >= '2026-11-11'::timestamptz
  LOOP
    PERFORM crm.apply_consumer_tag_presets_to_space(r.id, r.profile_type);
  END LOOP;
END $$;
