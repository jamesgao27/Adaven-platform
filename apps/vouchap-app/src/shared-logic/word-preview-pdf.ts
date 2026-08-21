/**
 * Heuristics for tax-filing attachments: Word vs other types.
 * PDF preview bytes are produced by Supabase Edge Function + Gotenberg (LibreOffice), not in the client.
 */

/** Filename / summary hints (e.g. mislabeled storage extension). */
export function summarySuggestsWord(name?: string | null): boolean {
  if (!name || !String(name).trim()) return false;
  const n = String(name).trim();
  return /\.(docx?)$/i.test(n) || /\bword\b/i.test(n) || /\bmsword\b/i.test(n);
}

/** URL extension or AI doc_type hints. */
export function isWordAttachmentUrl(url: string | null | undefined, docType?: string | null): boolean {
  if (docType && String(docType).trim()) {
    const u = String(docType).toUpperCase();
    if (
      u.includes('WORD') ||
      u.includes('DOCX') ||
      u.includes('MSWORD') ||
      u.includes('WORDPROCESSING')
    ) {
      return true;
    }
  }
  if (!url) return false;
  const base = url.split(/[#?]/)[0];
  const ext = base.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'doc' || ext === 'docx';
}
