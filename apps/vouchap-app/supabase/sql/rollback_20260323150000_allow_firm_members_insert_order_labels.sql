SET search_path = public, firm;

DROP POLICY IF EXISTS firm_order_labels_insert_member ON firm.order_labels;
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
