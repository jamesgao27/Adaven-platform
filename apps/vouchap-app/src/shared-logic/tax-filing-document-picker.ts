/**
 * Lazy-load expo-document-picker so screens that import TaxFilingTodosView do not crash at module load
 * when the native binary (Expo Go mismatch or stale dev client) does not include ExpoDocumentPicker.
 * First failure happens on first pick; user should rebuild: npx expo run:android / run:ios.
 *
 * Lives under shared-logic because tsconfig maps `@/lib/*` → `src/shared-logic/*`.
 */
import type { DocumentPickerOptions } from 'expo-document-picker';

export async function pickTaxFilingDocument(options: DocumentPickerOptions) {
  const { getDocumentAsync } = await import('expo-document-picker');
  return getDocumentAsync(options);
}
