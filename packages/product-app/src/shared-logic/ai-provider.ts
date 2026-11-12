import Constants from 'expo-constants';

/** LLM vendor routed through Supabase Edge Function `gemini-proxy` (multi-provider). */
export type AiProvider = 'gemini' | 'deepseek';

const extra = (Constants.expoConfig as { extra?: Record<string, unknown> } | null)?.extra ?? {};

function normalizeProvider(raw: unknown): AiProvider | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'gemini' || s === 'deepseek') return s;
  return null;
}

/**
 * Explicit client override only (`EXPO_PUBLIC_AI_PROVIDER` / `extra.aiProvider`).
 * When undefined, do not send `provider` in the Edge request — server uses `AI_PROVIDER_DEFAULT`.
 */
export function getClientAiProviderOverride(): AiProvider | undefined {
  const fromPublicEnv = normalizeProvider(process.env.EXPO_PUBLIC_AI_PROVIDER);
  if (fromPublicEnv) return fromPublicEnv;
  const fromExtra = normalizeProvider(extra.aiProvider);
  if (fromExtra) return fromExtra;
  return undefined;
}

/** Effective provider for local model ordering (defaults to gemini until server responds). */
export function getRecognitionAiProvider(): AiProvider {
  return getClientAiProviderOverride() ?? 'gemini';
}

export function getRecognitionApiKeyPlaceholder(): string {
  return getRecognitionAiProvider() === 'deepseek'
    ? 'server-side-deepseek-proxy'
    : 'server-side-gemini-proxy';
}

/** User-facing setup hint (English). */
export function getAiProxySetupHint(provider: AiProvider = getRecognitionAiProvider()): string {
  if (provider === 'deepseek') {
    return (
      'Configure Supabase Edge Function `gemini-proxy` secrets (DEEPSEEK_API_KEY required; optional ' +
      'DEEPSEEK_MODEL_DEFAULT, DEEPSEEK_ENFORCE_SERVER_MODEL, AI_PROVIDER_DEFAULT=deepseek) and redeploy the function.'
    );
  }
  return (
    'Configure Supabase Edge Function `gemini-proxy` secrets (GEMINI_API_KEY required; optional ' +
    'GEMINI_MODEL_DEFAULT, GEMINI_ENFORCE_SERVER_MODEL) and redeploy the function.'
  );
}

export const AI_PROXY_UNAVAILABLE_CODE = 'AI_PROXY_UNAVAILABLE';
