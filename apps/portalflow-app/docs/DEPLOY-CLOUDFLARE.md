# Cloudflare Pages — Portalflow Web

Git SoT is **`jamesgao27/Adaven-platform`**. Pages project slug is **`portalflow`**. Do **not** deploy this app to live Vouchap (`vouchap`). Historical `jamesgao27/Vouchap` stays on that old project.

**Do not connect Git** on the Pages project. Push to `main` that touches `apps/portalflow-app/**` ships this app only (GitHub Actions → Direct Upload). Kernel-only commits do not deploy; use Actions **Run workflow** or the CLI. See **`docs/PUBLISH.md`**.

Kernel screens come from `@adaven/platform-ui`.

## Ship

**CI:** GitHub Action **Deploy Portalflow Web** (path filter `apps/portalflow-app/**`). Secrets in `docs/PUBLISH.md` (`PORTALFLOW_EXPO_PUBLIC_*` from the **new** Supabase project).

**CLI** from **Adaven-platform** root (uses `apps/portalflow-app/.env` at export time):

```bash
npm run portalflow:deploy:web
```

```bash
cd apps/portalflow-app
npx expo export -p web
cp -f public/_redirects dist/_redirects
npx wrangler pages deploy dist --project-name=portalflow
```

## Dashboard

Workers & Pages → create **`portalflow`** via Direct Upload (no Git). Never set frozen Vouchap or Wholestore keys on this project.

## EAS

First native ship: `cd apps/portalflow-app && eas init` (new Expo project). Do **not** reuse Vouchap `projectId` `f98c5cea-…`.

```bash
cd apps/portalflow-app
eas build --platform all --profile production
```

`eas-build-pre-install` runs `npm ci` at the monorepo root so `@adaven/platform-*` resolve.

## SPA routing

`public/_redirects` copies into `dist`:

```
/*    /index.html   200
```
