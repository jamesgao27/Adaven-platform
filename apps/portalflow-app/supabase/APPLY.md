# Apply Portalflow schema (new empty Supabase only)

**Project:** `xvqlqvtfogxkfeillvig` (`https://xvqlqvtfogxkfeillvig.supabase.co`). Linked from this directory.

Portalflow is a **new** product. Do **not**:

- `supabase link` or `db push` this folder onto live Vouchap (`giuacjbfsyrristkigmz`)
- apply these migrations on Wholestore (`foyecolycmxcneflpant`)
- apply `packages/db-platform/sql/010_wholestore_provider_consumer.sql` here (that creates Wholestore `provider`/`consumer` schemas)
- import Vouchap `auth.users` or storage

## Already applied (2026-09-04)

- `npx supabase db push` — full migration chain including kernel `provider`/`consumer` and `create_space_with_user`
- PostgREST `pgrst.db_schemas` = `public, graphql_public, crm, firm` (via `ALTER ROLE authenticator`; Dashboard API config push returned 403 for this CLI role)
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

- historical product overlay (`firm.*`, receipts, tax filing, CRM)
- kernel kinds `provider` | `consumer` on `public.spaces`
- `20260904010000_portalflow_kernel_space_core.sql` — `create_space_core(p_kind)` + product wrapper `create_space_with_user`

UI labels: **Firm** = `provider`, **Client** = `consumer`. Overlay table names stay `firm.*`.
