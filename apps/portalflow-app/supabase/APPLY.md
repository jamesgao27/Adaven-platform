# Apply Portalflow schema (new empty Supabase only)

**Project:** `xvqlqvtfogxkfeillvig` (`https://xvqlqvtfogxkfeillvig.supabase.co`). Linked from this directory.

Portalflow is a **new** product. Do **not**:

- `supabase link` or `db push` this folder onto live Vouchap (`giuacjbfsyrristkigmz`)
- apply these migrations on Wholestore (`foyecolycmxcneflpant`)
- apply `packages/db-platform/sql/010_wholestore_provider_consumer.sql` here (that creates Wholestore `provider`/`consumer` schemas)
- import Vouchap `auth.users` or storage

## Already applied (2026-09-04)

- `npx supabase db push` — full migration chain including kernel `provider`/`consumer` and `create_space_with_user`
- PostgREST `pgrst.db_schemas` = `public, graphql_public, crm, provider, consumer` (via `ALTER ROLE authenticator` in `20260904150000`; Dashboard API config push returned 403 for this CLI role)
- Storage buckets: `receipts` (public), `marketplace` (public), `chat-audio` (private), `tax-filing` (private)
- Edge functions deployed: `gemini-proxy`, `send-invitation-email`
- Local `.env` + GitHub secrets `PORTALFLOW_EXPO_PUBLIC_*`
- Cloudflare Pages **`portalflow`** (Direct Upload, no Git) — `https://portalflow.pages.dev/`
- Auth URL Configuration: Site URL `https://portalflow.pages.dev` + redirect allow list (Owner)

## Later (not blocking register/login)

- **Authentication → SMTP** when invitation email should send (see `functions/send-invitation-email/README.md`)
- **`GEMINI_API_KEY`**: same Google key as live Vouchap. CLI user cannot write Portalflow secrets (403). Owner must add it in Dashboard → Project Settings → Edge Functions → Secrets. DeepSeek secrets are optional.

Resume SQL:

```bash
cd apps/portalflow-app
npx supabase db push
```

## What this push applies

All files under `apps/portalflow-app/supabase/migrations/`, including:

- historical product overlay (receipts, tax filing, CRM) then `20260904150000` (`firm.*` → `provider.*` + `consumer.consumers`), `20260904151000` (SECURITY DEFINER `search_path`), `20260904152000` (no UI words in DB: `dealer_*` → `consumer_*`, leftover firm/client index/constraint/policy names)
- kernel kinds `provider` | `consumer` on `public.spaces`
- `20260904010000_portalflow_kernel_space_core.sql` — `create_space_core(p_kind)` + product wrapper `create_space_with_user`

UI labels: **Firm** = `provider`, **Client** = `consumer`. Database identifiers are `provider` / `consumer` only (no firm/client/dealer/vendor in overlay table or column names). Portalflow keeps SKU items, 1:1 orders, groups, and permission roles.
