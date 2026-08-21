-- Rollback for 20260323142000_backfill_preset_labels_from_order_labels.sql
-- Note: inserted rows in crm.preset_template_labels cannot be safely identified if
-- they overlap with pre-existing values. This rollback only unlinks template ids.

SET search_path = public, firm, crm;

UPDATE crm.preset_templates
SET tax_country_label_id = NULL,
    tax_scenario_label_id = NULL;

