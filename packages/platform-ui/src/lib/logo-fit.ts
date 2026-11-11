import { Platform } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';

/** UI base fill behind contain-fitted avatars / logos (not dark). */
export const LOGO_PAD_COLOR = '#F8F9FA';

/**
 * Fit image into a square using long-edge contain (centered).
 * Uncovered / transparent areas are filled with the UI base color.
 */
export async function fitLogoToSquareContain(
  uri: string,
  originWidth?: number,
  originHeight?: number,
  maxSide = 1280,
): Promise<string> {
  const w = originWidth && originWidth > 0 ? originWidth : 0;
  const h = originHeight && originHeight > 0 ? originHeight : 0;

  if (Platform.OS === 'web') {
    return fitOnWebCanvas(uri, w, h, maxSide);
  }

  // Native: keep aspect via long-edge resize (no short-edge crop). Display uses contain + pad color.
  if (w > 0 && h > 0) {
    const longEdge = Math.max(w, h);
    if (longEdge <= maxSide) return uri;
    const scale = maxSide / longEdge;
    const resized = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) } }],
      { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
    );
    return resized.uri;
  }

  const resized = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxSide } }],
    { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
  );
  return resized.uri;
}

async function fitOnWebCanvas(
  uri: string,
  originWidth: number,
  originHeight: number,
  maxSide: number,
): Promise<string> {
  const img = await loadHtmlImage(uri);
  const srcW = originWidth > 0 ? originWidth : img.naturalWidth || img.width;
  const srcH = originHeight > 0 ? originHeight : img.naturalHeight || img.height;
  if (!srcW || !srcH) return uri;

  const side = Math.min(maxSide, Math.max(srcW, srcH));
  const scale = side / Math.max(srcW, srcH);
  const drawW = Math.max(1, Math.round(srcW * scale));
  const drawH = Math.max(1, Math.round(srcH * scale));
  const dx = Math.floor((side - drawW) / 2);
  const dy = Math.floor((side - drawH) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (!ctx) return uri;
  ctx.fillStyle = LOGO_PAD_COLOR;
  ctx.fillRect(0, 0, side, side);
  ctx.drawImage(img, dx, dy, drawW, drawH);

  return await new Promise<string>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode logo'));
          return;
        }
        resolve(URL.createObjectURL(blob));
      },
      'image/jpeg',
      0.92,
    );
  });
}

function loadHtmlImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for logo fit'));
    img.src = uri;
  });
}
