-- Drop public.suppliers and public.customers; data has been migrated to public.entities.
-- All app code now uses entities table (and entities.ts / suppliers.ts/customers.ts read from entities).
SET search_path = public;

DROP TABLE IF EXISTS public.customers CASCADE;
DROP TABLE IF EXISTS public.suppliers CASCADE;
