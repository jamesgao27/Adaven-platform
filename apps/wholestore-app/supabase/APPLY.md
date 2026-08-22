# Apply Wholestore kernel (project `foyecolycmxcneflpant` only)

Do **not** run these files on Vouchap (`giuacjbfsyrristkigmz`).

## Files (in order)

1. `packages/db-platform/sql/000_kernel.sql` — `public.users` / `spaces` / `user_spaces` / `space_invitations` + RPCs + RLS  
2. `packages/db-platform/sql/010_wholestore_provider_consumer.sql` — schemas `provider` / `consumer`  
3. `packages/db-platform/sql/020_space_membership.sql` — accept/decline invite, remove member, last-admin, role toggle  
4. `packages/db-platform/sql/030_provider_catalog_orders.sql` — `provider.skus` / `orders` / `order_lines`; dealers may have null `consumer_space_id`  
5. **Skip** `001_create_space_core.sql` on this project (`010` already defines `create_space_core` with `p_kind`)

Copies also live under `apps/wholestore-app/supabase/migrations/`.

## CLI push

Applied 2026-08-21 to project `foyecolycmxcneflpant` (org `ugmjeltmjiqmwevwlfnk` / Adaven2) as `james.aim.link@gmail.com`.

CLI on this machine can stay **Developer** for later SQL (`db query`). Keep **Owner** as `jamesgao27@gmail.com`. Developer cannot change API / Auth / billing settings.

1. `000_kernel.sql`
2. `010_wholestore_provider_consumer.sql`
3. `020_space_membership.sql`
4. `030_provider_catalog_orders.sql` — applied 2026-08-21 via `supabase db query --linked` (project `foyecolycmxcneflpant` only)
5. PostgREST exposed schemas: `public, graphql_public, provider, consumer`

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

Provider catalog/orders: `provider.skus` (name/description/publish only), `provider.orders` + `provider.order_lines` (multi-SKU). No receipts/invoices.
