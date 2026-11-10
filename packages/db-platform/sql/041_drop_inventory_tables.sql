-- Vouchap and Portalflow do not keep inventory.
-- Drops stock documents only. provider.skus (service catalog) and crm.sku_* stay.
DROP TABLE IF EXISTS public.inbound_items CASCADE;
DROP TABLE IF EXISTS public.outbound_items CASCADE;
DROP TABLE IF EXISTS public.inbound CASCADE;
DROP TABLE IF EXISTS public.outbound CASCADE;
DROP TABLE IF EXISTS public.location CASCADE;
DROP TABLE IF EXISTS public.warehouse CASCADE;
DROP TABLE IF EXISTS public.skus CASCADE;
