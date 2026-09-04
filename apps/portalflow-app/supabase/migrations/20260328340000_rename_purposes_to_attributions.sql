-- Compatibility-first migration:
-- 1) Keep legacy table "purposes" for old app.
-- 2) Create new table "attributions" for new app.
-- 3) Backfill + bi-directional sync to keep IDs/data consistent.
-- 4) Keep existing RPC function name for app compatibility.

BEGIN;

-- Fresh Portalflow baseline never ran the untimestamped scope/usage_count scripts.
ALTER TABLE public.purposes
  ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.purposes
  ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'expense';
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'expense';

CREATE TABLE IF NOT EXISTS public.attributions (LIKE public.purposes INCLUDING ALL);

ALTER TABLE public.attributions
  ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.attributions
  ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'expense';

ALTER TABLE public.attributions ENABLE ROW LEVEL SECURITY;

-- Mirror grants from purposes (roles used by Supabase clients)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attributions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attributions TO authenticated;
GRANT ALL ON TABLE public.attributions TO service_role;

-- Copy existing rows (keep id exactly same as purposes)
INSERT INTO public.attributions
SELECT * FROM public.purposes
ON CONFLICT (id) DO UPDATE
SET
  space_id = EXCLUDED.space_id,
  name = EXCLUDED.name,
  color = EXCLUDED.color,
  is_default = EXCLUDED.is_default,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at,
  usage_count = EXCLUDED.usage_count,
  scope = EXCLUDED.scope;

-- Clone policies from purposes to attributions (best effort, idempotent)
DO $$
DECLARE
  p RECORD;
  stmt TEXT;
BEGIN
  FOR p IN
    SELECT policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'purposes'
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'attributions'
        AND policyname = p.policyname
    ) THEN
      stmt := format(
        'CREATE POLICY %I ON public.attributions AS %s FOR %s TO %s',
        p.policyname,
        CASE WHEN p.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
        p.cmd,
        array_to_string(p.roles, ',')
      );
      IF p.qual IS NOT NULL THEN
        stmt := stmt || format(' USING (%s)', p.qual);
      END IF;
      IF p.with_check IS NOT NULL THEN
        stmt := stmt || format(' WITH CHECK (%s)', p.with_check);
      END IF;
      EXECUTE stmt;
    END IF;
  END LOOP;
END $$;

-- Purposes -> Attributions sync
CREATE OR REPLACE FUNCTION public.sync_purposes_to_attributions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.attributions (id, space_id, name, color, is_default, created_at, updated_at, usage_count, scope)
    VALUES (NEW.id, NEW.space_id, NEW.name, NEW.color, NEW.is_default, NEW.created_at, NEW.updated_at, NEW.usage_count, NEW.scope)
    ON CONFLICT (id) DO UPDATE
    SET space_id = EXCLUDED.space_id,
        name = EXCLUDED.name,
        color = EXCLUDED.color,
        is_default = EXCLUDED.is_default,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        usage_count = EXCLUDED.usage_count,
        scope = EXCLUDED.scope;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.attributions
    SET space_id = NEW.space_id,
        name = NEW.name,
        color = NEW.color,
        is_default = NEW.is_default,
        created_at = NEW.created_at,
        updated_at = NEW.updated_at,
        usage_count = NEW.usage_count,
        scope = NEW.scope
    WHERE id = NEW.id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.attributions WHERE id = OLD.id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_purposes_to_attributions ON public.purposes;
CREATE TRIGGER trg_sync_purposes_to_attributions
AFTER INSERT OR UPDATE OR DELETE ON public.purposes
FOR EACH ROW EXECUTE FUNCTION public.sync_purposes_to_attributions();

-- Attributions -> Purposes sync
CREATE OR REPLACE FUNCTION public.sync_attributions_to_purposes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.purposes (id, space_id, name, color, is_default, created_at, updated_at, usage_count, scope)
    VALUES (NEW.id, NEW.space_id, NEW.name, NEW.color, NEW.is_default, NEW.created_at, NEW.updated_at, NEW.usage_count, NEW.scope)
    ON CONFLICT (id) DO UPDATE
    SET space_id = EXCLUDED.space_id,
        name = EXCLUDED.name,
        color = EXCLUDED.color,
        is_default = EXCLUDED.is_default,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        usage_count = EXCLUDED.usage_count,
        scope = EXCLUDED.scope;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.purposes
    SET space_id = NEW.space_id,
        name = NEW.name,
        color = NEW.color,
        is_default = NEW.is_default,
        created_at = NEW.created_at,
        updated_at = NEW.updated_at,
        usage_count = NEW.usage_count,
        scope = NEW.scope
    WHERE id = NEW.id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.purposes WHERE id = OLD.id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_attributions_to_purposes ON public.attributions;
CREATE TRIGGER trg_sync_attributions_to_purposes
AFTER INSERT OR UPDATE OR DELETE ON public.attributions
FOR EACH ROW EXECUTE FUNCTION public.sync_attributions_to_purposes();

CREATE OR REPLACE FUNCTION seed_default_categories_purposes_for_space(p_space_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  names_arr TEXT[];
  lib TEXT[] := ARRAY['#F47C7C','#5DC8B4','#37B9DC','#F7A87A','#A8E0C4','#FBF177','#B494DA','#F0A093','#A3D8F5','#87E09A'];
  i INT;
  idx INT;
BEGIN
  names_arr := ARRAY['Groceries','Travel','Meal','Housing','Health','Clothing','Education','Entertainment','Software','Utilities','Tax','Refund'];
  FOR i IN 1..array_length(names_arr, 1) LOOP
    idx := ((i - 1) % 10) + 1;
    BEGIN
      INSERT INTO categories (space_id, name, color, is_default, scope)
      VALUES (p_space_id, names_arr[i], lib[idx], false, 'expense');
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;

  names_arr := ARRAY['Salary','Sales','Fee','Bonus','Tax','Grant','Refund','Other'];
  FOR i IN 1..array_length(names_arr, 1) LOOP
    idx := ((i - 1) % 10) + 1;
    BEGIN
      INSERT INTO categories (space_id, name, color, is_default, scope)
      VALUES (p_space_id, names_arr[i], lib[idx], false, 'income');
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;

  names_arr := ARRAY['Personal','Business','Client'];
  FOR i IN 1..array_length(names_arr, 1) LOOP
    idx := ((i - 1) % 10) + 1;
    BEGIN
      INSERT INTO attributions (space_id, name, color, is_default, scope)
      VALUES (p_space_id, names_arr[i], lib[idx], false, 'expense');
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;

  names_arr := ARRAY['Employer','Client','Gov','Private'];
  FOR i IN 1..array_length(names_arr, 1) LOOP
    idx := ((i - 1) % 10) + 1;
    BEGIN
      INSERT INTO attributions (space_id, name, color, is_default, scope)
      VALUES (p_space_id, names_arr[i], lib[idx], false, 'income');
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION seed_default_categories_purposes_for_space(UUID) IS
  '为新空间写入支出/收入预设分类与用途，颜色仅从标签颜色库选取（与前端一致）。';

COMMIT;
