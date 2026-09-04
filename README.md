# Adaven Platform

Shared **Space / members / invitations / third-party login** kernel, plus product apps.

GitHub: https://github.com/jamesgao27/Adaven-platform

- **Source of truth for Vouchap the app** is `apps/vouchap-app` in **this** repo. Push to `main` auto-ships **only the app whose folder changed** (GitHub Actions → Wrangler Direct Upload). Cloudflare Pages stays disconnected from Git. See **`docs/PUBLISH.md`**.
- **One kernel, many apps**: shared `packages/*` is always HEAD for every app (no per-app kernel versions). Each app has its own Supabase, EAS, and **Cloudflare Pages project** (Direct Upload). Vouchap keeps the existing Pages project; Wholestore uses a different one. Kernel-only commits do not auto-deploy.
- **Not** a unified login. Google/Apple/Microsoft credentials are per-app.
- Historical backup: https://github.com/jamesgao27/Vouchap (do not continue app development there). Marketing site and CRM stay in their own repos.

## Layout

```text
packages/platform-core    session, spaces, invites, OAuth
packages/platform-ui      Login / register / setup space / members / invites / space roles (plus Switch Space, OAuth buttons)
packages/db-platform      slim SQL (do not apply until an app is ready)
apps/vouchap-app          Vouchap Expo app → Supabase **giuacjbfsyrristkigmz**
apps/wholestore-app       Wholestore Expo shell → Supabase **foyecolycmxcneflpant**
```

## Vouchap develop / ship

```bash
npm install
npm run vouchap:web          # or: npm run vouchap:start
cd apps/vouchap-app && eas build --platform all --profile production
npm run vouchap:deploy:web   # Pages **vouchap** only (same target as Actions)
```

## Wholestore develop / ship

```bash
# apps/wholestore-app/.env
EXPO_PUBLIC_SUPABASE_URL=https://foyecolycmxcneflpant.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key from that project>

npm run wholestore:web
npm run wholestore:deploy:web   # Pages **wholestore** only; never Vouchap (same target as Actions)
```

Kernel SQL is ready. Apply **only** on `foyecolycmxcneflpant` (see `apps/wholestore-app/supabase/APPLY.md`). Never on Vouchap. **Applied 2026-08-21** (`000` + `010`, schemas exposed).

## Packages

| Package | Role |
|---|---|
| `@adaven/platform-core` | session, spaces, invitations, members, `registerOnSpaceCreated`, `signInWithOAuth(provider)` |
| `@adaven/platform-ui` | Kernel **screens** + Switch Space + third-party sign-in. Apps call `configureProductUi` then re-export screens. |
| `@adaven/db-platform` | Kernel SQL. Wholestore: `000_kernel.sql` then `010_wholestore_provider_consumer.sql` |

## SQL

- **Vouchap** (`giuacjbfsyrristkigmz`): do not apply db-platform scripts; it already has product RPCs (`create_space_with_user`, Firm schema, …).
- **Wholestore** (`foyecolycmxcneflpant`): apply `000_kernel.sql` then `010_wholestore_provider_consumer.sql`. Skip `001_create_space_core.sql`. Details: `apps/wholestore-app/supabase/APPLY.md`.

Wholestore names: `firm` → `provider`, `client` → `consumer` (`spaces.kind`, schemas, columns). No business tables in this pass.

## New app checklist

1. Copy an Expo shell into `apps/<name>-app`.
2. Create a **new** Supabase project; apply `packages/db-platform/sql` only when that app is ready.
3. Call `bindPlatformClient(supabase)`, `registerOnSpaceCreated`, and `configureProductUi`. Re-export kernel screens from `@adaven/platform-ui` — do not copy pages.
4. Inject `authProviders` + that app's OAuth client IDs.
5. Own `wrangler.toml` `name` + Cloudflare Pages project (**Direct Upload, no Git**). Auto-ship from GitHub Actions on `apps/<name>-app/**` only. Other apps stay on whatever they last shipped (`docs/PUBLISH.md`).
