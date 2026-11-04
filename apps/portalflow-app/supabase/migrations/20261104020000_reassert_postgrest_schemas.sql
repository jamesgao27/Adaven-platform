-- Re-assert PostgREST exposed schemas for Portalflow.
-- authenticator.pgrst.db_schemas can be wiped by platform role resets even when
-- 20260904150000 stays "applied". Hub product-ops then fails with PGRST106
-- (Invalid schema: crm). A full wipe also drops provider and consumer, so the
-- app .schema('provider'|'consumer') calls fail the same way.
-- Idempotent: safe to re-run.

GRANT USAGE ON SCHEMA crm TO authenticator, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA provider TO authenticator, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA consumer TO authenticator, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA crm TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA crm TO authenticator, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA crm TO service_role, authenticated, anon;

ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, crm, provider, consumer';

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
