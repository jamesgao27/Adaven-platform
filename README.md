# Adaven Platform

Shared **Space / members / invitations / third-party login** kernel for Adaven products.

GitHub: https://github.com/jamesgao27/Adaven-platform

- **This repo** (`/Users/macbook/Adaven-platform`): platform packages. Apps stay in their own repos until they are copied under `apps/`.
- **Not** a unified login. Each app has its own Supabase; Google/Apple/Microsoft credentials are per-app.
- **Vouchap** (`/Users/macbook/Vouchap/vouchap-app`) currently consumes these packages via `file:` + Metro alias. Native `ios/` / `android/` stay in the Vouchap repo.

## Packages

| Package | Role |
|---|---|
| `@adaven/platform-core` | session, spaces, invitations, members, `registerOnSpaceCreated`, `signInWithOAuth(provider)` |
| `@adaven/platform-ui` | Switch Space modal, third-party sign-in buttons |
| `@adaven/db-platform` | Slim SQL (`create_space_core`) — **do not apply until an app is ready to cut over** |

## SQL

Do **not** push or apply `packages/db-platform/sql` (or Vouchap's matching migration) until explicitly requested. Vouchap still uses existing product RPCs (`create_space_with_user`, etc.).

## New app checklist

1. Copy an Expo shell into `apps/<name>-app`.
2. Create a **new** Supabase project; apply `packages/db-platform/sql` only when that app is ready.
3. Pin platform package versions (do not ship unbounded `workspace:*` to stores).
4. Call `bindPlatformClient(supabase)` and `registerOnSpaceCreated` for product seeds.
5. Inject `authProviders` + that app's OAuth client IDs.
