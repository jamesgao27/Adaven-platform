/**
 * Gemini generateContent inlineData does not support Office spreadsheet MIME types.
 * Convert xlsx/xls/csv to plain text and use text-only prompts instead.
 */
import * as XLSX from 'xlsx';

const MAX_CHARS = 800_000;

const SPREADSHEET_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'text/comma-separated-values',
]);

export function isSpreadsheetMime(mime?: string, fileUrl?: string): boolean {
  const m = mime?.toLowerCase().trim() ?? '';
  if (m && SPREADSHEET_MIMES.has(m)) return true;
  if (m.includes('spreadsheet') || m.includes('/excel') || m.includes('csv')) return true;
  const u = fileUrl ?? '';
  if (/\.(xlsx|xls|csv)$/i.test(u)) return true;
  return false;
}

function bytesFromBase64(b64: string): Uint8Array {
  const atobFn = (globalThis as unknown as { atob?: (s: string) => string }).atob;
  if (typeof atobFn !== 'function') {
    throw new Error('Base64 decode requires atob (use a modern JS runtime).');
  }
  const bin = atobFn(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeBase64Utf8(base64: string): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytesFromBase64(base64));
}

/**
 * Turn spreadsheet file (base64 as stored after download) into plain text (CSV-like) for LLM input.
 */
export function spreadsheetBase64ToPlainText(base64: string, mimeType: string, fileUrl?: string): string {
  const mime = mimeType.toLowerCase();
  const looksCsv = mime.includes('csv') || (fileUrl && /\.csv$/i.test(fileUrl));

  let out: string;
  if (looksCsv) {
    out = decodeBase64Utf8(base64);
  } else {
    const wb = XLSX.read(base64, { type: 'base64' });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      if (!sheet) continue;
      parts.push(`## Sheet: ${name}\n${XLSX.utils.sheet_to_csv(sheet)}`);
    }
    out = parts.join('\n\n') || '(empty spreadsheet)';
  }

  if (out.length > MAX_CHARS) {
    return `${out.slice(0, MAX_CHARS)}\n\n[... content truncated for AI input ...]`;
  }
  return out;
}
