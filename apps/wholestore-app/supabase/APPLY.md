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
11. **Skip** `001_create_space_core.sql` on this project (`010` already defines `create_space_core` with `p_kind`)

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
11. PostgREST exposed schemas: `public, graphql_public, provider, consumer`

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

Provider catalog/orders: `provider.skus` (name/description/publish only). **Posters** (`provider.posters` + `poster_skus`) are Marketing cover/intro assets; M:N with SKUs. Each provider space has one **default poster** that hangs every published SKU. **Dealer IA (no Marketplace module):** `/suppliers` lists enrolled **stores** only; **Find more suppliers** (`/suppliers/discover`) lists unbound **showcases** (view + apply). Dealer-facing copy uses **supplier**, not factory. Only an **approved** enrollment can order (`consumer_create_order_from_published_skus`). Add dealer writes a pending `provider.consumers` row with a **required poster** (`consumer_space_id` null) and **never** creates a consumer space. Open invite issues a QR/link bound to a **published poster**; accept enrolls only (no order). Apply from a showcase creates a pending enrollment until the provider approves. Labels / follow-ups live on `provider.consumers` + `provider.consumer_follow_ups`. No receipts/invoices. SQL identifiers are `provider`/`consumer` only; Vendor / Dealer / Factory stay in the UI.
