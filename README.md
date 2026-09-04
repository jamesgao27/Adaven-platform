# Adaven Platform

Shared **Space / members / invitations / third-party login** kernel, plus product apps.

GitHub: https://github.com/jamesgao27/Adaven-platform

- **Portalflow** (new Firm/Client product) lives in `apps/portalflow-app`. It is **not** a continuation of live Vouchap users or its Supabase. Push to `main` auto-ships **only the app whose folder changed** (GitHub Actions → Wrangler Direct Upload). Cloudflare Pages stays disconnected from Git. See **`docs/PUBLISH.md`**.
- **One kernel, many apps**: shared `packages/*` is always HEAD for every app (no per-app kernel versions). Each app has its own Supabase, EAS, and **Cloudflare Pages project** (Direct Upload). Kernel-only commits do not auto-deploy.
- **Not** a unified login. Google/Apple/Microsoft credentials are per-app.
- Frozen live Vouchap: https://github.com/jamesgao27/Vouchap (do not continue app development there; do not migrate its data into Portalflow). Marketing site and CRM stay in their own repos.

## Layout

```text
packages/platform-core    session, spaces, invites, OAuth
packages/platform-ui      Login / register / setup space / members / invites / space roles (plus Switch Space, OAuth buttons)
packages/db-platform      slim SQL (Wholestore / new generic apps — not Portalflow product overlay)
apps/portalflow-app       Portalflow Expo app → **new empty Supabase** (Firm/Client on kernel provider/consumer)
apps/wholestore-app       Wholestore Expo shell → Supabase **foyecolycmxcneflpant**
```

## Portalflow develop / ship

```bash
# apps/portalflow-app/.env  — new project only, never giuacjbfsyrristkigmz
EXPO_PUBLIC_SUPABASE_URL=https://<portalflow-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>

npm install
npm run portalflow:web
cd apps/portalflow-app && eas build --platform all --profile production   # after eas init
npm run portalflow:deploy:web   # Pages **portalflow** only (same target as Actions)
```

Apply SQL: `apps/portalflow-app/supabase/APPLY.md`. Never `db push` this folder onto live Vouchap.

## Wholestore develop / ship

```bash
# apps/wholestore-app/.env
EXPO_PUBLIC_SUPABASE_URL=https://foyecolycmxcneflpant.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key from that project>

npm run wholestore:web
npm run wholestore:deploy:web   # Pages **wholestore** only; never Portalflow or Vouchap
```

Kernel SQL for Wholestore: `apps/wholestore-app/supabase/APPLY.md`. Never on Vouchap or Portalflow. **Applied 2026-08-21** (`000` + `010`, schemas exposed).

## Packages

| Package | Role |
|---|---|
| `@adaven/platform-core` | session, spaces, invitations, members, `registerOnSpaceCreated`, `signInWithOAuth(provider)` |
| `@adaven/platform-ui` | Kernel **screens** + Switch Space + third-party sign-in. Apps call `configureProductUi` then re-export screens. |
| `@adaven/db-platform` | Kernel SQL. Wholestore: `000_kernel.sql` then `010_wholestore_provider_consumer.sql` |

## SQL

- **Portalflow** (new project): push `apps/portalflow-app/supabase/migrations` only. Kernel kinds are `provider`/`consumer`; product overlay stays `firm.*`.
- **Vouchap** (`giuacjbfsyrristkigmz`): frozen. Do not apply Adaven migrations or db-platform scripts.
- **Wholestore** (`foyecolycmxcneflpant`): apply `000_kernel.sql` then `010_wholestore_provider_consumer.sql`. Skip `001_create_space_core.sql`. Details: `apps/wholestore-app/supabase/APPLY.md`.

Wholestore names: kernel `provider` / `consumer` (`spaces.kind`, schemas, columns). No receipts/invoices.

## New app checklist

1. Copy an Expo shell into `apps/<name>-app`.
2. Create a **new** Supabase project; apply `packages/db-platform/sql` only when that app is ready (Portalflow uses its own migrations instead).
3. Call `bindPlatformClient(supabase)`, `registerOnSpaceCreated`, and `configureProductUi`. Re-export kernel screens from `@adaven/platform-ui` — do not copy pages.
4. Inject `authProviders` + that app's OAuth client IDs.
5. Own `wrangler.toml` `name` + Cloudflare Pages project (**Direct Upload, no Git**). Auto-ship from GitHub Actions on `apps/<name>-app/**` only. Other apps stay on whatever they last shipped (`docs/PUBLISH.md`).
