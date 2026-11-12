import { inferComplexGeminiContent } from './gemini-helper';

/** Default chat model (OpenAI-compatible API; supports vision via image_url in proxy). */
export const DEEPSEEK_PRIMARY_MODEL = 'deepseek-chat' as const;

/** Heavier reasoning fallback when content is complex (PDF, long prompt, large image). */
export const DEEPSEEK_REASONER_MODEL = 'deepseek-reasoner' as const;

const DEEPSEEK_STATIC_MODELS = [
  DEEPSEEK_PRIMARY_MODEL,
  DEEPSEEK_REASONER_MODEL,
  'deepseek-v4-flash',
  'deepseek-v4-pro',
] as const;

/** Models returned by Edge `listModels` when provider is deepseek (static catalog). */
export function getDeepseekListModelsPayload(): Array<{
  name: string;
  supportedGenerationMethods?: string[];
}> {
  return DEEPSEEK_STATIC_MODELS.map((name) => ({
    name,
    supportedGenerationMethods: ['generateContent'],
  }));
}

/**
 * Try-order for DeepSeek: fast chat first; complex inputs prefer reasoner then chat.
 * Server may override via DEEPSEEK_MODEL_DEFAULT + DEEPSEEK_ENFORCE_SERVER_MODEL.
 */
export function resolveDeepseekModelsToTryOrder(complexity: {
  promptTextLength: number;
  inlineBase64Length?: number;
  mimeType?: string;
}): string[] {
  const preferReasoner = inferComplexGeminiContent(complexity);
  if (preferReasoner) {
    return [DEEPSEEK_REASONER_MODEL, DEEPSEEK_PRIMARY_MODEL];
  }
  return [DEEPSEEK_PRIMARY_MODEL, DEEPSEEK_REASONER_MODEL];
}
