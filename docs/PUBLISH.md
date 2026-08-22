# Publish model — one kernel, independent ships

**Source of truth is this repo:** `jamesgao27/Adaven-platform`.  
The historical GitHub repo `jamesgao27/Vouchap` is a **backup only** — do not iterate the app there.

## Release contract

| Layer | Policy |
|-------|--------|
| Kernel (`packages/*`) | **One version for all apps.** npm workspaces always link current HEAD. Do not pin divergent `@adaven/*` versions per app. Do not publish private npm packages / Changesets for the kernel. |
| Product ship | **Independent cadence.** `git push` must **not** deploy any Web app. Ship Vouchap or Wholestore only when you run that app’s command (or EAS for native). The other product stays on whatever was last uploaded. |

Kernel screens (login, register, setup space, **Management**, members, invites, space roles) are **imported from `@adaven/platform-ui`**, not copied. Members / Space roles are reached from Management; the web sidebar is product business pages only.

```text
Adaven-platform (GitHub: jamesgao27/Adaven-platform)
├── packages/platform-core | platform-ui | db-platform   ← shared code (always HEAD)
├── apps/vouchap-app       → Pages **vouchap** · EAS existing · Supabase giuacjbfsyrristkigmz
└── apps/wholestore-app    → Pages **wholestore** · own EAS · Supabase foyecolycmxcneflpant
```

## How Web actually ships

**Direct Upload only** (`wrangler pages deploy`). Each app’s `deploy:web` exports Expo Web then uploads `dist` to **that** Pages project.

```bash
npx wrangler login                 # once
npm run vouchap:deploy:web         # Pages **vouchap** only — needs apps/vouchap-app/.env
npm run wholestore:deploy:web      # Pages **wholestore** only — needs apps/wholestore-app/.env

cd apps/vouchap-app && eas build --platform all --profile production
```

`EXPO_PUBLIC_*` is baked in at `expo export` time from the app `.env` on the machine that runs the command — not from a Git-connected Cloudflare build.

## Cloudflare Dashboard (required)

Do **not** connect Git to either Pages project. Same GitHub repo + two Git builds = one push can rebuild both (or rebuild the kernel into both). That violates independent cadence.

### Vouchap — existing project `vouchap`

Keep this project. **Disconnect Git** if it still shows `jamesgao27/Vouchap` / branch `AI-Tax-filing` (or if someone connected `Adaven-platform`).

1. Workers & Pages → **vouchap** → Settings → Builds & deployments  
2. **Disconnect** the Git repository (Direct Upload remains).  
3. Keep existing Production env / secrets (Vouchap Supabase only). Never add Wholestore keys.  
4. Thereafter: `npm run vouchap:deploy:web` from this monorepo.

Until Git is disconnected, push to the **old** Vouchap repo can still overwrite production.

### Wholestore — project `wholestore`

Create **Direct Upload** (not “Connect to Git”). Name must be `wholestore`.

| Setting | Value |
|--------|--------|
| Create via | Direct Upload / wrangler — **no Git** |
| `wrangler.toml` `name` | `wholestore` |
| First/later deploys | `npm run wholestore:deploy:web` |

Optional Dashboard env (not used by `expo export`; keep the real keys in `apps/wholestore-app/.env` when shipping):

| Name | Value |
|------|--------|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://foyecolycmxcneflpant.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | that project’s anon key |

Never reuse Vouchap (`giuacjbfsyrristkigmz`) keys.

## Apps (identity, not Git build roots)

| App | Pages project | Supabase | EAS |
|-----|---------------|----------|-----|
| Vouchap | **`vouchap`** (do not create another) | `giuacjbfsyrristkigmz` | existing `projectId` / `com.vouchap.app` |
| Wholestore | **`wholestore`** | `foyecolycmxcneflpant` | new app |

## Kernel UI

Apps must **re-export** screens from `@adaven/platform-ui` (see `configureProductUi` in each app bootstrap). Product-only pages (receipts, Firm CRM, inventory, dealers/orders/catalog) stay in the app folder.

Changing `packages/*` on `main` is **not** a production release. Each app picks up that kernel the next time **that** app is exported and deployed (or EAS-built).
