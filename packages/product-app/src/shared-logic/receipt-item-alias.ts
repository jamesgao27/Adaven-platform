/**
 * Receipt line item_alias: normalize model output (mixed key names) and light heuristics.
 * Used by gemini recognition paths and receipt-helpers conversion.
 */

const MAX_ALIAS_LEN = 80;

/** Strip / cap length for DB and UI. */
function cleanItemAliasText(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim().replace(/\s+/g, ' ');
  if (!s) return undefined;
  if (s.length > MAX_ALIAS_LEN) return s.slice(0, MAX_ALIAS_LEN).trim();
  return s;
}

function looksLikePriceOrAmount(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  return /^(USD|CAD|CNY|EUR|GBP|MEX\$|\$)?\s*\d+([.,]\d{1,4})?$/.test(t);
}

/** Printed line text that is unlikely to be a human-readable product name. */
function receiptLineNameLooksCryptic(raw: unknown): boolean {
  const s = String(raw ?? '').trim();
  if (!s) return true;
  if (s.length <= 2) return true;
  const compact = s.replace(/\s+/g, '');
  // POS / dept / numeric-only lines
  if (/^[\d\s\-#*.,$/()]+$/.test(s) && /\d/.test(s)) return true;
  const mostlyCodeLike = /^[A-Z0-9._\-/#]+$/.test(compact);
  const hasDigit = /\d/.test(compact);
  const noVowelWord = !/[aeiou]/i.test(s) && /[A-Z]/.test(s);
  return mostlyCodeLike || (hasDigit && compact.length <= 24) || noVowelWord;
}

function firstAliasFromExplicitKeys(item: Record<string, unknown>): string | undefined {
  return cleanItemAliasText(
    item.itemAlias ??
      item.item_alias ??
      item.productName ??
      item.product_name ??
      item.label ??
      item.title ??
      item.friendlyName ??
      item.friendly_name ??
      item.displayTitle ??
      item.display_title ??
      item.alias ??
      item.displayName ??
      item.display_name ??
      item.readableName ??
      item.readable_name ??
      item.itemDescription ??
      item.item_description ??
      item.shortDescription ??
      item.short_description,
  );
}

/** Secondary text fields — use as alias only when primary "name" looks like a code (see pickReceiptLineItemAlias). */
function descriptionLikeFields(item: Record<string, unknown>): string | undefined {
  return cleanItemAliasText(
    item.lineDescription ??
      item.line_description ??
      item.description ??
      item.details ??
      item.detail ??
      item.memo ??
      item.note ??
      item.notes,
  );
}

/**
 * Best-effort readable label for a parsed line item (before/after Gemini normalization).
 * Does not use generic "description" as a direct alias unless name is code-like, to avoid noise.
 */
export function pickReceiptLineItemAlias(item: Record<string, unknown>): string | undefined {
  let out = firstAliasFromExplicitKeys(item);
  if (out && looksLikePriceOrAmount(out)) out = undefined;
  if (out) return out;

  const nameOnly = String(item.name ?? '').trim();
  const desc = descriptionLikeFields(item);
  if (!desc || looksLikePriceOrAmount(desc)) return undefined;
  if (!nameOnly) return undefined;
  if (!receiptLineNameLooksCryptic(nameOnly)) return undefined;
  const nn = nameOnly.toLowerCase().replace(/\s+/g, ' ');
  const nd = desc.toLowerCase().replace(/\s+/g, ' ');
  if (nd === nn) return undefined;
  return desc;
}

/** Drop alias that duplicates the stored line name (case/spacing insensitive). */
export function aliasDistinctFromLineName(lineName: string, alias: string | undefined): string | undefined {
  if (!alias) return undefined;
  const n = lineName.trim().toLowerCase().replace(/\s+/g, ' ');
  const a = alias.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!a || a === n) return undefined;
  return alias;
}
