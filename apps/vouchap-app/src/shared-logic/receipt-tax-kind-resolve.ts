/**
 * Match receipt tax_breakdown lines to crm.tax_kind_registry ids (jurisdiction + kind).
 * - Country: from printed currency (only if currencyPrintedOnReceipt) or from address text.
 * - Printed tax rate (rateLabel / label) narrows crm.tax_rate_standard rows when resolving ids.
 */
import type { ReceiptTaxBreakdownEntry } from '@/types';
import { supabase } from './supabase';

export type TaxBreakdownResolveContext = {
  currency?: string | null;
  /** When true, `currency` may be used to infer CA/US. When false, ignore currency for jurisdiction. */
  currencyPrintedOnReceipt?: boolean;
  supplierName?: string | null;
  supplierAddress?: string | null;
  /** Receipt date YYYY-MM-DD — limits tax_rate_standard effective_from / effective_to. */
  receiptDate?: string | null;
};

const CA_PROVINCE_CODES =
  /\b(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\b/i;

const CA_PROVINCE_NAMES: Array<{ re: RegExp; code: string }> = [
  { re: /\bALBERTA\b/i, code: 'AB' },
  { re: /\bBRITISH\s+COLUMBIA\b/i, code: 'BC' },
  { re: /\bMANITOBA\b/i, code: 'MB' },
  { re: /\bNEW\s+BRUNSWICK\b/i, code: 'NB' },
  { re: /\bNEWFOUNDLAND\b/i, code: 'NL' },
  { re: /\bNOVA\s+SCOTIA\b/i, code: 'NS' },
  { re: /\bNORTHWEST\s+TERRITORIES\b/i, code: 'NT' },
  { re: /\bNUNAVUT\b/i, code: 'NU' },
  { re: /\bONTARIO\b/i, code: 'ON' },
  { re: /\bPRINCE\s+EDWARD\s+ISLAND\b/i, code: 'PE' },
  { re: /\bQUEBEC\b/i, code: 'QC' },
  { re: /\bSASKATCHEWAN\b/i, code: 'SK' },
  { re: /\bYUKON\b/i, code: 'YT' },
];

const CA_CITY_TO_PROVINCE: Array<{ re: RegExp; code: string }> = [
  { re: /\bWINNIPEG\b/i, code: 'MB' },
  { re: /\bBRANDON\b/i, code: 'MB' },
  { re: /\bTORONTO\b/i, code: 'ON' },
  { re: /\bOTTAWA\b/i, code: 'ON' },
  { re: /\bMISSISSAUGA\b/i, code: 'ON' },
  { re: /\bVANCOUVER\b/i, code: 'BC' },
  { re: /\bVICTORIA\b/i, code: 'BC' },
  { re: /\bCALGARY\b/i, code: 'AB' },
  { re: /\bEDMONTON\b/i, code: 'AB' },
  { re: /\bMONTREAL\b|\bMONTRÉAL\b/i, code: 'QC' },
  { re: /\bQUEBEC\s+CITY\b|\bQUÉBEC\b/i, code: 'QC' },
  { re: /\bHALIFAX\b/i, code: 'NS' },
  { re: /\bREGINA\b/i, code: 'SK' },
  { re: /\bSASKATOON\b/i, code: 'SK' },
];

const US_STATE_CODES =
  /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/i;

function inferCountryFromCurrency(currency?: string | null): 'CA' | 'US' | null {
  const c = (currency || '').trim().toUpperCase();
  if (c === 'CAD') return 'CA';
  if (c === 'USD') return 'US';
  return null;
}

function inferRegionFromText(text: string, country: 'CA' | 'US'): string {
  if (country === 'CA') {
    const m2 = text.match(CA_PROVINCE_CODES);
    if (m2) return m2[1].toUpperCase();
    for (const { re, code } of CA_PROVINCE_NAMES) {
      if (re.test(text)) return code;
    }
    for (const { re, code } of CA_CITY_TO_PROVINCE) {
      if (re.test(text)) return code;
    }
    return '';
  }
  const mus = text.match(US_STATE_CODES);
  if (mus) return mus[1].toUpperCase();
  return '';
}

/** Country from merchant address / city / province only (no currency). */
function inferCountryFromAddressText(text: string): 'CA' | 'US' | null {
  if (!text || !String(text).trim()) return null;
  const t = text;
  if (
    CA_PROVINCE_CODES.test(t) ||
    CA_PROVINCE_NAMES.some((x) => x.re.test(t)) ||
    CA_CITY_TO_PROVINCE.some((x) => x.re.test(t)) ||
    /\bCANADA\b/i.test(t)
  ) {
    return 'CA';
  }
  if (US_STATE_CODES.test(t) || /\b(UNITED\s+STATES|U\.S\.A\.|USA)\b/i.test(t)) {
    return 'US';
  }
  return null;
}

/** Printed CA sales-tax codes — strong signal for country without using inferred currency. */
const CANADIAN_PRINTED_TAX_KIND_CODES = new Set(['GST', 'HST', 'PST', 'RST', 'QST']);

function inferCountryFromCanadianTaxCodes(entries: ReceiptTaxBreakdownEntry[]): 'CA' | null {
  for (const e of entries) {
    const c = (e.code || '').toUpperCase().trim();
    if (CANADIAN_PRINTED_TAX_KIND_CODES.has(c)) return 'CA';
  }
  return null;
}

function resolveCountry(
  ctx: TaxBreakdownResolveContext,
  entries: ReceiptTaxBreakdownEntry[],
): 'CA' | 'US' | null {
  if (ctx.currencyPrintedOnReceipt) {
    const fromCur = inferCountryFromCurrency(ctx.currency);
    if (fromCur) return fromCur;
  }
  const blob = [ctx.supplierAddress, ctx.supplierName].filter(Boolean).join(' | ');
  const fromAddr = inferCountryFromAddressText(blob);
  if (fromAddr) return fromAddr;
  return inferCountryFromCanadianTaxCodes(entries);
}

function mapBreakdownCodeToRegistryKind(
  code: string,
  country: 'CA' | 'US',
  region: string,
): string {
  const k = (code || 'OTHER').toUpperCase();
  if (country === 'CA' && region === 'MB' && k === 'PST') return 'RST';
  if (country === 'US') {
    if (['SALES', 'STATE', 'TAX', 'OTHER', 'VAT', 'GST'].includes(k)) return 'COMBINED_SALES_TAX';
  }
  return k;
}

function needsCanadianProvinceForKind(kind: string): boolean {
  return ['HST', 'PST', 'RST', 'QST'].includes(kind.toUpperCase());
}

/** Parse printed rate as fraction (0.05 for 5%). */
export function parsePrintedTaxRateFraction(entry: ReceiptTaxBreakdownEntry): number | null {
  const bits = [entry.rateLabel, entry.label].filter(Boolean).join(' ');
  const pct = bits.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) {
    const n = Number(pct[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n / 100;
  }
  const dec = bits.match(/\b(0\.\d{2,6})\b/);
  if (dec) {
    const n = Number(dec[1]);
    if (Number.isFinite(n) && n > 0 && n < 1) return n;
  }
  return null;
}

function rateMatchesPrinted(dbRate: number, printed: number): boolean {
  const diff = Math.abs(dbRate - printed);
  if (diff < 0.0008) return true;
  if (printed > 0.001 && diff / printed < 0.025) return true;
  return false;
}

function receiptDateInEffect(
  receiptDay: Date,
  effectiveFrom: string | null | undefined,
  effectiveTo: string | null | undefined,
): boolean {
  const from = effectiveFrom ? new Date(`${effectiveFrom}T12:00:00Z`) : null;
  const to = effectiveTo ? new Date(`${effectiveTo}T12:00:00Z`) : null;
  if (from && receiptDay < from) return false;
  if (to && receiptDay > to) return false;
  return true;
}

async function rpcResolveTaxKindId(
  country: string,
  region: string,
  taxClassCode: string,
  taxKindCode: string,
): Promise<string | null> {
  const { data, error } = await supabase.schema('crm').rpc('resolve_tax_kind_registry_id', {
    p_country_code: country,
    p_region_code: region,
    p_tax_class_code: taxClassCode,
    p_tax_kind_code: taxKindCode,
  });
  if (error) {
    console.warn('[receipt-tax-kind-resolve] rpc:', error.message, { country, region, taxKindCode });
    return null;
  }
  if (data == null || data === '') return null;
  return String(data);
}

async function resolveTaxKindIdPreferringPrintedRate(
  country: string,
  region: string,
  taxKindCode: string,
  printedRate: number | null,
  receiptDate: string | null | undefined,
): Promise<string | null> {
  const taxClass = 'STANDARD_TAXABLE';
  const reg = region ?? '';

  if (printedRate == null || !Number.isFinite(printedRate)) {
    return rpcResolveTaxKindId(country, reg, taxClass, taxKindCode);
  }

  let q = supabase
    .schema('crm')
    .from('tax_rate_standard')
    .select('tax_kind_registry_id, rate, effective_from, effective_to')
    .eq('country_code', country)
    .eq('region_code', reg)
    .eq('tax_class_code', taxClass)
    .eq('tax_kind_code', taxKindCode);

  const { data, error } = await q;
  if (error) {
    console.warn('[receipt-tax-kind-resolve] tax_rate_standard:', error.message);
    return rpcResolveTaxKindId(country, reg, taxClass, taxKindCode);
  }

  const day =
    receiptDate && /^\d{4}-\d{2}-\d{2}$/.test(receiptDate)
      ? new Date(`${receiptDate}T12:00:00Z`)
      : null;

  const candidates = (data || []).filter((row) => {
    const r = Number(row.rate);
    if (!Number.isFinite(r) || !rateMatchesPrinted(r, printedRate)) return false;
    if (day && !receiptDateInEffect(day, row.effective_from, row.effective_to)) return false;
    return true;
  });

  if (!candidates.length) {
    return rpcResolveTaxKindId(country, reg, taxClass, taxKindCode);
  }

  candidates.sort((a, b) => {
    const fa = a.effective_from || '';
    const fb = b.effective_from || '';
    return fb.localeCompare(fa);
  });

  const id = candidates[0].tax_kind_registry_id;
  if (id) return String(id);

  return rpcResolveTaxKindId(country, reg, taxClass, taxKindCode);
}

/**
 * Fill taxKindId on each line using jurisdiction + kind + optional printed rate.
 * Skips rows that already have taxKindId.
 */
export async function resolveTaxBreakdownTaxKindIds(
  entries: ReceiptTaxBreakdownEntry[],
  ctx: TaxBreakdownResolveContext,
): Promise<ReceiptTaxBreakdownEntry[]> {
  if (!entries.length) return entries;

  const country = resolveCountry(ctx, entries);
  if (!country) return entries;

  const baseBlob = [ctx.supplierAddress, ctx.supplierName].filter(Boolean).join(' | ');
  let region = inferRegionFromText(baseBlob, country);

  const out: ReceiptTaxBreakdownEntry[] = [];
  const receiptDate = ctx.receiptDate?.trim() || null;

  for (const entry of entries) {
    if (entry.taxKindId?.trim()) {
      out.push(entry);
      continue;
    }

    const printedRate = parsePrintedTaxRateFraction(entry);
    const kind = mapBreakdownCodeToRegistryKind(entry.code, country, region);
    let reg = region;

    if (country === 'CA' && needsCanadianProvinceForKind(kind) && !reg) {
      reg = inferRegionFromText(`${baseBlob} | ${entry.label ?? ''}`, country);
    }
    if (country === 'CA' && kind === 'HST' && !reg) {
      reg = inferRegionFromText(`${baseBlob} | ${entry.label ?? ''}`, country);
    }
    // CRM seeds RST only for MB; receipts say "RST" without a full address often.
    if (country === 'CA' && kind === 'RST' && !reg) {
      reg = 'MB';
    }

    let id: string | null = null;

    if (country === 'CA' && kind === 'GST') {
      if (reg) {
        id = await resolveTaxKindIdPreferringPrintedRate('CA', reg, 'GST', printedRate, receiptDate);
      }
      if (!id) {
        id = await resolveTaxKindIdPreferringPrintedRate('CA', '', 'GST', printedRate, receiptDate);
      }
    } else if (country === 'CA') {
      if (reg) {
        id = await resolveTaxKindIdPreferringPrintedRate('CA', reg, kind, printedRate, receiptDate);
      }
    } else if (country === 'US' && kind === 'COMBINED_SALES_TAX') {
      if (reg) {
        id = await resolveTaxKindIdPreferringPrintedRate(
          'US',
          reg,
          'COMBINED_SALES_TAX',
          printedRate,
          receiptDate,
        );
      }
    }

    out.push(id ? { ...entry, taxKindId: id } : entry);
  }

  if (typeof __DEV__ !== 'undefined' && __DEV__ && country === 'CA') {
    const missing = out.filter(
      (e) =>
        !e.taxKindId?.trim() &&
        CANADIAN_PRINTED_TAX_KIND_CODES.has((e.code || '').toUpperCase().trim()),
    );
    if (missing.length) {
      console.warn(
        '[receipt-tax-kind-resolve] Some CA tax_breakdown lines still have no tax_kind_id after resolve:',
        missing.map((e) => e.code),
        '— check hosted Supabase: Project Settings → API → Exposed schemas must include "crm"; run CRM migrations (tax_kind_registry, resolve_tax_kind_registry_id).',
      );
    }
  }

  return out;
}

/** DB json shape: tax_kind_id + amount + code/label/source; omit rate (from registry) and crm_tax_rate_standard_id. */
export function shapeTaxBreakdownForDb(
  entries: ReceiptTaxBreakdownEntry[] | null | undefined,
): Record<string, unknown>[] | null {
  if (!entries?.length) return null;
  return entries.map((e) => {
    const row: Record<string, unknown> = {
      code: e.code,
      label: e.label,
      amount: e.amount,
    };
    if (e.taxKindId?.trim()) row.tax_kind_id = e.taxKindId.trim();
    if (e.source != null && String(e.source).trim()) row.source = String(e.source).trim();
    return row;
  });
}
