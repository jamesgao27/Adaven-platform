import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useChatPanel, type StagedAttachmentFile } from '../contexts/ChatPanelContext';
import {
  filesFromClipboard,
  filesFromClipboardItems,
  type ClipboardStagedFile,
} from '../lib/use-web-clipboard-image-paste';
import { showToast } from '@/lib/toast';

/**
 * Single web paste path: if the clipboard has an image, turn it into a staged file.
 * Does not insert images into the text field.
 */
export function WebChatClipboardPasteHost() {
  const chat = useChatPanel();
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const lastAtRef = useRef(0);

  const applyFiles = useCallback((files: ClipboardStagedFile[]) => {
    if (!files.length) return;
    const now = Date.now();
    if (now - lastAtRef.current < 400) return;
    lastAtRef.current = now;
    const c = chatRef.current;
    if (!c) return;
    const staged: StagedAttachmentFile[] = files.map((f) => ({
      id: f.id,
      uri: f.uri,
      name: f.name,
    }));
    if (c.appendStagedFilesRef.current) {
      c.appendStagedFilesRef.current(staged);
    } else {
      c.setInitialStagedFiles(staged);
      if (!c.open) c.openPanel();
    }
    showToast('Screenshot added.', 'success');
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    let shortcutHeld = false;
    let shortcutHandled = false;

    const claimShortcut = () => {
      if (shortcutHandled) return false;
      shortcutHandled = true;
      return true;
    };

    const takeImagesFromClipboardApi = () => {
      if (!claimShortcut()) return;
      const clip = navigator.clipboard;
      if (!clip || typeof clip.read !== 'function') return;
      void clip.read()
        .then((items) => filesFromClipboardItems(items))
        .then((files) => {
          if (files.length) applyFiles(files);
        })
        .catch(() => undefined);
    };

    const onPaste = (e: ClipboardEvent) => {
      const files = filesFromClipboard(e.clipboardData);
      if (files.length) {
        e.preventDefault();
        e.stopPropagation();
        if (!claimShortcut()) return;
        applyFiles(files);
        return;
      }
      takeImagesFromClipboardApi();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'v') return;
      if (e.repeat || shortcutHeld) return;
      shortcutHeld = true;
      shortcutHandled = false;
      takeImagesFromClipboardApi();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key !== 'v' && e.key !== 'Meta' && e.key !== 'Control') return;
      shortcutHeld = false;
      shortcutHandled = false;
    };

    document.addEventListener('paste', onPaste, true);
    window.addEventListener('paste', onPaste, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      document.removeEventListener('paste', onPaste, true);
      window.removeEventListener('paste', onPaste, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [applyFiles]);

  return null;
}
