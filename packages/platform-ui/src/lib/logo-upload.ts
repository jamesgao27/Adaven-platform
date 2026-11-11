import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { getPlatformClient } from '@adaven/platform-core';

const MARKETPLACE_BUCKET = 'marketplace';

async function readUriAsArrayBuffer(fileUri: string): Promise<ArrayBuffer> {
  const isBlobOrData = fileUri.startsWith('blob:') || fileUri.startsWith('data:');
  let uri = fileUri;

  if (Platform.OS !== 'web' && !isBlobOrData) {
    const manipulated = await ImageManipulator.manipulateAsync(fileUri, [], {
      compress: 0.9,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    uri = manipulated.uri;
  }

  if (Platform.OS === 'web' || uri.startsWith('blob:') || uri.startsWith('data:')) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
    return res.arrayBuffer();
  }

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
}

async function uploadJpegToMarketplace(filePath: string, fileUri: string): Promise<string> {
  const supabase = getPlatformClient();
  const arrayBuffer = await readUriAsArrayBuffer(fileUri);
  const { error } = await supabase.storage.from(MARKETPLACE_BUCKET).upload(filePath, arrayBuffer, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) throw error;

  const {
    data: { publicUrl },
  } = supabase.storage.from(MARKETPLACE_BUCKET).getPublicUrl(filePath);
  return publicUrl + (publicUrl.includes('?') ? '&' : '?') + `v=${Date.now()}`;
}

/** Space logo → marketplace/{spaceId}/space_logo/space_logo.jpg */
export async function uploadSpaceImage(fileUri: string, spaceId: string): Promise<string> {
  const folder = spaceId?.trim() || 'unknown';
  return uploadJpegToMarketplace(`${folder}/space_logo/space_logo.jpg`, fileUri);
}

/** User avatar → marketplace/{userId}/user_logo/user_logo.jpg */
export async function uploadUserLogo(fileUri: string, userId: string): Promise<string> {
  const folder = userId?.trim() || 'unknown';
  return uploadJpegToMarketplace(`${folder}/user_logo/user_logo.jpg`, fileUri);
}
