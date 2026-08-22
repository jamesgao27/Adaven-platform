# Wholestore

Expo shell (Web + later warehouse scan). **Independent** of Vouchap accounts.

| | |
|---|---|
| Supabase project | `foyecolycmxcneflpant` |
| URL | `https://foyecolycmxcneflpant.supabase.co` |
| Vouchap (do not reuse) | `giuacjbfsyrristkigmz` |

## Local

1. Copy `.env.example` → `.env`.
2. Paste the **anon** key from this project’s Dashboard → Settings → API (`EXPO_PUBLIC_SUPABASE_ANON_KEY`).
3. From repo root: `npm run wholestore:web`.

Space / members UI matches Vouchap: login, register, setup space (Factory / Dealer), invitations, Team, Space roles, Management (switch space).

## Web (Cloudflare Pages)

Same **export + Direct Upload** as Vouchap, **separate Pages project** (`wholestore`, **no Git**). `git push` does not deploy. See repo `docs/PUBLISH.md` and `docs/DEPLOY-CLOUDFLARE.md`.

```bash
npm run wholestore:deploy:web
```

## Database

Kernel SQL is in the repo; apply **only** on this project (never Vouchap):

See `supabase/APPLY.md`. After SQL: Dashboard → Settings → API → Exposed schemas → add `provider` and `consumer`.
