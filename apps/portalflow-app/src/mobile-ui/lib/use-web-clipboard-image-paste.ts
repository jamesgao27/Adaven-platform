import { useEffect } from 'react';
import { Platform } from 'react-native';

export type ClipboardStagedFile = { id: string; uri: string; name?: string; mimeType?: string };

export const CHAT_WEB_COMPOSER_NATIVE_ID = 'chat-web-composer';
export const WEBCHAT_FAB_COMPOSER_NATIVE_ID = 'webchatfab-composer';
export const WEB_CHAT_PANEL_NATIVE_ID = 'web-chat-panel';

function isImageFile(f: File): boolean {
  if (f.type.startsWith('image/')) return true;
  if (/\.(png|jpe?g|gif|webp|heic|bmp)$/i.test(f.name)) return true;
  // macOS / Windows screenshot paste is often unnamed with image/png, sometimes empty type
  return !f.type && f.size > 0;
}

function pushImageFile(out: ClipboardStagedFile[], seen: Set<string>, f: File | null) {
  if (!f || !isImageFile(f)) return;
  const key = `${f.name}:${f.size}:${f.type}:${f.lastModified}`;
  if (seen.has(key)) return;
  seen.add(key);
  const mime = f.type && f.type.startsWith('image/') ? f.type : 'image/png';
  out.push({
    id: `paste-${Date.now()}-${out.length}-${f.name || 'screenshot'}`,
    uri: URL.createObjectURL(f),
    name: f.name || `screenshot-${out.length + 1}.png`,
    mimeType: mime,
  });
}

export function filesFromClipboard(data: DataTransfer | null | undefined): ClipboardStagedFile[] {
  if (!data) return [];
  const out: ClipboardStagedFile[] = [];
  const seen = new Set<string>();
  if (data.files?.length) {
    Array.from(data.files).forEach((f) => pushImageFile(out, seen, f));
  }
  if (data.items) {
    Array.from(data.items).forEach((item) => {
      if (item.type.startsWith('image/') || item.kind === 'file') {
        pushImageFile(out, seen, item.getAsFile());
      }
    });
  }
  return out;
}

/** RN-web TextInput / View paste events put DataTransfer on nativeEvent or the DOM event. */
export function extractClipboardImageFiles(e: unknown): ClipboardStagedFile[] {
  const ev = e as {
    clipboardData?: DataTransfer | null;
    nativeEvent?: { clipboardData?: DataTransfer | null };
  };
  return filesFromClipboard(ev?.clipboardData ?? ev?.nativeEvent?.clipboardData ?? null);
}

function isUnrelatedTextField(target: EventTarget | null): boolean {
  // Chat composer is a <textarea> (RN-web TextInput). Do not treat those as "other forms".
  if (!(target instanceof HTMLInputElement)) return false;
  const inChat =
    target.closest(`#${CHAT_WEB_COMPOSER_NATIVE_ID}`) ||
    target.closest(`#${WEBCHAT_FAB_COMPOSER_NATIVE_ID}`) ||
    target.closest(`#${WEB_CHAT_PANEL_NATIVE_ID}`);
  if (inChat) return false;
  const t = (target.type || 'text').toLowerCase();
  return t === 'text' || t === 'email' || t === 'search' || t === 'url' || t === 'tel' || t === 'password' || t === 'number';
}

/**
 * Desktop web: Ctrl/Cmd+V a screenshot into the chat composer as a staged attachment.
 * Uses capture so React Native Web's TextInput cannot swallow the event.
 */
export function useWebClipboardImagePaste(
  onFiles: (files: ClipboardStagedFile[]) => void,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled || Platform.OS !== 'web' || typeof document === 'undefined') return;

    const onPaste = (e: ClipboardEvent) => {
      const files = filesFromClipboard(e.clipboardData);
      if (files.length) {
        if (isUnrelatedTextField(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        onFiles(files);
        return;
      }
      if (isUnrelatedTextField(e.target)) return;
      const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (!clip || typeof clip.read !== 'function') return;
      void clip.read().then(async (items) => {
        const out: ClipboardStagedFile[] = [];
        const seen = new Set<string>();
        for (const item of items) {
          const type = item.types.find((t) => t.startsWith('image/'));
          if (!type) continue;
          const blob = await item.getType(type);
          pushImageFile(out, seen, new File([blob], `screenshot-${Date.now()}.png`, { type }));
        }
        if (out.length) onFiles(out);
      }).catch(() => {
        /* permission denied or no image */
      });
    };

    // Capture: RN-web TextInput often stopPropagation on bubble paste.
    document.addEventListener('paste', onPaste, true);
    window.addEventListener('paste', onPaste, true);
    return () => {
      document.removeEventListener('paste', onPaste, true);
      window.removeEventListener('paste', onPaste, true);
    };
  }, [enabled, onFiles]);
}
