/**
 * Heuristics for tax-filing attachments: spreadsheet vs other types.
 * PDF preview bytes are produced by Supabase Edge Function + Gotenberg (LibreOffice), not in the client.
 */

/** Filename / summary may hint spreadsheet when storage extension is wrong. */
export function summarySuggestsSpreadsheet(name?: string | null): boolean {
  if (!name || !String(name).trim()) return false;
  const n = String(name).trim();
  return /\.(xlsx|xls|csv)$/i.test(n) || /\bexcel\b/i.test(n) || /\bspreadsheet\b/i.test(n);
}

/** Treat as spreadsheet from URL extension or AI doc_type. */
export function isSpreadsheetAttachmentUrl(
  url: string | null | undefined,
  docType?: string | null
): boolean {
  if (docType && String(docType).trim()) {
    const u = String(docType).toUpperCase();
    if (
      u.includes('SPREADSHEET') ||
      u.includes('XLSX') ||
      u.includes('XLS') ||
      u.includes('EXCEL') ||
      u.includes('CSV')
    ) {
      return true;
    }
  }
  if (!url) return false;
  const base = url.split(/[#?]/)[0];
  const ext = base.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'xlsx' || ext === 'xls' || ext === 'csv';
}
