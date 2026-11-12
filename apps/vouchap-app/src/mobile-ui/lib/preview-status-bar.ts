import { Dimensions, Platform, StatusBar } from 'react-native';

/**
 * Store builds draw edge-to-edge, so a full-screen preview paints through the status bar.
 * Expo Go keeps the system bar outside the window, so this inset is zero there.
 */
export function previewStatusBarInset(): number {
  if (Platform.OS !== 'android') return 0;
  const bar = StatusBar.currentHeight ?? 0;
  if (bar <= 0) return 0;
  const screenH = Dimensions.get('screen').height;
  const windowH = Dimensions.get('window').height;
  if (screenH - windowH >= bar * 0.5) return 0;
  return bar;
}
