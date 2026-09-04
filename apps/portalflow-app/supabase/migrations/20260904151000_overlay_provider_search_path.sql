-- pg_get_functiondef emits SET search_path TO 'public', 'firm', which the identifier
-- rewrite in 20260904150000 did not match. Unqualified names would miss the overlay schema.

DO $$
DECLARE
  rec RECORD;
  cfg text;
  path_val text;
BEGIN
  FOR rec IN
    SELECT n.nspname,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           p.proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proconfig IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM unnest(p.proconfig) c
        WHERE c LIKE 'search_path=%' AND c ILIKE '%firm%'
      )
  LOOP
    FOREACH cfg IN ARRAY rec.proconfig
    LOOP
      IF cfg LIKE 'search_path=%' AND cfg ILIKE '%firm%' THEN
        path_val := substr(cfg, length('search_path=') + 1);
        path_val := replace(path_val, 'firm', 'provider, consumer');
        EXECUTE format(
          'ALTER FUNCTION %I.%I(%s) SET search_path TO %s',
          rec.nspname, rec.proname, rec.args, path_val
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
