# Apply Wholestore kernel (project `foyecolycmxcneflpant` only)

Do **not** run these files on Vouchap (`giuacjbfsyrristkigmz`).

## Files (in order)

1. `packages/db-platform/sql/000_kernel.sql` — `public.users` / `spaces` / `user_spaces` / `space_invitations` + RPCs + RLS  
2. `packages/db-platform/sql/010_wholestore_provider_consumer.sql` — schemas `provider` / `consumer`  
3. `packages/db-platform/sql/020_space_membership.sql` — accept/decline invite, remove member, last-admin, role toggle  
4. `packages/db-platform/sql/030_provider_catalog_orders.sql` — `provider.skus` / `orders` / `order_lines`; dealers may have null `consumer_space_id`  
5. `packages/db-platform/sql/031_bidirectional_dealer_orders_marketplace.sql` — dealer ↔ consumer space, shared orders, Marketplace RPCs  
6. `packages/db-platform/sql/032_no_on_behalf_dealer_factory_orders.sql` — no Factory-created dealer spaces; Factory cannot insert orders  
7. `packages/db-platform/sql/033_dealer_invites_labels_followups.sql` — labels, follow-ups, open-invite tokens (QR/link); accept RPC creates enrollment + order  
8. `packages/db-platform/sql/034_posters_marketing_storefront.sql` — posters M:N SKUs; open invite binds `poster_id` (accept enrolls only); Marketplace exclusive-store RPCs  
9. `packages/db-platform/sql/035_directed_invite_poster_showcase.sql` — directed invite requires poster; Marketplace showcase vs store; apply-to-provider  
10. `packages/db-platform/sql/036_overlay_no_ui_words_in_db.sql` — SQL identifiers are `provider`/`consumer` only (no dealer/factory table, column, or RPC names)  
11. `packages/db-platform/sql/037_crm_kernel.sql` — `crm.sku_edition` / `space_orders` / `get_space_entitlements` / registration trial + order/enrollment gates  
12. `packages/db-platform/sql/038_expose_crm_postgrest.sql` — grant `crm` to `authenticator` and expose it on PostgREST  
13. `packages/db-platform/sql/039_wholestore_erp_pricing.sql` — ERP connections, SKU external fields, price lists / MOQ, order ERP push, `list_dealer_shop_skus`  
14. `packages/db-platform/sql/040_wholestore_showcase_bands.sql` — Showcase accent/top/bottom images, `skus.category`, resolve/assign showcase, `get_dealer_storefront`  
15. `packages/db-platform/sql/041_space_invitations_realtime.sql` — `space_invitations` on `supabase_realtime` for invitee avatar badge  
16. **Skip** `001_create_space_core.sql` on this project (`010` already defines `create_space_core` with `p_kind`)

Copies also live under `apps/wholestore-app/supabase/migrations/`.

## CLI push

Applied 2026-08-21 to project `foyecolycmxcneflpant` (org `ugmjeltmjiqmwevwlfnk` / Adaven2) as `james.aim.link@gmail.com`.

CLI on this machine can stay **Developer** for later SQL (`db query`). Keep **Owner** as `jamesgao27@gmail.com`. Developer cannot change API / Auth / billing settings.

1. `000_kernel.sql`
2. `010_wholestore_provider_consumer.sql`
3. `020_space_membership.sql`
4. `030_provider_catalog_orders.sql` — applied 2026-08-21 via `supabase db query --linked` (project `foyecolycmxcneflpant` only)
5. `031_bidirectional_dealer_orders_marketplace.sql` — applied 2026-08-21 via `supabase db query --linked` (Wholestore only)
6. `032_no_on_behalf_dealer_factory_orders.sql` — applied 2026-08-21 via `supabase db query --linked` (Wholestore only)
7. `033_dealer_invites_labels_followups.sql` — applied 2026-08-21 via `supabase db query --linked` (Wholestore only)
8. `034_posters_marketing_storefront.sql` — applied 2026-08-21 via `supabase db query --linked` (Wholestore only)
9. `035_directed_invite_poster_showcase.sql` — applied 2026-08-21 via `supabase db query --linked` (Wholestore only)
10. `036_overlay_no_ui_words_in_db.sql` — applied 2026-09-04 via `apps/wholestore-app` `npx supabase db push` (project `foyecolycmxcneflpant` only). Migration history for 030–035 was repaired (`applied`) because those files originally went in via `db query`.
11. `037_crm_kernel.sql` / `20260904170000_crm_kernel.sql` — applied 2026-09-04 via `apps/wholestore-app` `npx supabase db push` (project `foyecolycmxcneflpant` only).
12. `038_expose_crm_postgrest.sql` / `20261004034500_expose_crm_postgrest.sql` — applied 2026-10-03. Grants `crm` to `authenticator` and sets PostgREST schemas to `public, graphql_public, provider, consumer, crm`. Without this, Adaven-CRM customer queries fail only for Wholestore.
13. `20261027210000_reassert_crm_postgrest_schemas.sql` — applied 2026-10-27. Same grants as 038; needed because `authenticator.pgrst.db_schemas` was wiped again (migration history still showed 038 applied, but REST returned PGRST106 Invalid schema: crm).
14. `20261104020000_reassert_crm_postgrest_schemas.sql` — applied 2026-11-03 via `db query --yes` (same wipe: REST hint was `public, graphql_public, provider, consumer`, no `crm`). If CRM Hub fails on Wholestore with Edge Function non-2xx, re-run this SQL and `NOTIFY pgrst, 'reload config'`. `config.toml` `[api].schemas` now lists the same set so a later config push does not drop `crm`.
15. `packages/db-platform/sql/039_wholestore_erp_pricing.sql` / `20261116010000_wholestore_erp_pricing.sql` — applied 2026-11-15 via `supabase db query --linked` (Wholestore only). ERP connection, SKU sync fields, price lists + MOQ, dealer shop RPC, order ERP push columns. Deploy Edge Function `erp-proxy` separately.
16. `packages/db-platform/sql/040_wholestore_showcase_bands.sql` / `20261116020000_wholestore_showcase_bands.sql` — applied 2026-11-16 via `supabase db query --remote` (Wholestore only). Simplified showcase bands + dealer storefront RPC.
17. `packages/db-platform/sql/041_space_invitations_realtime.sql` / `20261116030000_space_invitations_realtime.sql` — applied 2026-11-16 via `supabase db query --remote` (Wholestore only). Invitee sidebar badge realtime.

Skip `001_create_space_core.sql` on this project.


Rename vs Vouchap:

| Vouchap | Wholestore |
|---|---|
| `spaces.kind` `firm` / `client` | `provider` / `consumer` |
| schema `firm` | schema `provider` |
| `firm.firms` | `provider.providers` |
| `firm.clients` | `provider.consumers` |
| `firm.member_clients` | `provider.member_consumers` |
| `firm_space_id` / `client_space_id` | `provider_space_id` / `consumer_space_id` |
| *(no client schema)* | schema `consumer`, table `consumer.consumers` |

Provider catalog/orders: `provider.skus` (name/description/publish/category + optional ERP sync fields). **Price lists** hold unit price and MOQ. **ERP** via `erp_connections` + Edge `erp-proxy`. **Showcases** (`provider.posters` + `poster_skus`): accent + top/bottom images + SKU order; assign via `consumers.poster_id` (one per dealer). Dealer storefront: `get_dealer_storefront`. Discover uses featured/default; enrolled dealers use assigned showcase ∩ price list. Only **approved** enrollment can order. See `docs/WHOLESTORE-SHOWCASE.md`.
