# Adaven Platform

Shared **Space / members / invitations / third-party login** kernel, plus product apps.

GitHub: https://github.com/jamesgao27/Adaven-platform

- **Source of truth for Vouchap the app** is `apps/vouchap-app` in **this** repo. Push git here; EAS / Cloudflare from that folder.
- **Not** a unified login. Each app has its own Supabase; Google/Apple/Microsoft credentials are per-app.
- Historical backup: https://github.com/jamesgao27/Vouchap (do not continue app development there). Marketing site and CRM stay in their own repos.

## Layout

```text
packages/platform-core    session, spaces, invites, OAuth
packages/platform-ui      Switch Space, third-party sign-in buttons
packages/db-platform      slim SQL (do not apply until an app is ready)
apps/vouchap-app          Vouchap Expo app (EAS projectId + bundle id unchanged)
```

## Vouchap develop / ship

```bash
npm install
npm run vouchap:web          # or: npm run vouchap:start
cd apps/vouchap-app && eas build --platform all --profile production
cd apps/vouchap-app && npm run deploy:web
```

Changing `packages/platform-core` does **not** auto-publish Vouchap. Store / web releases still require an explicit EAS or Cloudflare build of `apps/vouchap-app`.

## Packages

| Package | Role |
|---|---|
| `@adaven/platform-core` | session, spaces, invitations, members, `registerOnSpaceCreated`, `signInWithOAuth(provider)` |
| `@adaven/platform-ui` | Switch Space modal, third-party sign-in buttons |
| `@adaven/db-platform` | Slim SQL (`create_space_core`) — **do not apply until an app is ready to cut over** |

## SQL

Do **not** push or apply `packages/db-platform/sql` until explicitly requested. Vouchap still uses existing product RPCs (`create_space_with_user`, etc.).

## New app checklist

1. Copy an Expo shell into `apps/<name>-app`.
2. Create a **new** Supabase project; apply `packages/db-platform/sql` only when that app is ready.
3. Call `bindPlatformClient(supabase)` and `registerOnSpaceCreated` for product seeds.
4. Inject `authProviders` + that app's OAuth client IDs.
5. Ship that app with its own EAS / Cloudflare build — other apps stay on whatever they last shipped.
