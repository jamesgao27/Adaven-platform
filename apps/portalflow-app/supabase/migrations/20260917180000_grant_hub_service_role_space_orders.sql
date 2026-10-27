-- Hub product-ops uses the Portalflow service_role key to insert/update CRM orders.
-- Historical CRM SQL only granted INSERT/UPDATE to authenticated (same gap as live Vouchap).

GRANT USAGE ON SCHEMA crm TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE crm.space_orders TO service_role;
GRANT SELECT ON TABLE crm.sku_edition TO service_role;
GRANT SELECT ON TABLE crm.sku_addon TO service_role;
GRANT EXECUTE ON FUNCTION crm.get_space_entitlements(uuid) TO service_role;
