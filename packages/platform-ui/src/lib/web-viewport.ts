import { Platform, useWindowDimensions } from 'react-native';

export const MOBILE_WEB_MAX_WIDTH = 920;

export function isMobileWebWidth(width: number): boolean {
  return width <= MOBILE_WEB_MAX_WIDTH;
}

export function useWebViewportKind() {
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const isMobileWeb = isWeb && isMobileWebWidth(width);
  const isDesktopWeb = isWeb && !isMobileWeb;
  return { width, isWeb, isMobileWeb, isDesktopWeb };
}
