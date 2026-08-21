/**
 * Gemini inlineData does not reliably support Word MIME types.
 * Extract plain text client-side: .docx via JSZip + xmldom (no Node fs — React Native safe).
 */
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';

const MAX_CHARS = 800_000;

const LEGACY_DOC_MSG =
  '(Legacy Microsoft Word .doc format: text cannot be extracted inside the app. Download the original file to open in Word, or convert to .docx or PDF.)';

const WORD_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

export function isWordDocumentMime(mime?: string, fileUrl?: string): boolean {
  const m = mime?.toLowerCase().trim() ?? '';
  if (m && WORD_MIMES.has(m)) return true;
  if (m.includes('wordprocessingml.document')) return true;
  if (m.includes('msword') && !m.includes('spreadsheet')) return true;
  const u = fileUrl ?? '';
  if (/\.(docx|doc)$/i.test(u.split(/[#?]/)[0])) return true;
  return false;
}

function bytesFromBase64(b64: string): Uint8Array {
  const atobFn = (globalThis as unknown as { atob?: (s: string) => string }).atob;
  if (typeof atobFn !== 'function') {
    throw new Error('Base64 decode requires atob.');
  }
  const bin = atobFn(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** OLE compound file (classic .doc), not Open XML. */
export function sniffOleWordDocBytes(arrayBuffer: ArrayBuffer): boolean {
  const u = new Uint8Array(arrayBuffer);
  return u.length >= 2 && u[0] === 0xd0 && u[1] === 0xcf;
}

/** ZIP-based Open XML package (.docx, .xlsx, etc.). */
export function sniffOpenXmlZipBytes(arrayBuffer: ArrayBuffer): boolean {
  const u = new Uint8Array(arrayBuffer);
  return u.length >= 4 && u[0] === 0x50 && u[1] === 0x4b && u[2] === 0x03 && u[3] === 0x04;
}

function isParaEl(nodeName: string): boolean {
  return nodeName === 'w:p' || nodeName.endsWith(':p');
}

function isTextEl(nodeName: string): boolean {
  return nodeName === 'w:t' || nodeName.endsWith(':t');
}

/** Pull plain text from Office WordprocessingML document body (w:p / w:t). */
function paragraphsFromWordDocumentXml(xml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const errs = doc.getElementsByTagName('parsererror');
  if (errs.length > 0) {
    throw new Error('Invalid document.xml');
  }
  const root = doc.documentElement;
  if (!root) return '';

  const paragraphs: string[] = [];

  function extractTextFromParagraph(pEl: Element): string {
    const parts: string[] = [];
    const walk = (n: Node) => {
      if (n.nodeType !== 1) return;
      const e = n as Element;
      if (isTextEl(e.nodeName)) {
        parts.push(e.textContent ?? '');
        return;
      }
      for (let i = 0; i < e.childNodes.length; i++) walk(e.childNodes[i]);
    };
    walk(pEl);
    return parts.join('');
  }

  const findParagraphs = (el: Element) => {
    for (let i = 0; i < el.childNodes.length; i++) {
      const n = el.childNodes[i];
      if (n.nodeType !== 1) continue;
      const e = n as Element;
      if (isParaEl(e.nodeName)) {
        paragraphs.push(extractTextFromParagraph(e));
      } else {
        findParagraphs(e);
      }
    }
  };

  findParagraphs(root);
  return paragraphs
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractDocxPlainText(arrayBuffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const file = zip.file('word/document.xml');
  if (!file) {
    throw new Error('missing word/document.xml');
  }
  const raw = await file.async('uint8array');
  const xml = new TextDecoder('utf-8', { fatal: false }).decode(raw);
  return paragraphsFromWordDocumentXml(xml);
}

/**
 * Extract plain text from Word bytes. .docx via JSZip + XML; legacy .doc returns a fixed English notice.
 */
export async function extractWordPlainTextFromArrayBuffer(arrayBuffer: ArrayBuffer): Promise<string> {
  if (sniffOleWordDocBytes(arrayBuffer)) {
    return LEGACY_DOC_MSG;
  }
  if (!sniffOpenXmlZipBytes(arrayBuffer)) {
    return '(Not a recognized Word document. Download the original file.)';
  }
  try {
    const text = await extractDocxPlainText(arrayBuffer);
    if (!text) {
      return '(No extractable text in this Word document. It may be empty, scanned, or encrypted.)';
    }
    return text;
  } catch {
    return '(Could not read this Word file. It may be corrupted or not a valid .docx.)';
  }
}

/** Extract body text from .doc / .docx base64 for LLM input. */
export async function wordDocumentBase64ToPlainText(base64: string): Promise<string> {
  const bytes = bytesFromBase64(base64);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let text = await extractWordPlainTextFromArrayBuffer(ab);
  if (text.length > MAX_CHARS) {
    text = `${text.slice(0, MAX_CHARS)}\n\n[... content truncated for AI input ...]`;
  }
  return text;
}
