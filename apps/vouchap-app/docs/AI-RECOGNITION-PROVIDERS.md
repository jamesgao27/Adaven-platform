# AI recognition providers (Gemini & DeepSeek)

Vouchap routes all receipt / voucher / tax-filing recognition through the Supabase Edge Function **`gemini-proxy`** (name kept for backward compatibility). The function supports:

| Provider | Secret | Default model env |
|----------|--------|-------------------|
| **gemini** (default) | `GEMINI_API_KEY` | `GEMINI_MODEL_DEFAULT` (`gemini-3.5-flash`; free-tier order in `gemini-helper`) |
| **deepseek** | `DEEPSEEK_API_KEY` | `DEEPSEEK_MODEL_DEFAULT` (`deepseek-chat`) |

Keys stay **server-side only**.

### Does DeepSeek have vision models?

Yes, but **not on the hosted API** you configure with `DEEPSEEK_API_KEY`:

| Product | Vision / OCR | Available via `api.deepseek.com`? |
|---------|----------------|-----------------------------------|
| **deepseek-v4-pro**, **deepseek-v4-flash**, **deepseek-chat** | Text only | Yes — `POST /chat/completions` |
| **DeepSeek-VL / VL2**, **Janus / Janus-Pro** | Image understanding, OCR | **No** — open weights on Hugging Face; self-host on your own GPU |

Official API model list: [api-docs.deepseek.com](https://api-docs.deepseek.com/) (V4 Flash / Pro only; no `image_url` in messages).

So for Vouchap (Supabase Edge → DeepSeek cloud API), **receipt photos cannot use DeepSeek-VL/Janus** unless you run a separate self-hosted inference service — that is out of scope for `gemini-proxy` today.

### Receipt photos and DeepSeek (hosted API)

The DeepSeek **chat** API is **text-only** — it returns HTTP 400 if the payload includes `image_url`. Vouchap expense/receipt capture always sends a photo, so with `AI_PROVIDER_DEFAULT=deepseek` the Edge function automatically uses **Gemini vision fallback** when `GEMINI_API_KEY` is set (`AI_VISION_FALLBACK_GEMINI` is not `false`).

- **Recommended**: keep a working `GEMINI_API_KEY` (paid Tier 1 if free tier is exhausted) for images, and use DeepSeek for text-only flows (chat-to-log text, documents already converted to text, etc.).
- **DeepSeek-only** (no Gemini key): receipt photo recognition will fail with an explicit error in function logs and in `recognition_notice`. The mobile/web app sends the user JWT and optional `provider` in the request body.

## Enable DeepSeek

```bash
cd vouchap-app
supabase secrets set DEEPSEEK_API_KEY=your_deepseek_key
supabase secrets set AI_PROVIDER_DEFAULT=deepseek
# Optional:
supabase secrets set DEEPSEEK_MODEL_DEFAULT=deepseek-chat
supabase secrets set DEEPSEEK_ENFORCE_SERVER_MODEL=true
supabase functions deploy gemini-proxy
```

## Client build override (optional)

For local or EAS builds that should call DeepSeek without changing server default:

```bash
EXPO_PUBLIC_AI_PROVIDER=deepseek
```

`app.config.js` maps this to `extra.aiProvider`. When omitted, the client still sends `provider: gemini` unless `EXPO_PUBLIC_AI_PROVIDER=deepseek`.

Server wins for model enforcement when `DEEPSEEK_ENFORCE_SERVER_MODEL=true` or `GEMINI_ENFORCE_SERVER_MODEL=true`.

## API shape

- **Gemini**: native `generateContent` parts (text + `inlineData` images).
- **DeepSeek**: OpenAI-compatible `POST /chat/completions` with `image_url` data URIs (converted in the Edge function).

`listModels` for DeepSeek returns a static catalog (`deepseek-chat`, `deepseek-reasoner`, `deepseek-v4-flash`, `deepseek-v4-pro`).

## Old app builds (no reinstall)

If you only set Supabase secrets, a **previously installed** app can still work:

1. **Redeploy** the Edge function (secrets alone are not enough for new code paths):
   `supabase functions deploy gemini-proxy`
2. Set `AI_PROVIDER_DEFAULT=deepseek` and `DEEPSEEK_API_KEY`.
3. Recommended: `DEEPSEEK_ENFORCE_SERVER_MODEL=true` and `DEEPSEEK_MODEL_DEFAULT=deepseek-chat`.

The Edge function remaps legacy requests that send Gemini model names (e.g. `gemini-1.5-flash`) to your DeepSeek default model. It also uses `AI_PROVIDER_DEFAULT` when the app does not send `provider` (or sends `provider: gemini` from an older build).

**Verify in Supabase → Edge Functions → gemini-proxy → Logs** after one recognition attempt. You should see:

`[gemini-proxy] calling DeepSeek API` with `"model":"deepseek-chat"` (or your default).

If logs still show `calling DeepSeek API` with `hasInlineImage:true` and recognition fails, DeepSeek rejected the image (text-only API). After the vision-fallback update, logs should show `DeepSeek cannot accept images; Gemini vision fallback` when `GEMINI_API_KEY` is set.

If logs still show `calling Gemini API` only (no fallback line) and `AI_PROVIDER_DEFAULT=deepseek`, redeploy the latest `gemini-proxy` build.

## Switch back to Gemini

```bash
supabase secrets set AI_PROVIDER_DEFAULT=gemini
# Ensure GEMINI_API_KEY is set
supabase functions deploy gemini-proxy
```

Unset `EXPO_PUBLIC_AI_PROVIDER` or set it to `gemini` for client builds.

## Related

- `docs/GEMINI-API-SECURITY.md` — key hygiene and CORS
- `supabase/functions/gemini-proxy/README.md` — deploy notes
