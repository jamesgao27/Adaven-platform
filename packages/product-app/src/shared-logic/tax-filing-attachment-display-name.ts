/**
 * Human-facing default title for tax-filing attachments (Tina / todos / chat).
 * Prefers a short natural phrase from summary (e.g. vendor/context), not doc_type + opaque numbers.
 * Full narrative stays in `summary`.
 */

const MAX_TITLE = 68;
const MAX_TAIL = 36;
const MIN_SUMMARY_PHRASE = 10;
const MIN_CARD_SUBTITLE = 8;

const BOILER_PREFIXES = [
  /^this\s+is\s+a\s+/i,
  /^this\s+is\s+an\s+/i,
  /^this\s+is\s+the\s+/i,
  /** "This document is a …" / "This scan is an …" — avoids enumerating every noun */
  /^this\s+(?:\S+\s+){1,4}is\s+(?:a|an|the)\s+/i,
  /^here\s+is\s+a\s+/i,
  /^here\s+is\s+an\s+/i,
  /^the\s+following\s+(?:is\s+)?a\s+/i,
  /^below\s+is\s+a\s+/i,
];

function stripBoilerplatePrefixes(input: string): string {
  let s = input.replace(/\s+/g, ' ').trim();
  for (const re of BOILER_PREFIXES) {
    const next = s.replace(re, '').trim();
    if (next.length < s.length) s = next;
  }
  return s;
}

function prettyDocType(docType: string | null | undefined): string {
  const t = docType?.trim().replace(/_/g, ' ');
  if (!t) return '';
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

function stemFromFileName(name: string): string {
  return name
    .replace(/^.*[/\\]/, '')
    .replace(/\.[^.]+$/i, '')
    .trim()
    .replace(/[_-]+/g, ' ');
}

function isGenericStem(stem: string): boolean {
  if (!stem || stem.length < 3) return true;
  if (/^img[-_]?\d+$/i.test(stem)) return true;
  if (/^dsc\d+$/i.test(stem)) return true;
  if (/^mvimg\d*$/i.test(stem)) return true;
  if (/^screenshot\b/i.test(stem)) return true;
  if (/^document[-_]?\d+$/i.test(stem)) return true;
  if (/^\d+$/.test(stem)) return true;
  if (/^[\d\s_-]+$/.test(stem)) return true;
  return false;
}

/** "This is a prescription … for X" → "Prescription …" (trim at " for ", first sentence). */
function readablePhraseFromSummary(summary: string): string {
  let s = stripBoilerplatePrefixes(summary);
  if (!s) return '';
  const low = s.toLowerCase();
  const forPos = low.indexOf(' for ');
  if (forPos >= MIN_SUMMARY_PHRASE) {
    s = s.slice(0, forPos).trim();
  }
  const dot = s.indexOf('. ');
  if (dot > MIN_SUMMARY_PHRASE && dot < 85) {
    s = s.slice(0, dot).trim();
  }
  s = s.replace(/,\s*$/, '').trim();
  if (s.length < MIN_SUMMARY_PHRASE) return '';
  return s[0].toUpperCase() + s.slice(1);
}

function capAtWords(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

function redundantTail(head: string, tail: string): boolean {
  const h = head.toLowerCase();
  const t = tail.toLowerCase();
  if (!t || t === h) return true;
  if (t.startsWith(h) && t.length <= h.length + 3) return true;
  return false;
}

export function buildTaxFilingAttachmentDefaultDisplayName(params: {
  summary?: string | null;
  docType?: string | null;
  sourceFileName?: string | null;
}): string {
  const rawFile = params.sourceFileName?.trim() || '';
  const stem = stemFromFileName(rawFile);
  const fromSummary = params.summary?.trim() ? readablePhraseFromSummary(params.summary.trim()) : '';

  if (fromSummary.length >= MIN_SUMMARY_PHRASE) {
    return capAtWords(fromSummary, MAX_TITLE);
  }

  const head = prettyDocType(params.docType) || 'Tax document';

  let tail = '';
  if (!isGenericStem(stem)) {
    tail = stem.length > MAX_TAIL ? `${stem.slice(0, MAX_TAIL - 1)}…` : stem;
  } else if (params.summary?.trim()) {
    tail = gistFromSummaryFallback(params.summary.trim(), MAX_TAIL);
  } else if (rawFile) {
    const base = rawFile.replace(/^.*[/\\]/, '');
    tail = base.length > MAX_TAIL ? `${base.slice(0, MAX_TAIL - 1)}…` : base;
  }

  if (!tail || redundantTail(head, tail)) {
    return head.length > MAX_TITLE ? `${head.slice(0, MAX_TITLE - 1)}…` : head;
  }

  const out = `${head} · ${tail}`;
  return capAtWords(out, MAX_TITLE);
}

function gistFromSummaryFallback(summary: string, maxLen: number): string {
  const one = summary.replace(/\s+/g, ' ').trim();
  if (!one) return '';
  const dot = one.indexOf('. ');
  let frag = dot > 10 && dot < 72 ? one.slice(0, dot) : one;
  if (frag.length > maxLen) {
    frag = `${frag.slice(0, maxLen - 1).replace(/\s+\S*$/, '')}…`;
  }
  return frag;
}

function detailAfterForPhrase(summary: string): string | null {
  const s = stripBoilerplatePrefixes(summary);
  const low = s.toLowerCase();
  const needle = ' for ';
  const forPos = low.indexOf(needle);
  if (forPos >= MIN_SUMMARY_PHRASE) {
    const rest = s.slice(forPos + needle.length).trim();
    return rest.length >= MIN_CARD_SUBTITLE ? rest : null;
  }
  return null;
}

function stripLeadingTitleDuplicate(summary: string, cardTitle: string): string | null {
  const s = summary.replace(/\s+/g, ' ').trim();
  const t = cardTitle.replace(/\s+/g, ' ').trim();
  if (t.length < 8) return null;
  if (s.toLowerCase().startsWith(t.toLowerCase())) {
    const rest = s.slice(t.length).trim().replace(/^[,;:\-–—.]\s*/, '');
    return rest.length >= MIN_CARD_SUBTITLE ? rest : null;
  }
  return null;
}

/**
 * Second line under the attachment card title: avoids repeating the same lead as the title
 * (e.g. title "Diagnostic imaging report", subtitle "for GAO, …" not the full summary).
 * When nothing meaningful remains vs. the title, returns null so the UI can omit the line.
 */
export function taxFilingAttachmentCardSubtitleSummary(params: {
  summary: string | null | undefined;
  cardTitle: string;
}): string | null {
  const raw = params.summary?.trim();
  if (!raw) return null;

  const afterFor = detailAfterForPhrase(raw);
  if (afterFor) return afterFor;

  const dup = stripLeadingTitleDuplicate(raw, params.cardTitle);
  if (dup) return dup;

  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const titleNorm = params.cardTitle.replace(/\s+/g, ' ').trim().toLowerCase();
  if (collapsed.toLowerCase() === titleNorm) return null;

  const strippedDup = stripLeadingTitleDuplicate(stripBoilerplatePrefixes(raw), params.cardTitle);
  if (strippedDup) return strippedDup;

  const stripped = stripBoilerplatePrefixes(raw);
  if (stripped.toLowerCase() === titleNorm) return null;

  return collapsed;
}
