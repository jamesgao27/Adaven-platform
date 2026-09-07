import { useEffect } from 'react';
import { Platform } from 'react-native';

export type ClipboardStagedFile = { id: string; uri: string; name?: string; mimeType?: string };

export const CHAT_WEB_COMPOSER_NATIVE_ID = 'chat-web-composer';
export const WEBCHAT_FAB_COMPOSER_NATIVE_ID = 'webchatfab-composer';

function filesFromClipboard(data: DataTransfer | null): ClipboardStagedFile[] {
  if (!data) return [];
  const out: ClipboardStagedFile[] = [];
  const seen = new Set<File>();
  const pushFile = (f: File) => {
    if (seen.has(f) || !f.type.startsWith('image/')) return;
    seen.add(f);
    out.push({
      id: `paste-${Date.now()}-${out.length}-${f.name || 'screenshot'}`,
      uri: URL.createObjectURL(f),
      name: f.name || `screenshot-${out.length + 1}.png`,
      mimeType: f.type || 'image/png',
    });
  };
  if (data.files?.length) {
    Array.from(data.files).forEach(pushFile);
  }
  if (data.items) {
    Array.from(data.items).forEach((item) => {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) return;
      const f = item.getAsFile();
      if (f) pushFile(f);
    });
  }
  return out;
}

/**
 * Desktop web: Ctrl/Cmd+V a screenshot into the chat composer as a staged attachment.
 * Does not steal paste from other text fields outside the composer.
 */
export function useWebClipboardImagePaste(
  onFiles: (files: ClipboardStagedFile[]) => void,
  enabled: boolean,
  composerElementId: string = CHAT_WEB_COMPOSER_NATIVE_ID,
) {
  useEffect(() => {
    if (!enabled || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onPaste = (e: ClipboardEvent) => {
      const files = filesFromClipboard(e.clipboardData);
      if (!files.length) return;
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const composer = document.getElementById(composerElementId);
        if (!composer?.contains(target)) return;
      }
      e.preventDefault();
      onFiles(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [enabled, onFiles, composerElementId]);
}
