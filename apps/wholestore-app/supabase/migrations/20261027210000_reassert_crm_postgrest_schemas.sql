-- Re-assert crm on PostgREST for Wholestore.
-- 20261004034500 was applied, but authenticator.pgrst.db_schemas can be wiped
-- by platform role resets; CRM Hub product-ops then fails with PGRST106
-- (Invalid schema: crm) while spaces still work.
-- Idempotent: safe to re-run.

GRANT USAGE ON SCHEMA crm TO authenticator, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA crm TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA crm TO authenticator, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA crm TO service_role, authenticated, anon;

ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, provider, consumer, crm';

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
