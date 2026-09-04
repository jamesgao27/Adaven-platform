/**
 * Receipt-level sales tax components: flexible storage in receipts.tax_breakdown (jsonb).
 * Supports legacy flat objects { GST: 0.4, RST: 0.28 } and row arrays for arbitrary printed labels.
 */
import type { ReceiptTaxBreakdownEntry } from '@/types';

export type { ReceiptTaxBreakdownEntry };

/** MB receipt may say PST; downstream tax_kind aligns with RST for that province. */
export function canonicalTaxKindCodeFromKey(kind: string, region: string): string {
  const k = kind.trim().toUpperCase();
  const r = (region || '').trim().toUpperCase();
  if (r === 'MB' && k === 'PST') return 'RST';
  return k;
}

function parseAmount(val: unknown): number | null {
  if (val == null) return null;
  const n =
    typeof val === 'number' ? val : Number(String(val).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return n;
}

/** Coarse code token from printed line text (before regional canonicalization). */
export function inferTaxCodeTokenFromLineText(text: string): string {
  const u = text.toUpperCase();
  if (/\bGST\b/.test(u)) return 'GST';
  if (/\bHST\b/.test(u)) return 'HST';
  if (/\bQST\b/.test(u)) return 'QST';
  if (/\bRST\b/.test(u)) return 'RST';
  if (/\bPST\b/.test(u)) return 'PST';
  if (/\bTVQ\b/.test(u)) return 'TVQ';
  if (/\bVAT\b/.test(u)) return 'VAT';
  if (/\bSALES\s+TAX\b/.test(u)) return 'SALES';
  if (/\bSTATE\s+TAX\b/.test(u)) return 'STATE';
  if (/\bUSE\s+TAX\b/.test(u)) return 'USE';
  if (/\bCONSUMPTION\s+TAX\b/.test(u)) return 'CONSUMPTION';
  if (/\bTAX\b/.test(u) && /\d/.test(u)) return 'TAX';
  return 'OTHER';
}

/**
 * Normalize model or DB json into typed entries. Accepts:
 * - Array of { code?, label?, rateLabel?, amount, source? }
 * - Legacy flat record { GST: number, "My city tax": number, ... }
 */
export function coerceReceiptTaxBreakdownEntries(
  raw: unknown,
  region: string | null | undefined,
): ReceiptTaxBreakdownEntry[] | null {
  if (raw == null) return null;
  const reg = region ?? '';
  if (Array.isArray(raw)) {
    const out: ReceiptTaxBreakdownEntry[] = [];
    for (const row of raw) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const o = row as Record<string, unknown>;
      const amount = parseAmount(o.amount);
      if (amount == null || Math.abs(amount) < 1e-9) continue;
      const taxKindRaw = o.tax_kind_id ?? o.taxKindId;
      const taxKindId =
        taxKindRaw != null && String(taxKindRaw).trim() ? String(taxKindRaw).trim() : null;
      const stdRaw = o.crm_tax_rate_standard_id ?? o.crmTaxRateStandardId;
      const crmTaxRateStandardId =
        stdRaw != null && String(stdRaw).trim() ? String(stdRaw).trim() : null;
      const label = String(o.label ?? o.name ?? '').trim();
      const codeRaw = String(o.code ?? o.kind ?? o.taxCode ?? '').trim();
      const rateBit = o.rateLabel != null ? String(o.rateLabel) : o.rate != null ? String(o.rate) : '';
      const token =
        codeRaw || inferTaxCodeTokenFromLineText(`${label} ${rateBit}`);
      const code = canonicalTaxKindCodeFromKey(token || 'OTHER', reg);
      out.push({
        ...(taxKindId ? { taxKindId } : {}),
        ...(crmTaxRateStandardId ? { crmTaxRateStandardId } : {}),
        code,
        label: label || code,
        rateLabel:
          o.rateLabel != null
            ? String(o.rateLabel)
            : o.rate != null
              ? String(o.rate)
              : null,
        amount: Number(amount.toFixed(4)),
        source: o.source != null ? String(o.source) : null,
      });
    }
    return out.length > 0 ? out : null;
  }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const out: ReceiptTaxBreakdownEntry[] = [];
    for (const [key, val] of Object.entries(o)) {
      const amount = parseAmount(val);
      if (amount == null || Math.abs(amount) < 1e-9) continue;
      const code = canonicalTaxKindCodeFromKey(key, reg);
      out.push({
        code,
        label: key,
        amount: Number(amount.toFixed(4)),
        source: 'legacy_flat',
      });
    }
    return out.length > 0 ? out : null;
  }
  return null;
}

/** Build entries from line items that were classified as tax breakdown rows (pre-strip). */
export function taxBreakdownEntriesFromStrippedLineItems(
  taxLineItems: any[],
  region: string | null | undefined,
): ReceiptTaxBreakdownEntry[] {
  const reg = region ?? '';
  const out: ReceiptTaxBreakdownEntry[] = [];
  for (const item of taxLineItems) {
    const name = String(
      item?.name ?? item?.description ?? (item as { itemAlias?: string }).itemAlias ?? '',
    ).trim();
    const category = String(item?.categoryName ?? item?.category ?? '').trim();
    const price = Number(item?.price ?? item?.amount ?? 0) || 0;
    const blob = `${name} ${category}`;
    const token = inferTaxCodeTokenFromLineText(blob);
    const code = canonicalTaxKindCodeFromKey(token, reg);
    const label = name || `${code} (tax line)`;
    out.push({
      code,
      label,
      amount: Number(price.toFixed(4)),
    });
  }
  return out;
}

/** Sum amounts by normalized code (e.g. dashboard / reports). */
export function aggregateTaxBreakdownTotalsByCode(
  receipts: Array<{ taxBreakdown?: ReceiptTaxBreakdownEntry[] | null | undefined }>,
): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const r of receipts) {
    const rows = r.taxBreakdown;
    if (!rows?.length) continue;
    for (const e of rows) {
      const k = (e.code || 'OTHER').toUpperCase();
      acc[k] = (acc[k] || 0) + e.amount;
    }
  }
  for (const k of Object.keys(acc)) {
    acc[k] = Number(acc[k].toFixed(4));
  }
  return acc;
}

/** Sum amounts by crm.tax_kind_registry id (falls back to `code:…` when id missing). */
export function aggregateTaxBreakdownTotalsByTaxKindId(
  receipts: Array<{ taxBreakdown?: ReceiptTaxBreakdownEntry[] | null | undefined }>,
): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const r of receipts) {
    const rows = r.taxBreakdown;
    if (!rows?.length) continue;
    for (const e of rows) {
      const k = e.taxKindId?.trim()
        ? `id:${e.taxKindId.trim()}`
        : `code:${(e.code || 'OTHER').toUpperCase()}`;
      acc[k] = (acc[k] || 0) + e.amount;
    }
  }
  for (const k of Object.keys(acc)) {
    acc[k] = Number(acc[k].toFixed(4));
  }
  return acc;
}
