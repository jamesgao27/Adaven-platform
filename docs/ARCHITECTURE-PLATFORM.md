# Architecture — Adaven Platform

## Constraints

- Share **kernel code and space kinds**, not accounts. Each product is an independent business app: **its own Supabase**, **its own `auth.users`**, own OAuth clients. Users do not share a login across apps.
- Kernel `spaces.kind` is only **`provider` | `consumer`**. Product copy maps those two values (Portalflow: Firm / Client; Wholestore: Vendor / Dealer; future B2B apps: other labels). Do not invent a third kernel kind per product.
- Third-party login (Google, Apple, Microsoft, …) is a **platform** capability. Credentials, bundle IDs, and Supabase Auth providers are **per app**.
- **One git repo, one kernel, independent product ships.** `packages/*` is always HEAD for every app (no per-app kernel pin). Platform changes on `main` are not a production release. Web ships via GitHub Actions path filters → Wrangler Direct Upload (one app per matching path), or that app’s CLI / EAS. **Never** Git-connect Cloudflare Pages to this repo (one push would rebuild every connected app).

## Source of truth

| What | Where |
|---|---|
| Vouchap **client** | `apps/vouchap-app`. Own `.env`, EAS project `f98c5cea-…`, bundle `com.vouchap.app`, Pages `vouchap`, Supabase `giuacjbfsyrristkigmz`. Product screens come from `packages/product-app`. |
| **Portalflow** firm CRM | `apps/portalflow-app`. Own `.env`, bundle `com.portalflow.app`, Pages `portalflow`, Supabase `xvqlqvtfogxkfeillvig`. Same `packages/product-app` screens, `extra.appVariant=portalflow`. |
| Wholestore | `apps/wholestore-app` → Supabase `foyecolycmxcneflpant` |
| **Adaven-CRM Hub** | Standalone repo `Adaven-CRM` (package `adaven-crm`) → Supabase **`glwacznypahmlpwottfz`**. Ops Auth only; not a product tenant. |
| Platform kernel | `packages/*` (code only, not a tenant) |

Portalflow native identity is new (`com.portalflow.app`, scheme `portalflow`). Do **not** reuse Vouchap EAS `projectId` (`f98c5cea-…`) or bundle `com.vouchap.app`. Create a new EAS app when first building native.

Cloudflare Pages projects are **Direct Upload** (`wrangler pages deploy` from `apps/portalflow-app` or `apps/wholestore-app`). Git source of the code is `jamesgao27/Adaven-platform`; Pages must **not** be Git-connected. Auto-publish is GitHub Actions with per-app path filters. See `docs/PUBLISH.md`.

## Information architecture

- **Kernel UI**: login / register / reset-password / setup-space / handle-invitations / invite, plus **Management** (space info, personal info, switch space, sign out, Members). Admin and member changes are on the members list for every product. `/permissions` only redirects there. Apps `export { ManagementScreen as default } from '@adaven/platform-ui'`.
- **Web left sidebar**: chrome only (brand, current space → Management, user card → Management, invitation badge). **Every nav column is a product business page** (`getSidebarNavItems`). Do not put Team or member admin in the rail.
- Product extras on Management use `getManagementMenuItems` (Portalflow: Accounts, Firm Permissions, billing, …). Finer provider permissions stay on those product screens and extend this same admin/member membership. They do not fork the members list.
- Shared list chrome (`DataTable`, `CenterModal`, `ProjectListCard` / `ProjectListRow`) lives in `platform-ui`. Wholestore Vendor maps Portalflow/Vouchap Firm: Dealers ← Clients, Orders ← Engagements (multi-SKU lines), Catalog ← Service Catalog (SKU without items).

## Space kinds (kernel vs product)

Kernel stores **two** kinds. Apps only change **labels and overlay tables**, not the enum.

| Kernel (`spaces.kind`) | Meaning | Portalflow UI | Wholestore UI | Future apps |
|------------------------|---------|---------------|---------------|-------------|
| `provider` | Supplies catalog / services to the other side | **Firm** | **Vendor** | other B2B role name |
| `consumer` | Buys / enrolls / is served | **Client** | **Dealer** | other B2B role name |

- SQL / `platform-core` / RLS / RPCs use `provider` and `consumer` only.
- `configureProductUi({ spaceKinds: [{ id: 'provider', label: 'Firm' }, …] })` is how a product shows its vocabulary.
- Product overlay schemas use `provider.*` / `consumer.*` identifiers only. **Firm / Client / Vendor / Dealer are UI labels**, not SQL names. **`public.spaces.kind` is always kernel `provider`/`consumer`**. Portalflow still has extra overlay tables (SKU items, groups, permission roles, tax) that Wholestore does not.
- Vouchap production `giuacjbfsyrristkigmz` uses the same kernel kinds and `provider` / `consumer` schemas. Portalflow still has its own database. Neither app writes to the other's project.

**Wholestore** overlay SQL uses `provider`/`consumer` only (UI copy is Vendor / Dealer; some screens still say supplier/factory). One user may belong to both kinds at once and switches between those spaces in Management. The two kinds are not separate accounts. Portalflow and Vouchap still limit the switcher with `allowedSpaceKinds`.

## Layout

```text
Adaven-platform/
  packages/
    platform-core/     signup, space, membership, invite
    platform-ui/       login, register, members, setup space
    product-app/       shared Vouchap and Portalflow screens
    db-platform/
  apps/
    vouchap-app/       client bookkeeping ship project
    portalflow-app/    firm CRM ship project
    wholestore-app/
```

Apps depend on `@adaven/platform-core` and `@adaven/platform-ui`. npm workspaces **always link the local packages on HEAD**. Do not fork kernel versions per app; independence is **when** each product is exported and uploaded, not which kernel commit it develops against.

## Space creation

```mermaid
flowchart TD
  ui[Setup Space UI]
  productRpc[create_space_with_user product RPC]
  core[create_space_core]
  hook[onSpaceCreated]
  product[App seeds: categories / Firm SKUs]
  ui --> productRpc --> core
  productRpc --> product
  ui --> hook --> product
```

- `create_space_core`: `spaces` + `user_spaces` + `current_space_id`. `p_kind` is `provider` | `consumer`.
- Portalflow product wrapper `create_space_with_user` calls core, then writes `provider.providers` / preset SKUs or `consumer.consumers` + Client CRM presets. `registerOnSpaceCreated` is the client-side fallback for the same seeds.
- Wholestore overlay (`provider.providers` / `consumer.consumers`) lives in its own `create_space_core` replacement in `010_wholestore_provider_consumer.sql`.
- Vouchap `giuacjbfsyrristkigmz` has `create_space_core` and `provider`/`consumer` kinds (`040_vouchap_align_provider_consumer.sql`).

## Vouchap and Portalflow

Both products are developed in this repo. They do not share a database or a release project.

```text
Vouchap client bookkeeping
  apps/vouchap-app
  Supabase giuacjbfsyrristkigmz
  Expo f98c5cea-…   Cloudflare Pages vouchap

Portalflow firm CRM
  apps/portalflow-app
  Supabase xvqlqvtfogxkfeillvig
  Cloudflare Pages portalflow
```

Do **not** copy Vouchap `auth.users` or receipts into the Portalflow project. A later snapshot links the client sides. Marketing sites, when published, use that product's own Vercel project.

Stand-up:

1. Create a **new** Supabase project (not `giuacjbfsyrristkigmz`, not Wholestore `foyecolycmxcneflpant`).
2. From `apps/portalflow-app`, `supabase link` then `supabase db push` (this app’s migrations, including `20260904010000_portalflow_kernel_space_core.sql`). See `apps/portalflow-app/supabase/APPLY.md`.
3. Create Cloudflare Pages project **`portalflow`** (Direct Upload, no Git).
4. Put URL/anon key in `apps/portalflow-app/.env` and GitHub secrets `PORTALFLOW_EXPO_PUBLIC_*`.
5. `eas init` a **new** Expo project when shipping native. Do not attach the Vouchap EAS id.

Do **not** apply `packages/db-platform/sql/010_wholestore_provider_consumer.sql` on Portalflow (that creates Wholestore `provider`/`consumer` schemas).

## Roles

Platform stores `user_spaces.is_admin` (Admin / Member). Membership RPCs live in `020_space_membership.sql`: invite (optional admin), accept/decline, remove, leave, last-admin guard. Wholestore enrollment is `provider.consumers` (Factory ↔ Dealer), not orders. This is **not** Portalflow Firm `permission_roles` (order managers).

## Ops plane (Adaven-CRM)

Cross-product customer operations live in the standalone repo **`Adaven-CRM`** (package name `adaven-crm`) on Supabase **`glwacznypahmlpwottfz`**. It is **not** shipped via this monorepo’s Pages path filters.

- **Hub Auth + Hub `crm` schema**: `ops_users`, `ops_assignments(product_id, tenant_id)`, `tenant_follow_ups`, `ops_audit_log`, `products`. Operators sign in once.
- **Product DBs keep entitlement facts**: `crm.sku_edition` + `crm.space_orders` (Vouchap / Portalflow / Wholestore) or `crm.workspace_orders` (aim.link). Apps call `get_space_entitlements` / `get_workspace_entitlements`.
- **Writes** go through Hub Edge Function `product-ops` using per-product **service role** secrets. The CRM browser only holds the Hub anon key.
- **Frozen Vouchap** (`giuacjbfsyrristkigmz`): adapter reads/writes existing `crm.*` only. No schema or app changes. `created_by_ops_user_id` stays null; Hub ops id is in `metadata.hub_ops_user_id`.
- Product UI labels (Firm / Client / Vendor / Dealer) stay in the CRM UI mapper. New SQL identifiers are `provider` / `consumer` / `workspace`.

## Independent release

1. Change platform packages on `main` — both apps see it in local/dev immediately. This is **not** a production update by itself (GitHub Actions path filters exclude `packages/**`).
2. When Portalflow web should go live: push that touches `apps/portalflow-app/**` (Pages `portalflow` only), or Actions **Deploy Portalflow Web**, or `npm run portalflow:deploy:web`. Vouchap bookkeeping web is the same tree with `APP_VARIANT=vouchap` and is started by hand (`Deploy Vouchap Web` or `npm run vouchap:deploy:web`).
3. When Wholestore should go live: push that touches `apps/wholestore-app/**`, or Actions **Deploy Wholestore Web → Run workflow**, or `npm run wholestore:deploy:web` (and its EAS). The other product stays on the last Direct Upload / store binary.
4. Run `db-platform` SQL on **Wholestore** only, when ready. Portalflow uses **its own** migration folder.
5. Never connect Git on Pages `portalflow` or `wholestore`. Leave frozen Pages `vouchap` alone (still the original product).
