-- tax-filing bucket: remove anonymous SELECT; scope read/write/delete to client space folder + firm access.
-- After apply: set bucket "tax-filing" to Private in Dashboard (recommended) so public URLs are not world-readable.
SET search_path = public, firm;

DROP POLICY IF EXISTS "tax_filing_public_select" ON storage.objects;

DROP POLICY IF EXISTS "tax_filing_authenticated_select" ON storage.objects;
DROP POLICY IF EXISTS "tax_filing_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "tax_filing_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "tax_filing_authenticated_delete" ON storage.objects;

CREATE POLICY "tax_filing_authenticated_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'tax-filing'
  AND (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid()
        AND us.space_id::text = split_part(name, '/', 1)
    )
    OR EXISTS (
      SELECT 1 FROM firm.orders o
      WHERE o.client_space_id IS NOT NULL
        AND o.client_space_id::text = split_part(name, '/', 1)
        AND firm.can_access_client(auth.uid(), o.firm_space_id, o.client_space_id, false)
    )
  )
);

CREATE POLICY "tax_filing_authenticated_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'tax-filing'
  AND (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid()
        AND us.space_id::text = split_part(name, '/', 1)
    )
    OR EXISTS (
      SELECT 1 FROM firm.orders o
      WHERE o.client_space_id IS NOT NULL
        AND o.client_space_id::text = split_part(name, '/', 1)
        AND firm.can_access_client(auth.uid(), o.firm_space_id, o.client_space_id, true)
    )
  )
);

CREATE POLICY "tax_filing_authenticated_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'tax-filing'
  AND (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid()
        AND us.space_id::text = split_part(name, '/', 1)
    )
    OR EXISTS (
      SELECT 1 FROM firm.orders o
      WHERE o.client_space_id IS NOT NULL
        AND o.client_space_id::text = split_part(name, '/', 1)
        AND firm.can_access_client(auth.uid(), o.firm_space_id, o.client_space_id, true)
    )
  )
);

CREATE POLICY "tax_filing_authenticated_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'tax-filing'
  AND (
    EXISTS (
      SELECT 1 FROM public.user_spaces us
      WHERE us.user_id = auth.uid()
        AND us.space_id::text = split_part(name, '/', 1)
    )
    OR EXISTS (
      SELECT 1 FROM firm.orders o
      WHERE o.client_space_id IS NOT NULL
        AND o.client_space_id::text = split_part(name, '/', 1)
        AND firm.can_access_client(auth.uid(), o.firm_space_id, o.client_space_id, true)
    )
  )
);

-- NOTE: Do not COMMENT ON POLICY on storage.objects here — migration role is not table owner on hosted Supabase (42501).
