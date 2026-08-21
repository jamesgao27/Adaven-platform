import { getClientAiProviderOverride, getRecognitionAiProvider } from './ai-provider';
import { resolveDeepseekModelsToTryOrder } from './deepseek-helper';
import {
  invalidateGeminiModelTryOrderCache,
  resolveGeminiOnlyModelsToTryOrder,
} from './gemini-helper';

/** Unified model try-order for receipt / voucher / tax-filing recognition. */
export async function resolveModelsToTryOrder(complexity: {
  promptTextLength: number;
  inlineBase64Length?: number;
  mimeType?: string;
}): Promise<string[]> {
  const provider = getClientAiProviderOverride() ?? getRecognitionAiProvider();
  if (provider === 'deepseek') {
    return resolveDeepseekModelsToTryOrder(complexity);
  }
  return resolveGeminiOnlyModelsToTryOrder(complexity);
}

/** Backward-compatible alias used across recognition modules. */
export async function resolveGeminiModelsToTryOrder(complexity: {
  promptTextLength: number;
  inlineBase64Length?: number;
  mimeType?: string;
}): Promise<string[]> {
  return resolveModelsToTryOrder(complexity);
}

export function invalidateModelTryOrderCache(): void {
  invalidateGeminiModelTryOrderCache();
}
