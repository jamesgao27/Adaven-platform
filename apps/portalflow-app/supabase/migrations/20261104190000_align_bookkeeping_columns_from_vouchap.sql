-- Columns present on live Vouchap bookkeeping tables and written by the app,
-- missing on Portalflow after the provider/consumer overlay.
-- Applied before copying Vouchap rows so chat history, merges, and inventory lines fit.

ALTER TABLE public.ai_chat_logs ADD COLUMN IF NOT EXISTS attachment_url text;
ALTER TABLE public.ai_chat_logs ADD COLUMN IF NOT EXISTS voucher_type text;
ALTER TABLE public.ai_chat_logs ADD COLUMN IF NOT EXISTS project_id uuid;

ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS usage_count integer DEFAULT 0;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS merged_into_id uuid;

ALTER TABLE public.spaces ADD COLUMN IF NOT EXISTS created_by uuid;

ALTER TABLE public.location ADD COLUMN IF NOT EXISTS merged_into_id uuid;
ALTER TABLE public.skus ADD COLUMN IF NOT EXISTS merged_into_id uuid;
ALTER TABLE public.warehouse ADD COLUMN IF NOT EXISTS merged_into_id uuid;

ALTER TABLE public.inbound ADD COLUMN IF NOT EXISTS warehouse_id uuid;
ALTER TABLE public.inbound ADD COLUMN IF NOT EXISTS location_id uuid;
ALTER TABLE public.inbound ADD COLUMN IF NOT EXISTS inbound_type text;
ALTER TABLE public.inbound ADD COLUMN IF NOT EXISTS total_amount_chinese text;
ALTER TABLE public.inbound ADD COLUMN IF NOT EXISTS handler_id uuid;
ALTER TABLE public.inbound ADD COLUMN IF NOT EXISTS warehouse_keeper_id uuid;
ALTER TABLE public.inbound ADD COLUMN IF NOT EXISTS accountant_id uuid;
ALTER TABLE public.inbound ADD COLUMN IF NOT EXISTS remarks text;

ALTER TABLE public.inbound_items ADD COLUMN IF NOT EXISTS line_no integer;
ALTER TABLE public.inbound_items ADD COLUMN IF NOT EXISTS amount numeric;
ALTER TABLE public.inbound_items ADD COLUMN IF NOT EXISTS qualified_quantity numeric;
ALTER TABLE public.inbound_items ADD COLUMN IF NOT EXISTS defective_quantity numeric;
ALTER TABLE public.inbound_items ADD COLUMN IF NOT EXISTS location_id uuid;
ALTER TABLE public.inbound_items ADD COLUMN IF NOT EXISTS remarks text;

ALTER TABLE public.outbound ADD COLUMN IF NOT EXISTS warehouse_id uuid;
ALTER TABLE public.outbound ADD COLUMN IF NOT EXISTS location_id uuid;
ALTER TABLE public.outbound ADD COLUMN IF NOT EXISTS total_tax numeric;
ALTER TABLE public.outbound ADD COLUMN IF NOT EXISTS handler_id uuid;
ALTER TABLE public.outbound ADD COLUMN IF NOT EXISTS preparer_id uuid;
ALTER TABLE public.outbound ADD COLUMN IF NOT EXISTS accountant_id uuid;
ALTER TABLE public.outbound ADD COLUMN IF NOT EXISTS remarks text;

ALTER TABLE public.outbound_items ADD COLUMN IF NOT EXISTS line_no integer;
ALTER TABLE public.outbound_items ADD COLUMN IF NOT EXISTS amount numeric;
ALTER TABLE public.outbound_items ADD COLUMN IF NOT EXISTS supply_price numeric;
ALTER TABLE public.outbound_items ADD COLUMN IF NOT EXISTS tax numeric;
ALTER TABLE public.outbound_items ADD COLUMN IF NOT EXISTS remarks text;

-- Portalflow inventory lines require a product name. Vouchap lines point at sku_id instead.
ALTER TABLE public.inbound_items ALTER COLUMN product_name DROP NOT NULL;
ALTER TABLE public.outbound_items ALTER COLUMN product_name DROP NOT NULL;

-- Vouchap uniqueness is (space_id, name, scope). Portalflow still had the older (space_id, name) key.
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_space_id_name_key;
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_space_id_name_scope_key;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_space_id_name_scope_key UNIQUE (space_id, name, scope);

ALTER TABLE public.purposes DROP CONSTRAINT IF EXISTS purposes_space_id_name_key;
ALTER TABLE public.purposes DROP CONSTRAINT IF EXISTS purposes_space_id_name_scope_key;
ALTER TABLE public.purposes
  ADD CONSTRAINT purposes_space_id_name_scope_key UNIQUE (space_id, name, scope);

ALTER TABLE public.attributions DROP CONSTRAINT IF EXISTS attributions_space_id_name_key;
ALTER TABLE public.attributions DROP CONSTRAINT IF EXISTS attributions_space_id_name_scope_key;
ALTER TABLE public.attributions
  ADD CONSTRAINT attributions_space_id_name_scope_key UNIQUE (space_id, name, scope);

-- Vouchap stored chat-audio and tax-filing objects as public URLs.
UPDATE storage.buckets SET public = true WHERE id IN ('chat-audio', 'tax-filing');
