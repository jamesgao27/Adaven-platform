-- Expose crm to PostgREST on Wholestore.
-- 037 granted USAGE to anon / authenticated / service_role and set
-- pgrst.db_schemas inside a swallowed exception. authenticator (the role
-- PostgREST uses to build the schema cache) had no USAGE, so the API only
-- exposed public, graphql_public, provider, consumer. Adaven-CRM product-ops
-- then failed list_orders / list_skus for Wholestore with a non-2xx response.

GRANT USAGE ON SCHEMA crm TO authenticator, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA crm TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA crm TO authenticator, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA crm TO service_role, authenticated, anon;

ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, provider, consumer, crm';

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
