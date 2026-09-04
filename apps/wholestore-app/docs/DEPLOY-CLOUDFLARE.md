# Cloudflare Pages — Wholestore Web

Same **export + Wrangler Direct Upload** as Vouchap, **different Pages project**.  
Vouchap’s live project is **`vouchap`**. This app uses **`wholestore` only**.

**Do not connect Git** on the Pages project (same repo as Vouchap would auto-build both). Push to `main` that touches `apps/wholestore-app/**` ships this app only. See **`docs/PUBLISH.md`**.

Shared kernel screens come from `@adaven/platform-ui`.

## Ship

**CI:** GitHub Action **Deploy Wholestore Web** (path filter `apps/wholestore-app/**`). Secrets in `docs/PUBLISH.md`.

**CLI** from the monorepo root (`npx wrangler login` once). Uses `apps/wholestore-app/.env` at export time:

```bash
npm run wholestore:deploy:web
```

## Dashboard

Create Pages project **`wholestore`** as **Direct Upload** (not Connect to Git). First deploy is the command above.

| Name | Value (local `.env` when shipping) |
|------|--------|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://foyecolycmxcneflpant.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Wholestore anon key (Dashboard → Settings → API) |

Never reuse Vouchap (`giuacjbfsyrristkigmz`) keys.

## SPA routing

`public/_redirects` copies into `dist`:

```
/*    /index.html   200
```
