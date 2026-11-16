import { Platform } from 'react-native';

/** Document scan / gallery multi-select: max pages per batch (Android uses maxNumDocuments). */
export const MAX_CAPTURE_BATCH = 20;

export type DocumentScanOutcome =
  | { kind: 'success'; images: string[] }
  | { kind: 'cancel' }
  | { kind: 'empty' };

type DocumentScannerModule = {
  scanDocument: (options?: Record<string, unknown>) => Promise<{
    scannedImages?: string[];
    status?: string;
  }>;
};

/**
 * Options shared by home + expense-list camera entries (avoid per-screen forks).
 * Matches Vouchap-261109backup home: quality 90, no manual crop, Android page limit.
 */
export function buildDocumentScanOptions(): Record<string, unknown> {
  const scanOptions: Record<string, unknown> = {
    croppedImageQuality: 90,
    letUserAdjustCrop: false,
  };
  // Android ML Kit page limit enables multi-page in one session; iOS VisionKit is multi by default.
  if (Platform.OS === 'android') {
    scanOptions.maxNumDocuments = MAX_CAPTURE_BATCH;
  }
  return scanOptions;
}

/**
 * Shared DocumentScanner gate used by home + receipts.
 *
 * Proven cancel behavior (backup / store builds): native cancel resolves as
 * `{ status: 'cancel' }` with **no** `scannedImages`, so
 * `scannedImages?.length > 0` alone never uploaded. Keep that as the upload gate.
 * Also short-circuit on `status === 'cancel'` (plugin docs) so we never upload if a
 * device ever attaches leftover URIs on cancel.
 */
export async function scanDocumentsWithPlugin(
  DocumentScanner: DocumentScannerModule
): Promise<DocumentScanOutcome> {
  const result = await DocumentScanner.scanDocument(buildDocumentScanOptions());

  // Same effective cancel path as backup: cancel has no images; do not upload.
  if (result?.status === 'cancel') {
    return { kind: 'cancel' };
  }

  const images = (result?.scannedImages ?? []).filter(
    (uri): uri is string => typeof uri === 'string' && uri.trim().length > 0
  );
  if (images.length === 0) {
    return { kind: 'empty' };
  }
  return { kind: 'success', images };
}
