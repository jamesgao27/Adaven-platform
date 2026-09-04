# Publish model — one kernel, independent ships

**Source of truth is this repo:** `jamesgao27/Adaven-platform`.  
The historical GitHub repo `jamesgao27/Vouchap` is the **frozen live Vouchap product** — do not iterate the app there, and do not deploy Adaven apps onto its Pages project or Supabase.

## Release contract

| Layer | Policy |
|-------|--------|
| Kernel (`packages/*`) | **One version for all apps.** npm workspaces always link current HEAD. Do not pin divergent `@adaven/*` versions per app. Do not publish private npm packages / Changesets for the kernel. |
| Product ship | **Independent cadence.** Cloudflare Pages stays **Direct Upload** (never connect Git to project `portalflow`, `wholestore`, or frozen `vouchap`). GitHub Actions ships **one** app per matching path. A kernel-only push does **not** deploy either product. |
| Native | EAS **per app**. Portalflow needs a **new** EAS project (do not reuse Vouchap `projectId`). |

Kernel screens (login, register, setup space, **Management**, members, invites, space roles) are **imported from `@adaven/platform-ui`**, not copied. Members / Space roles are reached from Management; the web sidebar is product business pages only.

```text
Adaven-platform (GitHub: jamesgao27/Adaven-platform)
├── packages/platform-core | platform-ui | db-platform   ← shared code (always HEAD)
├── apps/portalflow-app    → Pages **portalflow** · new EAS · Supabase xvqlqvtfogxkfeillvig
└── apps/wholestore-app    → Pages **wholestore** · own EAS · Supabase foyecolycmxcneflpant

Frozen (other repo, do not touch from this tree)
└── jamesgao27/Vouchap     → Pages **vouchap** · EAS f98c5cea-… · giuacjbfsyrristkigmz
```

## How Web actually ships

**Direct Upload only** (`wrangler pages deploy`). Pages projects must **not** be Git-connected. Auto-publish is GitHub Actions calling Wrangler, with path filters so the two products never share a deploy.

| Trigger | What deploys |
|---------|----------------|
| Push to `main` touching `apps/portalflow-app/**` | Pages **portalflow** only |
| Push to `main` touching `apps/wholestore-app/**` | Pages **wholestore** only |
| Push touching only `packages/**` | **Nothing.** Run **Actions → Deploy Portalflow Web / Deploy Wholestore Web → Run workflow**, or the CLI below. |
| Local CLI | Same Direct Upload target as CI |

```bash
npx wrangler login                 # once, local CLI only
npm run portalflow:deploy:web      # Pages **portalflow** only — needs apps/portalflow-app/.env
npm run wholestore:deploy:web      # Pages **wholestore** only — needs apps/wholestore-app/.env

cd apps/portalflow-app && eas init   # first native ship only — new EAS app
cd apps/portalflow-app && eas build --platform all --profile production
```

`EXPO_PUBLIC_*` is baked in at `expo export` time. Local CLI reads the app `.env`. GitHub Actions reads repository secrets (not Cloudflare Dashboard build env, and not a Git-connected Pages build).

Workflows: `.github/workflows/deploy-portalflow-web.yml`, `.github/workflows/deploy-wholestore-web.yml`. Shared job: `.github/workflows/deploy-web-reusable.yml`. Do **not** add `packages/**` to both path filters.

**Never** point Portalflow deploy at Pages `vouchap`. That project is the live original product.

## GitHub Actions secrets / variables

Repo **Settings → Secrets and variables → Actions**.

| Kind | Name | Value |
|------|------|--------|
| Variable | `CLOUDFLARE_ACCOUNT_ID` | `d35e7797a19034742c36e14f27831bd4` |
| Secret | `CLOUDFLARE_API_TOKEN` | Token with **Account → Cloudflare Pages → Edit**. Create: [API Tokens](https://dash.cloudflare.com/profile/api-tokens) → Custom token. |
| Secret | `PORTALFLOW_EXPO_PUBLIC_SUPABASE_URL` | `https://xvqlqvtfogxkfeillvig.supabase.co` |
| Secret | `PORTALFLOW_EXPO_PUBLIC_SUPABASE_ANON_KEY` | That project’s anon key |
| Secret | `WHOLESTORE_EXPO_PUBLIC_SUPABASE_URL` | `https://foyecolycmxcneflpant.supabase.co` |
| Secret | `WHOLESTORE_EXPO_PUBLIC_SUPABASE_ANON_KEY` | Wholestore anon key |

Never put Wholestore keys in Portalflow secrets, or the reverse. Do not reuse frozen Vouchap keys for Portalflow.

## Cloudflare Dashboard (required)

Do **not** connect Git to either Adaven Pages project. Same GitHub repo + two Git builds = one push can rebuild both. Independent cadence is the path filters in GitHub Actions, not Pages Git.

### Portalflow — new project `portalflow`

Create via Direct Upload / wrangler. **No Git.**

| Setting | Value |
|--------|--------|
| Create via | Direct Upload / wrangler — **no Git** |
| `wrangler.toml` `name` | `portalflow` |
| Deploys | GitHub Action **Deploy Portalflow Web**, or `npm run portalflow:deploy:web` |

### Frozen Vouchap — existing project `vouchap`

Leave this project on the original product. Do **not** Direct-Upload Portalflow there.

### Wholestore — project `wholestore`

**Direct Upload** (not “Connect to Git”). Name must be `wholestore`.

| Setting | Value |
|--------|--------|
| Create via | Direct Upload / wrangler — **no Git** |
| `wrangler.toml` `name` | `wholestore` |
| Deploys | GitHub Action **Deploy Wholestore Web**, or `npm run wholestore:deploy:web` |

Optional Dashboard env (not used by CI `expo export`; keep the real keys in GitHub secrets / `apps/wholestore-app/.env`):

| Name | Value |
|------|--------|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://foyecolycmxcneflpant.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | that project’s anon key |

Never reuse Vouchap (`giuacjbfsyrristkigmz`) or Portalflow keys here.

## Apps (identity, not Git build roots)

| App | Pages project | Supabase | EAS |
|-----|---------------|----------|-----|
| Portalflow | **`portalflow`** | `xvqlqvtfogxkfeillvig` | new `eas init` / `com.portalflow.app` |
| Wholestore | **`wholestore`** | `foyecolycmxcneflpant` | own app |
| Vouchap (frozen, other repo) | **`vouchap`** | `giuacjbfsyrristkigmz` | existing `projectId` / `com.vouchap.app` |

## Kernel UI

Apps must **re-export** screens from `@adaven/platform-ui` (see `configureProductUi` in each app bootstrap). Product-only pages (receipts, Firm CRM, inventory, dealers/orders/catalog) stay in the app folder.

Changing `packages/*` on `main` is **not** a production release. Each app picks up that kernel the next time **that** app is exported (GitHub Action `workflow_dispatch`, path-matching push, or CLI) and Direct-Uploaded.
