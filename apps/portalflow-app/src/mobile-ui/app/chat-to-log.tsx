import { useState, useRef, useEffect, useCallback, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  Keyboard,
  Animated,
  InteractionManager,
  Image,
  Modal,
  Linking,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { recognizeInboundFromText, recognizeInboundFromAudio, recognizeOutboundFromText, recognizeOutboundFromAudio, recognizeInboundFromImage, recognizeOutboundFromImage, recognizeInboundFromDocument, recognizeOutboundFromDocument, recognizeClientsFromText, recognizeClientsFromDocument, recognizeClientsFromImage } from '@/lib/gemini';
import { runWithRecognitionRetry, getUserFacingMessage } from '@/lib/recognition-retry';
import { getReceiptById, updateReceipt } from '@/lib/database';
import {
  createProcessingReceipt,
  processReceiptInBackground,
  processReceiptFromDocumentInBackground,
  processReceiptFromTextInBackground,
  processReceiptFromAudioInBackground,
} from '@/lib/receipt-processor';
import {
  createProcessingInvoice,
  processInvoiceInBackground,
  processInvoiceFromDocumentInBackground,
  processInvoiceFromTextInBackground,
  processInvoiceFromAudioInBackground,
} from '@/lib/invoice-processor';
import { getInvoiceById, saveInvoice } from '@/lib/invoices';
import { saveInbound, getInboundById } from '@/lib/inbound';
import { saveOutbound, getOutboundById } from '@/lib/outbound';
import {
  saveChatLog,
  getChatLogsPaginated,
  updateChatLogResponseData,
  updateLatestChatLogPreviewForVoucher,
  VoucherLogType,
  type ChatLog,
} from '@/lib/chat-logs';
import { showAiInventory, showTaxFiling } from '@/lib/feature-flags';
import { getCurrentSpace } from '@/lib/auth';
import { getChatToLogAllowedTypes, getChatToLogAllowedTypeValues } from '@/lib/chat-to-log-allowed-types';
import { getAssistantInfo, getInputPlaceholder } from '../../shared-logic/assistant-config';
import { uploadTaxFilingFile, uploadReceiptImageTempWithSpace } from '@/lib/supabase';
import {
  getProjectById,
  getProjectTodosTree,
  createProjectTodoAttachment,
  updateProjectTodoAttachment,
  getProjectTodoAttachmentById,
  buildExtractedPreview,
  type ProjectTodoNode,
} from '@/lib/firm';
import { classifyTaxDocumentAndPickTask, getFallbackTaskId } from '@/lib/tax-filing-task-matcher';
import { classificationLabelsForTaxFilingPrompt } from '@/lib/tax-filing-project-classification-labels';
import { runTaxFilingRecognition } from '@/lib/tax-filing-recognition-run';
import { resolveUploaderNameForTaxFilingAttachment } from '@/lib/tax-filing-uploader-name';
import {
  buildTaxFilingAttachmentDefaultDisplayName,
  taxFilingAttachmentCardSubtitleSummary,
} from '@/lib/tax-filing-attachment-display-name';
import {
  assertClientRecognitionAllowed,
  recordClientRecognitionSuccessIfEnforced,
} from '@/lib/client-recognition-quota';
import { alertClientRecognitionQuotaBlocked } from '@/lib/recognition-preflight-ui';
import { ReceiptStatus, Receipt, Invoice, Inbound, Outbound, ExtractedClient, ClientRecognitionResult } from '@/types';
import { convertGeminiResultToInbound, convertGeminiResultToOutbound } from '@/lib/receipt-helpers';
import { format } from 'date-fns';
import { 
  startRecording, 
  stopRecording, 
  cancelRecording, 
  uploadAudioFile, 
  playAudio, 
  stopPlayback,
  requestAudioPermission,
} from '@/lib/audio';
import { showToast } from '@/lib/toast';
import { getLocalDateString } from '@/lib/date-utils';
import { useChatPanel } from '../contexts/ChatPanelContext';
import FirmAddClientModal, {
  type FirmAddClientRecognitionDisplay,
  type FirmAddClientBatchRow,
} from '@/components/FirmAddClientModal';
import { FileDetailModal, type FileDetailModalFile } from '@/components/FileDetailModal';
import { webInputBlockStyles } from '../styles/web-input-block-styles';
import {
  CHAT_STAGED_FILES_DISPLAY_MAX,
  chatStagedFilesOverflowLabel,
} from '../lib/chat-staged-files-display';
import { useWebViewportKind } from '../lib/web-viewport';

function isAndroidImagePickerLauncherNotReadyError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return Platform.OS === 'android' && /unregistered ActivityResultLauncher/i.test(msg);
}

/**
 * After returning from the system picker (or when MainActivity was recreated), Expo may still be
 * re-registering ActivityResult contracts on the main queue; the first launch can throw
 * IllegalStateException until registration completes. Retry a few times with short backoff.
 */
async function launchImageLibraryAsyncWithAndroidRelaunchRetries(
  options: Parameters<typeof ImagePicker.launchImageLibraryAsync>[0],
): Promise<Awaited<ReturnType<typeof ImagePicker.launchImageLibraryAsync>>> {
  const betweenAttemptWaitsMs = Platform.OS === 'android' ? [120, 280] : [];
  let attempt = 0;
  for (;;) {
    try {
      return await ImagePicker.launchImageLibraryAsync(options);
    } catch (e) {
      const waitMs = betweenAttemptWaitsMs[attempt];
      if (waitMs == null || !isAndroidImagePickerLauncherNotReadyError(e)) {
        throw e;
      }
      await new Promise<void>((r) => setTimeout(r, waitMs));
      attempt += 1;
    }
  }
}

// 语音识别置信度阈值：与照片 needs_retake 一致，低于此值视为无可识别内容，提示重新提交
const VOICE_CONFIDENCE_THRESHOLD = 0.4;

function buildRecognitionAddClientPayload(items: ExtractedClient[]): {
  display: FirmAddClientRecognitionDisplay;
  batchRows: FirmAddClientBatchRow[];
} {
  const batchRows: FirmAddClientBatchRow[] = [];
  for (const item of items) {
    const contactEmail = (item.email || '').trim().toLowerCase();
    if (!contactEmail) continue;
    const clientName = (item.orgName?.trim() || item.contactName?.trim() || item.email) || 'Client Space';
    batchRows.push({
      clientName,
      contactName: item.contactName?.trim() || '',
      contactEmail,
    });
  }
  const multiple = items.length > 1;
  const display: FirmAddClientRecognitionDisplay = multiple
    ? { clientName: 'Multiple', contactName: 'Multiple', contactEmail: 'Multiple' }
    : batchRows.length === 1
      ? {
          clientName: batchRows[0].clientName,
          contactName: batchRows[0].contactName,
          contactEmail: batchRows[0].contactEmail,
        }
      : { clientName: '—', contactName: '—', contactEmail: '—' };
  return { display, batchRows };
}

/** 各助理的预设说明（助理口吻）：如何交代工作、支持哪些输入、处理后的效果。始终保留在聊天最顶部。 */
function getWelcomeMessage(voucherType: VoucherLogType): Message {
  const { nickname } = getAssistantInfo(voucherType);
  const t0 = new Date(0);
  switch (voucherType) {
    case 'tax-filing':
      return {
        id: 'welcome',
        text: `\nI'm ${nickname}. You can hand me tax documents in any of these ways:\n\n• Images or PDFs — Upload one or more files. I'll classify each document and attach it to the matching task in your project. You can upload multiple files; I'll process them one by one.\n\nAfter processing, each file appears as an attachment on the right task, with a summary and extracted fields you can review.`,
        isUser: false,
        timestamp: t0,
      };
    case 'invoice':
      return {
        id: 'welcome',
        text: `\nI'm ${nickname}. You can give me income or sales info in any of these ways:\n\n• Text — Describe the sale (e.g. who paid, amount, items).\n• Voice — Tell me by voice; I'll transcribe and extract the details.\n• Document — Upload an invoice (e.g. PDF); I'll read it and pull out customer, amount, and line items.\n\nI'll return a draft income record for you to confirm and save.`,
        isUser: false,
        timestamp: t0,
      };
    case 'inbound':
      return {
        id: 'welcome',
        text: `\nI'm ${nickname}. You can describe inbound (goods received from a supplier) in any of these ways:\n\n• Text — Describe supplier, date, and items with quantity and unit.\n• Voice — Tell me by voice; I'll transcribe and extract.\n• Image or document — Send a photo or file (e.g. delivery note); I'll extract supplier, date, and line items.\n\nI'll return a draft inbound record for you to confirm and save.`,
        isUser: false,
        timestamp: t0,
      };
    case 'outbound':
      return {
        id: 'welcome',
        text: `\nI'm ${nickname}. You can describe outbound (goods shipped to a customer) in any of these ways:\n\n• Text — Describe customer, date, and items with quantity and unit.\n• Voice — Tell me by voice; I'll transcribe and extract.\n• Image or document — Send a photo or file (e.g. packing slip); I'll extract customer, date, and line items.\n\nI'll return a draft outbound record for you to confirm and save.`,
        isUser: false,
        timestamp: t0,
      };
    case 'client':
      return {
        id: 'welcome',
        text: `\nI'm ${nickname}. You can add clients in any of these ways:\n\n• Text — Paste a client list (names, emails, companies) or type them line by line.\n• Document — Upload a PDF, Word, or spreadsheet with client/contact info.\n• Image — Upload business card photos or a screenshot of a contact list.\n\nI'll extract email, contact name, organization, and address, then show you a summary. After you confirm, I'll create each client space and send an invite email.`,
        isUser: false,
        timestamp: t0,
      };
    case 'receipt':
    default:
      return {
        id: 'welcome',
        text: `\nI'm ${nickname}. You can hand me expenses in any of these ways:\n\n• Text — Describe the purchase (e.g. where, amount, date, items).\n• Voice — Tell me by voice; I'll transcribe and extract the details.\n• Photo — Send a receipt or bill image; I'll read it and extract vendor, amount, date, and line items.\n• Document — Upload a PDF or image of a receipt; I'll do the same.\n\nI'll return a draft expense for you to confirm and save.`,
        isUser: false,
        timestamp: t0,
      };
  }
}

/** 语音/文字识别结果置信度过低（噪音/乱码/无可识别内容）时视为不可用，不保存记录 */
function isRecognitionResultUnrecognizable(result: { confidence?: number }): boolean {
  const c = result.confidence;
  if (c === undefined) return false;
  return c < VOICE_CONFIDENCE_THRESHOLD;
}

/** 是否图片类型（用于展示缩略图 vs 文档图标） */
const isImageMime = (mime?: string) => !mime || mime.startsWith('image/');
/** 是否可内嵌预览的文档（PDF / Word / Excel / PowerPoint 等） */
const isPreviewableDoc = (name?: string, mime?: string) => {
  const lower = name?.toLowerCase() ?? '';
  if (lower.endsWith('.pdf')) return true;
  if (/\.(docx?|xlsx?|pptx?|csv)$/i.test(lower)) return true;
  const m = mime || '';
  return (
    m === 'application/pdf' ||
    m === 'application/msword' ||
    m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    m === 'application/vnd.ms-excel' ||
    m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    m === 'text/csv' ||
    m === 'application/vnd.ms-powerpoint' ||
    m === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  );
};

/** 在浏览器新标签或系统外部应用中打开文件链接（统一 PDF 打开行为） */
const openFileUrlExternal = (url: string) => {
  if (!url) return;
  if (Platform.OS === 'web') {
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      // ignore
    }
  } else {
    Linking.openURL(url).catch(() => {});
  }
};

/**
 * 从 ChatLog 还原「用户提交消息」的 Message 对象（唯一来源，避免在 loadInitialHistory /
 * loadMoreHistory 中各写一份相同逻辑）。
 *
 * 关键规则：
 * - audio → audioUrl + voiceDuration；显示文字固定为 '🎤 Voice'
 * - image + 非文档 → imageUrl（缩略图可点预览）
 * - image + 文档   → documentUrl（点击新窗口打开）
 * - tax-filing 用 requestData.fileName 存文件名（prompt 含 "Uploaded: " 前缀，需剥离）
 * - expenses/invoice/inbound/outbound 用 requestData.imageUrl 存文件 URL
 */
function restorePromptFromLog(log: ChatLog): Message | null {
  if (!log.prompt) return null;

  const isImageType = log.type === 'image';
  const isAudioType = log.type === 'audio';

  // tax-filing 以 fileName 存储干净的文件名；其他模块 imageUrl 存 URL
  const taxFilingFileName = (log.requestData as any)?.fileName as string | undefined;
  const fileUrlFromRequest = (log.requestData as any)?.imageUrl as string | undefined;

  // 判断文档类型：优先用文件名判，兜底用 prompt 判
  const effectiveFileName = taxFilingFileName ?? log.prompt;
  const isDocFile = isPreviewableDoc(effectiveFileName);

  // 统一取附件 URL：expenses 存在 requestData.imageUrl，tax-filing 存在 attachmentUrl
  const attachUrl = fileUrlFromRequest ?? log.attachmentUrl ?? undefined;

  let requestImageUrl: string | undefined;
  let documentUrl: string | undefined;
  if (isImageType) {
    if (isDocFile) {
      documentUrl = attachUrl;
    } else {
      requestImageUrl = attachUrl;
    }
  }

  const voiceDuration =
    (log.requestData as any)?.audioDurationSeconds ??
    (isAudioType && log.audioUrl && log.prompt
      ? (() => {
          const m = log.prompt.match(/Voice input \((\d+)s\)/);
          return m ? parseInt(m[1], 10) : undefined;
        })()
      : undefined);

  // 显示文字：语音固定'🎤 Voice'；tax-filing 用干净文件名（剥离 "Uploaded: " 前缀）；其他用 prompt
  const displayText =
    isAudioType && log.audioUrl
      ? '🎤 Voice'
      : (taxFilingFileName ?? log.prompt);

  return {
    id: `${log.id}-prompt`,
    text: displayText,
    isUser: true,
    timestamp: new Date(log.createdAt),
    logType: log.type,
    audioUrl: isAudioType ? log.audioUrl ?? undefined : undefined,
    audioDurationSeconds: voiceDuration,
    imageUrl: requestImageUrl,
    documentUrl,
  };
}

// 与列表页 receipts/invoices 统一的货币符号
const getCurrencySymbol = (currency?: string): string => {
  const symbols: Record<string, string> = {
    USD: '$', CAD: 'C$', CNY: '¥', RMB: '¥', JPY: 'J¥', EUR: '€', GBP: '£', AUD: 'A$',
    HKD: 'HK$', TWD: 'NT$', KRW: '₩', SGD: 'S$', MXN: 'MX$', INR: '₹',
    THB: '฿', VND: '₫', PHP: '₱', MYR: 'RM', IDR: 'Rp',
  };
  return symbols[currency || 'USD'] || (currency ? `${currency} ` : '$');
};

// 金额展示：符号弱化、数字突出（与列表页一致）
const AmountText = ({ amount, currency, style }: { amount?: number | null; currency?: string; style?: any }) => {
  const symbol = getCurrencySymbol(currency);
  const baseSize = style?.fontSize || 16;
  const safeAmount = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  return (
    <Text style={style}>
      <Text style={{ color: '#2D3436', fontSize: baseSize - 2 }}>{symbol}</Text>
      <Text style={{ fontWeight: '600' }}>{safeAmount.toFixed(2)}</Text>
    </Text>
  );
};

/** 异步占位预览（或缺 date/amount）不可按完整卡片渲染，否则 Android 会因 toFixed/split 闪退 */
function isProcessingOrIncompletePreview(preview?: {
  status?: string | null;
  date?: string | null;
  totalAmount?: number | null;
} | null): boolean {
  if (!preview) return true;
  if (preview.status === 'processing') return true;
  if (!preview.date || typeof preview.date !== 'string') return true;
  if (preview.totalAmount == null || !Number.isFinite(Number(preview.totalAmount))) return true;
  return false;
}

function buildProcessingReceiptPreviewStub(id: string, imageUrl?: string) {
  return {
    id,
    status: 'processing' as const,
    supplierName: 'Processing...',
    totalAmount: 0,
    date: getLocalDateString(),
    items: [] as Receipt['items'],
    ...(imageUrl ? { imageUrl } : {}),
  };
}

function buildProcessingInvoicePreviewStub(id: string, imageUrl?: string) {
  return {
    id,
    status: 'processing' as const,
    customerName: 'Processing...',
    totalAmount: 0,
    date: getLocalDateString(),
    items: [] as Invoice['items'],
    ...(imageUrl ? { imageUrl } : {}),
  };
}

function markReceiptPreviewDeleted(msg: Message): Message {
  return {
    ...msg,
    receiptDeleted: true,
    receiptPreview: undefined,
    text: msg.text || 'This expense has been deleted.',
  };
}

function markInvoicePreviewDeleted(msg: Message): Message {
  return {
    ...msg,
    invoiceDeleted: true,
    invoicePreview: undefined,
    text: msg.text || 'This income has been deleted.',
  };
}

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  /** ai_chat_logs.type，用于区分 image/picture/document/attachment/audio/text */
  logType?: ChatLog['type'];
  receiptPreview?: Receipt;
  invoicePreview?: Invoice;
  inboundPreview?: Inbound;
  outboundPreview?: Outbound;
  /** attachments 类型：报税附件上传记录，用于跳转 project/attachment（放在「收到消息」卡片）；与 FileDetailModal 一致展示 docType/summary/extracted */
  attachmentPreview?: {
    id: string;
    projectId: string;
    todoId: string;
    name: string;
    displayName?: string | null;
    summary?: string | null;
    imageUrl?: string | null;
    docType?: string | null;
    extracted_data?: unknown;
  };
  /** attachments 类型：发出消息中预览的图片 URL */
  attachmentImageUrl?: string | null;
  /** Client Assistant: recognized client list for confirmation before creating clients + sending invites */
  clientPreview?: {
    firmSpaceId: string;
    summary: ClientRecognitionResult['summary'];
    items: ExtractedClient[];
    confirmed?: boolean;
    canceled?: boolean;
  };
  receiptDeleted?: boolean;
  invoiceDeleted?: boolean;
  inboundDeleted?: boolean;
  outboundDeleted?: boolean;
  voucherType?: VoucherLogType; // 当前记录类别，用于详情跳转
  audioUrl?: string;
  /** 录音时长（秒），用于展示 "Voice input (Xs)" */
  audioDurationSeconds?: number;
  /** 用户发出的图片消息：聊天记录中显示小图预览，文件名弱化 */
  imageUrl?: string | null;
  /** 用户发出的文档消息（PDF / docx 等）：点击可在新窗口或页内预览，文件名显示在下行 */
  documentUrl?: string;
  isPlayingAudio?: boolean;
  /** 多文件提交时：上传完成、识别中，占位预览卡片 loading */
  previewCardLoading?: boolean;
}

function taxFilingAttachmentCardTitle(preview: NonNullable<Message['attachmentPreview']>): string {
  const d = preview.displayName?.trim();
  if (d) return d;
  return buildTaxFilingAttachmentDefaultDisplayName({
    summary: preview.summary,
    docType: preview.docType,
    sourceFileName: preview.name,
  });
}

/**
 * 用户消息气泡内容（统一组件）。
 * 四种类型布局完全一致：56×56 交互区 + 下行文字。
 *   - 图片：缩略图（靠上裁剪），点击页内预览大图
 *   - 语音：播放/暂停图标，点击播放；下行"Voice input (Xs)"
 *   - 文档：文档图标，点击新窗口打开；下行文件名
 *   - 文字：纯文字（无交互区）
 */
const UserMessageBubble = memo(function UserMessageBubble({
  message,
  playingAudioId,
  onPlayAudio,
  onPreviewImage,
  onOpenDocument,
}: {
  message: Message;
  playingAudioId: string | null;
  onPlayAudio: (id: string, url: string) => void;
  onPreviewImage: (url: string) => void;
  onOpenDocument: (url: string, name?: string | null) => void;
}) {
  if (message.audioUrl) {
    return (
      <View style={styles.userMediaMessageContent}>
        <TouchableOpacity
          style={styles.userMediaThumb}
          onPress={() => onPlayAudio(message.id, message.audioUrl!)}
          activeOpacity={0.8}
        >
          <Ionicons
            name={playingAudioId === message.id ? 'pause-circle' : 'play-circle'}
            size={32}
            color="#fff"
          />
        </TouchableOpacity>
        <Text style={styles.userMediaLabel} numberOfLines={1}>
          Voice input ({message.audioDurationSeconds ?? 0}s)
        </Text>
      </View>
    );
  }

  if (message.imageUrl) {
    return (
      <View style={styles.userMediaMessageContent}>
        <TouchableOpacity
          style={styles.userMediaThumb}
          onPress={() => onPreviewImage(message.imageUrl!)}
          activeOpacity={0.9}
        >
          <Image
            source={{ uri: message.imageUrl }}
            style={[styles.userMediaThumbImage, styles.thumbAlignTopLeft]}
            resizeMode="cover"
          />
        </TouchableOpacity>
        <Text style={styles.userMediaLabel} numberOfLines={1} ellipsizeMode="tail">
          {message.text}
        </Text>
      </View>
    );
  }

  if (message.documentUrl || /\.(pdf|docx?|xlsx?|pptx?)$/i.test(message.text)) {
    return (
      <View style={styles.userMediaMessageContent}>
        <TouchableOpacity
          style={styles.userMediaThumb}
          onPress={() => message.documentUrl && onOpenDocument(message.documentUrl, message.text)}
          activeOpacity={message.documentUrl ? 0.8 : 1}
          disabled={!message.documentUrl}
        >
          <Ionicons
            name={/\.pdf$/i.test(message.text) ? 'document-text-outline' : 'document-outline'}
            size={28}
            color="rgba(255,255,255,0.9)"
          />
        </TouchableOpacity>
        <Text style={styles.userMediaLabel} numberOfLines={1} ellipsizeMode="tail">
          {message.text}
        </Text>
      </View>
    );
  }

  return (
    <Text style={[styles.messageText, styles.userMessageText]}>
      {message.text}
    </Text>
  );
});

export function ChatToLogContent(props: { voucherType: VoucherLogType }) {
  return <ChatToLogScreen voucherType={props.voucherType} />;
}

function ChatToLogScreen(props: { voucherType?: VoucherLogType }) {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ type?: string; drawer?: string; projectId?: string; todoId?: string }>();
  const chatPanel = useChatPanel();
  const { isDesktopWeb } = useWebViewportKind();
  const [currentSpace, setCurrentSpace] = useState<{ kind?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    getCurrentSpace().then((space) => {
      if (!cancelled) setCurrentSpace(space ?? null);
    });
    return () => { cancelled = true; };
  }, []);
  const allowedTypeValues = getChatToLogAllowedTypeValues(currentSpace);
  const rawVoucherType: VoucherLogType =
    props.voucherType
      ?? ((params.type === 'invoice' || params.type === 'inbound' || params.type === 'outbound' || params.type === 'tax-filing' || params.type === 'client' || params.type === 'attachments')
        ? (params.type === 'attachments' ? 'tax-filing' : (params.type as VoucherLogType))
        : 'receipt');
  const isPanel = props.voucherType !== undefined;
  // Panel 且 space 未加载时信任路由传入的 type，避免 Clients 页先被归一成 receipt 导致显示 Eric/Expenses 历史（串数据）
  const voucherType: VoucherLogType =
    isPanel && props.voucherType !== undefined && currentSpace == null
      ? rawVoucherType
      : allowedTypeValues.length > 0 && allowedTypeValues.includes(rawVoucherType)
        ? rawVoucherType
        : (allowedTypeValues[0] ?? 'receipt');
  const isAttachmentsType = voucherType === 'tax-filing';
  const isAiInventoryType = voucherType === 'inbound' || voucherType === 'outbound';
  const isDrawer = isDesktopWeb && params.drawer === '1';

  // 根据类型动态设置标题为「Chat to log - 模块名」（模块名为类型选项 label，如 Expenses、Tax Documents）
  useEffect(() => {
    if (isPanel) return;
    if (isDrawer) {
      navigation.setOptions({ headerShown: false });
      return;
    }
    const typeOptions = getChatToLogAllowedTypes(currentSpace);
    const moduleLabel = typeOptions.find((o) => o.value === voucherType)?.label ?? typeOptions[0]?.label ?? 'Expenses';
    navigation.setOptions({ title: `Chat to log - ${moduleLabel}` });
  }, [voucherType, currentSpace, navigation, isDrawer, isPanel]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmedReceipts, setConfirmedReceipts] = useState<Set<string>>(new Set());
  const [confirmedInvoices, setConfirmedInvoices] = useState<Set<string>>(new Set());
  const [confirmedInbounds, setConfirmedInbounds] = useState<Set<string>>(new Set());
  const [confirmedOutbounds, setConfirmedOutbounds] = useState<Set<string>>(new Set());
  const [confirmedClientPreviews, setConfirmedClientPreviews] = useState<Set<string>>(new Set());
  const [recognitionAddClientModal, setRecognitionAddClientModal] = useState<{
    messageId: string;
    firmSpaceId: string;
    display: FirmAddClientRecognitionDisplay;
    batchRows: FirmAddClientBatchRow[];
  } | null>(null);
  // Panel 模式：首帧即用当前类型的欢迎语，避免刷新/切换时先闪 Eric 再变 Cody
  const [messages, setMessages] = useState<Message[]>(() =>
    props.voucherType !== undefined ? [getWelcomeMessage(props.voucherType)] : [],
  );
  const effectiveProjectId = params.projectId ?? chatPanel?.attachmentContext?.projectId;
  /** 用于防止切换项目/类型时旧请求覆盖新请求（导致聊天记录混杂） */
  const historyLoadSeqRef = useRef(0);
  /** tax-filing 模式：项目下的 task 列表，用于识别文件类别后自动匹配关联 */
  const [attachmentTaskOptions, setAttachmentTaskOptions] = useState<{ id: string; title: string }[]>([]);
  const [stagedAttachmentFiles, setStagedAttachmentFiles] = useState<{ id: string; uri: string; name?: string; mimeType?: string }[]>([]);
  /** 当前正在上传/识别的暂存文件 id，用于按文件显示 loading */
  const [uploadingStagedIds, setUploadingStagedIds] = useState<Set<string>>(new Set());
  /** 聊天记录中点击附件预览图时，在弹层中展示大图 */
  const [attachmentImageModalUrl, setAttachmentImageModalUrl] = useState<string | null>(null);
  /** 识别后卡片点击：打开与 Todos 一致的文件详情大浮窗（需拉取附件详情） */
  const [selectedAttachmentForModal, setSelectedAttachmentForModal] = useState<{ attachmentId: string; projectId: string } | null>(null);
  const [attachmentDetailForModal, setAttachmentDetailForModal] = useState<FileDetailModalFile | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [oldestLoadedAt, setOldestLoadedAt] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const inputRef = useRef<TextInput>(null);
  const messagesRef = useRef<Message[]>([]);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  
  // 语音模式相关状态（默认语音模式）
  const [isVoiceMode, setIsVoiceMode] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimer = useRef<NodeJS.Timeout | null>(null);
  const recordingAnimation = useRef(new Animated.Value(1)).current;
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const isStartingRecording = useRef(false);
  const isRecordingRef = useRef(false); // 用 ref 跟踪录音状态，避免闭包问题
  const recordingDurationRef = useRef(0);
  const isLongPressMode = useRef(false); // 是否是长按模式（按住录音）
  const pressStartTime = useRef(0); // 按下的时间戳
  
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  /** Drawer 模式：头部助理区域切换类型时展开的下拉 */
  const [showDrawerTypePicker, setShowDrawerTypePicker] = useState(false);
  
  // 组件挂载状态，后台重试完成后仅在校验通过后更新 UI
  const mountedRef = useRef(true);
  messagesRef.current = messages;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // While async recognition runs, refresh processing preview cards from DB (covers missed UI updates / leave-and-return).
  useEffect(() => {
    if (voucherType !== 'receipt' && voucherType !== 'invoice') return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || !mountedRef.current) return;
      const pending = messagesRef.current.filter((m) =>
        voucherType === 'receipt'
          ? isProcessingOrIncompletePreview(m.receiptPreview)
          : isProcessingOrIncompletePreview(m.invoicePreview as any),
      );
      if (pending.length === 0) return;
      await Promise.all(
        pending.map(async (m) => {
          try {
            if (voucherType === 'receipt' && m.receiptPreview?.id) {
              const receipt = await getReceiptById(m.receiptPreview.id);
              if (!receipt || cancelled || !mountedRef.current) return;
              if (isProcessingOrIncompletePreview(receipt)) return;
              setMessages((prev) =>
                prev.map((row) =>
                  row.id === m.id ? { ...row, receiptPreview: receipt, receiptDeleted: false } : row,
                ),
              );
              void updateLatestChatLogPreviewForVoucher({
                receiptId: receipt.id,
                responseData: { receiptPreview: receipt },
              });
              return;
            }
            if (voucherType === 'invoice' && m.invoicePreview?.id) {
              const invoice = await getInvoiceById(m.invoicePreview.id);
              if (!invoice || cancelled || !mountedRef.current) return;
              if (isProcessingOrIncompletePreview(invoice as any)) return;
              setMessages((prev) =>
                prev.map((row) =>
                  row.id === m.id
                    ? { ...row, invoicePreview: invoice as Invoice, invoiceDeleted: false, voucherType: 'invoice' }
                    : row,
                ),
              );
              void updateLatestChatLogPreviewForVoucher({
                invoiceId: invoice.id,
                responseData: { invoicePreview: invoice },
              });
            }
          } catch {
            /* ignore poll errors */
          }
        }),
      );
    };
    const id = setInterval(() => {
      void tick();
    }, 2500);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [voucherType]);

  useEffect(() => {
    if (isAiInventoryType && !showAiInventory) router.replace('/');
  }, [isAiInventoryType]);

  // Firm 空间若无任何 chat-to-log 模块则退回首页
  useEffect(() => {
    if (currentSpace?.kind === 'provider' && allowedTypeValues.length === 0) router.replace('/');
  }, [currentSpace?.kind, allowedTypeValues.length]);

  // 从 FAB 展开栏带过来的预填输入与已选图片（打开右栏时填入）
  useEffect(() => {
    if (!isPanel || !chatPanel) return;
    if (chatPanel.initialInput) {
      setInputText(chatPanel.initialInput);
      chatPanel.setInitialInput(null);
    }
    if (chatPanel.initialStagedFiles?.length) {
      setStagedAttachmentFiles(prev => [...(chatPanel.initialStagedFiles ?? []), ...prev]);
      chatPanel.setInitialStagedFiles(null);
    }
  }, [isPanel, chatPanel?.initialInput, chatPanel?.initialStagedFiles]);

  // 右栏模式：注册聚焦回调，供 openPanel 后激活输入框
  // 依赖 inputFocusRef（稳定的 useRef 对象）而非整个 chatPanel，避免不必要的 effect 重触发
  const inputFocusRef = chatPanel?.inputFocusRef;
  useEffect(() => {
    if (!isPanel || !inputFocusRef) return;
    inputFocusRef.current = () => inputRef.current?.focus();
    return () => {
      inputFocusRef.current = null;
    };
  }, [isPanel, inputFocusRef]);

  // 识别后卡片点击：拉取附件详情并填入浮窗
  useEffect(() => {
    if (!selectedAttachmentForModal) {
      setAttachmentDetailForModal(null);
      return;
    }
    setAttachmentDetailForModal(null); // 先清空，避免短暂显示上一次附件
    const { attachmentId } = selectedAttachmentForModal;
    let cancelled = false;
    getProjectTodoAttachmentById(attachmentId).then((raw) => {
      if (cancelled) return;
      if (!raw) {
        setSelectedAttachmentForModal(null);
        showToast('Attachment not found.', 'info');
        return;
      }
      const file: FileDetailModalFile = {
        id: raw.id,
        name: raw.display_name?.trim() || raw.summary?.trim() || undefined,
        imageUrl: raw.attachment_url,
        docType: raw.doc_type ?? undefined,
        status: raw.status,
        extracted_data: raw.extracted_data,
      };
      setAttachmentDetailForModal(file);
    }).catch(() => {
      if (!cancelled) {
        setSelectedAttachmentForModal(null);
        showToast('Failed to load attachment.', 'error');
      }
    });
    return () => { cancelled = true; };
  }, [selectedAttachmentForModal?.attachmentId, selectedAttachmentForModal?.projectId]);

  // attachments 模式：有 projectId 时加载 task 列表（用于识别文件后自动匹配）
  useEffect(() => {
    if (!isAttachmentsType || !effectiveProjectId) return;
    let cancelled = false;
    (async () => {
      try {
        const project = await getProjectById(effectiveProjectId);
        if (!project || cancelled) return;
        const tree = await getProjectTodosTree(project.orderId);
        const tasks: { id: string; title: string }[] = [];
        function walk(nodes: ProjectTodoNode[]) {
          nodes.forEach((n) => {
            if (n.itemKind === 'task') tasks.push({ id: n.id, title: n.title });
            walk(n.children);
          });
        }
        walk(tree);
        if (!cancelled) setAttachmentTaskOptions(tasks);
      } catch {
        if (!cancelled) setAttachmentTaskOptions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [isAttachmentsType, effectiveProjectId]);

  // 提交类别选单打开时：点击选单外区域收起（仅 Web）
  useEffect(() => {
    if (Platform.OS !== 'web' || !showTypeDropdown) return;
    const handler = (e: PointerEvent) => {
      const el = document.getElementById('chat-to-log-type-dropdown');
      if (el && !el.contains(e.target as Node)) setShowTypeDropdown(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [showTypeDropdown]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      const current = messagesRef.current;
      const hasPreviews = current.some(
        (m) => m.receiptPreview?.id || m.invoicePreview?.id || m.inboundPreview?.id || m.outboundPreview?.id || m.attachmentPreview?.id,
      );
      if (!hasPreviews || current.length === 0) return;
      (async () => {
        const enriched = await Promise.all(
          current.map(async (msg) => {
            if (msg.invoicePreview?.id) {
              try {
                const invoice = await getInvoiceById(msg.invoicePreview.id);
                if (!invoice) return markInvoicePreviewDeleted(msg);
                return { ...msg, invoicePreview: invoice, invoiceDeleted: false };
              } catch {
                return markInvoicePreviewDeleted(msg);
              }
            }
            if (msg.inboundPreview?.id) {
              try {
                const inbound = await getInboundById(msg.inboundPreview.id);
                if (!inbound) return { ...msg, inboundDeleted: true };
                return { ...msg, inboundPreview: inbound, inboundDeleted: false };
              } catch {
                return { ...msg, inboundDeleted: true };
              }
            }
            if (msg.outboundPreview?.id) {
              try {
                const outbound = await getOutboundById(msg.outboundPreview.id);
                if (!outbound) return { ...msg, outboundDeleted: true };
                return { ...msg, outboundPreview: outbound, outboundDeleted: false };
              } catch {
                return { ...msg, outboundDeleted: true };
              }
            }
            if (msg.attachmentPreview?.id) {
              try {
                const raw = await getProjectTodoAttachmentById(msg.attachmentPreview.id);
                if (!raw) return msg;
                return {
                  ...msg,
                  attachmentPreview: {
                    ...msg.attachmentPreview,
                    displayName: raw.display_name ?? msg.attachmentPreview.displayName,
                    summary: raw.summary ?? msg.attachmentPreview.summary,
                    docType: raw.doc_type ?? msg.attachmentPreview.docType,
                  },
                };
              } catch {
                return msg;
              }
            }
            if (!msg.receiptPreview?.id) return msg;
            try {
              const receipt = await getReceiptById(msg.receiptPreview.id);
              if (!receipt) return markReceiptPreviewDeleted(msg);
              return { ...msg, receiptPreview: receipt, receiptDeleted: false };
            } catch {
              return markReceiptPreviewDeleted(msg);
            }
          }),
        );
        if (isActive) setMessages(enriched);
      })();
      return () => {
        isActive = false;
      };
    }, []),
  );

  useEffect(() => {
    // 切换助理类型时立即清空列表，只显示当前类型的欢迎语，避免串数据（如 Clients 页仍显示 Expenses 历史）
    setMessages([getWelcomeMessage(voucherType)]);
    setHasMoreHistory(false);
    setOldestLoadedAt(null);

    const seq = ++historyLoadSeqRef.current;

    const loadInitialHistory = async () => {
      try {
        setIsLoadingHistory(true);
        // tax-filing 必须有 projectId，否则 projectFilter 为 undefined 会导致跨项目混杂
        if (voucherType === 'tax-filing' && !effectiveProjectId) {
          setMessages([getWelcomeMessage(voucherType)]);
          setHasMoreHistory(false);
          setOldestLoadedAt(null);
          return;
        }
        const projectFilter = voucherType === 'tax-filing' ? effectiveProjectId : undefined;
        const rawLogs = await getChatLogsPaginated(
          5,
          undefined,
          voucherType,
          projectFilter,
        );
        const logs = rawLogs;

        // 如果切换过项目/类型，则丢弃旧请求结果
        if (historyLoadSeqRef.current !== seq) return;

        if (!logs || logs.length === 0) {
          setMessages([getWelcomeMessage(voucherType)]);
          setHasMoreHistory(false);
          return;
        }

        // Supabase 是按 created_at 降序返回，这里反转成时间正序显示
        const sorted = [...logs].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );

        // 首次加载：先 push 提交内容再 push 卡片，reverse 后为 [最新…最早]，inverted 下卡片在下、提交在上
        const restoredMessages: Message[] = [];

        for (const log of sorted) {
          const promptMsg = restorePromptFromLog(log);
          if (promptMsg) restoredMessages.push(promptMsg);
          const logType = log.voucherType ?? 'receipt';
          if (log.responseData?.invoicePreview && logType === 'invoice') {
            const preview = log.responseData.invoicePreview as Invoice;
            restoredMessages.push({
              id: `${log.id}-preview`,
              text: '',
              isUser: false,
              timestamp: new Date(log.createdAt),
              invoicePreview: preview,
              voucherType: 'invoice',
            });
          } else if (log.responseData?.inboundPreview && logType === 'inbound') {
            const preview = log.responseData.inboundPreview as Inbound;
            restoredMessages.push({
              id: `${log.id}-preview`,
              text: '',
              isUser: false,
              timestamp: new Date(log.createdAt),
              inboundPreview: preview,
              voucherType: 'inbound',
            });
          } else if (log.responseData?.outboundPreview && logType === 'outbound') {
            const preview = log.responseData.outboundPreview as Outbound;
            restoredMessages.push({
              id: `${log.id}-preview`,
              text: '',
              isUser: false,
              timestamp: new Date(log.createdAt),
              outboundPreview: preview,
              voucherType: 'outbound',
            });
          } else if (log.responseData?.receiptPreview) {
            const preview = log.responseData.receiptPreview as Receipt;
            restoredMessages.push({
              id: `${log.id}-preview`,
              text: '',
              isUser: false,
              timestamp: new Date(log.createdAt),
              receiptPreview: preview,
              voucherType: 'receipt',
            });
          } else if (log.responseData?.attachmentPreview && logType === 'tax-filing') {
            const preview = log.responseData.attachmentPreview as { id: string; projectId: string; todoId: string; name: string; summary?: string | null; imageUrl?: string | null; docType?: string | null; extracted_data?: unknown };
            restoredMessages.push({
              id: `${log.id}-preview`,
              text: '',
              isUser: false,
              timestamp: new Date(log.createdAt),
              attachmentPreview: preview,
              voucherType: 'tax-filing',
              logType: log.type,
            });
          } else if (log.responseData?.clientPreview && logType === 'client') {
            const preview = log.responseData.clientPreview as { firmSpaceId: string; summary: ClientRecognitionResult['summary']; items: ExtractedClient[]; confirmed?: boolean; canceled?: boolean };
            restoredMessages.push({
              id: `${log.id}-preview`,
              text: '',
              isUser: false,
              timestamp: new Date(log.createdAt),
              clientPreview: preview,
              voucherType: 'client',
            });
          } else if (log.response) {
            restoredMessages.push({
              id: `${log.id}-response`,
              text: log.response,
              isUser: false,
              timestamp: new Date(log.createdAt),
            });
          }
        }

        if (restoredMessages.length === 0) {
          setMessages([getWelcomeMessage(voucherType)]);
          setHasMoreHistory(false);
        } else {
          const enriched = await Promise.all(
            restoredMessages.map(async (msg) => {
              if (msg.invoicePreview?.id) {
                try {
                  const invoice = await getInvoiceById(msg.invoicePreview.id);
                  if (!invoice) return markInvoicePreviewDeleted(msg);
                  return { ...msg, invoicePreview: invoice, invoiceDeleted: false };
                } catch {
                  return markInvoicePreviewDeleted(msg);
                }
              }
              if (msg.inboundPreview?.id) {
                try {
                  const inbound = await getInboundById(msg.inboundPreview.id);
                  if (!inbound) return { ...msg, inboundDeleted: true };
                  return { ...msg, inboundPreview: inbound, inboundDeleted: false };
                } catch {
                  return { ...msg, inboundDeleted: true };
                }
              }
              if (msg.outboundPreview?.id) {
                try {
                  const outbound = await getOutboundById(msg.outboundPreview.id);
                  if (!outbound) return { ...msg, outboundDeleted: true };
                  return { ...msg, outboundPreview: outbound, outboundDeleted: false };
                } catch {
                  return { ...msg, outboundDeleted: true };
                }
              }
              if (msg.attachmentPreview?.id) {
                try {
                  const raw = await getProjectTodoAttachmentById(msg.attachmentPreview.id);
                  if (!raw) return msg;
                  return {
                    ...msg,
                    attachmentPreview: {
                      ...msg.attachmentPreview,
                      displayName: raw.display_name ?? msg.attachmentPreview.displayName,
                      summary: raw.summary ?? msg.attachmentPreview.summary,
                      docType: raw.doc_type ?? msg.attachmentPreview.docType,
                    },
                  };
                } catch {
                  return msg;
                }
              }
              if (!msg.receiptPreview?.id) return msg;
              try {
                const receipt = await getReceiptById(msg.receiptPreview.id);
                if (!receipt) return markReceiptPreviewDeleted(msg);
                return { ...msg, receiptPreview: receipt, receiptDeleted: false };
              } catch {
                return markReceiptPreviewDeleted(msg);
              }
            }),
          );

          // enrich 期间如果发生切换，则丢弃旧结果
          if (historyLoadSeqRef.current !== seq) return;

          // 存为 [最新…最早]，配合 inverted FlatList：最新在底部，往上滑加载更早；欢迎条固定放最后一项，滚动到最顶部可见
          setMessages([...enriched.reverse(), getWelcomeMessage(voucherType)]);
          const oldest = sorted[sorted.length - 1];
          setOldestLoadedAt(oldest.createdAt);
          setHasMoreHistory(sorted.length >= 5);
        }
      } catch (error) {
        console.error('Error loading initial chat history:', error);
      } finally {
        // 只让最新请求更新 loading 状态
        if (historyLoadSeqRef.current === seq) setIsLoadingHistory(false);
      }
    };

    // 先完成转场再加载历史，不阻塞前端
    const task = InteractionManager.runAfterInteractions(() => {
      loadInitialHistory();
    });

    // 自动聚焦输入框
    setTimeout(() => {
      inputRef.current?.focus();
    }, 300);

    // 监听键盘事件
    const keyboardWillShow = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
      }
    );

    const keyboardWillHide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
      }
    );

    return () => {
      task.cancel();
      keyboardWillShow.remove();
      keyboardWillHide.remove();
    };
  }, [voucherType, effectiveProjectId]);

  // 往上滑（看更早消息）时提前加载历史，由 FlatList onEndReached 触发
  const loadMoreHistory = useCallback(async () => {
    if (!hasMoreHistory || isLoadingHistory || !oldestLoadedAt) return;
    const seq = historyLoadSeqRef.current;
    try {
      setIsLoadingHistory(true);
      const projectFilter = voucherType === 'tax-filing' ? effectiveProjectId : undefined;
      const rawMoreLogs = await getChatLogsPaginated(
        20,
        oldestLoadedAt,
        voucherType,
        projectFilter,
      );
      const moreLogs = rawMoreLogs;

      // 如果切换过项目/类型，则丢弃旧请求结果
      if (historyLoadSeqRef.current !== seq) return;

      if (!moreLogs || moreLogs.length === 0) {
        setHasMoreHistory(false);
        return;
      }

      const sorted = [...moreLogs].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

      // 每条记录顺序：先卡片（靠下），再提交内容（靠上），inverted 下显示为卡片在下、提交在上
      const moreMessagesRaw: Message[] = [];
      for (const log of sorted) {
        const logType = log.voucherType ?? 'receipt';
        if (log.responseData?.invoicePreview && logType === 'invoice') {
          const preview = log.responseData.invoicePreview as Invoice;
          moreMessagesRaw.push({
            id: `${log.id}-preview`,
            text: '',
            isUser: false,
            timestamp: new Date(log.createdAt),
            invoicePreview: preview,
            voucherType: 'invoice',
          });
        } else if (log.responseData?.inboundPreview && logType === 'inbound') {
          const preview = log.responseData.inboundPreview as Inbound;
          moreMessagesRaw.push({
            id: `${log.id}-preview`,
            text: '',
            isUser: false,
            timestamp: new Date(log.createdAt),
            inboundPreview: preview,
            voucherType: 'inbound',
          });
        } else if (log.responseData?.outboundPreview && logType === 'outbound') {
          const preview = log.responseData.outboundPreview as Outbound;
          moreMessagesRaw.push({
            id: `${log.id}-preview`,
            text: '',
            isUser: false,
            timestamp: new Date(log.createdAt),
            outboundPreview: preview,
            voucherType: 'outbound',
          });
        } else if (log.responseData?.receiptPreview) {
          const preview = log.responseData.receiptPreview as Receipt;
          moreMessagesRaw.push({
            id: `${log.id}-preview`,
            text: '',
            isUser: false,
            timestamp: new Date(log.createdAt),
            receiptPreview: preview,
            voucherType: 'receipt',
          });
        } else if (log.responseData?.attachmentPreview && logType === 'tax-filing') {
          const preview = log.responseData.attachmentPreview as { id: string; projectId: string; todoId: string; name: string; summary?: string | null; imageUrl?: string | null; docType?: string | null; extracted_data?: unknown };
          moreMessagesRaw.push({
            id: `${log.id}-preview`,
            text: '',
            isUser: false,
            timestamp: new Date(log.createdAt),
            attachmentPreview: preview,
            voucherType: 'tax-filing',
            logType: log.type,
          });
        } else if (log.responseData?.clientPreview && logType === 'client') {
          const preview = log.responseData.clientPreview as { firmSpaceId: string; summary: ClientRecognitionResult['summary']; items: ExtractedClient[]; confirmed?: boolean };
          moreMessagesRaw.push({
            id: `${log.id}-preview`,
            text: '',
            isUser: false,
            timestamp: new Date(log.createdAt),
            clientPreview: preview,
            voucherType: 'client',
          });
        } else if (log.response) {
          moreMessagesRaw.push({
            id: `${log.id}-response`,
            text: log.response,
            isUser: false,
            timestamp: new Date(log.createdAt),
          });
        }
        const promptMsg = restorePromptFromLog(log);
        if (promptMsg) moreMessagesRaw.push(promptMsg);
      }

      const moreMessages = await Promise.all(
        moreMessagesRaw.map(async (msg) => {
          if (msg.invoicePreview?.id) {
            try {
              const invoice = await getInvoiceById(msg.invoicePreview.id);
              if (!invoice) return markInvoicePreviewDeleted(msg);
              return { ...msg, invoicePreview: invoice, invoiceDeleted: false };
            } catch {
              return markInvoicePreviewDeleted(msg);
            }
          }
          if (msg.inboundPreview?.id) {
            try {
              const inbound = await getInboundById(msg.inboundPreview.id);
              if (!inbound) return { ...msg, inboundDeleted: true };
              return { ...msg, inboundPreview: inbound, inboundDeleted: false };
            } catch {
              return { ...msg, inboundDeleted: true };
            }
          }
          if (msg.outboundPreview?.id) {
            try {
              const outbound = await getOutboundById(msg.outboundPreview.id);
              if (!outbound) return { ...msg, outboundDeleted: true };
              return { ...msg, outboundPreview: outbound, outboundDeleted: false };
            } catch {
              return { ...msg, outboundDeleted: true };
            }
          }
          if (msg.attachmentPreview?.id) {
            try {
              const raw = await getProjectTodoAttachmentById(msg.attachmentPreview.id);
              if (!raw) return msg;
              return {
                ...msg,
                attachmentPreview: {
                  ...msg.attachmentPreview,
                  displayName: raw.display_name ?? msg.attachmentPreview.displayName,
                  summary: raw.summary ?? msg.attachmentPreview.summary,
                  docType: raw.doc_type ?? msg.attachmentPreview.docType,
                },
              };
            } catch {
              return msg;
            }
          }
          if (!msg.receiptPreview?.id) return msg;
          try {
            const receipt = await getReceiptById(msg.receiptPreview.id);
            if (!receipt) return markReceiptPreviewDeleted(msg);
            return { ...msg, receiptPreview: receipt, receiptDeleted: false };
          } catch {
            return markReceiptPreviewDeleted(msg);
          }
        }),
      );

      // moreMessages 期间如果发生切换，则丢弃旧结果
      if (historyLoadSeqRef.current !== seq) return;

      // 按 id 去重，避免分页重叠导致重复 key；欢迎条固定为最后一项（inverted 下为最顶部），加载更早消息时插在欢迎条前
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const newOnes = moreMessages.filter((m) => !existingIds.has(m.id));
        if (newOnes.length === 0) return prev;
        const last = prev[prev.length - 1];
        const isWelcomeAtEnd = last?.id === 'welcome';
        if (isWelcomeAtEnd && prev.length > 1) {
          return [...prev.slice(0, -1), ...newOnes, last];
        }
        return [...prev, ...newOnes];
      });
      const oldest = sorted[sorted.length - 1];
      setOldestLoadedAt(oldest.createdAt);
      setHasMoreHistory(sorted.length >= 20);
    } catch (error) {
      console.error('Error loading more chat history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [hasMoreHistory, isLoadingHistory, oldestLoadedAt, voucherType]);

  const openFileInModal = (url?: string | null, name?: string | null) => {
    if (!url) return;
    setSelectedAttachmentForModal(null);
    const file: FileDetailModalFile = {
      id: `doc-${Date.now()}`,
      name: name ?? 'Document',
      imageUrl: url,
      hideRightPanel: true,
    };
    setAttachmentDetailForModal(file);
  };

  const handlePreviewDetails = async (message: Message) => {
    const invoiceId = message.invoicePreview?.id;
    if (invoiceId) {
      try {
        const invoice = await getInvoiceById(invoiceId);
        if (!invoice) {
          setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, invoiceDeleted: true } : m)));
          showToast('This income has been deleted.', 'info');
          return;
        }
        router.push(`/invoice-details/${invoiceId}`);
      } catch (error) {
        setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, invoiceDeleted: true } : m)));
        showToast('This income has been deleted.', 'info');
      }
      return;
    }
    const inboundId = message.inboundPreview?.id;
    if (inboundId) {
      try {
        const inbound = await getInboundById(inboundId);
        if (!inbound) {
          setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, inboundDeleted: true } : m)));
          showToast('This inbound has been deleted.', 'info');
          return;
        }
        router.push(`/inbound-details/${inboundId}`);
      } catch (error) {
        setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, inboundDeleted: true } : m)));
        showToast('This inbound has been deleted.', 'info');
      }
      return;
    }
    const outboundId = message.outboundPreview?.id;
    if (outboundId) {
      try {
        const outbound = await getOutboundById(outboundId);
        if (!outbound) {
          setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, outboundDeleted: true } : m)));
          showToast('This outbound has been deleted.', 'info');
          return;
        }
        router.push(`/outbound-details/${outboundId}`);
      } catch (error) {
        setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, outboundDeleted: true } : m)));
        showToast('This outbound has been deleted.', 'info');
      }
      return;
    }
    const attachmentPreview = message.attachmentPreview;
    if (attachmentPreview?.id && attachmentPreview?.projectId) {
      setSelectedAttachmentForModal({ attachmentId: attachmentPreview.id, projectId: attachmentPreview.projectId });
      return;
    }
    const receiptId = message.receiptPreview?.id;
    if (!receiptId) return;
    try {
      const receipt = await getReceiptById(receiptId);
      if (!receipt) {
        setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, receiptDeleted: true } : m)));
        showToast('This expense has been deleted.', 'info');
        return;
      }
      router.push(`/receipt-details/${receiptId}`);
    } catch (error) {
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, receiptDeleted: true } : m)));
      showToast('This expense has been deleted.', 'info');
    }
  };

  /** Web：文件 input 选图+PDF+文档；移动端：仅相册选图。 */
  const pickImagesForSend = useCallback(async () => {
    if (isProcessing) return;
    if (voucherType === 'tax-filing' && !effectiveProjectId) {
      showToast('Open from a tax-filing project to attach files.', 'info');
      return;
    }
    if (isDesktopWeb) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = [
        'image/*',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
      ].join(',');
      input.multiple = true;
      input.onchange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        const files = target.files;
        if (!files?.length) return;
        const now = Date.now();
        const next = Array.from(files).map((f, i) => ({
          id: `web-${now}-${i}-${f.name}`,
          uri: URL.createObjectURL(f),
          name: f.name,
          mimeType: f.type || undefined,
        }));
        setStagedAttachmentFiles(prev => [...prev, ...next]);
        setIsVoiceMode(false);
      };
      input.click();
      return;
    }
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showToast('Photo library access is required to add images.', 'info');
        return;
      }
      const launchPicker = async () => {
        try {
          const result = await launchImageLibraryAsyncWithAndroidRelaunchRetries({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsMultipleSelection: true,
            quality: 0.9,
          });
          if (result.canceled || !result.assets?.length) return;
          const now = Date.now();
          setStagedAttachmentFiles(prev => [
            ...prev,
            ...result.assets.map((a, i: number) => ({
              id: `${a.uri}-${now}-${i}`,
              uri: a.uri,
              name: (a.fileName != null ? a.fileName : `image-${i + 1}.jpg`),
              mimeType: 'image/jpeg' as const,
            })),
          ]);
          setIsVoiceMode(false);
        } catch (e) {
          showToast(e instanceof Error ? e.message : 'Failed to add files', 'error');
        }
      };
      await launchPicker();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to add files', 'error');
    }
  }, [effectiveProjectId, isProcessing, voucherType, isDesktopWeb]);

  /** Web：仅选择文件夹（可多选），将文件夹内的所有文件展开为待上传列表。 */
  const pickFoldersForSend = useCallback(() => {
    if (isProcessing) return;
    if (voucherType === 'tax-filing' && !effectiveProjectId) {
      showToast('Open from a tax-filing project to attach files.', 'info');
      return;
    }
    if (!isDesktopWeb) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = [
      'image/*',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
    ].join(',');
    input.multiple = true;
    // 允许多选文件夹，浏览器会将所选文件夹内的文件全部展开到 FileList
    (input as any).webkitdirectory = true;
    (input as any).directory = true;
    input.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const files = target.files;
      if (!files?.length) return;
      const now = Date.now();
      const next = Array.from(files).map((f, i) => ({
        id: `web-dir-${now}-${i}-${f.name}`,
        uri: URL.createObjectURL(f),
        name: f.name,
        mimeType: f.type || undefined,
      }));
      setStagedAttachmentFiles(prev => [...prev, ...next]);
      setIsVoiceMode(false);
    };
    input.click();
  }, [effectiveProjectId, isProcessing, voucherType, isDesktopWeb]);

  const handleSend = async () => {
    const text = inputText.trim();
    const hasStaged = stagedAttachmentFiles.length > 0;
    // 没有任何内容直接返回；发送按钮仅在「主流程」占用时禁用，识别阶段不再阻塞
    if (!text && !hasStaged) return;

    // 有暂存图片：按文件分别上传/识别，每文件单独预览框与 loading
    if (hasStaged) {
      const toUpload = [...stagedAttachmentFiles];
      const userInstructions = text || undefined;
      setInputText('');
      // isProcessing 仅用于「发送过程中」禁用输入/按钮，不覆盖后台识别阶段
      setIsProcessing(true);
      setUploadingStagedIds(new Set(toUpload.map((f) => f.id)));
      const scrollToBottom = () => setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
      let successfulCount = 0;
      try {
        // 优先用缓存，避免移动端 forceRefresh 时拿不到 currentSpaceId 导致多文件提交报 No space context
        let space = await getCurrentSpace(false);
        if (!space?.id) space = await getCurrentSpace(true);
        // firm 侧上传：优先使用 attachmentContext 中的 clientSpaceId，确保文件存到 client 的路径
        const clientSpaceId = (chatPanel?.attachmentContext?.clientSpaceId || space?.id) ?? '';
        if (!clientSpaceId) {
          showToast('No space context.', 'error');
          setUploadingStagedIds(new Set());
          setIsProcessing(false);
          return;
        }
        if (voucherType === 'tax-filing') {
          const projectId = effectiveProjectId;
          if (!projectId || attachmentTaskOptions.length === 0) {
            showToast(attachmentTaskOptions.length === 0 ? 'Loading project tasks…' : 'Open from a tax-filing project to attach files.', 'info');
            setUploadingStagedIds(new Set());
            setIsProcessing(false);
            return;
          }
        }
        for (let i = 0; i < toUpload.length; i++) {
          const file = toUpload[i];
          const removeFromStaged = () => {
            setStagedAttachmentFiles((prev) => prev.filter((x) => x.id !== file.id));
            setUploadingStagedIds((prev) => {
              const s = new Set(prev);
              s.delete(file.id);
              return s;
            });
          };
          const appendMessages = (msgs: Message[]) => {
            setMessages((prev) => [...msgs, ...prev]);
            scrollToBottom();
          };
          try {
            const nameLooksLikeSpreadsheetOrWord = /\.(xlsx|xls|csv|docx?)$/i.test(file.name ?? '');
            const isImage =
              !nameLooksLikeSpreadsheetOrWord && (!file.mimeType || file.mimeType.startsWith('image/'));
            if (voucherType === 'tax-filing') {
              const projectId = effectiveProjectId!;
              const project = await getProjectById(projectId);
              const classificationLabels = classificationLabelsForTaxFilingPrompt(project ?? undefined);
              const projectContext = {
                taxCountry: project?.taxCountry ?? null,
                taxScenario: project?.taxScenario ?? null,
                fileName: file.name ?? null,
                ...(classificationLabels.length > 0 ? { classificationLabels } : {}),
              };
              const taxFilingUploadOpts =
                file.name || file.mimeType
                  ? { fileName: file.name ?? undefined, mimeType: file.mimeType ?? undefined }
                  : undefined;
              let fileUrl: string;
              let todoId: string;
              if (isImage) {
                fileUrl = await uploadTaxFilingFile(
                  file.uri,
                  `chat-attach-${Date.now()}-${i}`,
                  clientSpaceId,
                  taxFilingUploadOpts,
                );
                try {
                  const classified = await classifyTaxDocumentAndPickTask(fileUrl, projectContext, attachmentTaskOptions);
                  todoId = classified.taskId;
                } catch {
                  todoId = getFallbackTaskId(attachmentTaskOptions);
                }
              } else {
                fileUrl = await uploadTaxFilingFile(
                  file.uri,
                  `chat-attach-${Date.now()}-${i}`,
                  clientSpaceId,
                  taxFilingUploadOpts,
                );
                todoId = getFallbackTaskId(attachmentTaskOptions);
              }
              const uploaderName = await resolveUploaderNameForTaxFilingAttachment();
              const name = file.name ?? `File ${i + 1}`;
              const createResult = await createProjectTodoAttachment(todoId, fileUrl, {
                status: 'PENDING_AI',
                uploader_name: uploaderName,
                source_file_name: name,
              });
              if ('error' in createResult) {
                showToast(`Upload failed: ${createResult.error.message}`, 'error');
                removeFromStaged();
                appendMessages([{ id: `attach-err-${file.id}`, text: `❌ ${file.name ?? 'File'} failed`, isUser: false, timestamp: new Date() }]);
                continue;
              }
              const attachmentId = createResult.id;
              const loadingCardId = `attach-preview-loading-${file.id}`;
              // tax-filing 模块：图片用缩略图，文档用 documentUrl（已上传的远端 URL）
              const userMsg: Message = {
                id: `attach-user-${attachmentId}`,
                text: name,
                isUser: true,
                timestamp: new Date(),
                imageUrl: isImage ? file.uri : undefined,
                documentUrl: !isImage ? fileUrl : undefined,
              };
              const loadingCardMsg: Message = { id: loadingCardId, text: '', isUser: false, timestamp: new Date(), previewCardLoading: true };
              removeFromStaged();
              successfulCount += 1;
              appendMessages([loadingCardMsg, userMsg]);
              // 识别阶段放入后台异步执行，仅占用卡片 loading，不再阻塞发送按钮
              (async () => {
                let summary: string | null = null;
                let effectiveTodoId = todoId;
                let docType: string | null = null;
                let extracted_data: unknown = null;

                const quotaGate = await assertClientRecognitionAllowed(clientSpaceId);
                if (!quotaGate.allowed) {
                  alertClientRecognitionQuotaBlocked(router, { allowed: false, message: quotaGate.message });
                  await updateProjectTodoAttachment(attachmentId, {
                    status: 'FAILED_ONCE',
                    recognition_fail_count: 1,
                  });
                  const capMsg = quotaGate.message ?? 'Recognition limit reached.';
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === loadingCardId
                        ? { id: m.id, text: `Limit: ${capMsg}`, isUser: false, timestamp: new Date() }
                        : m
                    )
                  );
                  return;
                }

                // 标记为处理中
                await updateProjectTodoAttachment(attachmentId, { status: 'PROCESSING' });

                const taskTitle = attachmentTaskOptions.find((t) => t.id === todoId)?.title ?? '';
                const recognizeFn = () =>
                  runTaxFilingRecognition(
                    fileUrl,
                    {
                      country: (project?.taxCountry === 'USA' ? 'USA' : 'CANADA') as 'CANADA' | 'USA',
                      taxScenario: project?.taxScenario ?? '',
                      ...(classificationLabels.length > 0 ? { classificationLabels } : {}),
                    },
                    taskTitle ? { task: taskTitle } : undefined,
                    userInstructions,
                    isImage ? undefined : (file.mimeType ?? undefined),
                    attachmentTaskOptions
                  );

                const recognitionResult = await runWithRecognitionRetry(recognizeFn, { maxAttempts: 3, delayMs: 1500 });

                if (!recognitionResult.success) {
                  // Tina only: 识别失败也保留附件，文件已关联到 task 可预览；其他助理无此逻辑，直接反馈失败
                  const latest = await getProjectTodoAttachmentById(attachmentId);
                  const currentFailCount =
                    (latest as any)?.recognition_fail_count != null ? Number((latest as any).recognition_fail_count) || 0 : 0;
                  const nextFailCount = Math.min(currentFailCount + 1, 3);
                  const nextStatus =
                    nextFailCount >= 3 ? 'FAILED_FINAL' : nextFailCount === 2 ? 'FAILED_TWICE' : 'FAILED_ONCE';

                  await updateProjectTodoAttachment(attachmentId, {
                    status: nextStatus,
                    recognition_fail_count: nextFailCount,
                  });

                  const errText = recognitionResult.isContentQuality
                    ? '❌ Content unclear or not recognized. Please resubmit.'
                    : `❌ ${getUserFacingMessage(recognitionResult)}`;
                  const hint = ' The file is attached to the task for preview.';
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === loadingCardId
                        ? { id: m.id, text: errText + hint, isUser: false, timestamp: new Date() }
                        : m
                    )
                  );
                  return;
                }

                const recognition = recognitionResult.result;
                const displayName = buildTaxFilingAttachmentDefaultDisplayName({
                  summary: recognition.summary,
                  docType: recognition.doc_type,
                  sourceFileName: name,
                });
                if (recognition.suggested_task_id && recognition.suggested_task_id !== todoId && attachmentTaskOptions.some((t) => t.id === recognition.suggested_task_id)) {
                  effectiveTodoId = recognition.suggested_task_id;
                  await updateProjectTodoAttachment(attachmentId, {
                    summary: recognition.summary,
                    doc_type: recognition.doc_type,
                    extracted_data: recognition.extracted_data,
                    status: 'PROCESSED',
                    project_todo_id: effectiveTodoId,
                    recognition_fail_count: 0,
                    display_name: displayName,
                  });
                } else {
                  await updateProjectTodoAttachment(attachmentId, {
                    summary: recognition.summary,
                    doc_type: recognition.doc_type,
                    extracted_data: recognition.extracted_data,
                    status: 'PROCESSED',
                    recognition_fail_count: 0,
                    display_name: displayName,
                  });
                }
                summary = recognition.summary;
                docType = recognition.doc_type ?? null;
                extracted_data = recognition.extracted_data ?? null;
                const previewPayload = {
                  id: attachmentId,
                  projectId,
                  todoId: effectiveTodoId,
                  name,
                  displayName,
                  summary,
                  imageUrl: fileUrl,
                  docType,
                  extracted_data,
                };
                const previewMsg: Message = {
                  id: `attach-preview-${attachmentId}`,
                  text: '',
                  isUser: false,
                  timestamp: new Date(),
                  attachmentPreview: previewPayload,
                  voucherType: 'tax-filing',
                  logType: isImage ? 'image' : 'document',
                };
                setMessages((prev) => prev.map((m) => (m.id === loadingCardId ? previewMsg : m)));
                await saveChatLog({
                  receiptId: undefined,
                  projectId,
                  voucherType: 'tax-filing',
                  type: isImage ? 'image' : 'document',
                  modelName: 'tax-filing',
                  prompt: userInstructions ? `Uploaded: ${name}. Note: ${userInstructions}` : `Uploaded: ${name}`,
                  response: '',
                  requestData: { todoId: effectiveTodoId, fileName: name },
                  responseData: { attachmentPreview: previewPayload },
                  success: true,
                  attachmentUrl: fileUrl,
                });
                await recordClientRecognitionSuccessIfEnforced(clientSpaceId);
              })();
            } else if (voucherType === 'receipt' || voucherType === 'invoice') {
              const name = file.name ?? `File ${i + 1}`;
              const loadingCardId = `img-preview-loading-${file.id}`;
              const userMsg: Message = {
                id: `img-user-${file.id}`,
                text: name,
                isUser: true,
                timestamp: new Date(),
                imageUrl: isImage ? file.uri : undefined,
              };
              const loadingCardMsg: Message = { id: loadingCardId, text: '', isUser: false, timestamp: new Date(), previewCardLoading: true };
              removeFromStaged();
              successfulCount += 1;
              appendMessages([loadingCardMsg, userMsg]);
              const tempFileName = `chat-${voucherType}-${Date.now()}-${i}`;
              let fileUrl: string;
              if (isImage) {
                fileUrl = await uploadReceiptImageTempWithSpace(file.uri, tempFileName, clientSpaceId);
              } else {
                fileUrl = await uploadReceiptImageTempWithSpace(file.uri, tempFileName, clientSpaceId, { fileName: file.name, mimeType: file.mimeType });
                setMessages((prev) => prev.map((m) => (m.id === `img-user-${file.id}` ? { ...m, documentUrl: fileUrl } : m)));
              }
              const inputType = (isImage ? 'image' : 'document') as 'image' | 'document';
              // 先建 processing 记录，识别后台异步；退出窗口不影响落库与后续更新
              if (voucherType === 'invoice') {
                const invoiceId = await createProcessingInvoice({ imageUrl: fileUrl, inputType });
                await saveChatLog({
                  invoiceId,
                  voucherType: 'invoice',
                  type: isImage ? 'image' : (file.mimeType ? 'document' : 'attachment'),
                  modelName: 'gemini',
                  prompt: name,
                  response: '',
                  requestData: { imageUrl: fileUrl, mimeType: file.mimeType, async: true },
                  responseData: { invoicePreview: buildProcessingInvoicePreviewStub(invoiceId, fileUrl) },
                  success: true,
                  attachmentUrl: fileUrl,
                });
                void (async () => {
                  try {
                    const updated = isImage
                      ? await processInvoiceInBackground(fileUrl, invoiceId)
                      : await processInvoiceFromDocumentInBackground(fileUrl, invoiceId, file.mimeType);
                    const invoice = updated ?? (await getInvoiceById(invoiceId));
                    if (!invoice) {
                      if (mountedRef.current) {
                        setMessages((prev) =>
                          prev.map((m) =>
                            m.id === loadingCardId
                              ? { id: m.id, text: '❌ Recognition failed.', isUser: false, timestamp: new Date() }
                              : m
                          )
                        );
                      }
                      return;
                    }
                    void updateLatestChatLogPreviewForVoucher({
                      invoiceId,
                      responseData: { invoicePreview: invoice },
                    });
                    if (!mountedRef.current) return;
                    const previewMessage: Message = {
                      id: `img-preview-${file.id}`,
                      text: '',
                      isUser: false,
                      timestamp: new Date(),
                      invoicePreview: {
                        ...invoice,
                        account: invoice.account,
                      } as Invoice,
                      voucherType: 'invoice',
                    };
                    setMessages((prev) => prev.map((m) => (m.id === loadingCardId ? previewMessage : m)));
                  } catch (err) {
                    console.error('Invoice attachment background recognition failed:', err);
                    if (!mountedRef.current) return;
                    const errText = err instanceof Error ? err.message : 'Recognition failed.';
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === loadingCardId
                          ? { id: m.id, text: `❌ ${errText}`, isUser: false, timestamp: new Date() }
                          : m
                      )
                    );
                  } finally {
                    if (Platform.OS === 'web' && typeof file.uri === 'string' && file.uri.startsWith('blob:')) {
                      URL.revokeObjectURL(file.uri);
                    }
                  }
                })();
              } else {
                const receiptId = await createProcessingReceipt({ imageUrl: fileUrl, inputType });
                await saveChatLog({
                  receiptId,
                  voucherType: 'receipt',
                  type: isImage ? 'image' : (file.mimeType ? 'document' : 'attachment'),
                  modelName: 'gemini',
                  prompt: name,
                  response: '',
                  requestData: { imageUrl: fileUrl, mimeType: file.mimeType, async: true },
                  responseData: { receiptPreview: buildProcessingReceiptPreviewStub(receiptId, fileUrl) },
                  success: true,
                  attachmentUrl: fileUrl,
                });
                void (async () => {
                  try {
                    if (isImage) {
                      await processReceiptInBackground(fileUrl, receiptId, file.uri);
                    } else {
                      await processReceiptFromDocumentInBackground(fileUrl, receiptId, file.mimeType);
                    }
                    const receipt = await getReceiptById(receiptId);
                    if (!receipt) {
                      if (mountedRef.current) {
                        setMessages((prev) =>
                          prev.map((m) =>
                            m.id === loadingCardId
                              ? { id: m.id, text: '❌ Recognition failed.', isUser: false, timestamp: new Date() }
                              : m
                          )
                        );
                      }
                      return;
                    }
                    void updateLatestChatLogPreviewForVoucher({
                      receiptId,
                      responseData: { receiptPreview: receipt },
                    });
                    if (!mountedRef.current) return;
                    const previewMessage: Message = {
                      id: `img-preview-${file.id}`,
                      text: '',
                      isUser: false,
                      timestamp: new Date(),
                      receiptPreview: {
                        ...receipt,
                        account: receipt.account,
                      },
                    };
                    setMessages((prev) => prev.map((m) => (m.id === loadingCardId ? previewMessage : m)));
                  } catch (err) {
                    console.error('Receipt attachment background recognition failed:', err);
                    if (!mountedRef.current) return;
                    const errText = err instanceof Error ? err.message : 'Recognition failed.';
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === loadingCardId
                          ? { id: m.id, text: `❌ ${errText}`, isUser: false, timestamp: new Date() }
                          : m
                      )
                    );
                  } finally {
                    if (Platform.OS === 'web' && typeof file.uri === 'string' && file.uri.startsWith('blob:')) {
                      URL.revokeObjectURL(file.uri);
                    }
                  }
                })();
              }
            } else if (voucherType === 'inbound' || voucherType === 'outbound') {
              const name = file.name ?? `File ${i + 1}`;
              const loadingCardId = `img-preview-loading-${file.id}`;
              const userMsg: Message = {
                id: `img-user-${file.id}`,
                text: name,
                isUser: true,
                timestamp: new Date(),
                imageUrl: isImage ? file.uri : undefined,
              };
              const loadingCardMsg: Message = { id: loadingCardId, text: '', isUser: false, timestamp: new Date(), previewCardLoading: true };
              removeFromStaged();
              successfulCount += 1;
              appendMessages([loadingCardMsg, userMsg]);
              const tempFileName = `chat-${voucherType}-${Date.now()}-${i}`;
              let fileUrl: string;
              if (isImage) {
                fileUrl = await uploadReceiptImageTempWithSpace(file.uri, tempFileName, clientSpaceId);
              } else {
                fileUrl = await uploadReceiptImageTempWithSpace(file.uri, tempFileName, clientSpaceId, { fileName: file.name, mimeType: file.mimeType });
                setMessages((prev) => prev.map((m) => (m.id === `img-user-${file.id}` ? { ...m, documentUrl: fileUrl } : m)));
              }
              const ioGate = await assertClientRecognitionAllowed(clientSpaceId);
              if (!ioGate.allowed) {
                alertClientRecognitionQuotaBlocked(router, { allowed: false, message: ioGate.message });
                const msg = ioGate.message ?? 'Recognition limit reached.';
                setMessages((prev) => prev.map((m) => (m.id === loadingCardId ? { id: m.id, text: `Limit: ${msg}`, isUser: false, timestamp: new Date() } : m)));
                continue;
              }
              try {
                if (voucherType === 'inbound') {
                  const recognizedData = isImage ? await recognizeInboundFromImage(fileUrl) : await recognizeInboundFromDocument(fileUrl, file.mimeType);
                  const inbound = await convertGeminiResultToInbound(recognizedData);
                  const inboundToSave = { ...inbound, inputType: (isImage ? 'image' : 'document') as 'image' | 'document', imageUrl: fileUrl };
                  const inboundId = await saveInbound(inboundToSave);
                  const previewMessage: Message = { id: `img-preview-${file.id}`, text: '', isUser: false, timestamp: new Date(), inboundPreview: { ...inboundToSave, id: inboundId } as Inbound, voucherType: 'inbound' };
                  setMessages((prev) => prev.map((m) => (m.id === loadingCardId ? previewMessage : m)));
                  await saveChatLog({ receiptId: undefined, voucherType: 'inbound', type: 'image', modelName: 'gemini', prompt: name, response: '', requestData: { imageUrl: fileUrl }, responseData: { inboundPreview: previewMessage.inboundPreview }, success: true });
                  await recordClientRecognitionSuccessIfEnforced(clientSpaceId);
                } else {
                  const recognizedData = isImage ? await recognizeOutboundFromImage(fileUrl) : await recognizeOutboundFromDocument(fileUrl, file.mimeType);
                  const outbound = await convertGeminiResultToOutbound(recognizedData);
                  const outboundToSave = { ...outbound, inputType: (isImage ? 'image' : 'document') as 'image' | 'document', imageUrl: fileUrl };
                  const outboundId = await saveOutbound(outboundToSave);
                  const previewMessage: Message = { id: `img-preview-${file.id}`, text: '', isUser: false, timestamp: new Date(), outboundPreview: { ...outboundToSave, id: outboundId } as Outbound, voucherType: 'outbound' };
                  setMessages((prev) => prev.map((m) => (m.id === loadingCardId ? previewMessage : m)));
                  await saveChatLog({ receiptId: undefined, voucherType: 'outbound', type: 'image', modelName: 'gemini', prompt: name, response: '', requestData: { imageUrl: fileUrl }, responseData: { outboundPreview: previewMessage.outboundPreview }, success: true });
                  await recordClientRecognitionSuccessIfEnforced(clientSpaceId);
                }
              } catch (err) {
                const errText = err instanceof Error ? err.message : 'Recognition failed.';
                setMessages((prev) => prev.map((m) => (m.id === loadingCardId ? { id: m.id, text: `❌ ${errText}`, isUser: false, timestamp: new Date() } : m)));
              }
            } else if (voucherType === 'client') {
              // Client Assistant: upload all files, recognize each, merge clients, show one summary for confirmation
              let space = await getCurrentSpace(false);
              if (!space?.id) space = await getCurrentSpace(true);
              if (space?.kind !== 'provider' || !space?.id) {
                showToast('Client assistant is only available in a firm space.', 'error');
                removeFromStaged();
                appendMessages([{ id: `client-err-${file.id}`, text: 'Open from a firm space to add clients from files.', isUser: false, timestamp: new Date() }]);
                continue;
              }
              const name = file.name ?? `File ${i + 1}`;
              const loadingCardId = `client-loading-${file.id}`;
              const userMsg: Message = { id: `client-user-${file.id}`, text: name, isUser: true, timestamp: new Date(), imageUrl: isImage ? file.uri : undefined, documentUrl: !isImage ? undefined : undefined };
              const loadingCardMsg: Message = { id: loadingCardId, text: 'Extracting client info…', isUser: false, timestamp: new Date(), previewCardLoading: true };
              removeFromStaged();
              successfulCount += 1;
              appendMessages([loadingCardMsg, userMsg]);
              const tempFileName = `chat-client-${Date.now()}-${i}`;
              let fileUrl: string;
              if (isImage) {
                fileUrl = await uploadReceiptImageTempWithSpace(file.uri, tempFileName, space!.id);
              } else {
                fileUrl = await uploadReceiptImageTempWithSpace(file.uri, tempFileName, space!.id, { fileName: file.name, mimeType: file.mimeType });
                setMessages((prev) => prev.map((m) => (m.id === `client-user-${file.id}` ? { ...m, documentUrl: fileUrl } : m)));
              }
              try {
                const result = isImage ? await recognizeClientsFromImage(fileUrl) : await recognizeClientsFromDocument(fileUrl, file.mimeType);
                if (result.clients.length === 0) {
                  setMessages((prev) => prev.map((m) => (m.id === loadingCardId ? { id: m.id, text: 'No valid client records found in this file (email required).', isUser: false, timestamp: new Date() } : m)));
                  continue;
                }
                const previewMsg: Message = {
                  id: `client-preview-${file.id}-${Date.now()}`,
                  text: '',
                  isUser: false,
                  timestamp: new Date(),
                  clientPreview: { firmSpaceId: space.id, summary: result.summary, items: result.clients },
                };
                setMessages((prev) => prev.map((m) => (m.id === loadingCardId ? previewMsg : m)));
                await saveChatLog({ receiptId: undefined, voucherType: 'client', type: 'image', modelName: 'gemini', prompt: name, response: '', requestData: { imageUrl: fileUrl }, responseData: { clientPreview: previewMsg.clientPreview }, success: true });
              } catch (err) {
                const errText = err instanceof Error ? err.message : 'Recognition failed.';
                setMessages((prev) => prev.map((m) => (m.id === loadingCardId ? { id: m.id, text: `❌ ${errText}`, isUser: false, timestamp: new Date() } : m)));
              }
            } else {
              showToast('File upload for this type is not supported yet.', 'info');
              removeFromStaged();
            }
          } catch (e) {
            showToast(e instanceof Error ? e.message : 'Upload failed', 'error');
            removeFromStaged();
            appendMessages([{ id: `img-err-${file.id}`, text: `❌ ${file.name ?? 'File'} failed`, isUser: false, timestamp: new Date() }]);
            // blob revoke 统一放 finally；receipt/invoice 不得在此提前 revoke
          } finally {
            // receipt/invoice 异步识别仍可能用到本地 blob，由后台任务结束后再 revoke
            if (
              voucherType !== 'receipt' &&
              voucherType !== 'invoice' &&
              Platform.OS === 'web' &&
              typeof file.uri === 'string' &&
              file.uri.startsWith('blob:')
            ) {
              URL.revokeObjectURL(file.uri);
            }
          }
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Upload failed', 'error');
      } finally {
        setUploadingStagedIds(new Set());
        // 发送阶段结束后立即释放按钮，识别逻辑在后台继续
        setIsProcessing(false);
      }
      return;
    }

    // 纯文字：attachments 类型仅支持图片提交
    if (voucherType === 'tax-filing') {
      showToast('Add images from a tax-filing project to submit.', 'info');
      return;
    }
    const userMessage: Message = { id: Date.now().toString(), text: text, isUser: true, timestamp: new Date() };
    setMessages(prev => [userMessage, ...prev]);
    setInputText('');
    setIsProcessing(true);
    setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);

    // Client Assistant: text-only path — require firm space, extract clients, show summary for confirmation
    if (voucherType === 'client') {
      try {
        let space = await getCurrentSpace(false);
        if (!space?.id) space = await getCurrentSpace(true);
        if (space?.kind !== 'provider' || !space?.id) {
          showToast('Client assistant is only available in a firm space.', 'error');
          setIsProcessing(false);
          return;
        }
        const result = await recognizeClientsFromText(text);
        if (result.clients.length === 0) {
          const emptyMsg: Message = { id: (Date.now() + 1).toString(), text: 'No valid client records found (email required). Please paste a list with emails.', isUser: false, timestamp: new Date() };
          setMessages(prev => [emptyMsg, ...prev]);
          await saveChatLog({ receiptId: undefined, voucherType: 'client', type: 'text', modelName: 'gemini', prompt: text, response: '', requestData: { rawText: text }, responseData: { clientPreview: null }, success: false });
          setIsProcessing(false);
          return;
        }
        const previewMsg: Message = {
          id: `client-preview-${Date.now()}`,
          text: '',
          isUser: false,
          timestamp: new Date(),
          clientPreview: { firmSpaceId: space.id, summary: result.summary, items: result.clients },
        };
        setMessages(prev => [previewMsg, ...prev]);
        await saveChatLog({ receiptId: undefined, voucherType: 'client', type: 'text', modelName: 'gemini', prompt: text, response: '', requestData: { rawText: text }, responseData: { clientPreview: previewMsg.clientPreview }, success: true });
      } catch (e) {
        const errMsg: Message = { id: (Date.now() + 1).toString(), text: `❌ ${e instanceof Error ? e.message : 'Failed to extract clients.'}`, isUser: false, timestamp: new Date() };
        setMessages(prev => [errMsg, ...prev]);
      }
      setIsProcessing(false);
      return;
    }

    // receipt / invoice：先建 processing 记录，识别异步更新；退出窗口不影响落库
    if (voucherType === 'receipt' || voucherType === 'invoice') {
      const loadingCardId = `text-preview-loading-${Date.now()}`;
      setMessages((prev) => [
        { id: loadingCardId, text: '', isUser: false, timestamp: new Date(), previewCardLoading: true },
        ...prev,
      ]);
      try {
        if (voucherType === 'invoice') {
          const invoiceId = await createProcessingInvoice({ inputType: 'text' });
          await saveChatLog({
            invoiceId,
            voucherType: 'invoice',
            type: 'text',
            modelName: 'gemini',
            prompt: text,
            response: '',
            requestData: { rawText: text, async: true },
            responseData: { invoicePreview: buildProcessingInvoicePreviewStub(invoiceId) },
            success: true,
          });
          setIsProcessing(false);
          void (async () => {
            try {
              const updated = await processInvoiceFromTextInBackground(text, invoiceId);
              const invoice = updated ?? (await getInvoiceById(invoiceId));
              if (!invoice) {
                if (!mountedRef.current) return;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === loadingCardId
                      ? { id: m.id, text: '❌ Recognition failed.', isUser: false, timestamp: new Date() }
                      : m
                  )
                );
                return;
              }
              void updateLatestChatLogPreviewForVoucher({
                invoiceId,
                responseData: { invoicePreview: invoice },
              });
              if (!mountedRef.current) return;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === loadingCardId
                    ? {
                        id: `text-preview-${invoiceId}`,
                        text: '',
                        isUser: false,
                        timestamp: new Date(),
                        invoicePreview: invoice as Invoice,
                        voucherType: 'invoice',
                      }
                    : m
                )
              );
            } catch (err) {
              console.error('Invoice text background recognition failed:', err);
              if (!mountedRef.current) return;
              const errText = err instanceof Error ? err.message : 'Recognition failed.';
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === loadingCardId
                    ? { id: m.id, text: `❌ ${errText}`, isUser: false, timestamp: new Date() }
                    : m
                )
              );
            }
          })();
        } else {
          const receiptId = await createProcessingReceipt({ inputType: 'text' });
          await saveChatLog({
            receiptId,
            voucherType: 'receipt',
            type: 'text',
            modelName: 'gemini',
            prompt: text,
            response: '',
            requestData: { rawText: text, async: true },
            responseData: { receiptPreview: buildProcessingReceiptPreviewStub(receiptId) },
            success: true,
          });
          setIsProcessing(false);
          void (async () => {
            try {
              await processReceiptFromTextInBackground(text, receiptId);
              const receipt = await getReceiptById(receiptId);
              if (!receipt) {
                if (!mountedRef.current) return;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === loadingCardId
                      ? { id: m.id, text: '❌ Recognition failed.', isUser: false, timestamp: new Date() }
                      : m
                  )
                );
                return;
              }
              void updateLatestChatLogPreviewForVoucher({
                receiptId,
                responseData: { receiptPreview: receipt },
              });
              if (!mountedRef.current) return;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === loadingCardId
                    ? {
                        id: `text-preview-${receiptId}`,
                        text: '',
                        isUser: false,
                        timestamp: new Date(),
                        receiptPreview: receipt,
                      }
                    : m
                )
              );
            } catch (err) {
              console.error('Receipt text background recognition failed:', err);
              if (!mountedRef.current) return;
              const errText = err instanceof Error ? err.message : 'Recognition failed.';
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === loadingCardId
                    ? { id: m.id, text: `❌ ${errText}`, isUser: false, timestamp: new Date() }
                    : m
                )
              );
            }
          })();
        }
      } catch (error) {
        console.error('Error creating processing voucher from text:', error);
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: `❌ ${error instanceof Error ? error.message : 'Failed to save'}`,
          isUser: false,
          timestamp: new Date(),
        };
        setMessages((prev) => prev.map((m) => (m.id === loadingCardId ? errorMessage : m)));
        setIsProcessing(false);
      }
      return;
    }

    let textQuotaSpace = await getCurrentSpace(false);
    if (!textQuotaSpace?.id) textQuotaSpace = await getCurrentSpace(true);
    const textSpaceId = textQuotaSpace?.id ?? '';
    const textGate = await assertClientRecognitionAllowed(textSpaceId);
    if (!textGate.allowed) {
      alertClientRecognitionQuotaBlocked(router, { allowed: false, message: textGate.message });
      const errLine = textGate.message ?? 'Recognition limit reached.';
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: `Limit: ${errLine}`,
        isUser: false,
        timestamp: new Date(),
      };
      setMessages((prev) => [errorMessage, ...prev]);
      setIsProcessing(false);
      return;
    }

    const recognizeFn = () => {
      if (voucherType === 'inbound') return recognizeInboundFromText(text);
      if (voucherType === 'outbound') return recognizeOutboundFromText(text);
      throw new Error(`Unsupported text recognition for voucher type: ${voucherType}`);
    };

    const addTextSuccess = async (result: Awaited<ReturnType<typeof recognizeFn>>) => {
      const scrollToBottom = () => setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
      if (voucherType === 'inbound') {
        const inbound = await convertGeminiResultToInbound(result as Awaited<ReturnType<typeof recognizeInboundFromText>>);
        const inboundToSave = { ...inbound, status: 'pending' as const, inputType: 'text' as const };
        const inboundId = await saveInbound(inboundToSave);
        const previewMessage: Message = { id: (Date.now() + 1).toString(), text: '', isUser: false, timestamp: new Date(), inboundPreview: { ...inboundToSave, id: inboundId, status: 'pending' }, voucherType: 'inbound' };
        setMessages(prev => [previewMessage, ...prev]);
        await saveChatLog({ receiptId: undefined, voucherType: 'inbound', type: 'text', modelName: 'gemini', prompt: text, response: '', requestData: { rawText: text }, responseData: { inboundPreview: previewMessage.inboundPreview }, success: true });
      } else if (voucherType === 'outbound') {
        const outbound = await convertGeminiResultToOutbound(result as Awaited<ReturnType<typeof recognizeOutboundFromText>>);
        const outboundToSave = { ...outbound, status: 'pending' as const, inputType: 'text' as const };
        const outboundId = await saveOutbound(outboundToSave);
        const previewMessage: Message = { id: (Date.now() + 1).toString(), text: '', isUser: false, timestamp: new Date(), outboundPreview: { ...outboundToSave, id: outboundId, status: 'pending' }, voucherType: 'outbound' };
        setMessages(prev => [previewMessage, ...prev]);
        await saveChatLog({ receiptId: undefined, voucherType: 'outbound', type: 'text', modelName: 'gemini', prompt: text, response: '', requestData: { rawText: text }, responseData: { outboundPreview: previewMessage.outboundPreview }, success: true });
      }
      let qs = await getCurrentSpace(false);
      if (!qs?.id) qs = await getCurrentSpace(true);
      if (qs?.id) await recordClientRecognitionSuccessIfEnforced(qs.id);
      scrollToBottom();
    };

    try {
      const first = await runWithRecognitionRetry(recognizeFn as () => Promise<Awaited<ReturnType<typeof recognizeFn>>>, { maxAttempts: 1 });
      if (first.success) {
        if (isRecognitionResultUnrecognizable(first.result)) {
          const errorMessage: Message = { id: (Date.now() + 1).toString(), text: '❌ Content unclear or not recognized. Please resubmit.', isUser: false, timestamp: new Date() };
          setMessages(prev => [errorMessage, ...prev]);
          setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
          return;
        }
        await addTextSuccess(first.result);
        return;
      }
      if (first.isContentQuality) {
        const errorMessage: Message = { id: (Date.now() + 1).toString(), text: `❌ ${getUserFacingMessage(first)}`, isUser: false, timestamp: new Date() };
        setMessages(prev => [errorMessage, ...prev]);
        setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
        return;
      }
      setIsProcessing(false);
      // 落库与 UI 解耦：即使退出页面也继续识别并写库；仅 UI 更新受 mounted 约束
      runWithRecognitionRetry(recognizeFn as () => Promise<Awaited<ReturnType<typeof recognizeFn>>>, { maxAttempts: 4, delayMs: 2000 }).then(async (r) => {
        if (r.success) {
          if (isRecognitionResultUnrecognizable(r.result)) {
            if (!mountedRef.current) return;
            const errorMessage: Message = { id: (Date.now() + 1).toString(), text: '❌ Content unclear or not recognized. Please resubmit.', isUser: false, timestamp: new Date() };
            setMessages(prev => [errorMessage, ...prev]);
            setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
            return;
          }
          await addTextSuccess(r.result);
        } else if (mountedRef.current) {
          const errorMessage: Message = { id: (Date.now() + 1).toString(), text: `❌ ${getUserFacingMessage(r)}`, isUser: false, timestamp: new Date() };
          setMessages(prev => [errorMessage, ...prev]);
          setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
        }
      });
      return;
    } catch (error) {
      console.error('Error processing text:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: `❌ ${error instanceof Error ? error.message : 'Failed to recognize from text'}`,
        isUser: false,
        timestamp: new Date(),
      };
      setMessages(prev => [errorMessage, ...prev]);
      setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
    } finally {
      setIsProcessing(false);
    }
  };

  // 开始录音
  const handleStartRecording = async () => {
    // 防止重复触发
    if (isRecordingRef.current || isStartingRecording.current || isProcessing) {
      console.log('handleStartRecording: already recording or starting, skip');
      return;
    }
    
    isStartingRecording.current = true;
    console.log('handleStartRecording: starting...');
    
    try {
      const hasPermission = await requestAudioPermission();
      if (!hasPermission) {
        showToast('Please allow microphone access to use voice input.', 'info');
        return;
      }

      const started = await startRecording();
      if (started) {
        isRecordingRef.current = true;
        recordingDurationRef.current = 0;
        setIsRecording(true);
        setRecordingDuration(0);
        
        // 开始计时
        recordingTimer.current = setInterval(() => {
          recordingDurationRef.current += 1;
          setRecordingDuration(prev => prev + 1);
        }, 1000);
        
        // 录音动画（脉动效果）
        Animated.loop(
          Animated.sequence([
            Animated.timing(recordingAnimation, {
              toValue: 1.2,
              duration: 500,
              useNativeDriver: true,
            }),
            Animated.timing(recordingAnimation, {
              toValue: 1,
              duration: 500,
              useNativeDriver: true,
            }),
          ])
        ).start();
        
        console.log('handleStartRecording: recording started successfully');
      }
    } finally {
      isStartingRecording.current = false;
    }
  };

  // 停止录音并发送
  const handleStopRecording = async () => {
    console.log('handleStopRecording: called, isRecordingRef=', isRecordingRef.current);
    
    // 使用 ref 检查，避免闭包问题
    if (!isRecordingRef.current) {
      console.log('handleStopRecording: not recording, skip');
      return;
    }
    
    // 立即标记为不再录音
    isRecordingRef.current = false;
    
    // 停止计时和动画
    if (recordingTimer.current) {
      clearInterval(recordingTimer.current);
      recordingTimer.current = null;
    }
    recordingAnimation.stopAnimation();
    recordingAnimation.setValue(1);
    setIsRecording(false);
    
    const duration = recordingDurationRef.current;
    console.log('handleStopRecording: duration=', duration);
    
    // 录音时长太短（小于3秒），取消
    if (duration < 3) {
      await cancelRecording();
      showToast('Recording too short');
      return;
    }
    
    setIsProcessing(true);
    
    try {
      // 停止录音获取本地文件
      const localUri = await stopRecording();
      if (!localUri) {
        throw new Error('Failed to get recording');
      }

      // 添加用户语音消息（先显示，稍后更新 audioUrl）
      const userMessageId = Date.now().toString();
      const userMessage: Message = {
        id: userMessageId,
        text: `🎤 Voice (${duration}s)`,
        isUser: true,
        timestamp: new Date(),
        audioUrl: localUri, // 暂用本地 URI，上传后更新
        audioDurationSeconds: duration,
      };
      setMessages(prev => [userMessage, ...prev]);
      
      // 滚动到底部
      setTimeout(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
      }, 100);

      // 上传录音文件
      const audioUrl = await uploadAudioFile(localUri);
      if (!audioUrl) {
        throw new Error('Failed to upload audio');
      }
      
      // 更新消息中的 audioUrl
      setMessages(prev => prev.map(msg => 
        msg.id === userMessageId ? { ...msg, audioUrl } : msg
      ));

      // receipt / invoice：上传后立即建 processing 记录，识别异步；退出不影响落库
      if (voucherType === 'receipt' || voucherType === 'invoice') {
        const loadingCardId = `voice-preview-loading-${Date.now()}`;
        setMessages((prev) => [
          { id: loadingCardId, text: '', isUser: false, timestamp: new Date(), previewCardLoading: true },
          ...prev,
        ]);
        if (voucherType === 'invoice') {
          const invoiceId = await createProcessingInvoice({ inputType: 'audio' });
          await saveChatLog({
            invoiceId,
            voucherType: 'invoice',
            type: 'audio',
            modelName: 'gemini',
            prompt: `Voice input (${duration}s)`,
            response: '',
            requestData: { audioDurationSeconds: duration, async: true },
            responseData: { invoicePreview: buildProcessingInvoicePreviewStub(invoiceId) },
            success: true,
            attachmentUrl: audioUrl,
          });
          setIsProcessing(false);
          setRecordingDuration(0);
          recordingDurationRef.current = 0;
          void (async () => {
            try {
              const updated = await processInvoiceFromAudioInBackground(localUri, invoiceId);
              const invoice = updated ?? (await getInvoiceById(invoiceId));
              if (!invoice) {
                if (!mountedRef.current) return;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === loadingCardId
                      ? { id: m.id, text: '❌ Recognition failed.', isUser: false, timestamp: new Date() }
                      : m
                  )
                );
                return;
              }
              void updateLatestChatLogPreviewForVoucher({
                invoiceId,
                responseData: { invoicePreview: invoice },
              });
              if (!mountedRef.current) return;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === loadingCardId
                    ? {
                        id: `voice-preview-${invoiceId}`,
                        text: '',
                        isUser: false,
                        timestamp: new Date(),
                        invoicePreview: invoice as Invoice,
                        voucherType: 'invoice',
                      }
                    : m
                )
              );
            } catch (err) {
              console.error('Invoice voice background recognition failed:', err);
              if (!mountedRef.current) return;
              const errText = err instanceof Error ? err.message : 'Recognition failed.';
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === loadingCardId
                    ? { id: m.id, text: `❌ ${errText}`, isUser: false, timestamp: new Date() }
                    : m
                )
              );
            }
          })();
        } else {
          const receiptId = await createProcessingReceipt({ inputType: 'audio' });
          await saveChatLog({
            receiptId,
            voucherType: 'receipt',
            type: 'audio',
            modelName: 'gemini',
            prompt: `Voice input (${duration}s)`,
            response: '',
            requestData: { audioDurationSeconds: duration, async: true },
            responseData: { receiptPreview: buildProcessingReceiptPreviewStub(receiptId) },
            success: true,
            attachmentUrl: audioUrl,
          });
          setIsProcessing(false);
          setRecordingDuration(0);
          recordingDurationRef.current = 0;
          void (async () => {
            try {
              await processReceiptFromAudioInBackground(localUri, receiptId);
              const receipt = await getReceiptById(receiptId);
              if (!receipt) {
                if (!mountedRef.current) return;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === loadingCardId
                      ? { id: m.id, text: '❌ Recognition failed.', isUser: false, timestamp: new Date() }
                      : m
                  )
                );
                return;
              }
              void updateLatestChatLogPreviewForVoucher({
                receiptId,
                responseData: { receiptPreview: receipt },
              });
              if (!mountedRef.current) return;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === loadingCardId
                    ? {
                        id: `voice-preview-${receiptId}`,
                        text: '',
                        isUser: false,
                        timestamp: new Date(),
                        receiptPreview: receipt,
                      }
                    : m
                )
              );
            } catch (err) {
              console.error('Receipt voice background recognition failed:', err);
              if (!mountedRef.current) return;
              const errText = err instanceof Error ? err.message : 'Recognition failed.';
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === loadingCardId
                    ? { id: m.id, text: `❌ ${errText}`, isUser: false, timestamp: new Date() }
                    : m
                )
              );
            }
          })();
        }
        return;
      }

      let voiceQuotaSpace = await getCurrentSpace(false);
      if (!voiceQuotaSpace?.id) voiceQuotaSpace = await getCurrentSpace(true);
      const voiceSpaceId = voiceQuotaSpace?.id ?? '';
      const voiceGate = await assertClientRecognitionAllowed(voiceSpaceId);
      if (!voiceGate.allowed) {
        alertClientRecognitionQuotaBlocked(router, { allowed: false, message: voiceGate.message });
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: `Limit: ${voiceGate.message ?? 'Recognition limit reached.'}`,
          isUser: false,
          timestamp: new Date(),
        };
        setMessages((prev) => [errorMessage, ...prev]);
        setIsProcessing(false);
        return;
      }

      const recognizeFn = () => {
        if (voucherType === 'inbound') return recognizeInboundFromAudio(localUri);
        if (voucherType === 'outbound') return recognizeOutboundFromAudio(localUri);
        throw new Error(`Unsupported voice recognition for voucher type: ${voucherType}`);
      };

      const addVoiceSuccess = async (result: Awaited<ReturnType<typeof recognizeFn>>) => {
        const scrollToBottom = () => setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
        if (voucherType === 'inbound') {
          const inbound = await convertGeminiResultToInbound(result as Awaited<ReturnType<typeof recognizeInboundFromAudio>>);
          const inboundToSave = { ...inbound, status: 'pending' as const, inputType: 'audio' as const };
          const inboundId = await saveInbound(inboundToSave);
          const previewMessage: Message = { id: (Date.now() + 1).toString(), text: '', isUser: false, timestamp: new Date(), inboundPreview: { ...inboundToSave, id: inboundId, status: 'pending' }, voucherType: 'inbound' };
          if (mountedRef.current) setMessages(prev => [previewMessage, ...prev]);
          await saveChatLog({ receiptId: undefined, voucherType: 'inbound', type: 'audio', modelName: 'gemini', prompt: `Voice input (${duration}s)`, response: '', requestData: { audioDurationSeconds: duration }, responseData: { inboundPreview: previewMessage.inboundPreview }, success: true, attachmentUrl: audioUrl });
        } else if (voucherType === 'outbound') {
          const outbound = await convertGeminiResultToOutbound(result as Awaited<ReturnType<typeof recognizeOutboundFromAudio>>);
          const outboundToSave = { ...outbound, status: 'pending' as const, inputType: 'audio' as const };
          const outboundId = await saveOutbound(outboundToSave);
          const previewMessage: Message = { id: (Date.now() + 1).toString(), text: '', isUser: false, timestamp: new Date(), outboundPreview: { ...outboundToSave, id: outboundId, status: 'pending' }, voucherType: 'outbound' };
          if (mountedRef.current) setMessages(prev => [previewMessage, ...prev]);
          await saveChatLog({ receiptId: undefined, voucherType: 'outbound', type: 'audio', modelName: 'gemini', prompt: `Voice input (${duration}s)`, response: '', requestData: { audioDurationSeconds: duration }, responseData: { outboundPreview: previewMessage.outboundPreview }, success: true, attachmentUrl: audioUrl });
        }
        let vqs = await getCurrentSpace(false);
        if (!vqs?.id) vqs = await getCurrentSpace(true);
        if (vqs?.id) await recordClientRecognitionSuccessIfEnforced(vqs.id);
        if (mountedRef.current) scrollToBottom();
      };

      const first = await runWithRecognitionRetry(recognizeFn as () => Promise<Awaited<ReturnType<typeof recognizeFn>>>, { maxAttempts: 1 });
      if (first.success) {
        if (isRecognitionResultUnrecognizable(first.result)) {
          const errorMessage: Message = { id: (Date.now() + 1).toString(), text: '❌ Content unclear or not recognized. Please resubmit.', isUser: false, timestamp: new Date() };
          setMessages(prev => [errorMessage, ...prev]);
          setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
          return;
        }
        await addVoiceSuccess(first.result);
        return;
      }
      if (first.isContentQuality) {
        const errorMessage: Message = { id: (Date.now() + 1).toString(), text: `❌ ${getUserFacingMessage(first)}`, isUser: false, timestamp: new Date() };
        setMessages(prev => [errorMessage, ...prev]);
        setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
        return;
      }
      setIsProcessing(false);
      setRecordingDuration(0);
      recordingDurationRef.current = 0;
      runWithRecognitionRetry(recognizeFn as () => Promise<Awaited<ReturnType<typeof recognizeFn>>>, { maxAttempts: 4, delayMs: 2000 }).then(async (r) => {
        if (r.success) {
          if (isRecognitionResultUnrecognizable(r.result)) {
            if (!mountedRef.current) return;
            const errorMessage: Message = { id: (Date.now() + 1).toString(), text: '❌ Content unclear or not recognized. Please resubmit.', isUser: false, timestamp: new Date() };
            setMessages(prev => [errorMessage, ...prev]);
            setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
            return;
          }
          await addVoiceSuccess(r.result);
        } else if (mountedRef.current) {
          const errorMessage: Message = { id: (Date.now() + 1).toString(), text: `❌ ${getUserFacingMessage(r)}`, isUser: false, timestamp: new Date() };
          setMessages(prev => [errorMessage, ...prev]);
          setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
        }
      });
      return;
    } catch (error) {
      console.error('Error processing voice:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: `❌ ${error instanceof Error ? error.message : 'Failed to recognize receipt from voice'}`,
        isUser: false,
        timestamp: new Date(),
      };
      setMessages(prev => [errorMessage, ...prev]);
      setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
    } finally {
      setIsProcessing(false);
      setRecordingDuration(0);
      recordingDurationRef.current = 0;
    }
  };

  // 取消录音
  const handleCancelRecording = async () => {
    isRecordingRef.current = false;
    recordingDurationRef.current = 0;
    if (recordingTimer.current) {
      clearInterval(recordingTimer.current);
      recordingTimer.current = null;
    }
    recordingAnimation.stopAnimation();
    recordingAnimation.setValue(1);
    setIsRecording(false);
    setRecordingDuration(0);
    await cancelRecording();
  };

  // 播放/停止音频
  const handlePlayAudio = async (messageId: string, audioUrl: string) => {
    if (playingAudioId === messageId) {
      // 正在播放这条，停止
      await stopPlayback();
      setPlayingAudioId(null);
    } else {
      // 播放新的
      setPlayingAudioId(messageId);
      await playAudio(audioUrl, () => {
        // 播放完成后重置状态
        setPlayingAudioId(null);
      });
    }
  };

  // 格式化录音时长
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isAiInventoryType && !showAiInventory) return null;

  const drawerAssistant = getAssistantInfo(voucherType);
  const drawerTypeOptions = getChatToLogAllowedTypes(currentSpace);
  const drawerHeader = (
    <View style={drawerStyles.header}>
      <Pressable
        style={drawerStyles.headerAssistant}
        onPress={() => setShowDrawerTypePicker((v) => !v)}
      >
        <Image source={drawerAssistant.avatar} style={drawerStyles.headerAvatar} resizeMode="cover" />
        <View style={drawerStyles.headerNameBlock}>
          <View style={drawerStyles.headerNicknameRow}>
            <Text style={drawerStyles.headerNickname}>{drawerAssistant.nickname}</Text>
            <Ionicons name="chevron-down" size={18} color="#636E72" />
          </View>
          <Text style={drawerStyles.headerRole}>{drawerAssistant.role}</Text>
        </View>
      </Pressable>
      {showDrawerTypePicker && (
        <View style={drawerStyles.typePickerDropdown}>
          {drawerTypeOptions.map((opt) => {
            const optAssistant = getAssistantInfo(opt.value);
            return (
              <Pressable
                key={opt.value}
                style={[drawerStyles.typePickerItem, voucherType === opt.value && drawerStyles.typePickerItemActive]}
                onPress={() => {
                  router.replace(`/chat-to-log?type=${opt.value}&drawer=1`);
                  setShowDrawerTypePicker(false);
                }}
              >
                <Image source={optAssistant.avatar} style={drawerStyles.typePickerItemAvatar} resizeMode="cover" />
                <View style={drawerStyles.typePickerItemTextBlock}>
                  <Text style={[drawerStyles.typePickerItemText, voucherType === opt.value && drawerStyles.typePickerItemTextActive]}>{optAssistant.nickname}</Text>
                  <Text style={[drawerStyles.typePickerItemRole, voucherType === opt.value && drawerStyles.typePickerItemRoleActive]}>{optAssistant.role}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
      <TouchableOpacity style={drawerStyles.closeButton} onPress={() => router.back()}>
        <Ionicons name="close" size={24} color="#2D3436" />
      </TouchableOpacity>
    </View>
  );

  const stagedAttachmentFilesVisible = stagedAttachmentFiles.slice(0, CHAT_STAGED_FILES_DISPLAY_MAX);
  const stagedAttachmentFilesOverflowHint = chatStagedFilesOverflowLabel(stagedAttachmentFiles.length);

  const mainContent = (
    <>
      <Modal visible={!!attachmentImageModalUrl} transparent animationType="fade">
        <Pressable style={styles.attachmentImageModalBackdrop} onPress={() => setAttachmentImageModalUrl(null)}>
          <View style={styles.attachmentImageModalContent}>
            {attachmentImageModalUrl ? (
              <Image source={{ uri: attachmentImageModalUrl }} style={styles.attachmentImageModalImage} resizeMode="contain" />
            ) : null}
          </View>
          <TouchableOpacity style={styles.attachmentImageModalClose} onPress={() => setAttachmentImageModalUrl(null)}>
            <Ionicons name="close-circle" size={36} color="rgba(255,255,255,0.9)" />
          </TouchableOpacity>
        </Pressable>
      </Modal>
      {attachmentDetailForModal ? (
        <Modal visible transparent animationType="fade">
          <FileDetailModal
            file={attachmentDetailForModal}
            onClose={() => { setSelectedAttachmentForModal(null); setAttachmentDetailForModal(null); }}
          />
        </Modal>
      ) : null}
      <FirmAddClientModal
        visible={!!recognitionAddClientModal}
        onClose={() => setRecognitionAddClientModal(null)}
        firmSpaceId={recognitionAddClientModal?.firmSpaceId ?? null}
        variant="recognition"
        initialSkuSelection="none"
        recognitionDisplay={recognitionAddClientModal?.display}
        batchRows={recognitionAddClientModal?.batchRows}
        onSuccess={async () => {
          const ctx = recognitionAddClientModal;
          if (!ctx) return;
          const snapshot = messages.find((m) => m.id === ctx.messageId)?.clientPreview;
          const logId = ctx.messageId.replace(/-preview$/, '');
          setConfirmedClientPreviews((prev) => new Set(prev).add(ctx.messageId));
          setMessages((prev) =>
            prev.map((m) =>
              m.id === ctx.messageId && m.clientPreview
                ? { ...m, clientPreview: { ...m.clientPreview, confirmed: true } }
                : m
            )
          );
          if (logId && snapshot) {
            await updateChatLogResponseData(logId, {
              clientPreview: { ...snapshot, confirmed: true },
            });
          }
          setRecognitionAddClientModal(null);
        }}
      />
      <FlatList
        ref={listRef}
        data={messages}
        inverted
        keyExtractor={(item) => item.id}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onEndReached={loadMoreHistory}
        onEndReachedThreshold={1.2}
        ListHeaderComponent={null}
        renderItem={({ item: message }) => (
          <View>
            {/* 用户消息上方显示时间戳 */}
            {message.isUser && (message.text || message.audioUrl || message.imageUrl || message.documentUrl) && (
              <View style={styles.timestampDivider}>
                <Text style={styles.timestampText}>
                  {format(message.timestamp, 'MMM dd, HH:mm')}
                </Text>
              </View>
            )}
            
            {/* 只在有内容时显示消息气泡 */}
            {(message.text || message.audioUrl || message.imageUrl || message.documentUrl) && (
              <View
                style={[
                  styles.messageContainer,
                  message.isUser ? styles.userMessage : styles.botMessage,
                ]}
              >
                {message.isUser ? (
                  <UserMessageBubble
                    message={message}
                    playingAudioId={playingAudioId}
                    onPlayAudio={handlePlayAudio}
                    onPreviewImage={setAttachmentImageModalUrl}
                    onOpenDocument={openFileInModal}
                  />
                ) : (
                  <Text style={[styles.messageText, styles.botMessageText]}>
                    {message.text}
                  </Text>
                )}
              </View>
            )}
            
            {/* 预览卡片 loading 占位（仅 spinner，不显示 Processing 文案） */}
            {message.previewCardLoading && (
              <View style={[styles.receiptPreviewCard, { minHeight: 72, justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="small" color="#6C5CE7" />
              </View>
            )}
            {/* 识别结果预览卡片：仅当前助理类型匹配时展示，避免切换后串数据 */}
            {message.receiptPreview && (voucherType === 'receipt' || message.voucherType === 'receipt') && (
              isProcessingOrIncompletePreview(message.receiptPreview) ? (
                <View style={[styles.receiptPreviewCard, { minHeight: 72, justifyContent: 'center', alignItems: 'center' }]}>
                  <ActivityIndicator size="small" color="#6C5CE7" />
                </View>
              ) : (
              <View style={styles.receiptPreviewCard}>
                <View style={styles.receiptPreviewHeader}>
                  <Ionicons name="receipt" size={20} color="#6C5CE7" />
                  <Text style={styles.receiptPreviewTitle}>Expenses Preview</Text>
                </View>
                <View style={styles.receiptPreviewContent}>
                  {message.outboundPreview?.imageUrl && isPreviewableDoc(message.outboundPreview.imageUrl) && (
                    <TouchableOpacity
                      style={styles.previewFileLinkRow}
                      onPress={() => openFileInModal(message.outboundPreview?.imageUrl, 'Outbound file')}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="document-text-outline" size={16} color="#6C5CE7" />
                      <Text style={styles.previewFileLinkText} numberOfLines={1}>Open original PDF</Text>
                    </TouchableOpacity>
                  )}
                  {message.inboundPreview?.imageUrl && isPreviewableDoc(message.inboundPreview.imageUrl) && (
                    <TouchableOpacity
                      style={styles.previewFileLinkRow}
                      onPress={() => openFileInModal(message.inboundPreview?.imageUrl, 'Inbound file')}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="document-text-outline" size={16} color="#6C5CE7" />
                      <Text style={styles.previewFileLinkText} numberOfLines={1}>Open original PDF</Text>
                    </TouchableOpacity>
                  )}
                  {message.invoicePreview?.imageUrl && isPreviewableDoc(message.invoicePreview.imageUrl) && (
                    <TouchableOpacity
                      style={styles.previewFileLinkRow}
                      onPress={() => openFileInModal(message.invoicePreview?.imageUrl, 'Invoice file')}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="document-text-outline" size={16} color="#6C5CE7" />
                      <Text style={styles.previewFileLinkText} numberOfLines={1}>Open original PDF</Text>
                    </TouchableOpacity>
                  )}
                  {/* 原始 PDF 链接：现在统一在页内浮窗中预览 PDF */}
                  {message.receiptPreview?.imageUrl && isPreviewableDoc(message.receiptPreview.imageUrl) && (
                    <TouchableOpacity
                      style={styles.previewFileLinkRow}
                      onPress={() => openFileInModal(message.receiptPreview?.imageUrl, 'Expense file')}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="document-text-outline" size={16} color="#6C5CE7" />
                      <Text style={styles.previewFileLinkText} numberOfLines={1}>Open original PDF</Text>
                    </TouchableOpacity>
                  )}
                  <View style={styles.receiptPreviewRow}>
                    <Text style={styles.receiptPreviewLabel}>Marked as:</Text>
                    <Text style={styles.receiptPreviewValue}>{message.receiptPreview.supplierName}</Text>
                  </View>
                  <View style={styles.receiptPreviewRow}>
                    <Text style={styles.receiptPreviewLabel}>Date:</Text>
                    <Text style={styles.receiptPreviewValue}>
                      {(() => {
                        try {
                          // 解析日期字符串为本地时区，避免 UTC 时区转换问题
                          const [year, month, day] = message.receiptPreview.date.split('-').map(Number);
                          const date = new Date(year, month - 1, day);
                          return format(date, 'MMM dd, yyyy');
                        } catch {
                          return message.receiptPreview.date;
                        }
                      })()}
                    </Text>
                  </View>
                  <View style={styles.receiptPreviewRow}>
                    <Text style={styles.receiptPreviewLabel}>Amount:</Text>
                    <AmountText
                      amount={message.receiptPreview.totalAmount}
                      currency={message.receiptPreview.currency}
                      style={[styles.receiptPreviewValue, styles.receiptPreviewAmount]}
                    />
                  </View>
                  {message.receiptPreview.account && (
                    <View style={styles.receiptPreviewRow}>
                      <Text style={styles.receiptPreviewLabel}>Account:</Text>
                      <Text style={styles.receiptPreviewValue}>
                        {message.receiptPreview.account.name}
                      </Text>
                    </View>
                  )}
                  {message.receiptPreview.items && message.receiptPreview.items.length > 0 && (
                    <View style={styles.receiptPreviewItems}>
                      <Text style={styles.receiptPreviewLabel}>Items:</Text>
                      {message.receiptPreview.items.map((item, index) => (
                        <View key={index} style={styles.receiptPreviewItemRow}>
                          <Text style={styles.receiptPreviewItemName}>{item.name}</Text>
                          <Text style={styles.receiptPreviewItemPrice}>
                            {(typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : 0).toFixed(2)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
                <View style={styles.receiptPreviewActions}>
                  {/* 左侧：仅在小票未删除时展示详情按钮 */}
                  {!message.receiptDeleted && (
                    <TouchableOpacity
                      style={styles.previewActionButton}
                      onPress={() => {
                        handlePreviewDetails(message);
                      }}
                    >
                      <Ionicons name="eye-outline" size={16} color="#6C5CE7" />
                      <Text style={styles.previewActionText}>View Details</Text>
                    </TouchableOpacity>
                  )}

                  {/* 右侧按钮：根据实际状态显示“Confirm / Confirmed / Deleted” */}
                  <TouchableOpacity
                    style={[
                      styles.previewActionButton,
                      message.receiptDeleted
                        ? styles.previewActionButtonDisabled
                        : confirmedReceipts.has(message.receiptPreview!.id!) ||
                          message.receiptPreview!.status === 'confirmed'
                        ? styles.previewActionButtonConfirmed
                        : styles.previewActionButtonPrimary,
                    ]}
                    onPress={async () => {
                      if (!message.receiptPreview?.id) return;

                      // 已删除的记录，不再允许确认，直接提示
                      if (message.receiptDeleted) {
                        showToast('This expense has been deleted.', 'info');
                        return;
                      }

                      // 如果已经确认，不做任何操作
                      if (
                        confirmedReceipts.has(message.receiptPreview.id) ||
                        message.receiptPreview.status === 'confirmed'
                      ) {
                        return;
                      }

                      try {
                        // 再次确认小票是否存在，避免已被删除的情况；与 invoice/inbound/outbound 一致，用完整对象更新，避免 supplier 被置空
                        const receipt = await getReceiptById(message.receiptPreview.id);
                        if (!receipt) {
                          setMessages((prev) =>
                            prev.map((msg) =>
                              msg.id === message.id ? { ...msg, receiptDeleted: true } : msg,
                            ),
                          );
                          showToast('This expense has been deleted.', 'info');
                          return;
                        }

                        // 更新小票状态为已确认（传完整 receipt 与 invoice/inbound/outbound 确认逻辑一致）
                        await updateReceipt(message.receiptPreview.id, { ...receipt, status: 'confirmed' });

                        // 更新本地状态
                        setConfirmedReceipts((prev) => new Set(prev).add(message.receiptPreview!.id!));

                        // 更新消息中的 receipt 状态
                        setMessages((prev) =>
                          prev.map((msg) => {
                            if (msg.id === message.id && msg.receiptPreview) {
                              return {
                                ...msg,
                                receiptPreview: {
                                  ...msg.receiptPreview,
                                  status: 'confirmed' as ReceiptStatus,
                                },
                              };
                            }
                            return msg;
                          }),
                        );

                        // 清空输入框，准备下一条
                        setInputText('');
                        // 不自动聚焦，避免触发键盘
                      } catch (error) {
                        console.error('Error confirming receipt:', error);
                        showToast('Failed to confirm receipt. Please try again.', 'error');
                      }
                    }}
                    disabled={
                      message.receiptDeleted ||
                      confirmedReceipts.has(message.receiptPreview!.id!) ||
                      message.receiptPreview!.status === 'confirmed'
                    }
                  >
                    {message.receiptDeleted ? (
                      <Ionicons name="trash-outline" size={16} color="#fff" />
                    ) : (
                      <Ionicons
                        name={
                          confirmedReceipts.has(message.receiptPreview!.id!) ||
                          message.receiptPreview!.status === 'confirmed'
                            ? 'checkmark-circle'
                            : 'checkmark-circle-outline'
                        }
                        size={16}
                        color="#fff"
                      />
                    )}
                    <Text style={[styles.previewActionText, styles.previewActionTextPrimary]}>
                      {message.receiptDeleted
                        ? 'Deleted'
                        : confirmedReceipts.has(message.receiptPreview!.id!) ||
                          message.receiptPreview!.status === 'confirmed'
                        ? 'Confirmed'
                        : 'Confirm'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
              )
            )}

            {/* 发票识别结果预览卡片 */}
            {message.invoicePreview && (voucherType === 'invoice' || message.voucherType === 'invoice') && (
              isProcessingOrIncompletePreview(message.invoicePreview) ? (
                <View style={[styles.receiptPreviewCard, { minHeight: 72, justifyContent: 'center', alignItems: 'center' }]}>
                  <ActivityIndicator size="small" color="#6C5CE7" />
                </View>
              ) : (
              <View style={styles.receiptPreviewCard}>
                <View style={styles.receiptPreviewHeader}>
                  <Ionicons name="document-text" size={20} color="#6C5CE7" />
                  <Text style={styles.receiptPreviewTitle}>Income Preview</Text>
                </View>
                <View style={styles.receiptPreviewContent}>
                  <View style={styles.receiptPreviewRow}>
                    <Text style={styles.receiptPreviewLabel}>Customer:</Text>
                    <Text style={styles.receiptPreviewValue}>{message.invoicePreview.customerName}</Text>
                  </View>
                  <View style={styles.receiptPreviewRow}>
                    <Text style={styles.receiptPreviewLabel}>Date:</Text>
                    <Text style={styles.receiptPreviewValue}>
                      {(() => {
                        try {
                          const [y, m, d] = message.invoicePreview.date.split('-').map(Number);
                          return format(new Date(y, m - 1, d), 'MMM dd, yyyy');
                        } catch {
                          return message.invoicePreview.date;
                        }
                      })()}
                    </Text>
                  </View>
                  <View style={styles.receiptPreviewRow}>
                    <Text style={styles.receiptPreviewLabel}>Amount:</Text>
                    <AmountText
                      amount={message.invoicePreview.totalAmount}
                      currency={message.invoicePreview.currency}
                      style={[styles.receiptPreviewValue, styles.receiptPreviewAmount, { color: '#D35400' }]}
                    />
                  </View>
                  {message.invoicePreview.account && (
                    <View style={styles.receiptPreviewRow}>
                      <Text style={styles.receiptPreviewLabel}>Account:</Text>
                      <Text style={styles.receiptPreviewValue}>{message.invoicePreview.account.name}</Text>
                    </View>
                  )}
                  {message.invoicePreview.items && message.invoicePreview.items.length > 0 && (
                    <View style={styles.receiptPreviewItems}>
                      <Text style={styles.receiptPreviewLabel}>Items:</Text>
                      {message.invoicePreview.items.map((item, index) => (
                        <View key={index} style={styles.receiptPreviewItemRow}>
                          <Text style={styles.receiptPreviewItemName}>{item.name}</Text>
                          <Text style={[styles.receiptPreviewItemPrice, { color: '#D35400' }]}>
                            {(typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : 0).toFixed(2)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
                <View style={styles.receiptPreviewActions}>
                  {!message.invoiceDeleted && (
                    <TouchableOpacity style={styles.previewActionButton} onPress={() => handlePreviewDetails(message)}>
                      <Ionicons name="eye-outline" size={16} color="#6C5CE7" />
                      <Text style={styles.previewActionText}>View Details</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[
                      styles.previewActionButton,
                      message.invoiceDeleted ? styles.previewActionButtonDisabled
                        : confirmedInvoices.has(message.invoicePreview!.id!) || message.invoicePreview!.status === 'confirmed'
                        ? styles.previewActionButtonConfirmed
                        : styles.previewActionButtonPrimary,
                    ]}
                    onPress={async () => {
                      if (!message.invoicePreview?.id) return;
                      if (message.invoiceDeleted) return;
                      if (confirmedInvoices.has(message.invoicePreview.id) || message.invoicePreview.status === 'confirmed') return;
                      try {
                        const fullInvoice = await getInvoiceById(message.invoicePreview.id);
                        if (!fullInvoice) {
                          showToast('Income not found.', 'error');
                          return;
                        }
                        await saveInvoice({ ...fullInvoice, status: 'confirmed' });
                        setConfirmedInvoices((prev) => new Set(prev).add(message.invoicePreview!.id!));
                        setMessages((prev) => prev.map((msg) =>
                          msg.id === message.id && msg.invoicePreview
                            ? { ...msg, invoicePreview: { ...msg.invoicePreview, status: 'confirmed' as const } }
                            : msg
                        ));
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : 'Failed to confirm invoice.';
                        showToast(msg, 'error');
                      }
                    }}
                    disabled={message.invoiceDeleted || confirmedInvoices.has(message.invoicePreview!.id!) || message.invoicePreview!.status === 'confirmed'}
                  >
                    <Ionicons name={confirmedInvoices.has(message.invoicePreview!.id!) || message.invoicePreview!.status === 'confirmed' ? 'checkmark-circle' : 'checkmark-circle-outline'} size={16} color="#fff" />
                    <Text style={[styles.previewActionText, styles.previewActionTextPrimary]}>
                      {message.invoiceDeleted ? 'Deleted' : confirmedInvoices.has(message.invoicePreview!.id!) || message.invoicePreview!.status === 'confirmed' ? 'Confirmed' : 'Confirm'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
              )
            )}

            {/* 入库单识别结果预览卡片 */}
            {message.inboundPreview && (voucherType === 'inbound' || message.voucherType === 'inbound') && (
              <View style={styles.receiptPreviewCard}>
                <View style={styles.receiptPreviewHeader}>
                  <Ionicons name="arrow-down-circle" size={20} color="#6C5CE7" />
                  <Text style={styles.receiptPreviewTitle}>Inbound Preview</Text>
                </View>
                <View style={styles.receiptPreviewContent}>
                  <View style={styles.receiptPreviewRow}>
                    <Text style={styles.receiptPreviewLabel}>Supplier:</Text>
                    <Text style={styles.receiptPreviewValue}>{message.inboundPreview.supplierName || '—'}</Text>
                  </View>
                  <View style={styles.receiptPreviewRow}>
                    <Text style={styles.receiptPreviewLabel}>Date:</Text>
                    <Text style={styles.receiptPreviewValue}>
                      {(() => {
                        try {
                          const [y, m, d] = message.inboundPreview.date.split('-').map(Number);
                          return format(new Date(y, m - 1, d), 'MMM dd, yyyy');
                        } catch {
                          return message.inboundPreview.date;
                        }
                      })()}
                    </Text>
                  </View>
                  {(message.inboundPreview.totalAmount != null && message.inboundPreview.totalAmount > 0) && (
                    <View style={styles.receiptPreviewRow}>
                      <Text style={styles.receiptPreviewLabel}>Amount:</Text>
                      <AmountText
                        amount={message.inboundPreview.totalAmount ?? 0}
                        currency={message.inboundPreview.currency}
                        style={[styles.receiptPreviewValue, styles.receiptPreviewAmount]}
                      />
                    </View>
                  )}
                  {message.inboundPreview.items && message.inboundPreview.items.length > 0 && (
                    <View style={styles.receiptPreviewItems}>
                      <Text style={styles.receiptPreviewLabel}>Items:</Text>
                      {message.inboundPreview.items.map((item, index) => (
                        <View key={index} style={styles.receiptPreviewItemRow}>
                          <Text style={styles.receiptPreviewItemName}>{item.productName ?? ''}</Text>
                          <Text style={styles.receiptPreviewItemPrice}>
                            {item.quantity} {item.unit ?? 'pcs'}{Number.isFinite(Number(item.unitPrice)) ? ` @ ${Number(item.unitPrice).toFixed(2)}` : ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
                <View style={styles.receiptPreviewActions}>
                  {!message.inboundDeleted && (
                    <TouchableOpacity style={styles.previewActionButton} onPress={() => handlePreviewDetails(message)}>
                      <Ionicons name="eye-outline" size={16} color="#6C5CE7" />
                      <Text style={styles.previewActionText}>View Details</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[
                      styles.previewActionButton,
                      message.inboundDeleted ? styles.previewActionButtonDisabled
                        : confirmedInbounds.has(message.inboundPreview!.id!) || message.inboundPreview!.status === 'confirmed'
                        ? styles.previewActionButtonConfirmed
                        : styles.previewActionButtonPrimary,
                    ]}
                    onPress={async () => {
                      if (!message.inboundPreview?.id) return;
                      if (message.inboundDeleted) return;
                      if (confirmedInbounds.has(message.inboundPreview.id) || message.inboundPreview.status === 'confirmed') return;
                      try {
                        const full = await getInboundById(message.inboundPreview.id);
                        if (!full) { showToast('Inbound not found.', 'error'); return; }
                        await saveInbound({ ...full, status: 'confirmed' });
                        setConfirmedInbounds((prev) => new Set(prev).add(message.inboundPreview!.id!));
                        setMessages((prev) => prev.map((msg) =>
                          msg.id === message.id && msg.inboundPreview ? { ...msg, inboundPreview: { ...msg.inboundPreview, status: 'confirmed' as const } } : msg
                        ));
                      } catch (e) {
                        showToast(e instanceof Error ? e.message : 'Failed to confirm inbound.', 'error');
                      }
                    }}
                    disabled={message.inboundDeleted || confirmedInbounds.has(message.inboundPreview!.id!) || message.inboundPreview!.status === 'confirmed'}
                  >
                    <Ionicons name={confirmedInbounds.has(message.inboundPreview!.id!) || message.inboundPreview!.status === 'confirmed' ? 'checkmark-circle' : 'checkmark-circle-outline'} size={16} color="#fff" />
                    <Text style={[styles.previewActionText, styles.previewActionTextPrimary]}>
                      {message.inboundDeleted ? 'Deleted' : confirmedInbounds.has(message.inboundPreview!.id!) || message.inboundPreview!.status === 'confirmed' ? 'Confirmed' : 'Confirm'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* 出库单识别结果预览卡片 */}
            {message.outboundPreview && (voucherType === 'outbound' || message.voucherType === 'outbound') && (
              <View style={styles.receiptPreviewCard}>
                <View style={styles.receiptPreviewHeader}>
                  <Ionicons name="arrow-up-circle" size={20} color="#6C5CE7" />
                  <Text style={styles.receiptPreviewTitle}>Outbound Preview</Text>
                </View>
                <View style={styles.receiptPreviewContent}>
                  <View style={styles.receiptPreviewRow}>
                    <Text style={styles.receiptPreviewLabel}>Customer:</Text>
                    <Text style={styles.receiptPreviewValue}>{message.outboundPreview.customerName || '—'}</Text>
                  </View>
                  <View style={styles.receiptPreviewRow}>
                    <Text style={styles.receiptPreviewLabel}>Date:</Text>
                    <Text style={styles.receiptPreviewValue}>
                      {(() => {
                        try {
                          const [y, m, d] = message.outboundPreview.date.split('-').map(Number);
                          return format(new Date(y, m - 1, d), 'MMM dd, yyyy');
                        } catch {
                          return message.outboundPreview.date;
                        }
                      })()}
                    </Text>
                  </View>
                  {(message.outboundPreview.totalAmount != null && message.outboundPreview.totalAmount > 0) && (
                    <View style={styles.receiptPreviewRow}>
                      <Text style={styles.receiptPreviewLabel}>Amount:</Text>
                      <AmountText
                        amount={message.outboundPreview.totalAmount ?? 0}
                        currency={message.outboundPreview.currency}
                        style={[styles.receiptPreviewValue, styles.receiptPreviewAmount, { color: '#D35400' }]}
                      />
                    </View>
                  )}
                  {message.outboundPreview.items && message.outboundPreview.items.length > 0 && (
                    <View style={styles.receiptPreviewItems}>
                      <Text style={styles.receiptPreviewLabel}>Items:</Text>
                      {message.outboundPreview.items.map((item, index) => (
                        <View key={index} style={styles.receiptPreviewItemRow}>
                          <Text style={styles.receiptPreviewItemName}>{item.productName ?? ''}</Text>
                          <Text style={[styles.receiptPreviewItemPrice, { color: '#D35400' }]}>
                            {item.quantity} {item.unit ?? 'pcs'}{Number.isFinite(Number(item.unitPrice)) ? ` @ ${Number(item.unitPrice).toFixed(2)}` : ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
                <View style={styles.receiptPreviewActions}>
                  {!message.outboundDeleted && (
                    <TouchableOpacity style={styles.previewActionButton} onPress={() => handlePreviewDetails(message)}>
                      <Ionicons name="eye-outline" size={16} color="#6C5CE7" />
                      <Text style={styles.previewActionText}>View Details</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[
                      styles.previewActionButton,
                      message.outboundDeleted ? styles.previewActionButtonDisabled
                        : confirmedOutbounds.has(message.outboundPreview!.id!) || message.outboundPreview!.status === 'confirmed'
                        ? styles.previewActionButtonConfirmed
                        : styles.previewActionButtonPrimary,
                    ]}
                    onPress={async () => {
                      if (!message.outboundPreview?.id) return;
                      if (message.outboundDeleted) return;
                      if (confirmedOutbounds.has(message.outboundPreview.id) || message.outboundPreview.status === 'confirmed') return;
                      try {
                        const full = await getOutboundById(message.outboundPreview.id);
                        if (!full) { showToast('Outbound not found.', 'error'); return; }
                        await saveOutbound({ ...full, status: 'confirmed' });
                        setConfirmedOutbounds((prev) => new Set(prev).add(message.outboundPreview!.id!));
                        setMessages((prev) => prev.map((msg) =>
                          msg.id === message.id && msg.outboundPreview ? { ...msg, outboundPreview: { ...msg.outboundPreview, status: 'confirmed' as const } } : msg
                        ));
                      } catch (e) {
                        showToast(e instanceof Error ? e.message : 'Failed to confirm outbound.', 'error');
                      }
                    }}
                    disabled={message.outboundDeleted || confirmedOutbounds.has(message.outboundPreview!.id!) || message.outboundPreview!.status === 'confirmed'}
                  >
                    <Ionicons name={confirmedOutbounds.has(message.outboundPreview!.id!) || message.outboundPreview!.status === 'confirmed' ? 'checkmark-circle' : 'checkmark-circle-outline'} size={16} color="#fff" />
                    <Text style={[styles.previewActionText, styles.previewActionTextPrimary]}>
                      {message.outboundDeleted ? 'Deleted' : confirmedOutbounds.has(message.outboundPreview!.id!) || message.outboundPreview!.status === 'confirmed' ? 'Confirmed' : 'Confirm'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Client Assistant: recognized client list — summary + confirm to create clients and send invites */}
            {message.clientPreview && (voucherType === 'client' || message.voucherType === 'client') && (
              <View style={styles.receiptPreviewCard}>
                <View style={styles.receiptPreviewHeader}>
                  <Ionicons name="people" size={20} color="#6C5CE7" />
                  <Text style={styles.receiptPreviewTitle}>Clients recognized</Text>
                </View>
                <View style={styles.receiptPreviewContent}>
                  <View style={{ marginBottom: 6 }}>
                    <Text style={styles.receiptPreviewLabel}>{message.clientPreview.summary?.totalCount ?? 0} client(s) found.</Text>
                    <Text style={styles.receiptPreviewLabel}>{message.clientPreview.summary?.completeCount ?? 0} with full name/organization.</Text>
                    <Text style={styles.receiptPreviewLabel}>{message.clientPreview.summary?.incompleteCount ?? 0} will use email as display name.</Text>
                  </View>
                  {(message.clientPreview.items ?? []).slice(0, 10).map((item, idx) => (
                    <View key={idx} style={styles.receiptPreviewRow}>
                      <Text style={styles.receiptPreviewValue} numberOfLines={1}>
                        {[item.contactName, item.orgName].filter(Boolean).join(' · ') || item.email}
                      </Text>
                      <Text style={[styles.receiptPreviewLabel, { fontSize: 12 }]} numberOfLines={1}>{item.email}</Text>
                    </View>
                  ))}
                  {(message.clientPreview.items?.length ?? 0) > 10 && (
                    <Text style={[styles.receiptPreviewLabel, { marginTop: 4 }]}>… and {(message.clientPreview.items?.length ?? 0) - 10} more</Text>
                  )}
                </View>
                <View style={styles.receiptPreviewActions}>
                  {message.clientPreview.confirmed || confirmedClientPreviews.has(message.id) ? (
                    <View style={[styles.previewActionButton, styles.previewActionButtonConfirmed]}>
                      <Ionicons name="checkmark-circle" size={16} color="#fff" />
                      <Text style={[styles.previewActionText, styles.previewActionTextPrimary]}>Confirmed</Text>
                    </View>
                  ) : message.clientPreview.canceled ? (
                    <View style={[styles.previewActionButton, styles.previewActionButtonDisabled]}>
                      <Ionicons name="close-circle" size={16} color="#fff" />
                      <Text style={[styles.previewActionText, styles.previewActionTextPrimary]}>Canceled</Text>
                    </View>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={[styles.previewActionButton, styles.previewActionButtonSecondary, styles.previewActionButtonSecondaryShort]}
                        onPress={async () => {
                          setMessages((prev) =>
                            prev.map((m) =>
                              m.id === message.id && m.clientPreview
                                ? { ...m, clientPreview: { ...m.clientPreview!, canceled: true } }
                                : m
                            )
                          );
                          const logId = message.id.replace(/-preview$/, '');
                          if (logId && message.clientPreview) {
                            await updateChatLogResponseData(logId, {
                              clientPreview: { ...message.clientPreview, canceled: true },
                            });
                          }
                          showToast('Canceled', 'info');
                        }}
                      >
                        <Text style={styles.previewActionTextSecondary}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.previewActionButton, styles.previewActionButtonPrimary, styles.previewActionButtonPrimaryGolden]}
                        onPress={() => {
                          const firmSpaceId = message.clientPreview?.firmSpaceId;
                          if (!firmSpaceId || !message.clientPreview?.items?.length) {
                            showToast('Missing firm context or client list.', 'error');
                            return;
                          }
                          const { display, batchRows } = buildRecognitionAddClientPayload(message.clientPreview.items);
                          if (batchRows.length === 0) {
                            showToast('No valid contact emails to create clients.', 'error');
                            return;
                          }
                          setRecognitionAddClientModal({
                            messageId: message.id,
                            firmSpaceId,
                            display,
                            batchRows,
                          });
                        }}
                      >
                        <Ionicons name="open-outline" size={16} color="#fff" />
                        <Text style={[styles.previewActionText, styles.previewActionTextPrimary]}>Review & create</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            )}

            {message.attachmentPreview?.id &&
              message.attachmentPreview.projectId != null &&
              message.attachmentPreview.todoId != null &&
              (() => {
                const ap = message.attachmentPreview!;
                const attachmentCardTitle = taxFilingAttachmentCardTitle(ap);
                const attachmentCardSubtitle = taxFilingAttachmentCardSubtitleSummary({
                  summary: ap.summary,
                  cardTitle: attachmentCardTitle,
                });
                return (
              <View style={styles.receiptPreviewCard}>
                <View style={styles.receiptPreviewHeader}>
                  <Ionicons name="attach" size={20} color="#6C5CE7" />
                  <Text style={styles.receiptPreviewTitle}>
                    {(message.logType ?? 'attachment').toUpperCase()}
                  </Text>
                </View>
                <View style={styles.receiptPreviewContent}>
                  <View style={styles.attachmentPreviewRow}>
                    <Pressable onPress={() => handlePreviewDetails(message)}>
                      {(() => {
                        const isDoc = isPreviewableDoc(ap.name);
                        const url = ap.imageUrl || undefined;
                        if (url && !isDoc) {
                          const imgUrl = url as string;
                          return (
                            <View style={styles.attachmentThumbWrap}>
                              <Image source={{ uri: imgUrl }} style={[styles.attachmentThumb, styles.thumbAlignTopLeft]} resizeMode="cover" />
                            </View>
                          );
                        }
                        if (url && isDoc) {
                          return (
                            <View style={[styles.attachmentThumbWrap, styles.attachmentThumbDocIcon]}>
                              <Ionicons name="document-text-outline" size={32} color="#636E72" />
                            </View>
                          );
                        }
                        return (
                          <View style={[styles.attachmentThumbWrap, styles.attachmentThumbDocIcon]}>
                            <Ionicons name={isDoc ? 'document-text-outline' : 'document-outline'} size={32} color="#636E72" />
                          </View>
                        );
                      })()}
                    </Pressable>
                    <View style={styles.attachmentPreviewMeta}>
                      <View style={styles.attachmentPreviewTitleRow}>
                        <Text
                          style={styles.attachmentPreviewSummaryTitle}
                          numberOfLines={2}
                          ellipsizeMode="tail"
                        >
                          {attachmentCardTitle}
                        </Text>
                      </View>
                      {ap.docType ? (
                        <Text style={styles.attachmentPreviewTypeCode} numberOfLines={1}>
                          {`Type: ${ap.docType}`}
                        </Text>
                      ) : null}
                      <Pressable onPress={() => handlePreviewDetails(message)}>
                        <View>
                          <View style={styles.attachmentPreviewTodoRow}>
                            <Ionicons name="checkmark-circle-outline" size={14} color="#6C5CE7" style={styles.attachmentPreviewTodoIcon} />
                            <Text style={styles.attachmentPreviewTodoName} numberOfLines={1}>
                              {attachmentTaskOptions.find((t) => t.id === ap.todoId)?.title ?? 'Unknown task'}
                            </Text>
                          </View>
                          {attachmentCardSubtitle ? (
                            <Text
                              style={styles.attachmentPreviewSummary}
                              numberOfLines={4}
                              ellipsizeMode="tail"
                            >
                              {attachmentCardSubtitle}
                            </Text>
                          ) : null}
                          {ap.extracted_data
                            ? (() => {
                                const rows = buildExtractedPreview(ap.extracted_data!);
                                if (rows.length === 0) return null;
                                return (
                                  <View style={styles.attachmentPreviewExtracted}>
                                    {rows.map((p, i) => (
                                      <View key={i} style={styles.attachmentPreviewExtractedRow}>
                                        <Text style={styles.attachmentPreviewExtractedLabel}>{p.label}:</Text>
                                        <Text style={styles.attachmentPreviewExtractedValue} numberOfLines={1}>{p.value}</Text>
                                      </View>
                                    ))}
                                  </View>
                                );
                              })()
                            : null}
                        </View>
                      </Pressable>
                    </View>
                  </View>
                </View>
              </View>
                );
              })()}
            
          </View>
        )}
      >
      </FlatList>

      <View style={[styles.inputContainer, { paddingBottom: Platform.OS === 'ios' ? (keyboardHeight ? keyboardHeight + 20 : 20) : (keyboardHeight ? keyboardHeight + 16 : 16) }]}>
        {isDesktopWeb ? (
          <View style={webInputBlockStyles.webInputOuter}>
            <View style={webInputBlockStyles.webInputBlock}>
              {stagedAttachmentFiles.length > 0 && !isProcessing ? (
                <View style={webInputBlockStyles.stagedFilesRow}>
                  <View style={webInputBlockStyles.stagedFilesList}>
                    {stagedAttachmentFilesVisible.map((f) => {
                      const uploading = uploadingStagedIds.has(f.id);
                      const isImage = isImageMime(f.mimeType);
                      return (
                        <View key={f.id} style={webInputBlockStyles.stagedFileChip}>
                          <View style={webInputBlockStyles.stagedFileThumbWrap}>
                            {isImage ? (
                              <Image source={{ uri: f.uri }} style={[webInputBlockStyles.stagedFileThumb, styles.thumbAlignTopLeft]} resizeMode="cover" />
                            ) : (
                              <View style={webInputBlockStyles.stagedFileThumbDocIcon}>
                                <Ionicons name={isPreviewableDoc(f.name, f.mimeType) ? 'document-text-outline' : 'document-outline'} size={20} color="#636E72" />
                              </View>
                            )}
                          </View>
                          <Text style={webInputBlockStyles.stagedFileChipText} numberOfLines={1}>{f.name ?? 'Image'}</Text>
                          {!uploading ? (
                            <TouchableOpacity
                              hitSlop={8}
                              onPress={() => setStagedAttachmentFiles(prev => prev.filter((x) => x.id !== f.id))}
                              disabled={isProcessing}
                            >
                              <Ionicons name="close-circle" size={18} color="#636E72" />
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                  {stagedAttachmentFilesOverflowHint ? (
                    <Text style={webInputBlockStyles.stagedFilesMoreHint}>{stagedAttachmentFilesOverflowHint}</Text>
                  ) : null}
                </View>
              ) : null}
              <View style={webInputBlockStyles.webInputRow}>
                <View style={webInputBlockStyles.webInputWrapper}>
                  <TextInput
                    ref={inputRef}
                    style={webInputBlockStyles.webInput}
                    placeholder={getInputPlaceholder(voucherType)}
                    placeholderTextColor="#95A5A6"
                    value={inputText}
                    onChangeText={setInputText}
                    multiline
                    maxLength={500}
                    editable={!isProcessing}
                    returnKeyType="send"
                    onSubmitEditing={handleSend}
                    blurOnSubmit={false}
                    onFocus={() => setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100)}
                  />
                </View>
              </View>
              <View style={webInputBlockStyles.webInputActionsRow}>
                <View style={webInputBlockStyles.webInputActionsLeftGroup}>
                  <View style={webInputBlockStyles.webInputActionsLeft}>
                    <TouchableOpacity style={webInputBlockStyles.webActionIcon} onPress={pickImagesForSend} disabled={isProcessing}>
                      <Ionicons name="image" size={22} color="#636E72" />
                    </TouchableOpacity>
                    {isDesktopWeb ? (
                      <TouchableOpacity
                        style={webInputBlockStyles.webActionIcon}
                        onPress={pickFoldersForSend}
                        disabled={isProcessing}
                      >
                        <Ionicons name="folder-open-outline" size={22} color="#636E72" />
                      </TouchableOpacity>
                    ) : null}
                    {!isDesktopWeb && (
                      <TouchableOpacity
                        style={[webInputBlockStyles.webActionIcon, isRecording && styles.webActionIconRecording]}
                        onPress={() => { if (isRecordingRef.current) handleStopRecording(); else if (!isProcessing) handleStartRecording(); }}
                        disabled={isProcessing}
                      >
                        <Ionicons name={isRecording ? 'mic' : 'mic-outline'} size={22} color={isRecording ? '#E74C3C' : '#636E72'} />
                      </TouchableOpacity>
                    )}
                  </View>
                  {isPanel && chatPanel && (() => {
                    const typeOptions = getChatToLogAllowedTypes(currentSpace);
                    const currentLabel = typeOptions.find(o => o.value === voucherType)?.label ?? typeOptions[0]?.label ?? 'Expenses';
                    return (
                      <View style={webInputBlockStyles.webTypeDropdownWrap} nativeID="chat-to-log-type-dropdown">
                      <Pressable
                        style={({ hovered }) => [webInputBlockStyles.webTypeDropdownTrigger, hovered && webInputBlockStyles.webTypeDropdownTriggerHover]}
                        onPress={() => setShowTypeDropdown(v => !v)}
                      >
                        <Text style={webInputBlockStyles.webTypeDropdownLabel}>{currentLabel}</Text>
                        <Ionicons name={showTypeDropdown ? 'chevron-up' : 'chevron-down'} size={16} color="#636E72" />
                      </Pressable>
                      {showTypeDropdown && (
                        <View style={webInputBlockStyles.webTypeDropdownMenu}>
                          {typeOptions.map((opt) => (
                            <Pressable
                              key={opt.value}
                              style={({ hovered }) => [
                                webInputBlockStyles.webTypeDropdownItem,
                                voucherType === opt.value && webInputBlockStyles.webTypeDropdownItemActive,
                                hovered && webInputBlockStyles.webTypeDropdownItemHover,
                              ]}
                              onPress={() => { chatPanel.setType(opt.value); setShowTypeDropdown(false); }}
                            >
                              <Text style={[webInputBlockStyles.webTypeDropdownItemText, voucherType === opt.value && webInputBlockStyles.webTypeDropdownItemTextActive]}>{opt.label}</Text>
                            </Pressable>
                          ))}
                        </View>
                      )}
                      </View>
                    );
                  })()}
                </View>
                <TouchableOpacity
                  style={[styles.webSendButton, ((!inputText.trim() && stagedAttachmentFiles.length === 0) || isProcessing) && styles.sendButtonDisabled]}
                  onPress={handleSend}
                  disabled={(!inputText.trim() && stagedAttachmentFiles.length === 0) || isProcessing}
                >
                  {isProcessing ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={20} color="#fff" />}
                </TouchableOpacity>
              </View>
            </View>
            <Text style={webInputBlockStyles.webInputDisclaimer}>AI Assistant may make mistakes.</Text>
          </View>
        ) : (
          <View style={styles.nativeInputColumn}>
            {/* 预览区：已选图片在上方另起一行，不挤压录入框 */}
            {stagedAttachmentFiles.length > 0 && !isProcessing ? (
              <View style={webInputBlockStyles.stagedFilesRow}>
                <View style={webInputBlockStyles.stagedFilesList}>
                  {stagedAttachmentFilesVisible.map((f) => {
                    const uploading = uploadingStagedIds.has(f.id);
                    const isImage = isImageMime(f.mimeType);
                    return (
                      <View key={f.id} style={webInputBlockStyles.stagedFileChip}>
                        <View style={webInputBlockStyles.stagedFileThumbWrap}>
                          {isImage ? (
                            <Image source={{ uri: f.uri }} style={[webInputBlockStyles.stagedFileThumb, styles.thumbAlignTopLeft]} resizeMode="cover" />
                          ) : (
                            <View style={webInputBlockStyles.stagedFileThumbDocIcon}>
                              <Ionicons name={isPreviewableDoc(f.name, f.mimeType) ? 'document-text-outline' : 'document-outline'} size={20} color="#636E72" />
                            </View>
                          )}
                        </View>
                        <Text style={webInputBlockStyles.stagedFileChipText} numberOfLines={1}>{f.name ?? 'Image'}</Text>
                        {!uploading ? (
                          <TouchableOpacity
                            hitSlop={8}
                            onPress={() => setStagedAttachmentFiles(prev => prev.filter((x) => x.id !== f.id))}
                            disabled={isProcessing}
                          >
                            <Ionicons name="close-circle" size={18} color="#636E72" />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
                {stagedAttachmentFilesOverflowHint ? (
                  <Text style={webInputBlockStyles.stagedFilesMoreHint}>{stagedAttachmentFilesOverflowHint}</Text>
                ) : null}
              </View>
            ) : null}
            {/* 录入行：键盘/录音 icon 左端，再图片 icon，再输入框/录音按钮，再发送 */}
            <View style={styles.nativeInputRow}>
              {!isPanel && (
                <TouchableOpacity
                  style={styles.modeToggleButton}
                  onPress={() => {
                    const nextVoice = !isVoiceMode;
                    setIsVoiceMode(nextVoice);
                    if (nextVoice) {
                      Keyboard.dismiss();
                    } else {
                      setTimeout(() => {
                        inputRef.current?.focus();
                      }, 150);
                    }
                  }}
                  disabled={isProcessing || isRecording}
                >
                  {isVoiceMode ? (
                    <MaterialCommunityIcons name="keyboard-outline" size={22} color="#6C5CE7" />
                  ) : (
                    <Ionicons name="mic-outline" size={22} color="#6C5CE7" />
                  )}
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.attachIconButton} onPress={pickImagesForSend} disabled={isProcessing}>
                <Ionicons name="image" size={22} color="#6C5CE7" />
              </TouchableOpacity>
              {(isVoiceMode && !isPanel) ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.voiceButton,
                    isRecording && styles.voiceButtonRecording,
                    pressed && !isRecording && styles.voiceButtonPressed,
                  ]}
                  onPressIn={() => {
                    pressStartTime.current = Date.now();
                    isLongPressMode.current = false;
                  }}
                  onLongPress={() => {
                    if (!isRecordingRef.current && !isProcessing) {
                      isLongPressMode.current = true;
                      handleStartRecording();
                    }
                  }}
                  onPressOut={() => {
                    const pressDuration = Date.now() - pressStartTime.current;
                    if (isLongPressMode.current && isRecordingRef.current) {
                      handleStopRecording();
                    } else if (pressDuration < 500) {
                      if (isRecordingRef.current) {
                        handleStopRecording();
                      } else if (!isProcessing) {
                        isLongPressMode.current = false;
                        handleStartRecording();
                      }
                    }
                  }}
                  delayLongPress={500}
                  disabled={isProcessing}
                >
                  {isRecording ? (
                    <Animated.View style={{ transform: [{ scale: recordingAnimation }] }}>
                      <View style={styles.voiceButtonContent}>
                        <Ionicons name="mic" size={22} color="#E74C3C" />
                        <Text style={styles.voiceButtonTextRecording}>
                          {formatDuration(recordingDuration)} - Tap to send
                        </Text>
                      </View>
                    </Animated.View>
                  ) : (
                    <View style={styles.voiceButtonContent}>
                      <Ionicons name="mic-outline" size={22} color="#636E72" />
                      <Text style={styles.voiceButtonText}>Tap or hold to record</Text>
                    </View>
                  )}
                </Pressable>
              ) : (
                <View style={styles.inputWrapper}>
                  <TextInput
                    ref={inputRef}
                    style={styles.input}
                    placeholder={getInputPlaceholder(voucherType)}
                    placeholderTextColor="#95A5A6"
                    value={inputText}
                    onChangeText={setInputText}
                    multiline
                    maxLength={500}
                    editable={!isProcessing}
                    returnKeyType="send"
                    onSubmitEditing={handleSend}
                    blurOnSubmit={false}
                    textAlignVertical="center"
                    onFocus={() => {
                      setTimeout(() => {
                        listRef.current?.scrollToOffset({ offset: 0, animated: true });
                      }, 100);
                    }}
                  />
                  {inputText.length > 0 && (
                    <TouchableOpacity
                      style={styles.clearButton}
                      onPress={() => setInputText('')}
                    >
                      <Ionicons name="close-circle" size={18} color="#95A5A6" />
                    </TouchableOpacity>
                  )}
                </View>
              )}
              {!isVoiceMode && (
                <TouchableOpacity
                  style={[
                    styles.sendButton,
                    ((!inputText.trim() && stagedAttachmentFiles.length === 0) || isProcessing) && styles.sendButtonDisabled,
                  ]}
                  onPress={handleSend}
                  disabled={(!inputText.trim() && stagedAttachmentFiles.length === 0) || isProcessing}
                >
                  {isProcessing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="send" size={20} color="#fff" />
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </View>
    </>
  );

  if (isPanel) return mainContent;

  if (isDrawer) {
    return (
      <View style={drawerStyles.overlay}>
        <TouchableOpacity style={drawerStyles.backdrop} activeOpacity={1} onPress={() => router.back()} />
        <View style={drawerStyles.panel}>
          {drawerHeader}
          <View style={drawerStyles.panelBody}>{mainContent}</View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={24} color="#2D3436" />
      </TouchableOpacity>
      {mainContent}
    </View>
  );
}

export default ChatToLogScreen;

const drawerStyles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    zIndex: 1000,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  panel: {
    width: 420,
    backgroundColor: '#fff',
    flexDirection: 'column',
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
    position: 'relative',
    overflow: 'visible',
    zIndex: 10,
  },
  headerAssistant: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: 10,
  },
  headerAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: -50,
    zIndex: 11,
  },
  headerNameBlock: {
    flex: 1,
    minWidth: 0,
  },
  headerNicknameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerNickname: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
  },
  headerRole: {
    fontSize: 12,
    color: '#636E72',
    marginTop: 2,
  },
  typePickerDropdown: {
    position: 'absolute',
    left: 16,
    top: 124,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    minWidth: 160,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  typePickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 10,
  },
  typePickerItemAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  typePickerItemTextBlock: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  typePickerItemActive: {
    backgroundColor: '#F1F3F5',
  },
  typePickerItemText: {
    fontSize: 14,
    color: '#2D3436',
  },
  typePickerItemTextActive: {
    fontWeight: '600',
  },
  typePickerItemRole: {
    fontSize: 11,
    color: '#636E72',
  },
  typePickerItemRoleActive: {
    color: '#636E72',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toggleTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  toggleTabActive: {
    backgroundColor: '#6C5CE7',
  },
  toggleText: {
    fontSize: 15,
    color: '#2D3436',
    fontWeight: '500',
  },
  toggleTextActive: {
    color: '#fff',
  },
  closeButton: {
    padding: 4,
  },
  panelBody: {
    flex: 1,
    minHeight: 0,
    zIndex: 0,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  toast: {
    alignSelf: 'center',
    backgroundColor: 'rgba(45, 52, 54, 0.9)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  toastText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  backButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 16 : 16,
    right: 16,
    zIndex: 1000,
    padding: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    flexGrow: 1,
    padding: 12,
    paddingBottom: 16,
  },
  messageContainer: {
    maxWidth: '80%',
    marginBottom: 8,
    padding: 10,
    borderRadius: 16,
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#6C5CE7',
    borderBottomRightRadius: 4,
  },
  botMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  userMessageText: {
    color: '#fff',
  },
  botMessageText: {
    color: '#2D3436',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 10,
    paddingBottom: Platform.OS === 'ios' ? 20 : 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E9ECEF',
    gap: 8,
  },
  nativeInputColumn: {
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  nativeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
  },
  webSendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6C5CE7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  webActionIconRecording: {
    backgroundColor: '#FFEBEE',
  },
  attachmentsHint: {
    fontSize: 14,
    color: '#636E72',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  attachIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F0EFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  attachmentTaskLabel: {
    fontSize: 14,
    color: '#636E72',
    fontWeight: '500',
  },
  attachmentTaskSelectWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  attachmentTaskSelectPlaceholder: {
    fontSize: 13,
    color: '#95A5A6',
    width: '100%',
    marginBottom: 4,
  },
  attachmentTaskOption: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#F1F3F5',
  },
  attachmentTaskOptionActive: {
    backgroundColor: '#6C5CE7',
  },
  attachmentTaskOptionText: {
    fontSize: 13,
    color: '#2D3436',
    maxWidth: 160,
  },
  attachmentTaskOptionTextActive: {
    color: '#fff',
  },
  uploadAttachmentsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: '#6C5CE7',
  },
  uploadAttachmentsBtnDisabled: {
    backgroundColor: '#BDC3C7',
  },
  uploadAttachmentsBtnText: {
    fontSize: 15,
    color: '#fff',
    fontWeight: '600',
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    backgroundColor: '#F8F9FA',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    paddingRight: 6,
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 96,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#2D3436',
    borderRadius: 20,
  },
  clearButton: {
    padding: 4,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#6C5CE7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#BDC3C7',
  },
  timestampDivider: {
    alignItems: 'flex-end',
    marginTop: 12,
    marginBottom: 4,
    marginRight: 16,
  },
  timestampText: {
    fontSize: 11,
    color: '#95A5A6',
    fontWeight: '400',
  },
  receiptPreviewCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    marginLeft: 0,
    marginRight: 0,
    marginBottom: 8,
    width: '90%',
    alignSelf: 'flex-start',
    padding: 11,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  receiptPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 6,
  },
  receiptPreviewTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3436',
  },
  receiptPreviewContent: {
    marginBottom: 6,
  },
  receiptPreviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  receiptPreviewLabel: {
    fontSize: 12,
    color: '#636E72',
    fontWeight: '500',
  },
  receiptPreviewValue: {
    fontSize: 12,
    color: '#2D3436',
    fontWeight: '600',
  },
  receiptPreviewAmount: {
    color: '#6C5CE7',
    fontSize: 14,
  },
  previewFileLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  previewFileLinkText: {
    fontSize: 11,
    color: '#6C5CE7',
    textDecorationLine: 'underline',
  },
  receiptPreviewItems: {
    marginTop: 6,
  },
  attachmentPreviewRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  attachmentThumbWrap: {
    width: 64,
    height: 64,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#E9ECEF',
  },
  attachmentThumb: {
    width: '100%',
    height: '100%',
  },
  attachmentThumbDocIcon: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentThumbTapHint: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    opacity: 0.85,
  },
  attachmentPreviewMeta: {
    flex: 1,
    minWidth: 0,
  },
  attachmentPreviewDocType: {
    fontSize: 15,
    fontWeight: '700',
    color: '#6C5CE7',
    marginBottom: 6,
  },
  attachmentPreviewSummary: {
    fontSize: 13,
    color: '#2D3436',
    lineHeight: 18,
    marginBottom: 8,
  },
  attachmentPreviewSummaryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#6C5CE7',
    marginBottom: 0,
  },
  attachmentPreviewTitleRow: {
    marginBottom: 4,
  },
  attachmentPreviewTypeCode: {
    fontSize: 11,
    color: '#95A5A6',
    marginBottom: 4,
  },
  attachmentPreviewTodoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  attachmentPreviewTodoIcon: {
    marginRight: 4,
  },
  attachmentPreviewTodoName: {
    fontSize: 12,
    color: '#636E72',
    flexShrink: 1,
  },
  attachmentPreviewExtracted: {
    gap: 6,
    marginBottom: 8,
  },
  attachmentPreviewExtractedRow: {
    marginBottom: 4,
  },
  attachmentPreviewExtractedLabel: {
    fontSize: 11,
    color: '#95A5A6',
    marginBottom: 1,
    textTransform: 'capitalize',
  },
  attachmentPreviewExtractedValue: {
    fontSize: 13,
    color: '#2D3436',
    fontWeight: '600',
    lineHeight: 18,
  },
  attachmentPreviewTodoLabel: {
    fontSize: 11,
    color: '#95A5A6',
    marginBottom: 2,
  },
  attachmentPreviewTodoTitle: {
    fontSize: 12,
    color: '#2D3436',
    fontWeight: '600',
    marginBottom: 4,
  },
  attachmentPreviewName: {
    fontSize: 10,
    color: '#95A5A6',
    marginBottom: 3,
  },
  attachmentImageModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentImageModalContent: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentImageModalImage: {
    width: '100%',
    height: '100%',
  },
  attachmentImageModalClose: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 40,
    right: 20,
  },
  receiptPreviewItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
    paddingLeft: 6,
  },
  receiptPreviewItemName: {
    fontSize: 12,
    color: '#2D3436',
    flex: 1,
  },
  receiptPreviewItemPrice: {
    fontSize: 12,
    color: '#636E72',
    fontWeight: '500',
    marginLeft: 6,
  },
  receiptPreviewActions: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 5,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#E9ECEF',
  },
  previewActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#6C5CE7',
    gap: 5,
  },
  previewActionButtonPrimary: {
    backgroundColor: '#6C5CE7',
    borderColor: '#6C5CE7',
  },
  previewActionButtonConfirmed: {
    backgroundColor: '#00B894',
    borderColor: '#00B894',
  },
  previewActionButtonDisabled: {
    backgroundColor: '#BDC3C7',
    borderColor: '#BDC3C7',
  },
  previewActionButtonSecondary: {
    backgroundColor: '#F8F9FA',
    borderColor: '#E9ECEF',
  },
  previewActionButtonSecondaryShort: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  previewActionButtonPrimaryGolden: {
    flex: 1.618,
  },
  previewActionText: {
    fontSize: 12,
    color: '#6C5CE7',
    fontWeight: '600',
  },
  previewActionTextPrimary: {
    color: '#fff',
  },
  previewActionTextSecondary: {
    fontSize: 12,
    color: '#636E72',
    fontWeight: '500',
  },
  // 语音模式相关样式
  modeToggleButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F0EFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceButton: {
    flex: 1,
    height: 40,
    backgroundColor: '#F8F9FA',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceButtonRecording: {
    backgroundColor: '#FFEBEE',
    borderColor: '#E74C3C',
  },
  voiceButtonPressed: {
    backgroundColor: '#F0F0F0',
    borderColor: '#6C5CE7',
  },
  voiceButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  voiceButtonText: {
    fontSize: 13,
    color: '#636E72',
    fontWeight: '500',
  },
  voiceButtonTextRecording: {
    fontSize: 13,
    color: '#E74C3C',
    fontWeight: '600',
  },
  audioMessageContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  /** 统一的用户媒体消息容器（图片 / 语音 / 文档共用） */
  userMediaMessageContent: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    maxWidth: '100%',
    alignSelf: 'flex-start',
  },
  /** 56×56 交互区：图片缩略图 / 语音图标 / 文档图标 */
  userMediaThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  userMediaThumbImage: {
    width: 56,
    height: 56,
  },
  /** 交互区下方的说明文字（文件名 / "Voice input (Xs)"） */
  userMediaLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 4,
    maxWidth: 220,
    minWidth: 56,
  },
  thumbAlignTopLeft: Platform.select({
    web: { objectFit: 'cover' as const, objectPosition: 'top left' as const },
    default: {},
  }),
  // 以下保留旧名，供可能残留的引用（stagedFile 缩略图等）
  userImageMessageContent: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    maxWidth: '100%',
    alignSelf: 'flex-start',
  },
  userMessageImageThumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.2)' },
  userMessageDocIconWrap: { width: 56, height: 56, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  userMessageImageName: { fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 4, maxWidth: 220, minWidth: 56 },
  userVoiceMessageContent: { flexDirection: 'column', alignItems: 'flex-start', maxWidth: '100%', alignSelf: 'flex-start' },
  userVoiceMessageIcon: { width: 56, height: 56, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  userVoiceMessageLabel: { fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 4 },
});
