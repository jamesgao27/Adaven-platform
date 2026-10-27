-- Align Portalflow catalog + receipts with the app after provider/consumer overlay.
-- 1) SKU space_target firm/client never matched spaces.kind provider/consumer, so CRM
--    subscription orders did not activate entitlements or AI recognition.
-- 2) App queries public.accounts / receipts.account_id / receipts.input_type (Vouchap names);
--    live overlay still had payment_accounts / payment_account_id.

-- ---------------------------------------------------------------------------
-- A) Subscription matching
-- ---------------------------------------------------------------------------
UPDATE crm.sku_edition
SET data_limits = jsonb_set(data_limits, '{space_target}', to_jsonb('provider'::text), true),
    updated_at = now()
WHERE data_limits->>'space_target' = 'firm';

UPDATE crm.sku_edition
SET data_limits = jsonb_set(data_limits, '{space_target}', to_jsonb('consumer'::text), true),
    updated_at = now()
WHERE data_limits->>'space_target' = 'client';

CREATE OR REPLACE FUNCTION crm._active_space_subscription_row(p_space_id uuid)
RETURNS TABLE (
  order_id uuid,
  sku_code text,
  started_at timestamptz,
  expires_at timestamptz,
  is_trial boolean,
  recognition_included_per_month integer,
  engagement_included_per_year integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'crm'
AS $$
  SELECT
    so.id,
    se.code,
    so.started_at,
    so.expires_at,
    COALESCE(se.is_trial, false),
    (se.data_limits->>'recognition_included_per_month')::int,
    COALESCE(
      NULLIF((se.data_limits->>'engagement_included_per_subscription_year')::text, '')::int,
      NULLIF((se.data_limits->>'engagements_included')::text, '')::int,
      NULLIF((se.data_limits->>'engagement_credits_included')::text, '')::int
    )
  FROM crm.space_orders so
  INNER JOIN crm.sku_edition se ON se.id = so.sku_id
  INNER JOIN public.spaces sp ON sp.id = so.space_id
  WHERE so.space_id = p_space_id
    AND so.status = 'active'
    AND so.expires_at IS NOT NULL
    AND so.expires_at > now()
    AND COALESCE(se.data_limits->>'billing_kind', '') = 'space_subscription'
    AND COALESCE(se.data_limits->>'space_target', 'any') IN (
      'any',
      sp.kind::text,
      CASE sp.kind::text
        WHEN 'provider' THEN 'firm'
        WHEN 'consumer' THEN 'client'
        WHEN 'firm' THEN 'provider'
        WHEN 'client' THEN 'consumer'
        ELSE sp.kind::text
      END
    )
  ORDER BY (NOT COALESCE(se.is_trial, false)) DESC, so.created_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION crm._active_space_subscription_row(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- B) Accounts / receipts columns the expenses list selects
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_update_payment_account_usage ON receipts;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payment_accounts'
  ) THEN
    ALTER TABLE public.payment_accounts RENAME TO accounts;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'receipts' AND column_name = 'payment_account_id'
  ) THEN
    ALTER TABLE public.receipts RENAME COLUMN payment_account_id TO account_id;
  END IF;
END $$;

ALTER TABLE public.receipts DROP CONSTRAINT IF EXISTS receipts_payment_account_id_fkey;
ALTER TABLE public.receipts DROP CONSTRAINT IF EXISTS receipts_account_id_fkey;
ALTER TABLE public.receipts
  ADD CONSTRAINT receipts_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'payment_account_id'
  ) THEN
    ALTER TABLE public.invoices RENAME COLUMN payment_account_id TO account_id;
    ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_payment_account_id_fkey;
    ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_account_id_fkey;
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE IF EXISTS public.payment_account_merge_history RENAME TO account_merge_history;

CREATE INDEX IF NOT EXISTS idx_accounts_space_id ON public.accounts(space_id);

ALTER TABLE public.receipts ADD COLUMN IF NOT EXISTS input_type text DEFAULT 'image';
UPDATE public.receipts SET input_type = 'image' WHERE image_url IS NOT NULL AND input_type IS NULL;
UPDATE public.receipts SET input_type = 'text' WHERE image_url IS NULL AND input_type IS NULL;

DROP TRIGGER IF EXISTS update_payment_accounts_updated_at ON public.accounts;
DROP TRIGGER IF EXISTS update_accounts_updated_at ON public.accounts;
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage payment accounts in their household" ON public.accounts;
DROP POLICY IF EXISTS payment_accounts_select_policy ON public.accounts;
DROP POLICY IF EXISTS payment_accounts_insert_policy ON public.accounts;
DROP POLICY IF EXISTS payment_accounts_update_policy ON public.accounts;
DROP POLICY IF EXISTS payment_accounts_delete_policy ON public.accounts;
DROP POLICY IF EXISTS payment_accounts_manage_policy ON public.accounts;
DROP POLICY IF EXISTS accounts_select_policy ON public.accounts;
DROP POLICY IF EXISTS accounts_insert_policy ON public.accounts;
DROP POLICY IF EXISTS accounts_update_policy ON public.accounts;
DROP POLICY IF EXISTS accounts_delete_policy ON public.accounts;
CREATE POLICY accounts_select_policy ON public.accounts FOR SELECT
  USING (space_id IN (SELECT space_id FROM public.user_spaces WHERE user_id = auth.uid()));
CREATE POLICY accounts_insert_policy ON public.accounts FOR INSERT
  WITH CHECK (space_id IN (SELECT space_id FROM public.user_spaces WHERE user_id = auth.uid()));
CREATE POLICY accounts_update_policy ON public.accounts FOR UPDATE
  USING (space_id IN (SELECT space_id FROM public.user_spaces WHERE user_id = auth.uid()));
CREATE POLICY accounts_delete_policy ON public.accounts FOR DELETE
  USING (space_id IN (SELECT space_id FROM public.user_spaces WHERE user_id = auth.uid()));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'account_merge_history'
  ) THEN
    ALTER TABLE public.account_merge_history ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Users can manage merge history in their household" ON public.account_merge_history;
    DROP POLICY IF EXISTS payment_account_merge_history_manage_policy ON public.account_merge_history;
    DROP POLICY IF EXISTS account_merge_history_manage_policy ON public.account_merge_history;
    CREATE POLICY account_merge_history_manage_policy ON public.account_merge_history
      FOR ALL USING (space_id IN (SELECT space_id FROM public.user_spaces WHERE user_id = auth.uid()))
      WITH CHECK (space_id IN (SELECT space_id FROM public.user_spaces WHERE user_id = auth.uid()));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_default_accounts(p_space_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.accounts (space_id, name, is_ai_recognized) VALUES
    (p_space_id, 'Cash', true)
  ON CONFLICT (space_id, name) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_default_payment_accounts(p_space_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.create_default_accounts(p_space_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_default_accounts(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_default_payment_accounts(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
