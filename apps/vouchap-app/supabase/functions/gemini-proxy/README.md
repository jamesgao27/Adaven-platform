# gemini-proxy (Gemini + DeepSeek)

Server-side AI for recognition: **`generateContent`** and **`listModels`**. API keys only in Function secrets.

## Providers

| `AI_PROVIDER_DEFAULT` | Required secret | Optional |
|----------------------|-----------------|----------|
| `gemini` (default) | `GEMINI_API_KEY` | `GEMINI_MODEL_DEFAULT`, `GEMINI_ENFORCE_SERVER_MODEL` |
| `deepseek` | `DEEPSEEK_API_KEY` | `DEEPSEEK_MODEL_DEFAULT`, `DEEPSEEK_ENFORCE_SERVER_MODEL`, `DEEPSEEK_API_BASE` |

Clients may pass `provider: "gemini" | "deepseek"` in the JSON body; otherwise `AI_PROVIDER_DEFAULT` is used.

See `docs/AI-RECOGNITION-PROVIDERS.md` for full setup.

## Security

- **`verify_jwt = true`** (see `supabase/config.toml`): callers must use a valid Supabase session JWT.
- Function **re-validates** the user via `auth.getUser()` using `Authorization` + `SUPABASE_ANON_KEY`.
- Optional **`GEMINI_PROXY_ALLOWED_ORIGINS`**: comma-separated browser Origins. If set, requests with an `Origin` header not in the list get **403**. Omitted or empty keeps `*` (mobile clients often send no `Origin`).

## Deploy

```bash
cd vouchap-app
supabase functions deploy gemini-proxy
```

After code changes, **redeploy**. No new mobile app build is required unless client recognition paths change.

- Gemini `listModels` uses Google API with `x-goog-api-key` header.
- DeepSeek `listModels` returns a static model list (no public list API).
