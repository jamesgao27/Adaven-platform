/**
 * Engagement classification: four dimensions aligned with firm permission scope
 * (see firm/permissions.tsx Permission scope).
 */
import type { FirmOrderWithDetails } from '@/lib/firm';
import type { FirmSku } from '@/types';

export type ClassificationDimension = 'season' | 'country' | 'scenario' | 'custom';

export const CLASSIFICATION_DIMENSIONS: ClassificationDimension[] = ['season', 'country', 'scenario', 'custom'];

/** Client Service Marketplace: published SKUs have no tax season field; omit from filter UI. */
export const CLIENT_MARKETPLACE_CLASSIFICATION_DIMENSIONS: ClassificationDimension[] = [
  'country',
  'scenario',
  'custom',
];

export const CLASSIFICATION_DIMENSION_LABEL: Record<ClassificationDimension, string> = {
  season: 'Tax season',
  country: 'Jurisdiction',
  scenario: 'Tax scenario',
  custom: 'Custom label',
};

/** ALL chip lit state (same as permissions scope editor) */
export const SCOPE_ALL_LIT_BG = '#E8F5E9';
export const SCOPE_ALL_LIT_FG = '#2ECC71';
export const SCOPE_CHIP_UNLIT_BG = '#F1F3F5';
export const SCOPE_CHIP_MUTED_FG = '#95A5A6';

const SCOPE_LABEL_PALETTE: [string, string][] = [
  ['#E8F5E9', '#2ECC71'],
  ['#FFF3E0', '#E67E22'],
  ['#FCE4EC', '#E91E63'],
  ['#E0F7FA', '#00ACC1'],
  ['#FFF8E1', '#F9A825'],
  ['#F3E5F5', '#9C27B0'],
];

export function getClassificationChipColors(key: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) & 0xffff;
  return SCOPE_LABEL_PALETTE[hash % SCOPE_LABEL_PALETTE.length];
}

export function getTaxSeasonYearForClassification(row: FirmOrderWithDetails): number | null {
  if (row.taxSeasonYear != null) return row.taxSeasonYear;
  const d = row.dueAt || row.createdAt || null;
  if (!d) return null;
  try {
    const y = new Date(d).getFullYear();
    return Number.isNaN(y) ? null : y;
  } catch {
    return null;
  }
}

export function getOrderValuesForClassificationDim(
  row: FirmOrderWithDetails,
  d: ClassificationDimension
): string[] {
  switch (d) {
    case 'season': {
      const y = getTaxSeasonYearForClassification(row);
      return y != null ? [String(y)] : [];
    }
    case 'country':
      return row.taxCountry && String(row.taxCountry).trim() ? [String(row.taxCountry).trim()] : [];
    case 'scenario':
      return row.taxScenario && String(row.taxScenario).trim() ? [String(row.taxScenario).trim()] : [];
    case 'custom':
      if (!Array.isArray(row.tags)) return [];
      return row.tags.filter((t): t is string => typeof t === 'string' && !!String(t).trim()).map((t) => String(t).trim());
    default:
      return [];
  }
}

export function collectClassificationOptionsForDim(
  rows: FirmOrderWithDetails[],
  d: ClassificationDimension
): string[] {
  const acc = new Set<string>();
  for (const row of rows) {
    for (const v of getOrderValuesForClassificationDim(row, d)) {
      acc.add(v);
    }
  }
  return Array.from(acc).sort((a, b) => a.localeCompare(b));
}

export function customClassificationGroupKey(row: FirmOrderWithDetails): string {
  const tags = getOrderValuesForClassificationDim(row, 'custom');
  if (tags.length === 0) return 'Unclassified';
  return [...new Set(tags)].sort().join(' · ');
}

export type ClassificationDimFilter = { mode: 'all' } | { mode: 'include'; values: Set<string> };

export function emptyClassificationDimFilters(): Record<ClassificationDimension, ClassificationDimFilter> {
  return {
    season: { mode: 'all' },
    country: { mode: 'all' },
    scenario: { mode: 'all' },
    custom: { mode: 'all' },
  };
}

export function orderMatchesClassificationDimFilters(
  row: FirmOrderWithDetails,
  filters: Record<ClassificationDimension, ClassificationDimFilter>,
  optionsByDim: Record<ClassificationDimension, string[]>
): boolean {
  for (const d of CLASSIFICATION_DIMENSIONS) {
    const f = filters[d];
    if (f.mode === 'all') continue;
    const sel = f.values;
    const allOpts = optionsByDim[d];
    if (allOpts.length > 0 && sel.size === allOpts.length && allOpts.every((x) => sel.has(x))) {
      continue;
    }
    if (sel.size === 0) continue;
    const orderVals = getOrderValuesForClassificationDim(row, d);
    if (!orderVals.some((v) => sel.has(v))) return false;
  }
  return true;
}

/** Published catalog SKUs have no tax season on the row until the API exposes it; keep season empty for filtering. */
export function getSkuValuesForClassificationDim(sku: FirmSku, d: ClassificationDimension): string[] {
  switch (d) {
    case 'season':
      return [];
    case 'country':
      return sku.taxCountry && String(sku.taxCountry).trim() ? [String(sku.taxCountry).trim()] : [];
    case 'scenario':
      return sku.taxScenario && String(sku.taxScenario).trim() ? [String(sku.taxScenario).trim()] : [];
    case 'custom':
      if (!Array.isArray(sku.tags)) return [];
      return sku.tags
        .filter((t): t is string => typeof t === 'string' && !!String(t).trim())
        .map((t) => String(t).trim());
    default:
      return [];
  }
}

export function collectClassificationOptionsForSkuDim(skus: FirmSku[], d: ClassificationDimension): string[] {
  const acc = new Set<string>();
  for (const sku of skus) {
    for (const v of getSkuValuesForClassificationDim(sku, d)) {
      acc.add(v);
    }
  }
  return Array.from(acc).sort((a, b) => a.localeCompare(b));
}

export function skuMatchesClassificationDimFilters(
  sku: FirmSku,
  filters: Record<ClassificationDimension, ClassificationDimFilter>,
  optionsByDim: Record<ClassificationDimension, string[]>,
  dims: readonly ClassificationDimension[] = CLASSIFICATION_DIMENSIONS,
): boolean {
  for (const d of dims) {
    const f = filters[d];
    if (f.mode === 'all') continue;
    const sel = f.values;
    const allOpts = optionsByDim[d];
    if (allOpts.length > 0 && sel.size === allOpts.length && allOpts.every((x) => sel.has(x))) {
      continue;
    }
    if (sel.size === 0) continue;
    const vals = getSkuValuesForClassificationDim(sku, d);
    if (!vals.some((v) => sel.has(v))) return false;
  }
  return true;
}

export function classificationFilterConstraintCount(
  filters: Record<ClassificationDimension, ClassificationDimFilter>,
  optionsByDim: Record<ClassificationDimension, string[]>,
  dims: readonly ClassificationDimension[] = CLASSIFICATION_DIMENSIONS,
): number {
  let n = 0;
  for (const d of dims) {
    const f = filters[d];
    if (f.mode !== 'include') continue;
    const opts = optionsByDim[d];
    if (opts.length === 0) continue;
    const sel = f.values;
    if (sel.size === 0) continue;
    if (opts.length > 0 && sel.size === opts.length && opts.every((x) => sel.has(x))) continue;
    n += 1;
  }
  return n;
}
