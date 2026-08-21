-- Rollback for 20260323133000_enable_rls_for_order_labels.sql

SET search_path = public, firm;

-- Drop policies on firm.order_labels
DROP POLICY IF EXISTS firm_order_labels_select ON firm.order_labels;
DROP POLICY IF EXISTS firm_order_labels_insert_admin ON firm.order_labels;
DROP POLICY IF EXISTS firm_order_labels_update_admin ON firm.order_labels;
DROP POLICY IF EXISTS firm_order_labels_delete_admin ON firm.order_labels;

-- Drop policies on firm.preset_order_labels
DROP POLICY IF EXISTS firm_preset_order_labels_select ON firm.preset_order_labels;
DROP POLICY IF EXISTS firm_preset_order_labels_all_service ON firm.preset_order_labels;
DROP POLICY IF EXISTS firm_preset_order_labels_insert_editor ON firm.preset_order_labels;
DROP POLICY IF EXISTS firm_preset_order_labels_update_editor ON firm.preset_order_labels;
DROP POLICY IF EXISTS firm_preset_order_labels_delete_editor ON firm.preset_order_labels;

-- Disable RLS (restore previous behavior)
ALTER TABLE firm.order_labels DISABLE ROW LEVEL SECURITY;
ALTER TABLE firm.preset_order_labels DISABLE ROW LEVEL SECURITY;

