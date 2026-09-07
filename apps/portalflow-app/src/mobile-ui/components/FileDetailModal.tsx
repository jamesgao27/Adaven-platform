/**
 * 文件详情大浮窗：左侧预览（图/PDF/Office），右侧识别内容（docType、summary、extractedPreview）。
 * 供 TaxFilingTodosView 与 chat-to-log 识别后卡片共用。
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Image,
  Platform,
  Dimensions,
  Linking,
  BackHandler,
  ActivityIndicator,
  Share,
  Alert,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import {
  buildExtractedPreview,
  isSpreadsheetAttachmentUrl,
  isWordAttachmentUrl,
  summarySuggestsSpreadsheet,
  summarySuggestsWord,
  type AttachmentPreviewField,
} from '@/lib/firm';
import { getTaxFilingViewUrl } from '@/lib/supabase';
import {
  fetchTaxFilingAttachmentArrayBuffer,
  workbookArrayBufferToPreviewHtml,
  renderDocxIntoContainer,
  isLegacyWordDocBytes,
  writeNativeDocxPreviewHtmlPage,
  writeNativePdfPreviewHtmlPage,
  iosWebViewAllowingReadAccessUrlForFileUri,
} from '@/lib/office-inline-preview';
import { promptSaveAttachmentImage } from './AttachmentImagePreviewModal';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'];

type PreviewPaneKind = 'image' | 'pdf' | 'office-sheet' | 'office-word';

/** Path-only check (strips query/hash). Used by expense/income detail thumbs too. */
export function looksLikePdfUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const path = url.split(/[#?]/)[0].toLowerCase();
  return path.endsWith('.pdf');
}

/** Non-image attachment that should open FileDetailModal instead of the image lightbox. */
export function looksLikeDocumentAttachmentUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const path = url.split(/[#?]/)[0].toLowerCase();
  if (IMAGE_EXTENSIONS.some((ext) => path.endsWith(`.${ext}`))) return false;
  return /\.(pdf|docx?|xlsx?|pptx?|csv)$/i.test(path);
}

function getPreviewPaneKind(
  url: string | null | undefined,
  docType: string | null | undefined,
  summaryName?: string | null
): PreviewPaneKind {
  if (url && isSpreadsheetAttachmentUrl(url, docType)) return 'office-sheet';
  if (url && isWordAttachmentUrl(url, docType)) return 'office-word';
  if (summarySuggestsSpreadsheet(summaryName)) return 'office-sheet';
  if (summarySuggestsWord(summaryName)) return 'office-word';
  const ext = (url ? url.split(/[#?]/)[0].split('.').pop()?.toLowerCase() : '') ?? '';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  return 'pdf';
}

function deriveDownloadFileName(file: FileDetailModalFile): string {
  const raw = file.name?.trim();
  if (raw && /\.[a-z0-9]{1,8}$/i.test(raw)) {
    return raw.replace(/[/\\?%*:|"<>]/g, '_');
  }
  const path = file.imageUrl?.split(/[#?]/)[0] ?? '';
  const seg = path.split('/').pop() || '';
  const decoded = decodeURIComponent(seg).replace(/[/\\?%*:|"<>]/g, '_');
  if (decoded && decoded !== '') return decoded;
  return `attachment-${file.id.slice(0, 8)}`;
}

/** 统一包装原生调用，避免 TurboModule 抛异常直接导致崩溃，便于后续排查 */
async function callNativeSafe(label: string, fn: () => Promise<void> | void) {
  try {
    await fn();
  } catch (e) {
    console.error('[NativeCallError]', label, e);
  }
}

// 原生端若未链接 react-native-webview（如 Expo Go），require 会抛 RNCWebViewModule；避免顶层 require 导致整应用崩溃
const WebView =
  Platform.OS === 'web'
    ? null
    : (() => {
        try {
          return require('react-native-webview').WebView;
        } catch {
          return null;
        }
      })();

export interface FileDetailModalFile {
  id: string;
  name?: string | null;
  imageUrl?: string | null;
  docType?: string | null;
  status?: string;
  extracted_data?: unknown;
  extractedPreview?: AttachmentPreviewField[];
  /**
   * 当为 true 时，仅展示左侧内嵌文档预览，不展示右侧识别内容。
   * 供 expenses / income / chat 提交气泡等场景使用。
   */
  hideRightPanel?: boolean;
}

export interface FileDetailModalProps {
  file: FileDetailModalFile;
  onClose: () => void;
}

const WEB_CARD_NATIVE_ID = 'file-detail-modal-card';
const WEB_LEFT_NATIVE_ID = 'file-detail-modal-left';

export function FileDetailModal({ file, onClose }: FileDetailModalProps) {
  const extractedPreview =
    file.extractedPreview ?? (file.extracted_data ? buildExtractedPreview(file.extracted_data) : []);
  const showRightPanel = !file.hideRightPanel;

  const paneKind = useMemo(
    () => getPreviewPaneKind(file.imageUrl, file.docType, file.name),
    [file.imageUrl, file.docType, file.name]
  );

  const [officeSheetState, setOfficeSheetState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [officeWordState, setOfficeWordState] = useState<'idle' | 'loading' | 'legacy' | 'ready' | 'error'>('idle');
  const [sheetHtml, setSheetHtml] = useState<string | null>(null);
  const [wordBuffer, setWordBuffer] = useState<ArrayBuffer | null>(null);
  const [nativeDocxUri, setNativeDocxUri] = useState<string | null>(null);
  const [nativePdfState, setNativePdfState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [nativePdfUri, setNativePdfUri] = useState<string | null>(null);
  const nativePreviewMinHeight = Math.max(
    280,
    Math.round(Dimensions.get('window').height * (showRightPanel ? 0.38 : 0.7)),
  );
  const docxWebRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOfficeSheetState('idle');
    setOfficeWordState('idle');
    setSheetHtml(null);
    setWordBuffer(null);
    setNativeDocxUri(null);
    setNativePdfState('idle');
    setNativePdfUri(null);
  }, [file.id]);

  /** Native: download PDF, then preview via a local HTML+PDF.js page (iOS file:// PDF is often a white screen). */
  useEffect(() => {
    if (Platform.OS === 'web' || paneKind !== 'pdf' || !file.imageUrl) {
      setNativePdfState('idle');
      setNativePdfUri(null);
      return;
    }
    let cancelled = false;
    setNativePdfState('loading');
    setNativePdfUri(null);
    (async () => {
      try {
        const viewUrl = await getTaxFilingViewUrl(file.imageUrl!);
        const dest = `${FileSystem.cacheDirectory ?? ''}portalflow-pdf-preview-${file.id.slice(0, 8)}-${Date.now()}.pdf`;
        const { uri } = await FileSystem.downloadAsync(viewUrl, dest);
        if (cancelled) return;
        const htmlUri = await writeNativePdfPreviewHtmlPage(uri, file.id);
        if (cancelled) return;
        setNativePdfUri(htmlUri);
        setNativePdfState('ready');
      } catch (e) {
        console.error('[FileDetailModal] native PDF preview:', e);
        if (!cancelled) setNativePdfState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paneKind, file.imageUrl, file.id]);

  useEffect(() => {
    let cancelled = false;
    if (!file.imageUrl || paneKind !== 'office-sheet') {
      setOfficeSheetState('idle');
      return;
    }
    setOfficeSheetState('loading');
    fetchTaxFilingAttachmentArrayBuffer(file.imageUrl)
      .then((ab) => {
        if (cancelled) return;
        setSheetHtml(workbookArrayBufferToPreviewHtml(ab));
        setOfficeSheetState('ready');
      })
      .catch(() => {
        if (!cancelled) setOfficeSheetState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [file.imageUrl, paneKind, file.id]);

  useEffect(() => {
    let cancelled = false;
    if (!file.imageUrl || paneKind !== 'office-word') {
      setOfficeWordState('idle');
      return;
    }
    setOfficeWordState('loading');
    fetchTaxFilingAttachmentArrayBuffer(file.imageUrl)
      .then(async (ab) => {
        if (cancelled) return;
        if (isLegacyWordDocBytes(ab)) {
          setOfficeWordState('legacy');
          return;
        }
        if (Platform.OS === 'web') {
          setWordBuffer(ab);
          setOfficeWordState('ready');
          return;
        }
        try {
          const uri = await writeNativeDocxPreviewHtmlPage(ab, file.id);
          if (cancelled) return;
          setNativeDocxUri(uri);
          setOfficeWordState('ready');
        } catch {
          if (!cancelled) setOfficeWordState('error');
        }
      })
      .catch(() => {
        if (!cancelled) setOfficeWordState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [file.imageUrl, paneKind, file.id]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || paneKind !== 'office-word' || officeWordState !== 'ready' || !wordBuffer) {
      return;
    }
    const el = docxWebRef.current;
    if (!el) return;
    let cancelled = false;
    renderDocxIntoContainer(el, wordBuffer).catch(() => {
      if (!cancelled) setOfficeWordState('error');
    });
    return () => {
      cancelled = true;
      el.innerHTML = '';
    };
  }, [paneKind, officeWordState, wordBuffer]);

  const [downloadBusy, setDownloadBusy] = useState(false);
  const downloadInFlightRef = useRef(false);
  const handleDownloadOriginal = useCallback(async () => {
    if (!file.imageUrl || downloadInFlightRef.current) return;
    downloadInFlightRef.current = true;
    setDownloadBusy(true);
    try {
      const viewUrl = await getTaxFilingViewUrl(file.imageUrl);
      const baseName = deriveDownloadFileName(file);

      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const res = await fetch(viewUrl, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = baseName;
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
        return;
      }

      const dest = `${FileSystem.cacheDirectory ?? ''}vouchap-download-${Date.now()}-${baseName}`;
      const { uri } = await FileSystem.downloadAsync(viewUrl, dest);
      try {
        await Share.share({
          title: baseName,
          url: uri,
        });
      } catch {
        await callNativeSafe('FileDetailModal.openDownloaded', () => Linking.openURL(uri));
      }
    } catch (e) {
      console.error('[FileDetailModal] download original:', e);
      try {
        if (!file.imageUrl) return;
        const fallback = await getTaxFilingViewUrl(file.imageUrl);
        await callNativeSafe('FileDetailModal.downloadFallback', () => Linking.openURL(fallback));
      } catch {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.alert('Could not download this file. Try again or open the link from your browser.');
        } else Alert.alert('Download failed', 'Could not save this file. Please try opening it in a browser instead.');
      }
    } finally {
      downloadInFlightRef.current = false;
      setDownloadBusy(false);
    }
  }, [file.imageUrl, file.name, file.id]);

  /** Web：签名 URL 供 `<object>`；blob: 供部分浏览器内嵌更稳定（仅 PDF） */
  const [webPdfBlobUrl, setWebPdfBlobUrl] = useState<string | null>(null);
  const [pdfSignedUrl, setPdfSignedUrl] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    if (paneKind !== 'pdf' || !file.imageUrl) {
      setWebPdfBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setPdfSignedUrl(null);
      return;
    }

    const src = file.imageUrl;
    let cancelled = false;

    (async () => {
      try {
        const signed = await getTaxFilingViewUrl(src);
        if (cancelled) return;
        setPdfSignedUrl(signed);
        const res = await fetch(signed, { mode: 'cors', credentials: 'omit' });
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        if (cancelled) return;
        const ct = blob.type || '';
        const pathLooksPdf =
          (file.imageUrl ?? '').toLowerCase().includes('.pdf') || /\/[^/]+\.pdf/i.test(file.imageUrl ?? '');
        if (!ct.includes('pdf') && !pathLooksPdf) {
          if (!cancelled) {
            setWebPdfBlobUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return null;
            });
          }
          return;
        }
        const u = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        setWebPdfBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return u;
        });
      } catch {
        if (!cancelled) {
          setWebPdfBlobUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      setWebPdfBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setPdfSignedUrl(null);
    };
  }, [paneKind, file.imageUrl, file.id]);

  const webPdfEmbedSrc = Platform.OS === 'web' ? webPdfBlobUrl ?? pdfSignedUrl ?? file.imageUrl : file.imageUrl;

  // Android：拦截硬件返回键，优先关闭预览浮窗而不是直接退出页面
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  // Web：内嵌预览区左右滚动时禁止触发浏览器前进/后退（横向 wheel + overscroll）
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const cardEl = document.getElementById(WEB_CARD_NATIVE_ID);
    const leftEl = document.getElementById(WEB_LEFT_NATIVE_ID);
    const targets = [cardEl, leftEl].filter(Boolean) as HTMLElement[];
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX !== 0) e.preventDefault();
    };
    targets.forEach((el) => el.addEventListener('wheel', onWheel, { passive: false }));
    return () => targets.forEach((el) => el.removeEventListener('wheel', onWheel));
  }, []);

  const renderLeftPreview = () => {
    if (!file.imageUrl) {
      return (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <Ionicons name="document-outline" size={48} color="#BDC3C7" />
        </View>
      );
    }

    if (paneKind === 'image') {
      return (
        <Pressable
          style={styles.thumb}
          onLongPress={() => promptSaveAttachmentImage(file.imageUrl as string)}
          delayLongPress={350}
        >
          <Image source={{ uri: file.imageUrl as string }} style={styles.thumb} resizeMode="contain" />
        </Pressable>
      );
    }

    if (paneKind === 'office-sheet') {
      if (officeSheetState === 'loading' || officeSheetState === 'idle') {
        return (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <ActivityIndicator size="large" color="#6C5CE7" />
            <Text style={styles.openInNewHint}>Loading preview…</Text>
          </View>
        );
      }
      if (officeSheetState === 'error' || !sheetHtml) {
        return (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="document-text-outline" size={40} color="#BDC3C7" />
            <Text style={styles.openInNewHint}>Preview not available</Text>
            <TouchableOpacity
              style={styles.openInNewBtn}
              onPress={() => callNativeSafe('FileDetailModal.openURL', () => Linking.openURL(file.imageUrl!))}
            >
              <Text style={styles.openInNewBtnText}>Open in new tab</Text>
            </TouchableOpacity>
          </View>
        );
      }
      if (Platform.OS === 'web') {
        return (
          <View style={[styles.thumb, styles.thumbWebIframeHost]}>
            {React.createElement('iframe', {
              srcDoc: sheetHtml,
              style: {
                width: '100%',
                height: '100%',
                minHeight: 420,
                border: 'none',
                borderRadius: 10,
                display: 'block',
                backgroundColor: '#fff',
              } as object,
              title: 'Spreadsheet preview',
              sandbox: 'allow-scripts allow-same-origin',
            })}
          </View>
        );
      }
      if (WebView) {
        return (
          <WebView
            source={{ html: sheetHtml }}
            style={styles.thumb}
            originWhitelist={['*']}
            scalesPageToFit
          />
        );
      }
      return (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <Text style={styles.openInNewHint}>Preview not supported</Text>
        </View>
      );
    }

    if (paneKind === 'office-word') {
      if (officeWordState === 'loading' || officeWordState === 'idle') {
        return (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <ActivityIndicator size="large" color="#6C5CE7" />
            <Text style={styles.openInNewHint}>Loading preview…</Text>
          </View>
        );
      }
      if (officeWordState === 'legacy') {
        return (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="document-text-outline" size={40} color="#BDC3C7" />
            <Text style={styles.openInNewHint}>
              Legacy .doc format cannot be previewed here. Download the file and open it in Word or convert to .docx.
            </Text>
            <TouchableOpacity
              style={styles.openInNewBtn}
              onPress={() => callNativeSafe('FileDetailModal.openURL', () => Linking.openURL(file.imageUrl!))}
            >
              <Text style={styles.openInNewBtnText}>Open in new tab</Text>
            </TouchableOpacity>
          </View>
        );
      }
      if (officeWordState === 'error') {
        return (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="document-text-outline" size={40} color="#BDC3C7" />
            <Text style={styles.openInNewHint}>Preview not available</Text>
            <TouchableOpacity
              style={styles.openInNewBtn}
              onPress={() => callNativeSafe('FileDetailModal.openURL', () => Linking.openURL(file.imageUrl!))}
            >
              <Text style={styles.openInNewBtnText}>Open in new tab</Text>
            </TouchableOpacity>
          </View>
        );
      }
      if (Platform.OS === 'web' && wordBuffer) {
        return (
          <ScrollView style={styles.officeScroll} contentContainerStyle={styles.officeScrollContent}>
            {React.createElement('div', {
              ref: docxWebRef,
              style: {
                minHeight: 360,
                width: '100%',
                backgroundColor: '#fff',
              },
            })}
          </ScrollView>
        );
      }
      if (Platform.OS !== 'web' && nativeDocxUri && WebView) {
        const readUrl = iosWebViewAllowingReadAccessUrlForFileUri(nativeDocxUri);
        return (
          <WebView
            source={{ uri: nativeDocxUri }}
            style={styles.thumb}
            originWhitelist={['*']}
            scalesPageToFit
            allowFileAccess
            allowFileAccessFromFileURLs
            allowUniversalAccessFromFileURLs
            {...(Platform.OS === 'ios' ? { allowingReadAccessToURL: readUrl } : {})}
          />
        );
      }
      return (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <Text style={styles.openInNewHint}>Preview not supported</Text>
        </View>
      );
    }

    // pdf — web keeps blob/object embed; native downloads then previews in-app
    if (Platform.OS === 'web' && WebView) {
      return (
        <WebView
          source={{ uri: (webPdfEmbedSrc || '') as string }}
          style={styles.thumb}
          originWhitelist={['*']}
          scalesPageToFit
        />
      );
    }
    if (Platform.OS === 'web' && file.imageUrl) {
      return (
        <View style={[styles.thumb, styles.thumbWebIframeHost]}>
          {React.createElement(
            'object',
            {
              data: webPdfEmbedSrc as string,
              type: 'application/pdf',
              style: {
                width: '100%',
                height: '100%',
                minHeight: 420,
                border: 'none',
                borderRadius: 10,
                display: 'block',
              } as any,
              'aria-label': 'Document preview',
            },
            React.createElement(
              'p',
              { style: { padding: 16, color: '#636E72', fontSize: 14 } },
              'Embedded preview is not available in this browser. Use “Open in new tab” below.',
            ),
          )}
        </View>
      );
    }
    if (Platform.OS !== 'web') {
      if (nativePdfState === 'loading' || nativePdfState === 'idle') {
        return (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <ActivityIndicator size="large" color="#6C5CE7" />
            <Text style={styles.openInNewHint}>Loading preview…</Text>
          </View>
        );
      }
      if (nativePdfState === 'ready' && nativePdfUri && WebView) {
        const readUrl = iosWebViewAllowingReadAccessUrlForFileUri(nativePdfUri);
        return (
          <WebView
            source={{ uri: nativePdfUri }}
            style={[styles.thumb, { minHeight: nativePreviewMinHeight }]}
            originWhitelist={['*']}
            scalesPageToFit
            allowFileAccess
            allowFileAccessFromFileURLs
            allowUniversalAccessFromFileURLs
            mixedContentMode="always"
            javaScriptEnabled
            domStorageEnabled
            setSupportMultipleWindows={false}
            startInLoadingState
            onError={() => setNativePdfState('error')}
            onHttpError={() => setNativePdfState('error')}
            {...(Platform.OS === 'ios' ? { allowingReadAccessToURL: readUrl } : {})}
          />
        );
      }
      return (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <Ionicons name="document-text-outline" size={40} color="#BDC3C7" />
          <Text style={styles.openInNewHint}>Preview not available</Text>
          <TouchableOpacity
            style={styles.openInNewBtn}
            onPress={() => void handleDownloadOriginal()}
          >
            <Text style={styles.openInNewBtnText}>Download / share file</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={[styles.thumb, styles.thumbPlaceholder]}>
        <Ionicons name="document-text-outline" size={40} color="#BDC3C7" />
        <Text style={styles.openInNewHint}>Preview not supported</Text>
        <TouchableOpacity
          style={styles.openInNewBtn}
          onPress={() => callNativeSafe('FileDetailModal.openURL', () => Linking.openURL(file.imageUrl!))}
        >
          <Text style={styles.openInNewBtnText}>Open in new tab</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View nativeID={WEB_CARD_NATIVE_ID} style={[styles.card, Platform.OS === 'web' && styles.cardWeb]}>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Ionicons name="close" size={24} color="#636E72" />
        </TouchableOpacity>
        <View style={styles.body}>
          <View
            nativeID={WEB_LEFT_NATIVE_ID}
            style={[
              styles.left,
              Platform.OS === 'web' && styles.leftWeb,
              !showRightPanel && styles.leftSolo,
            ]}
          >
            {renderLeftPreview()}
          </View>
          {showRightPanel && (
            <ScrollView
              style={[styles.right, Platform.OS === 'web' && styles.rightWeb]}
              contentContainerStyle={styles.rightContent}
              showsVerticalScrollIndicator
            >
              <Text style={styles.docType}>
                {file.docType ?? (file.status === 'PENDING_AI' ? 'Processing…' : 'Attachment')}
              </Text>
              {file.status === 'PENDING_AI' && <Text style={styles.pending}>Recognition in progress</Text>}
              {file.name && file.name !== 'Attachment' && file.name !== 'Processing...' && (
                <Text style={styles.summary}>{file.name}</Text>
              )}
              {extractedPreview.length > 0 && (
                <View style={styles.preview}>
                  {extractedPreview.map((p, i) => (
                    <View key={i} style={styles.previewRow}>
                      <Text style={styles.previewLabel}>{p.label}:</Text>
                      <Text style={styles.previewValue}>{p.value}</Text>
                    </View>
                  ))}
                </View>
              )}
              {file.imageUrl ? (
                <View style={styles.downloadSection}>
                  <Text style={styles.downloadSectionTitle}>Download original file</Text>
                  <Text style={styles.downloadSectionHint}>
                    If the preview does not load, save the file and open it on your device.
                  </Text>
                  <TouchableOpacity
                    style={styles.downloadBtn}
                    onPress={() => void handleDownloadOriginal()}
                    disabled={downloadBusy}
                    activeOpacity={0.85}
                  >
                    {downloadBusy ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <>
                        <Ionicons name="download-outline" size={22} color="#FFF" style={styles.downloadBtnIcon} />
                        <Text style={styles.downloadBtnText}>Download file</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}
            </ScrollView>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  card: {
    width: Math.min(Dimensions.get('window').width * 0.98, 960),
    height: '95%',
    maxHeight: '95%',
    backgroundColor: '#FFF',
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    ...(Platform.OS === 'web'
      ? { flexDirection: 'column' as const, display: 'flex' as const }
      : null),
  },
  cardWeb: {
    overscrollBehavior: 'contain',
  } as any,
  closeBtn: { position: 'absolute', top: 10, right: 10, zIndex: 2, padding: 6 },
  body: {
    flexDirection: Platform.OS === 'web' ? 'row' : 'column',
    flex: 1,
    minHeight: 0,
    ...(Platform.OS === 'web'
      ? { alignItems: 'stretch' as const, width: '100%', height: '100%' as const }
      : null),
  },
  left: {
    backgroundColor: '#F8F9FA',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    flex: Platform.OS === 'web' ? undefined : 1,
    minHeight: Platform.OS === 'web' ? 420 : 280,
    aspectRatio: Platform.OS === 'web' ? 440 / 600 : undefined,
    alignSelf: 'stretch',
    width: Platform.OS === 'web' ? '61.8%' : '100%',
    ...(Platform.OS === 'web'
      ? {
          flexShrink: 0,
          minWidth: 0,
        }
      : null),
  },
  leftSolo: {
    flex: 1,
    maxWidth: '100%',
  },
  leftWeb: {
    overscrollBehavior: 'contain',
  } as any,
  thumb: { width: '100%', height: '100%', minHeight: 240, borderRadius: 10, backgroundColor: '#FFF' },
  thumbWebIframeHost:
    Platform.OS === 'web'
      ? {
          minHeight: 420,
          flexGrow: 1,
          alignSelf: 'stretch',
          position: 'relative',
          overflow: 'hidden',
        }
      : {},
  officeScroll: {
    width: '100%',
    flex: 1,
    minHeight: 420,
  },
  officeScrollContent: {
    flexGrow: 1,
    paddingBottom: 8,
  },
  thumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  openInNewHint: { fontSize: 12, color: '#95A5A6', marginTop: 8, textAlign: 'center', paddingHorizontal: 12 },
  openInNewBtn: { marginTop: 12, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: '#6C5CE7', borderRadius: 8 },
  openInNewBtnText: { fontSize: 13, color: '#FFF', fontWeight: '600' },
  right: {
    flex: Platform.OS === 'web' ? undefined : 1,
    minWidth: 0,
    minHeight: 0,
    alignSelf: 'stretch',
    width: Platform.OS === 'web' ? '38.2%' : '100%',
    flexShrink: 0,
  },
  rightWeb: {
    height: '100%',
    maxHeight: '100%',
  },
  rightContent: { padding: 24, paddingTop: 44, paddingBottom: 24 },
  docType: { fontSize: 16, fontWeight: '700', color: '#6C5CE7', marginBottom: 10 },
  pending: { fontSize: 13, color: '#95A5A6', fontStyle: 'italic', marginBottom: 12 },
  summary: { fontSize: 15, color: '#2D3436', marginBottom: 16, lineHeight: 24 },
  preview: { gap: 12 },
  previewRow: { marginBottom: 10 },
  previewLabel: { fontSize: 12, color: '#95A5A6', marginBottom: 2, textTransform: 'capitalize' },
  previewValue: { fontSize: 15, color: '#2D3436', fontWeight: '600', lineHeight: 22 },
  downloadSection: {
    marginTop: 28,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#DFE6E9',
  },
  downloadSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2D3436',
    marginBottom: 8,
  },
  downloadSectionHint: {
    fontSize: 13,
    color: '#636E72',
    lineHeight: 20,
    marginBottom: 14,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6C5CE7',
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 10,
    minHeight: 48,
  },
  downloadBtnIcon: { marginRight: 10 },
  downloadBtnText: { fontSize: 16, color: '#FFF', fontWeight: '700' },
});
