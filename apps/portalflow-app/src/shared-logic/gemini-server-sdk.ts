import { FunctionsHttpError } from '@supabase/supabase-js';
import { getClientAiProviderOverride, type AiProvider } from './ai-provider';
import { supabase } from './supabase';

/** When Edge returns 4xx/5xx, functions-js sets data=null and throws FunctionsHttpError; JSON body is on error.context (Response). */
async function readEdgeFunctionJsonError(error: unknown): Promise<string | undefined> {
  if (!(error instanceof FunctionsHttpError)) return undefined;
  const res = error.context as unknown;
  if (!res || typeof (res as Response).clone !== 'function') return undefined;
  try {
    const response = res as Response;
    const ct = response.headers.get('Content-Type') || '';
    if (!ct.includes('application/json')) return undefined;
    const body: unknown = await response.clone().json();
    if (body && typeof body === 'object') {
      const o = body as { error?: unknown; message?: unknown };
      if (typeof o.error === 'string' && o.error.trim()) return o.error.trim();
      if (typeof o.message === 'string' && o.message.trim()) return o.message.trim();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

type InlineDataPart = {
  inlineData: {
    data: string;
    mimeType: string;
  };
};

type TextPart = string;
type GeminiContent = TextPart | InlineDataPart;

type AiProxyGenerateResponse = {
  success: boolean;
  text?: string;
  modelUsed?: string;
  provider?: AiProvider;
  error?: string;
};

type AiProxyListModelsResponse = {
  success: boolean;
  models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
  provider?: AiProvider;
  error?: string;
};

function resolveInvokeProvider(override?: AiProvider): AiProvider | undefined {
  return override ?? getClientAiProviderOverride();
}

class ProxyLlmModel {
  private readonly model: string;
  private readonly provider: AiProvider | undefined;

  constructor(model: string, provider: AiProvider | undefined) {
    this.model = model;
    this.provider = provider;
  }

  async generateContent(contents: GeminiContent | GeminiContent[]) {
    const parts = Array.isArray(contents) ? contents : [contents];
    const body: Record<string, unknown> = {
      action: 'generateContent',
      model: this.model,
      contents: parts,
    };
    if (this.provider) {
      body.provider = this.provider;
    }
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      let inlineChars = 0;
      for (const p of parts) {
        if (p && typeof p === 'object' && 'inlineData' in p) {
          const d = (p as InlineDataPart).inlineData?.data;
          if (typeof d === 'string') inlineChars += d.length;
        }
      }
      console.log('[ai-proxy] invoking Edge Function generateContent', {
        provider: this.provider ?? '(server AI_PROVIDER_DEFAULT)',
        model: this.model,
        inlineImageBase64Chars: inlineChars,
      });
    }
    const { data, error } = await supabase.functions.invoke('gemini-proxy', {
      body,
      timeout: 180_000,
    });
    const payload = (data ?? null) as AiProxyGenerateResponse | null;
    const serverMsg =
      typeof payload?.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : null;
    if (payload?.success && payload.text) {
      return {
        response: {
          text: () => payload.text as string,
        },
        modelUsed: payload.modelUsed,
        provider: payload.provider ?? this.provider,
      };
    }
    const httpDetail = await readEdgeFunctionJsonError(error);
    throw new Error(
      serverMsg ||
        httpDetail ||
        (error instanceof Error ? error.message : String(error)) ||
        'AI proxy returned empty result',
    );
  }
}

/** Compatible shim for legacy `GoogleGenerativeAI` usage in recognition modules. */
export class GoogleGenerativeAI {
  private readonly provider: AiProvider | undefined;

  constructor(_apiKey: string, opts?: { provider?: AiProvider }) {
    this.provider = resolveInvokeProvider(opts?.provider);
  }

  getGenerativeModel(opts: { model: string }) {
    return new ProxyLlmModel(opts.model, this.provider);
  }
}

export async function listModelsViaGeminiProxy(providerOverride?: AiProvider): Promise<
  Array<{ name: string; supportedGenerationMethods?: string[] }>
> {
  const provider = resolveInvokeProvider(providerOverride);
  const body: Record<string, unknown> = { action: 'listModels' };
  if (provider) {
    body.provider = provider;
  }
  const { data, error } = await supabase.functions.invoke('gemini-proxy', {
    body,
    timeout: 60_000,
  });
  const payload = (data ?? null) as AiProxyListModelsResponse | null;
  const serverMsg =
    typeof payload?.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : null;
  if (payload?.success) {
    return payload.models ?? [];
  }
  const httpDetail = await readEdgeFunctionJsonError(error);
  throw new Error(serverMsg || httpDetail || error?.message || 'AI proxy listModels failed');
}
