BEGIN;

SET search_path = public, crm, firm;

CREATE SCHEMA IF NOT EXISTS crm;

-- 1) Client space type: household/business (legacy apps default to household)
ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS client_profile_type TEXT;

UPDATE public.spaces
SET client_profile_type = 'household'
WHERE client_profile_type IS NULL;

ALTER TABLE public.spaces
  ALTER COLUMN client_profile_type SET DEFAULT 'household';

ALTER TABLE public.spaces
  ALTER COLUMN client_profile_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'spaces_client_profile_type_check'
      AND conrelid = 'public.spaces'::regclass
  ) THEN
    ALTER TABLE public.spaces
      ADD CONSTRAINT spaces_client_profile_type_check
      CHECK (client_profile_type IN ('household', 'business'));
  END IF;
END $$;

-- 2) CRM preset tables for client tag bootstrap
CREATE TABLE IF NOT EXISTS crm.preset_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_for TEXT NOT NULL CHECK (preset_for IN ('household', 'business')),
  scope TEXT NOT NULL CHECK (scope IN ('expense', 'income')),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#95A5A6',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm.preset_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_for TEXT NOT NULL CHECK (preset_for IN ('household', 'business')),
  scope TEXT NOT NULL CHECK (scope IN ('expense', 'income')),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#95A5A6',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_preset_categories_name
  ON crm.preset_categories (preset_for, scope, name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_preset_attributions_name
  ON crm.preset_attributions (preset_for, scope, name);

CREATE INDEX IF NOT EXISTS idx_crm_preset_categories_lookup
  ON crm.preset_categories (preset_for, scope, sort_order, name);

CREATE INDEX IF NOT EXISTS idx_crm_preset_attributions_lookup
  ON crm.preset_attributions (preset_for, scope, sort_order, name);

-- Seed presets (replace previous defaults with product-approved values)
DELETE FROM crm.preset_categories
WHERE preset_for IN ('household', 'business');

DELETE FROM crm.preset_attributions
WHERE preset_for IN ('household', 'business');

INSERT INTO crm.preset_categories (preset_for, scope, name, color, sort_order)
VALUES
  -- household expense categories
  ('household', 'expense', '🏠 Home', '#F47C7C', 1),
  ('household', 'expense', '🛒 Groceries', '#5DC8B4', 2),
  ('household', 'expense', '🍟 Dining', '#37B9DC', 3),
  ('household', 'expense', '🚗 Trans', '#F7A87A', 4),
  ('household', 'expense', '🎓 Education', '#A8E0C4', 5),
  ('household', 'expense', '👕 Life', '#FBF177', 6),
  ('household', 'expense', '🎉 Fun', '#B494DA', 7),
  ('household', 'expense', '💊 Health', '#F0A093', 8),
  ('household', 'expense', '🎁 Gift', '#A3D8F5', 9),
  ('household', 'expense', '❓ Misc', '#87E09A', 10),
  -- household income categories
  ('household', 'income', '💵 Salary', '#F47C7C', 1),
  ('household', 'income', '🏆 Bonus', '#5DC8B4', 2),
  ('household', 'income', '💌 Benefit', '#37B9DC', 3),
  ('household', 'income', '🧮 Asset', '#F7A87A', 4),
  ('household', 'income', '🎁 Gift', '#A8E0C4', 5),
  ('household', 'income', '💰 Return', '#FBF177', 6),
  -- business expense categories
  ('business', 'expense', '📢 Advertising', '#F47C7C', 1),
  ('business', 'expense', '🥂 Meals', '#5DC8B4', 2),
  ('business', 'expense', '📎 Office', '#37B9DC', 3),
  ('business', 'expense', '⚖ Pro Fees', '#F7A87A', 4),
  ('business', 'expense', '✈ Travel', '#A8E0C4', 5),
  ('business', 'expense', '⚓ Insurance', '#FBF177', 6),
  ('business', 'expense', '🔋 Utilities', '#B494DA', 7),
  ('business', 'expense', '🚙 Auto', '#F0A093', 8),
  ('business', 'expense', '🛠 Maintenance', '#A3D8F5', 9),
  ('business', 'expense', '🛋 Home Office', '#87E09A', 10),
  -- business income categories
  ('business', 'income', '🧭 Services', '#F47C7C', 1),
  ('business', 'income', '📦 Sales', '#5DC8B4', 2),
  ('business', 'income', '💸 Grants', '#37B9DC', 3),
  ('business', 'income', '📈 Interest', '#F7A87A', 4),
  ('business', 'income', '💰 Refund', '#A8E0C4', 5)
ON CONFLICT (preset_for, scope, name) DO NOTHING;

INSERT INTO crm.preset_attributions (preset_for, scope, name, color, sort_order)
VALUES
  -- household expense attributions
  ('household', 'expense', '🛟 Needs', '#F47C7C', 1),
  ('household', 'expense', '✨ Wants', '#5DC8B4', 2),
  ('household', 'expense', '📆 Fixed', '#37B9DC', 3),
  ('household', 'expense', '🎲 Misc', '#F7A87A', 4),
  -- household income attributions
  ('household', 'income', '♟ Active', '#F47C7C', 1),
  ('household', 'income', '🏖 Passive', '#5DC8B4', 2),
  ('household', 'income', '🎰 One-off', '#37B9DC', 3),
  -- business expense attributions
  ('business', 'expense', '🏢 Business', '#F47C7C', 1),
  ('business', 'expense', '🎨 Split', '#5DC8B4', 2),
  ('business', 'expense', '🫆 Personal', '#37B9DC', 3),
  ('business', 'expense', '💻 Asset', '#F7A87A', 4),
  -- business income attributions
  ('business', 'income', '🧾 Taxable', '#F47C7C', 1),
  ('business', 'income', '🌐 Export', '#5DC8B4', 2),
  ('business', 'income', '🧰 Exempt', '#37B9DC', 3),
  ('business', 'income', '🪙 Equity', '#F7A87A', 4),
  ('business', 'income', '⏳ A/R', '#A8E0C4', 5)
ON CONFLICT (preset_for, scope, name) DO NOTHING;

-- 3) Copy CRM presets to newly-created client spaces
CREATE OR REPLACE FUNCTION crm.apply_client_tag_presets_to_space(
  p_space_id UUID,
  p_space_type TEXT DEFAULT 'household'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $$
DECLARE
  v_space_type TEXT;
BEGIN
  IF p_space_id IS NULL THEN
    RAISE EXCEPTION 'space_id is required';
  END IF;

  v_space_type := COALESCE(NULLIF(lower(trim(p_space_type)), ''), 'household');
  IF v_space_type NOT IN ('household', 'business') THEN
    RAISE EXCEPTION 'space_type must be household or business';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.spaces s
    WHERE s.id = p_space_id
      AND s.kind = 'client'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.categories (space_id, name, color, is_default, scope)
  SELECT
    p_space_id,
    pc.name,
    pc.color,
    false,
    pc.scope
  FROM crm.preset_categories pc
  WHERE pc.preset_for = v_space_type
    AND pc.is_active = true
  ORDER BY pc.scope, pc.sort_order, pc.name
  ON CONFLICT DO NOTHING;

  INSERT INTO public.attributions (space_id, name, color, is_default, scope)
  SELECT
    p_space_id,
    pa.name,
    pa.color,
    false,
    pa.scope
  FROM crm.preset_attributions pa
  WHERE pa.preset_for = v_space_type
    AND pa.is_active = true
  ORDER BY pa.scope, pa.sort_order, pa.name
  ON CONFLICT DO NOTHING;
END;
$$;

-- Keep legacy function name for app-side fallback.
-- IMPORTANT: Drop both old signatures first, so old app (1 param) won't hit stale logic.
DROP FUNCTION IF EXISTS public.seed_default_categories_purposes_for_space(UUID);
DROP FUNCTION IF EXISTS public.seed_default_categories_purposes_for_space(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.seed_default_categories_purposes_for_space(
  p_space_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $$
BEGIN
  PERFORM crm.apply_client_tag_presets_to_space(p_space_id, 'household');
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_default_categories_purposes_for_space(
  p_space_id UUID,
  p_space_type TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $$
BEGIN
  PERFORM crm.apply_client_tag_presets_to_space(p_space_id, p_space_type);
END;
$$;

COMMENT ON FUNCTION public.seed_default_categories_purposes_for_space(UUID, TEXT) IS
  'Seed client categories/attributions from crm preset tables by space type (household/business).';

DROP FUNCTION IF EXISTS public.create_space_with_user(TEXT, TEXT, UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.create_space_with_user(
  p_space_name TEXT,
  p_space_address TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_kind TEXT DEFAULT 'client',
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

  v_kind := COALESCE(NULLIF(TRIM(LOWER(p_kind)), ''), 'client');
  IF v_kind NOT IN ('client', 'firm') THEN
    RAISE EXCEPTION 'kind must be client or firm';
  END IF;

  v_client_profile_type := COALESCE(NULLIF(TRIM(LOWER(p_client_profile_type)), ''), 'household');
  IF v_client_profile_type NOT IN ('household', 'business') THEN
    RAISE EXCEPTION 'client_profile_type must be household or business';
  END IF;

  IF v_kind = 'firm' THEN
    IF p_firm_verification_url IS NULL OR TRIM(p_firm_verification_url) = '' THEN
      RAISE EXCEPTION 'Firm registration requires verification attachment URL';
    END IF;
    v_verification_url := TRIM(p_firm_verification_url);
  ELSE
    v_verification_url := NULL;
  END IF;

  INSERT INTO public.spaces (name, address, kind, client_profile_type)
  VALUES (
    p_space_name,
    NULLIF(TRIM(p_space_address), ''),
    v_kind,
    CASE WHEN v_kind = 'client' THEN v_client_profile_type ELSE 'household' END
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
  ELSE
    PERFORM crm.apply_client_tag_presets_to_space(v_space_id, v_client_profile_type);
  END IF;

  RETURN v_space_id;
END;
$$;

COMMENT ON FUNCTION public.create_space_with_user(TEXT, TEXT, UUID, TEXT, TEXT, TEXT) IS
  'Create space + membership + current_space. Firm creates firm row and SKU presets; client copies category/attribution presets by household/business profile.';

COMMIT;
