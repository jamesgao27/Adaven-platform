-- 创建 firm 时 RPC create_space_with_user 会写：public.spaces → public.user_spaces → public.users → firm.apply_preset_skus_to_firm → firm.skus / firm.sku_items。
-- 上述步骤均以 SECURITY DEFINER（postgres）执行，需为 postgres 在相关表上放行写入。

-- =============================================================================
-- 0. public.user_spaces：RPC 内 INSERT 需 postgres 通过
-- =============================================================================
DROP POLICY IF EXISTS "user_spaces_insert_definer" ON public.user_spaces;
CREATE POLICY "user_spaces_insert_definer" ON public.user_spaces
  FOR INSERT TO postgres WITH CHECK (true);

-- =============================================================================
-- 1. firm.skus：允许 definer（postgres 等）INSERT/UPDATE
-- =============================================================================
DROP POLICY IF EXISTS "firm_skus_insert_definer" ON firm.skus;
CREATE POLICY "firm_skus_insert_definer" ON firm.skus
  FOR INSERT TO postgres WITH CHECK (true);

DROP POLICY IF EXISTS "firm_skus_update_definer" ON firm.skus;
CREATE POLICY "firm_skus_update_definer" ON firm.skus
  FOR UPDATE TO postgres USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "firm_skus_insert_service_role" ON firm.skus;
CREATE POLICY "firm_skus_insert_service_role" ON firm.skus
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "firm_skus_update_service_role" ON firm.skus;
CREATE POLICY "firm_skus_update_service_role" ON firm.skus
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

DO $$
BEGIN
  DROP POLICY IF EXISTS "firm_skus_insert_supabase_admin" ON firm.skus;
  CREATE POLICY "firm_skus_insert_supabase_admin" ON firm.skus FOR INSERT TO supabase_admin WITH CHECK (true);
  DROP POLICY IF EXISTS "firm_skus_update_supabase_admin" ON firm.skus;
  CREATE POLICY "firm_skus_update_supabase_admin" ON firm.skus FOR UPDATE TO supabase_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- =============================================================================
-- 2. firm.sku_items：允许 definer INSERT/UPDATE（含 depends_on_id 回填）
-- =============================================================================
DROP POLICY IF EXISTS "firm_sku_items_insert_definer" ON firm.sku_items;
CREATE POLICY "firm_sku_items_insert_definer" ON firm.sku_items
  FOR INSERT TO postgres WITH CHECK (true);

DROP POLICY IF EXISTS "firm_sku_items_update_definer" ON firm.sku_items;
CREATE POLICY "firm_sku_items_update_definer" ON firm.sku_items
  FOR UPDATE TO postgres USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "firm_sku_items_insert_service_role" ON firm.sku_items;
CREATE POLICY "firm_sku_items_insert_service_role" ON firm.sku_items
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "firm_sku_items_update_service_role" ON firm.sku_items;
CREATE POLICY "firm_sku_items_update_service_role" ON firm.sku_items
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

DO $$
BEGIN
  DROP POLICY IF EXISTS "firm_sku_items_insert_supabase_admin" ON firm.sku_items;
  CREATE POLICY "firm_sku_items_insert_supabase_admin" ON firm.sku_items FOR INSERT TO supabase_admin WITH CHECK (true);
  DROP POLICY IF EXISTS "firm_sku_items_update_supabase_admin" ON firm.sku_items;
  CREATE POLICY "firm_sku_items_update_supabase_admin" ON firm.sku_items FOR UPDATE TO supabase_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

COMMENT ON POLICY "firm_skus_insert_definer" ON firm.skus IS 'RPC apply_preset_skus_to_firm 以 postgres 写入';
COMMENT ON POLICY "firm_sku_items_insert_definer" ON firm.sku_items IS 'RPC apply_preset_skus_to_firm 以 postgres 写入';
