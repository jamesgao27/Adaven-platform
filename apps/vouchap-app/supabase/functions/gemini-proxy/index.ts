import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.24.1';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getDeepseekListModelsPayload } from './deepseek-models.ts';

type AiProvider = 'gemini' | 'deepseek';

type InlineDataPart = {
  inlineData: {
    data: string;
    mimeType: string;
  };
};

type GeminiContentPart = string | InlineDataPart;

function parseAllowedOrigins(): string[] | null {
  const raw = Deno.env.get('GEMINI_PROXY_ALLOWED_ORIGINS')?.trim();
  if (!raw) return null;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeadersForRequest(req: Request): Record<string, string> {
  const allowed = parseAllowedOrigins();
  const origin = req.headers.get('Origin') || '';
  const allowOrigin =
    allowed == null || allowed.length === 0
      ? '*'
      : !origin
        ? '*'
        : allowed.includes(origin)
          ? origin
          : 'null';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

/** Hardcoded safe default when env / client still point at retired models (e.g. gemini-1.5-flash). */
const GEMINI_SAFE_FALLBACK_MODEL = 'gemini-3.5-flash';
const GEMINI_DEFAULT_MODEL = Deno.env.get('GEMINI_MODEL_DEFAULT') || GEMINI_SAFE_FALLBACK_MODEL;
const GEMINI_ENFORCE_SERVER_MODEL = Deno.env.get('GEMINI_ENFORCE_SERVER_MODEL') === 'true';

const DEEPSEEK_DEFAULT_MODEL = Deno.env.get('DEEPSEEK_MODEL_DEFAULT') || 'deepseek-chat';
const DEEPSEEK_ENFORCE_SERVER_MODEL = Deno.env.get('DEEPSEEK_ENFORCE_SERVER_MODEL') === 'true';
const DEEPSEEK_API_BASE = (Deno.env.get('DEEPSEEK_API_BASE') || 'https://api.deepseek.com').replace(
  /\/$/,
  '',
);

function jsonResponse(req: Request, payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeadersForRequest(req), 'Content-Type': 'application/json' },
  });
}

/**
 * Server `AI_PROVIDER_DEFAULT` wins over legacy clients that omit `provider` or send `provider: gemini`.
 * Explicit `provider: deepseek` in the body always uses DeepSeek.
 */
function resolveProvider(body: Record<string, unknown>): AiProvider {
  const serverDefault = (Deno.env.get('AI_PROVIDER_DEFAULT') || 'gemini').trim().toLowerCase();
  const serverDeepseek = serverDefault === 'deepseek';

  const fromBody = String(body?.provider ?? '').trim().toLowerCase();
  if (fromBody === 'deepseek') return 'deepseek';
  if (fromBody === 'gemini' && !serverDeepseek) return 'gemini';

  return serverDeepseek ? 'deepseek' : 'gemini';
}

/** Legacy app builds send Gemini model IDs; remap when the active provider is DeepSeek. */
function isGeminiStyleModelId(model: string): boolean {
  const m = model.trim().toLowerCase();
  return !m || m.startsWith('gemini') || m.startsWith('models/gemini');
}

/** Align with client gemini-helper GEMINI_FREE_TIER_MODEL_ORDER (AI Studio non-zero quota). */
const GEMINI_FREE_TIER_ALLOWED = [
  'gemini-3.5-flash',
  'gemini-3-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
];

function normalizeGeminiModelId(model: string): string {
  let s = model.trim().toLowerCase();
  if (s.startsWith('models/')) s = s.slice('models/'.length);
  return s;
}

function isGeminiModelAllowedOnFreeTier(model: string): boolean {
  const id = normalizeGeminiModelId(model);
  return GEMINI_FREE_TIER_ALLOWED.some((p) => id === p || id.startsWith(`${p}-`));
}

/** Block Pro / 1.5 / 2.0 / 2 Flash — 0 RPM on typical free tier. */
function isGeminiModelBlockedOnFreeTier(model: string): boolean {
  const id = normalizeGeminiModelId(model);
  if (!id.startsWith('gemini')) return true;
  if (/\bpro\b|gemini-.*-pro|pro-preview/.test(id)) return true;
  if (/gemini-1\.5/.test(id)) return true;
  if (/gemini-2\.0/.test(id)) return true;
  if (/gemini-2-flash/.test(id) && !/gemini-2\.5/.test(id)) return true;
  return !isGeminiModelAllowedOnFreeTier(id);
}

function pickAllowedGeminiModel(preferred: string): string {
  const p = preferred.trim();
  if (p && !isGeminiModelBlockedOnFreeTier(p)) return p;
  const fromEnv = GEMINI_DEFAULT_MODEL.trim();
  if (fromEnv && !isGeminiModelBlockedOnFreeTier(fromEnv)) return fromEnv;
  return GEMINI_SAFE_FALLBACK_MODEL;
}

function resolveModelForProvider(
  provider: AiProvider,
  clientModel: string,
): string {
  if (provider === 'deepseek') {
    if (
      DEEPSEEK_ENFORCE_SERVER_MODEL ||
      isGeminiStyleModelId(clientModel)
    ) {
      return DEEPSEEK_DEFAULT_MODEL;
    }
    return clientModel.trim() || DEEPSEEK_DEFAULT_MODEL;
  }
  const preferred = GEMINI_ENFORCE_SERVER_MODEL
    ? GEMINI_DEFAULT_MODEL
    : clientModel.trim() || GEMINI_DEFAULT_MODEL;
  return pickAllowedGeminiModel(preferred);
}

async function requireAuthenticatedUser(req: Request): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse(req, { success: false, error: 'Unauthorized' }, 401);
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return jsonResponse(req, { success: false, error: 'Server misconfigured.' }, 503);
  }
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id) {
    return jsonResponse(req, { success: false, error: 'Unauthorized' }, 401);
  }
  return { userId: user.id };
}

function contentsHasInlineImage(contents: GeminiContentPart[]): boolean {
  return contents.some(
    (p) =>
      p &&
      typeof p === 'object' &&
      'inlineData' in p &&
      !!(p as InlineDataPart).inlineData?.data,
  );
}

/** DeepSeek chat API is text-only; never send image_url (returns 400 unknown variant image_url). */
function contentsToDeepseekTextOnlyMessage(
  contents: GeminiContentPart[],
): { role: 'user'; content: string } {
  const textParts: string[] = [];
  for (const p of contents) {
    if (typeof p === 'string' && p.trim()) textParts.push(p);
  }
  return { role: 'user', content: textParts.join('\n\n') || '' };
}

function visionFallbackToGeminiEnabled(): boolean {
  return Deno.env.get('AI_VISION_FALLBACK_GEMINI') !== 'false';
}

async function geminiGenerateContent(
  apiKey: string,
  clientModel: string,
  contents: GeminiContentPart[],
): Promise<string> {
  const geminiModel = resolveModelForProvider('gemini', clientModel);
  const requested = clientModel.trim();
  if (requested && normalizeGeminiModelId(requested) !== normalizeGeminiModelId(geminiModel)) {
    console.info(
      '[gemini-proxy] remapped Gemini model',
      JSON.stringify({ requested, used: geminiModel }),
    );
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const result = await genAI.getGenerativeModel({ model: geminiModel }).generateContent(contents);
  const text = result?.response?.text?.();
  if (!text || !String(text).trim()) {
    throw new Error('Gemini returned empty text');
  }
  return String(text).trim();
}

async function deepseekGenerateContent(
  apiKey: string,
  model: string,
  contents: GeminiContentPart[],
): Promise<string> {
  const messages = [contentsToDeepseekTextOnlyMessage(contents)];
  const res = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${errBody.slice(0, 800)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (text == null || !String(text).trim()) {
    throw new Error('DeepSeek returned empty text');
  }
  return String(text).trim();
}

Deno.serve(async (req) => {
  const cors = corsHeadersForRequest(req);
  const allowed = parseAllowedOrigins();
  const origin = req.headers.get('Origin') || '';
  if (allowed && allowed.length > 0 && origin && !allowed.includes(origin)) {
    return jsonResponse(req, { success: false, error: 'Forbidden origin' }, 403);
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const auth = await requireAuthenticatedUser(req);
    if (auth instanceof Response) return auth;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const provider = resolveProvider(body);
    const action = String(body?.action || '').trim();
    const clientModel = String(body?.model || '').trim();
    const model = resolveModelForProvider(provider, clientModel);

    if (action === 'listModels') {
      if (provider === 'deepseek') {
        const deepseekKey = Deno.env.get('DEEPSEEK_API_KEY');
        if (!deepseekKey) {
          return jsonResponse(
            req,
            { success: false, error: 'DEEPSEEK_API_KEY is missing on server.' },
            503,
          );
        }
        return jsonResponse(req, { success: true, models: getDeepseekListModelsPayload(), provider });
      }

      const geminiKey = Deno.env.get('GEMINI_API_KEY');
      if (!geminiKey) {
        return jsonResponse(req, { success: false, error: 'GEMINI_API_KEY is missing on server.' }, 503);
      }
      const response = await fetch('https://generativelanguage.googleapis.com/v1/models', {
        headers: { 'x-goog-api-key': geminiKey },
      });
      if (!response.ok) {
        return jsonResponse(
          req,
          { success: false, error: `listModels failed: ${response.status}` },
          400,
        );
      }
      const data = await response.json();
      return jsonResponse(req, { success: true, models: data?.models || [], provider });
    }

    if (action === 'generateContent') {
      const contents = Array.isArray(body?.contents) ? (body.contents as GeminiContentPart[]) : [];
      if (contents.length === 0) {
        return jsonResponse(req, { success: false, error: 'contents is required' }, 400);
      }

      const hasInlineImage = contentsHasInlineImage(contents);

      if (provider === 'deepseek') {
        const deepseekKey = Deno.env.get('DEEPSEEK_API_KEY');
        if (!deepseekKey) {
          return jsonResponse(
            req,
            { success: false, error: 'DEEPSEEK_API_KEY is missing on server.' },
            503,
          );
        }

        // Receipt / voucher photo recognition requires vision; DeepSeek chat API rejects images.
        if (hasInlineImage) {
          const geminiKey = Deno.env.get('GEMINI_API_KEY');
          if (geminiKey && visionFallbackToGeminiEnabled()) {
            const geminiModel = resolveModelForProvider('gemini', clientModel);
            console.info(
              '[gemini-proxy] DeepSeek cannot accept images; Gemini vision fallback',
              JSON.stringify({ geminiModel, parts: contents.length, provider }),
            );
            const text = await geminiGenerateContent(geminiKey, geminiModel, contents);
            return jsonResponse(req, {
              success: true,
              text,
              modelUsed: geminiModel,
              provider: 'gemini',
              visionFallback: true,
            });
          }
          console.warn(
            '[gemini-proxy] image recognition blocked: DeepSeek is text-only and GEMINI_API_KEY vision fallback is unavailable',
          );
          return jsonResponse(
            req,
            {
              success: false,
              error:
                'Receipt image recognition requires a vision model. The DeepSeek chat API does not accept images. ' +
                'Set GEMINI_API_KEY on this Supabase project for automatic vision fallback, or set AI_PROVIDER_DEFAULT=gemini.',
            },
            400,
          );
        }

        console.info(
          '[gemini-proxy] calling DeepSeek API (text only)',
          JSON.stringify({ model, parts: contents.length, hasInlineImage, provider }),
        );
        const text = await deepseekGenerateContent(deepseekKey, model, contents);
        return jsonResponse(req, { success: true, text, modelUsed: model, provider });
      }

      const geminiKey = Deno.env.get('GEMINI_API_KEY');
      if (!geminiKey) {
        return jsonResponse(req, { success: false, error: 'GEMINI_API_KEY is missing on server.' }, 503);
      }
      const geminiModelUsed = resolveModelForProvider('gemini', clientModel);
      console.info(
        '[gemini-proxy] calling Gemini API',
        JSON.stringify({
          model: geminiModelUsed,
          clientModel: clientModel || null,
          parts: contents.length,
          hasInlineImage,
          provider,
        }),
      );
      const text = await geminiGenerateContent(geminiKey, clientModel, contents);
      return jsonResponse(req, {
        success: true,
        text,
        modelUsed: geminiModelUsed,
        provider,
      });
    }

    return jsonResponse(req, { success: false, error: 'Unsupported action' }, 400);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[gemini-proxy] request failed:', msg);
    return jsonResponse(req, { success: false, error: msg }, 500);
  }
});
