# Wholestore ERP + pricing

## Goals

- Vendor syncs SKUs from an ERP adapter into `provider.skus` (portal remains source of truth for **publish** and **price lists**).
- Dealers see only their assigned (or Default) price list: unit price + MOQ.
- Placing an order freezes line prices and pushes **one** external sales order id (`external_order_id`).

## Adapters (`@adaven/platform-erp`)

| Provider | Status |
|---|---|
| `mock` | Implemented. Fixture: curated Pouchpies food SKUs (`packages/platform-erp/src/fixtures/pouchpies-products.json`). Wholesale hint = DTC × 0.55. |
| `finale` | Stub only. Refuses connect/sync until a sandbox or Partner ID exists. Auth will be HTTP Basic (`apiKey:apiSecret`). Docs: https://developer.finaleinventory.com/reference/authentication |

Factory: `createErpAdapter({ provider })`.

Edge Functions use a Deno copy under `apps/wholestore-app/supabase/functions/_shared/erp/` (keep behavior aligned with the package).

## Connection UI

Management → **Integrations** (`/integrations`, provider spaces only):

1. Connect Mock  
2. Sync products (upsert by `sku_code`; does **not** auto-publish; seeds Default price list rows without overwriting edited prices)  
3. Finale card remains disabled

## Schema (Wholestore only)

See `packages/db-platform/sql/039_wholestore_erp_pricing.sql` / migration `20261116010000_wholestore_erp_pricing.sql`.

- `provider.erp_connections`
- SKU fields: `sku_code`, `external_product_id`, `external_source`, `qty_on_hand`, `synced_at`
- `provider.price_lists` / `price_list_items` / `consumer_price_lists`
- Order: `external_order_id`, `erp_push_status`, `erp_pushed_at`
- Order lines: `unit_price`, `moq_applied`
- RPCs: `resolve_price_list_id`, `list_dealer_shop_skus`; updated `consumer_create_order_from_published_skus`

## Edge Function `erp-proxy`

Actions: `save_connection` | `test_connection` | `sync_products` | `push_order`.

- Vendor members required for connect/sync.
- `push_order` allowed for vendor members **or** members of the order’s `consumer_space_id`.
- Idempotent: existing `external_order_id` is returned as-is.

## Price list rules

- One Default list per vendor space (`is_default`).
- Dealer assignment via `consumer_price_lists`; if unset, Default applies.
- Shop for enrolled dealers uses `list_dealer_shop_skus` (published SKUs on the resolved list only).
- Order create rejects quantity &lt; MOQ or SKUs missing from the list.

## Finale follow-up (out of this slice)

1. Customer sandbox or Adaven **Finale-Partner-ID**.
2. Implement `FinaleErpAdapter` (Basic Auth + REST product collection and/or GraphQL `productViewConnection`).
3. Encrypt credentials with `ERP_CREDENTIALS_KEY` in Edge; never expose to the client.
4. Respect Finale rate limits (collection ≤ 300/hour).

## Apply

Wholestore project `foyecolycmxcneflpant` only. See `apps/wholestore-app/supabase/APPLY.md` item 039 / migration `20261116010000`. Deploy function:

```bash
cd apps/wholestore-app && npx supabase functions deploy erp-proxy --project-ref foyecolycmxcneflpant
```
