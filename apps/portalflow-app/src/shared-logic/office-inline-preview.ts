/**
 * Inline preview for Office attachments without server-side PDF conversion.
 * Spreadsheets: SheetJS → HTML tables; Word (Open XML): docx-preview on web / WebView shell on native.
 */
import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { getTaxFilingViewUrl } from './supabase';
import { sniffOleWordDocBytes, sniffOpenXmlZipBytes } from './word-document-to-text';

const MAX_SHEETS = 24;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Strip scripts and inline event handlers from SheetJS HTML output (mitigate malicious xlsx). */
export function sanitizePreviewTableHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

export async function fetchTaxFilingAttachmentArrayBuffer(attachmentUrl: string): Promise<ArrayBuffer> {
  const signed = await getTaxFilingViewUrl(attachmentUrl);
  const res = await fetch(signed, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.arrayBuffer();
}

export function workbookArrayBufferToPreviewHtml(ab: ArrayBuffer): string {
  const wb = XLSX.read(ab, { type: 'array', cellDates: true });
  const names = wb.SheetNames.slice(0, MAX_SHEETS);
  const chunks: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const sn = names[i];
    const ws = wb.Sheets[sn];
    if (!ws) continue;
    const html = sanitizePreviewTableHtml(XLSX.utils.sheet_to_html(ws, { id: `sheet-${i}`, editable: false }));
    chunks.push(
      `<section class="sheet-block"><h2 class="sheet-title">${escapeHtml(sn)}</h2><div class="sheet-wrap">${html}</div></section>`,
    );
  }
  const body = chunks.length > 0 ? chunks.join('') : '<p>No sheets found.</p>';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
body{margin:0;padding:8px;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;background:#fff;color:#222;}
.sheet-title{font-size:14px;margin:12px 0 8px;font-weight:600;}
.sheet-block{margin-bottom:16px;}
table{border-collapse:collapse;width:100%;min-width:max-content;}
td,th{border:1px solid #dfe6e9;padding:4px 6px;text-align:left;vertical-align:top;}
th{background:#f1f2f6;font-weight:600;}
</style></head><body>${body}</body></html>`;
}

/** True if bytes are legacy OLE Word (.doc), not Open XML (.docx). */
export function isLegacyWordDocBytes(ab: ArrayBuffer): boolean {
  return sniffOleWordDocBytes(ab) && !sniffOpenXmlZipBytes(ab);
}

const DOCX_BASE_STYLE_ID = 'portalflow-docx-preview-base-css';

export async function renderDocxIntoContainer(container: HTMLElement, ab: ArrayBuffer): Promise<void> {
  if (typeof document !== 'undefined' && !document.getElementById(DOCX_BASE_STYLE_ID)) {
    const s = document.createElement('style');
    s.id = DOCX_BASE_STYLE_ID;
    s.textContent =
      '.docx-wrapper{font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;line-height:1.5;color:#222;}';
    document.head.appendChild(s);
  }
  const { renderAsync } = await import('docx-preview');
  container.innerHTML = '';
  await renderAsync(ab, container, undefined, {
    className: 'docx-wrapper',
    inWrapper: true,
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  const btoaFn = (globalThis as unknown as { btoa?: (s: string) => string }).btoa;
  if (typeof btoaFn !== 'function') throw new Error('btoa is not available');
  return btoaFn(binary);
}

const DOCX_PREVIEW_VER = '0.3.7';

function buildNativeDocxHtmlShell(docxFileName: string): string {
  const nameJson = JSON.stringify(docxFileName);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/docx-preview@${DOCX_PREVIEW_VER}/dist/docx-preview.min.js"></script>
<style>html,body{margin:0;padding:8px;background:#fff;}#root{min-height:200px;}
.docx-wrapper{font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.45;color:#222;}</style></head><body><div id="root"></div>
<script>
(function(){
  var name = ${nameJson};
  fetch(name).then(function(r){return r.arrayBuffer();}).then(function(ab){
    return docx.renderAsync(ab, document.getElementById('root'), null, { className: 'docx-wrapper', inWrapper: true });
  }).catch(function(){
    document.body.innerHTML = '<p style="padding:16px;color:#636E72;font-family:system-ui,sans-serif;">Preview failed. Use Download to open the file.</p>';
  });
})();
</script></body></html>`;
}

function toFileWebViewUri(path: string): string {
  if (path.startsWith('file://')) return path;
  if (Platform.OS === 'android' && !path.startsWith('/')) return path;
  return `file://${path}`;
}

/**
 * Writes a local .docx next to an HTML page that loads docx-preview from CDN (native WebView only).
 */
export async function writeNativeDocxPreviewHtmlPage(ab: ArrayBuffer, attachmentId: string): Promise<string> {
  const base = FileSystem.cacheDirectory;
  if (!base) throw new Error('Cache directory is not available');

  const safeId = attachmentId.replace(/[^a-z0-9-]/gi, '').slice(0, 36) || 'att';
  const docxFile = `docx-src-${safeId}-${Date.now()}.docx`;
  const docxPath = `${base}${docxFile}`;
  await FileSystem.writeAsStringAsync(docxPath, arrayBufferToBase64(ab), {
    encoding: FileSystem.EncodingType.Base64,
  });

  const htmlFile = `docx-preview-${safeId}-${Date.now()}.html`;
  const htmlPath = `${base}${htmlFile}`;
  await FileSystem.writeAsStringAsync(htmlPath, buildNativeDocxHtmlShell(docxFile));

  return toFileWebViewUri(htmlPath);
}

export function iosWebViewAllowingReadAccessUrlForFileUri(fileUri: string): string {
  const slash = fileUri.lastIndexOf('/');
  if (slash <= 0) return fileUri;
  return fileUri.slice(0, slash + 1);
}

function buildNativePdfHtmlShell(pdfFileName: string): string {
  const nameJson = JSON.stringify(pdfFileName);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=4"/>
<style>
html,body{margin:0;padding:0;background:#525659;min-height:100%;}
#pages{padding:8px 0 24px;}
.page{display:block;margin:8px auto;max-width:100%;box-shadow:0 1px 4px rgba(0,0,0,.35);background:#fff;}
#status{color:#fff;font:14px -apple-system,sans-serif;text-align:center;padding:24px 12px;}
</style></head><body>
<div id="status">Loading PDF…</div><div id="pages"></div>
<script>
(function(){
  var name = ${nameJson};
  var statusEl = document.getElementById('status');
  var pagesEl = document.getElementById('pages');
  var scripts = [
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js',
    'https://cdn.bootcdn.net/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
  ];
  var workers = [
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    'https://cdn.bootcdn.net/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  ];
  function loadScript(src){
    return new Promise(function(resolve, reject){
      var s = document.createElement('script');
      s.src = src;
      s.onload = function(){ resolve(); };
      s.onerror = function(){ reject(new Error('script')); };
      document.head.appendChild(s);
    });
  }
  function renderWithPdfJs(){
    return fetch(name).then(function(r){
      if (!r.ok) throw new Error('pdf ' + r.status);
      return r.arrayBuffer();
    }).then(function(ab){
      return pdfjsLib.getDocument({ data: ab }).promise;
    }).then(function(pdf){
      statusEl.style.display = 'none';
      var scale = Math.min(2, (window.innerWidth - 16) / 612);
      if (!(scale > 0)) scale = 1.2;
      var chain = Promise.resolve();
      for (var p = 1; p <= pdf.numPages; p++) {
        (function(n){
          chain = chain.then(function(){
            return pdf.getPage(n).then(function(page){
              var viewport = page.getViewport({ scale: scale });
              var canvas = document.createElement('canvas');
              canvas.className = 'page';
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              pagesEl.appendChild(canvas);
              return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
            });
          });
        })(p);
      }
      return chain;
    });
  }
  function tryCdn(i){
    if (i >= scripts.length) {
      statusEl.textContent = 'Could not load PDF viewer. Use Download to open the file.';
      return;
    }
    loadScript(scripts[i]).then(function(){
      pdfjsLib.GlobalWorkerOptions.workerSrc = workers[i];
      return renderWithPdfJs();
    }).catch(function(err){
      console.error(err);
      tryCdn(i + 1);
    });
  }
  tryCdn(0);
})();
</script></body></html>`;
}

/**
 * Writes an HTML shell next to a local PDF so native WebView can render via PDF.js
 * (same pattern as Word preview). Avoids iOS file:// PDF white screens and Android CDN-only HTML strings.
 */
export async function writeNativePdfPreviewHtmlPage(pdfFileUri: string, attachmentId: string): Promise<string> {
  const dir = iosWebViewAllowingReadAccessUrlForFileUri(pdfFileUri);
  const pdfName = decodeURIComponent((pdfFileUri.split('/').pop() || 'preview.pdf').split('?')[0]);
  if (!pdfName) throw new Error('PDF file name is missing');
  const safeId = attachmentId.replace(/[^a-z0-9-]/gi, '').slice(0, 36) || 'att';
  const htmlPath = `${dir}pdf-preview-${safeId}-${Date.now()}.html`;
  await FileSystem.writeAsStringAsync(htmlPath, buildNativePdfHtmlShell(pdfName));
  return toFileWebViewUri(htmlPath);
}
