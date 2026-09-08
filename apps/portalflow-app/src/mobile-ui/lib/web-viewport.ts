import { Platform, useWindowDimensions } from 'react-native';

export const MOBILE_WEB_MAX_WIDTH = 920;

export function isMobileWebWidth(width: number): boolean {
  return width <= MOBILE_WEB_MAX_WIDTH;
}

export function isDesktopWebRuntime(widthHint?: number): boolean {
  if (Platform.OS !== 'web') return false;
  const width =
    typeof widthHint === 'number'
      ? widthHint
      : typeof window !== 'undefined'
        ? window.innerWidth
        : MOBILE_WEB_MAX_WIDTH + 1;
  return !isMobileWebWidth(width);
}

export function useWebViewportKind() {
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const isMobileWeb = isWeb && isMobileWebWidth(width);
  const isDesktopWeb = isWeb && !isMobileWeb;

  return {
    width,
    isWeb,
    isMobileWeb,
    isDesktopWeb,
  };
}

/** RN-web `useWindowDimensions` can be 0 inside the chat rail; prefer the browser viewport. */
export function useOverlayViewportSize() {
  const dims = useWindowDimensions();
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return {
      width: window.innerWidth || dims.width || 1024,
      height: window.innerHeight || dims.height || 768,
    };
  }
  return { width: dims.width, height: dims.height };
}
