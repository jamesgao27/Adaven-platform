# Gemini API security (Vouchap)

> **Multi-provider:** DeepSeek is supported via the same Edge function. See [`AI-RECOGNITION-PROVIDERS.md`](./AI-RECOGNITION-PROVIDERS.md).

## Architecture

| Layer | Responsibility |
|-------|----------------|
| **Mobile / Web app** | Calls Supabase Edge Function `gemini-proxy` with the user JWT. No vendor API keys in the bundle. |
| **`gemini-proxy`** | Holds `GEMINI_API_KEY` and/or `DEEPSEEK_API_KEY` (Supabase secrets). Validates session via `auth.getUser()`. Forwards `generateContent` / `listModels`. |
| **Google Cloud / DeepSeek** | Restrict keys by API + IP/app as needed; rotate on leak. |

Client placeholder: `app.config.js` → `extra.geminiApiKey = 'server-side-gemini-proxy'` (not a real key).

## Configure secrets (server only)

```bash
cd vouchap-app
supabase secrets set GEMINI_API_KEY=your_key_here
supabase functions deploy gemini-proxy
```

Optional function env:

- `GEMINI_PROXY_ALLOWED_ORIGINS` — comma-separated web Origins (e.g. production web URL). Omit for mobile (`*` when no Origin).
- `GEMINI_MODEL_DEFAULT` / `GEMINI_ENFORCE_SERVER_MODEL` — server-side model policy. Do **not** use retired IDs such as `gemini-1.5-flash` (404); prefer `gemini-3.5-flash` or omit the secret.

## Do not

- Put `EXPO_PUBLIC_GEMINI_API_KEY` in EAS, `.env`, or source.
- Commit keys matching `AIza…` (pre-commit hook blocks staged leaks).
- Log full API keys in app or Edge logs.

## Optional local smoke test (not used by the app)

From repo root, with a **local-only** env var (never commit):

```bash
GEMINI_API_KEY=... node test-gemini-api-simple.js
```

## Ops checklist

- [ ] `GEMINI_API_KEY` only in Supabase secrets
- [ ] Remove obsolete `EXPO_PUBLIC_GEMINI_API_KEY` from EAS if present
- [ ] GCP: API restrictions + usage alerts
- [ ] Web production: set `GEMINI_PROXY_ALLOWED_ORIGINS`
- [ ] Rotate key if ever exposed in git or docs
