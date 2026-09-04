-- Enable RLS and policies for label library tables.

SET search_path = public, firm;

--------------------------------------------------------------------------------
-- 1) Enable RLS
--------------------------------------------------------------------------------

ALTER TABLE firm.order_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm.preset_order_labels ENABLE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- 2) firm.order_labels policies
--------------------------------------------------------------------------------

DROP POLICY IF EXISTS firm_order_labels_select ON firm.order_labels;
CREATE POLICY firm_order_labels_select ON firm.order_labels
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_spaces us
      WHERE us.space_id = firm.order_labels.firm_space_id
        AND us.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS firm_order_labels_insert_admin ON firm.order_labels;
CREATE POLICY firm_order_labels_insert_admin ON firm.order_labels
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_spaces us
      WHERE us.space_id = firm.order_labels.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

DROP POLICY IF EXISTS firm_order_labels_update_admin ON firm.order_labels;
CREATE POLICY firm_order_labels_update_admin ON firm.order_labels
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_spaces us
      WHERE us.space_id = firm.order_labels.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_spaces us
      WHERE us.space_id = firm.order_labels.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

DROP POLICY IF EXISTS firm_order_labels_delete_admin ON firm.order_labels;
CREATE POLICY firm_order_labels_delete_admin ON firm.order_labels
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_spaces us
      WHERE us.space_id = firm.order_labels.firm_space_id
        AND us.user_id = auth.uid()
        AND us.is_admin = true
    )
  );

--------------------------------------------------------------------------------
-- 3) firm.preset_order_labels policies
--------------------------------------------------------------------------------

DROP POLICY IF EXISTS firm_preset_order_labels_select ON firm.preset_order_labels;
CREATE POLICY firm_preset_order_labels_select ON firm.preset_order_labels
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS firm_preset_order_labels_all_service ON firm.preset_order_labels;
CREATE POLICY firm_preset_order_labels_all_service ON firm.preset_order_labels
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS firm_preset_order_labels_insert_editor ON firm.preset_order_labels;
CREATE POLICY firm_preset_order_labels_insert_editor ON firm.preset_order_labels
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'preset_editor') = 'true');

DROP POLICY IF EXISTS firm_preset_order_labels_update_editor ON firm.preset_order_labels;
CREATE POLICY firm_preset_order_labels_update_editor ON firm.preset_order_labels
  FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'preset_editor') = 'true');

DROP POLICY IF EXISTS firm_preset_order_labels_delete_editor ON firm.preset_order_labels;
CREATE POLICY firm_preset_order_labels_delete_editor ON firm.preset_order_labels
  FOR DELETE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'preset_editor') = 'true');

