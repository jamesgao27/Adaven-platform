// 辅助函数：列出所有可用的 Gemini 模型
import { getClientAiProviderOverride } from './ai-provider';
import { listModelsViaGeminiProxy } from './gemini-server-sdk';

/**
 * 严格获取 API Key
 * 排除 EAS 可能注入的 "${EXPO_PUBLIC_...}" 这种无效字符串
 */
const getSafeApiKey = (): string => 'server-side-gemini-proxy';
const apiKey = getSafeApiKey();

/**
 * 校验 Key 是否存在
 * 如果是在打包后的 APK (非 __DEV__) 中发现 Key 缺失，直接弹窗告知用户原因
 */
if (!apiKey) {
  const errorMsg = 'Gemini API Key 未配置或注入失败（检测到占位符）';
  console.error(errorMsg);
}

// 列出所有可用模型
export async function listAvailableModels() {
  try {
    return await listModelsViaGeminiProxy(getClientAiProviderOverride());
  } catch (error: any) {
    console.error('Error listing models:', error);
    throw error;
  }
}

/**
 * Google AI Studio free tier (May 2026): prefer models with non-zero RPM/RPD.
 * Order: 3.5 Flash → 3 Flash → 2.5 Flash → 3.1 Flash Lite → 2.5 Flash Lite.
 */
export const GEMINI_FREE_TIER_MODEL_ORDER = [
  'gemini-3.5-flash',
  'gemini-3-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
] as const;

/** Default for receipt recognition (matches first free-tier slot). */
export const GEMINI_PRIMARY_MODEL = GEMINI_FREE_TIER_MODEL_ORDER[0];

/** Complex prompts (long text / PDF / large image): use highest-RPD lite model, not Pro (0 quota). */
export const GEMINI_COMPLEX_FALLBACK_MODEL = 'gemini-3.1-flash-lite' as const;

/** @deprecated Use GEMINI_COMPLEX_FALLBACK_MODEL — Pro models have 0 free-tier quota. */
export const GEMINI_PRO_FALLBACK_MODEL = GEMINI_COMPLEX_FALLBACK_MODEL;

const LONG_PROMPT_CHARS = 10_000;
const LARGE_INLINE_BASE64 = 800_000;

/** 判断当前请求是否更适合先尝试 lite 兜底（长 prompt、大附件、PDF 等） */
export function inferComplexGeminiContent(args: {
  promptTextLength?: number;
  inlineBase64Length?: number;
  mimeType?: string;
}): boolean {
  const promptTextLength = args.promptTextLength ?? 0;
  const inlineBase64Length = args.inlineBase64Length ?? 0;
  const { mimeType } = args;
  if (promptTextLength >= LONG_PROMPT_CHARS) return true;
  if (inlineBase64Length >= LARGE_INLINE_BASE64) return true;
  if (mimeType === 'application/pdf') return true;
  return false;
}

/**
 * Models with 0 RPM on free tier (AI Studio) — never call via recognition retry loops.
 * See user quota table: 2.5 Pro, 2 Flash / 2 Flash Lite, 3.1 Pro, legacy 1.5, etc.
 */
export function isGeminiModelBlockedOnFreeTier(modelId: string): boolean {
  const id = normalizeGeminiModelApiName(modelId).toLowerCase();
  if (!id.startsWith('gemini')) return true;
  if (/embed|embedding|aqa/.test(id)) return true;
  if (/\bpro\b|gemini-.*-pro|pro-preview/.test(id)) return true;
  if (/gemini-1\.5/.test(id)) return true;
  if (/gemini-2\.0/.test(id)) return true;
  if (/gemini-2-flash/.test(id) && !/gemini-2\.5/.test(id)) return true;
  return !GEMINI_FREE_TIER_MODEL_ORDER.some(
    (allowed) => id === allowed || id.startsWith(`${allowed}-`),
  );
}

/**
 * Static try-order aligned with free-tier quotas (no Pro / zero-quota models).
 */
export function buildGeminiModelOrder(opts?: { preferProAfterFlash?: boolean }): string[] {
  const base = [...GEMINI_FREE_TIER_MODEL_ORDER];
  if (!opts?.preferProAfterFlash) {
    return base;
  }
  const primary = base[0];
  const complex = GEMINI_COMPLEX_FALLBACK_MODEL;
  const rest = base.filter((m) => m !== primary && m !== complex);
  return [primary, complex, ...rest];
}

/** API 探测到的可用模型优先，再与静态顺序合并去重 */
export function mergeGeminiModelsWithAvailable(
  available: string | null | undefined,
  ordered: readonly string[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (m: string) => {
    if (!m || seen.has(m) || isGeminiModelBlockedOnFreeTier(m)) return;
    seen.add(m);
    out.push(m);
  };
  if (available) push(available);
  for (const m of ordered) push(m);
  return out;
}

// ── Dynamic model list: listModels → filter generateContent → cost-sort → cache (TTL) ──

type GeminiListModelRow = { name: string; supportedGenerationMethods?: string[] };

let dynamicModelsSortedCache: string[] | null = null;
let dynamicModelsSortedCacheAt = 0;
const DYNAMIC_MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

/** Clear when API returns 404/503/429 etc. so next recognition run refetches listModels. */
export function invalidateGeminiModelTryOrderCache(): void {
  dynamicModelsSortedCache = null;
  dynamicModelsSortedCacheAt = 0;
}

export function normalizeGeminiModelApiName(name: string): string {
  let s = String(name || '').trim();
  if (!s) return '';
  if (s.startsWith('models/')) s = s.slice('models/'.length);
  return s;
}

function modelIsGenerateContentCandidate(m: GeminiListModelRow): boolean {
  const methods = m.supportedGenerationMethods;
  if (!methods?.includes('generateContent')) return false;
  const id = normalizeGeminiModelApiName(m.name).toLowerCase();
  if (!id.startsWith('gemini')) return false;
  if (id.includes('embedding') || id.includes('embed')) return false;
  if (id.includes('aqa')) return false;
  if (isGeminiModelBlockedOnFreeTier(id)) return false;
  return true;
}

/**
 * Lower score = try earlier. Matches GEMINI_FREE_TIER_MODEL_ORDER; blocked models → 9999.
 */
export function scoreGeminiModelCostHeuristic(modelId: string): number {
  const id = normalizeGeminiModelApiName(modelId).toLowerCase();
  if (isGeminiModelBlockedOnFreeTier(id)) return 9999;
  for (let i = 0; i < GEMINI_FREE_TIER_MODEL_ORDER.length; i += 1) {
    const prefix = GEMINI_FREE_TIER_MODEL_ORDER[i].toLowerCase();
    if (id === prefix || id.startsWith(`${prefix}-`)) {
      return (i + 1) * 10;
    }
  }
  if (/3\.5-flash/.test(id)) return 10;
  if (/3-flash/.test(id)) return 20;
  if (/2\.5-flash(?!-lite)/.test(id)) return 30;
  if (/3\.1-flash-lite/.test(id)) return 40;
  if (/2\.5-flash-lite/.test(id)) return 50;
  return 800;
}

function sortGeminiModelIdsByCost(ids: string[]): string[] {
  return [...new Set(ids)].sort((a, b) => {
    const d = scoreGeminiModelCostHeuristic(a) - scoreGeminiModelCostHeuristic(b);
    if (d !== 0) return d;
    return a.localeCompare(b);
  });
}

async function fetchDynamicGeminiModelsSortedByCost(): Promise<string[]> {
  const models = (await listAvailableModels()) as GeminiListModelRow[];
  const ids = models
    .filter(modelIsGenerateContentCandidate)
    .map((m) => normalizeGeminiModelApiName(m.name))
    .filter(Boolean);
  return sortGeminiModelIdsByCost(ids);
}

async function getDynamicGeminiModelsSortedCached(): Promise<string[]> {
  const now = Date.now();
  if (dynamicModelsSortedCache && now - dynamicModelsSortedCacheAt < DYNAMIC_MODEL_CACHE_TTL_MS) {
    return dynamicModelsSortedCache;
  }
  try {
    const sorted = await fetchDynamicGeminiModelsSortedByCost();
    if (sorted.length > 0) {
      dynamicModelsSortedCache = sorted;
      dynamicModelsSortedCacheAt = Date.now();
    }
    return sorted;
  } catch {
    return [];
  }
}

function mergeDynamicSortedWithStaticOrder(
  dynamicSorted: string[],
  staticOrder: string[],
  preferComplexFallback: boolean,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (m: string) => {
    if (!m || seen.has(m) || isGeminiModelBlockedOnFreeTier(m)) return;
    seen.add(m);
    out.push(m);
  };
  const complex = GEMINI_COMPLEX_FALLBACK_MODEL;

  if (preferComplexFallback && dynamicSorted.length > 0) {
    push(dynamicSorted[0]);
    push(complex);
    for (let i = 1; i < dynamicSorted.length; i += 1) push(dynamicSorted[i]);
  } else {
    for (const m of dynamicSorted) push(m);
  }

  for (const m of staticOrder) push(m);
  return out;
}

/**
 * Full try-order for generateContent: API list (free-tier sorted) + static fallbacks.
 * Call invalidateGeminiModelTryOrderCache() on 404/503 so the next run refetches the catalog.
 */
/** Gemini-only model try-order (use `resolveModelsToTryOrder` from `ai-model-helper` for provider-aware routing). */
export async function resolveGeminiOnlyModelsToTryOrder(complexity: {
  promptTextLength: number;
  inlineBase64Length?: number;
  mimeType?: string;
}): Promise<string[]> {
  const preferComplex = inferComplexGeminiContent(complexity);
  const staticOrder = buildGeminiModelOrder({ preferProAfterFlash: preferComplex });
  const dynamicSorted = await getDynamicGeminiModelsSortedCached();
  return mergeDynamicSortedWithStaticOrder(dynamicSorted, staticOrder, preferComplex);
}

export async function getAvailableImageModel(): Promise<string | null> {
  const FALLBACK_MODEL = GEMINI_PRIMARY_MODEL;
  try {
    if (!apiKey) return null;
    const sorted = await getDynamicGeminiModelsSortedCached();
    if (sorted.length > 0) return sorted[0];
    return FALLBACK_MODEL;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn('无法动态获取模型列表，使用默认模型:', msg);
    return FALLBACK_MODEL;
  }
}
