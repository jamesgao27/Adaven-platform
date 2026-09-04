# Cloudflare Pages — Vouchap Web

Git SoT is **`jamesgao27/Adaven-platform`**. Pages project slug stays **`vouchap`**. Do not create a second Vouchap project. Historical `jamesgao27/Vouchap` is backup only.

**Do not connect Git** on the Pages project. Push to `main` that touches `apps/vouchap-app/**` ships this app only (GitHub Actions → Direct Upload). Kernel-only commits do not deploy; use Actions **Run workflow** or the CLI. See **`docs/PUBLISH.md`**.

Kernel screens come from `@adaven/platform-ui`.

## Ship

**CI:** GitHub Action **Deploy Vouchap Web** (path filter `apps/vouchap-app/**`). Secrets in `docs/PUBLISH.md`.

**CLI** from **Adaven-platform** root (uses `apps/vouchap-app/.env` at export time):

```bash
npm run vouchap:deploy:web
```

```bash
cd apps/vouchap-app
npx expo export -p web
cp -f public/_redirects dist/_redirects
npx wrangler pages deploy dist --project-name=vouchap
```

## Dashboard

Workers & Pages → **vouchap** → Settings → Builds & deployments → **Disconnect Git** if a repository is linked (`jamesgao27/Vouchap` / `AI-Tax-filing`, or `Adaven-platform`). Keep Vouchap Production variables. Never set Wholestore keys.

Until Git is disconnected, push to the old Vouchap repo can still replace this site.

## EAS

```bash
cd apps/vouchap-app
eas build --platform all --profile production
```

`eas-build-pre-install` runs `npm ci` at the monorepo root so `@adaven/platform-*` resolve.

## SPA routing

`public/_redirects` copies into `dist`:

```
/*    /index.html   200
```
