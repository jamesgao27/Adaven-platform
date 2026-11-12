import { Platform, Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { showToast } from './toast';

function extFromUri(uri: string): string {
  const path = uri.split(/[#?]/)[0];
  const m = path.match(/\.(jpe?g|png|gif|webp|heic)$/i);
  return m ? m[0].toLowerCase() : '.jpg';
}

async function ensureLocalImageFile(uri: string): Promise<string> {
  if (uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('data:')) return uri;
  const dest = `${FileSystem.cacheDirectory ?? ''}saved-image-${Date.now()}${extFromUri(uri)}`;
  const { uri: local } = await FileSystem.downloadAsync(uri, dest);
  return local;
}

async function downloadViaAnchor(uri: string): Promise<void> {
  const name = `image-${Date.now()}${extFromUri(uri)}`;
  let href = uri;
  let revoke: string | null = null;
  try {
    const res = await fetch(uri, { mode: 'cors', credentials: 'omit' });
    if (res.ok) {
      const blob = await res.blob();
      href = URL.createObjectURL(blob);
      revoke = href;
    }
  } catch {
    /* cross-origin: fall back to the original URL */
  }
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revoke) URL.revokeObjectURL(revoke);
}

/** Save a previewed attachment image to Photos / Downloads, or the system share sheet. */
export async function saveAttachmentImageToDevice(uri: string): Promise<void> {
  if (!uri) return;
  if (Platform.OS === 'web') {
    try {
      await downloadViaAnchor(uri);
      showToast('Image saved.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save image.', 'error');
    }
    return;
  }
  try {
    const local = await ensureLocalImageFile(uri);
    try {
      // Optional: only linked after a native rebuild with expo-media-library.
      const MediaLibrary = require('expo-media-library') as {
        requestPermissionsAsync: () => Promise<{ granted?: boolean; status?: string }>;
        saveToLibraryAsync: (fileUri: string) => Promise<void>;
      };
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (perm.granted || perm.status === 'granted') {
        await MediaLibrary.saveToLibraryAsync(local);
        showToast('Saved to Photos.', 'success');
        return;
      }
    } catch {
      /* module not linked — share sheet still lets the user save */
    }
    await Share.share(
      Platform.OS === 'ios' ? { url: local } : { url: local, title: 'Save image', message: local },
    );
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Could not save image.', 'error');
  }
}
