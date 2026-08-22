# Cloudflare Pages — Vouchap Web

Git SoT is **`jamesgao27/Adaven-platform`**. Pages project slug stays **`vouchap`**. Do not create a second Vouchap project. Historical `jamesgao27/Vouchap` is backup only.

**Do not connect Git.** Production updates are Direct Upload only so Wholestore is not rebuilt when this repo is pushed. See **`docs/PUBLISH.md`**.

Kernel screens come from `@adaven/platform-ui`.

## Ship

From **Adaven-platform** root (uses `apps/vouchap-app/.env` at export time):

```bash
npm run vouchap:deploy:web
```

```bash
cd apps/vouchap-app
npx expo export -p web
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
