// 后台处理小票识别的模块（先落库 processing，再异步识别并 update）
import {
  recognizeReceipt,
  recognizeReceiptFromText,
  recognizeReceiptFromAudio,
  recognizeReceiptFromDocument,
} from './gemini';
import { convertGeminiResultToReceiptResilient } from './receipt-helpers';
import { updateReceipt, getReceiptById, saveReceipt } from './database';
import { uploadReceiptImage, supabase } from './supabase';
import { checkDuplicateReceipt } from './receipt-duplicate-checker';
import { getUserFacingMessage, runWithRecognitionRetry } from './recognition-retry';
import { getCurrentUser } from './auth';
import {
  assertClientRecognitionAllowed,
  formatRecognitionQuotaBlockedNotice,
  recordClientRecognitionSuccessIfEnforced,
} from './client-recognition-quota';
import {
  incrementReceiptRecognitionFailCount,
  resetReceiptRecognitionFailCount,
} from './recognition-fail-count';
import { getLocalDateString } from './date-utils';
import type { InputType, Receipt } from './types';

// 从公共 URL 提取 bucket 与对象路径。URL 格式: .../storage/v1/object/public/{bucket_id}/{path}
function extractBucketAndPathFromUrl(url: string): { bucket: string; filePath: string } | null {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const publicIndex = pathParts.indexOf('public');
    if (publicIndex === -1 || publicIndex + 2 > pathParts.length) return null;
    const bucket = pathParts[publicIndex + 1];
    const filePath = pathParts.slice(publicIndex + 2).join('/');
    return filePath ? { bucket, filePath } : null;
  } catch (error) {
    console.error('Error extracting bucket/path from URL:', error);
    return null;
  }
}

// 删除临时文件（支持 receipts 与 tax-filing bucket）
async function deleteTempFile(imageUrl: string): Promise<void> {
  try {
    const parsed = extractBucketAndPathFromUrl(imageUrl);
    if (!parsed) {
      console.warn('Could not extract bucket/path from URL:', imageUrl);
      return;
    }
    const { bucket, filePath } = parsed;

    console.log(`Deleting temp file from bucket: ${bucket}, path: ${filePath}`);
    const { error } = await supabase.storage.from(bucket).remove([filePath]);

    if (error) {
      console.error('Error deleting temp file:', error);
    } else {
      console.log('Temp file deleted successfully:', filePath);
    }
  } catch (error) {
    console.error('Error deleting temp file:', error);
  }
}

async function resolveQuotaSpaceForReceipt(receiptId: string): Promise<{
  quotaSpaceId: string;
  activeSpaceId: string;
  existingRow: Receipt | null;
}> {
  const userForQuota = await getCurrentUser(true);
  const activeSpaceId = userForQuota?.currentSpaceId || userForQuota?.spaceId || '';
  const existingRow = await getReceiptById(receiptId);
  const quotaSpaceId =
    existingRow?.spaceId && String(existingRow.spaceId).trim() !== ''
      ? String(existingRow.spaceId)
      : activeSpaceId;
  if (existingRow?.spaceId && activeSpaceId && existingRow.spaceId !== activeSpaceId) {
    console.warn('[receipt-processor] receipt.space_id differs from active workspace:', {
      receiptSpaceId: existingRow.spaceId,
      activeSpaceId,
      quotaSpaceUsed: quotaSpaceId,
    });
  }
  return { quotaSpaceId, activeSpaceId, existingRow };
}

async function markReceiptRecognitionFailed(receiptId: string, notice: string): Promise<void> {
  await updateReceipt(
    receiptId,
    {
      status: 'needs_retake',
      recognitionNotice: notice,
    },
    true
  );
  await incrementReceiptRecognitionFailCount(receiptId);
}

async function finalizeDuplicateCheck(receiptId: string): Promise<void> {
  const updatedReceipt = await getReceiptById(receiptId);
  if (!updatedReceipt) return;
  const duplicateReceipt = await checkDuplicateReceipt(updatedReceipt);
  if (duplicateReceipt) {
    await updateReceipt(receiptId, { status: 'duplicate' }, true);
    await resetReceiptRecognitionFailCount(receiptId);
    console.log(
      `小票数据已更新，发现重复小票，状态：duplicate，重复的小票ID：${duplicateReceipt.id}`
    );
  }
}

/** 立即创建 processing 占位收据（识别前落库，退出 UI 不影响后续更新） */
export async function createProcessingReceipt(opts: {
  imageUrl?: string;
  inputType: InputType;
}): Promise<string> {
  const today = getLocalDateString();
  return saveReceipt({
    spaceId: '',
    supplierName: 'Processing...',
    totalAmount: 0,
    date: today,
    status: 'processing',
    items: [],
    imageUrl: opts.imageUrl,
    inputType: opts.inputType,
  });
}

type RecognizeSource =
  | { kind: 'image'; imageUrl: string; localUri: string; skipDeleteSourceUrl?: boolean }
  | { kind: 'document'; fileUrl: string; mimeHint?: string }
  | { kind: 'text'; text: string }
  | { kind: 'audio'; audioUri: string };

async function processReceiptRecognition(
  receiptId: string,
  source: RecognizeSource
): Promise<Receipt | null> {
  try {
    console.log('[receipt-processor] start', source.kind, receiptId);

    const { quotaSpaceId, activeSpaceId, existingRow } = await resolveQuotaSpaceForReceipt(receiptId);

    const gate = await assertClientRecognitionAllowed(quotaSpaceId);
    if (!gate.allowed) {
      console.warn(
        '[receipt-processor] Recognition blocked by quota/billing (model NOT invoked).',
        gate.message ?? 'No message',
        {
          quotaSpaceId: quotaSpaceId || '(empty)',
          activeSpaceId: activeSpaceId || '(empty)',
          receiptSpaceId: existingRow?.spaceId,
        }
      );
      await markReceiptRecognitionFailed(receiptId, formatRecognitionQuotaBlockedNotice(gate.message));
      return null;
    }

    const recognizeFn = () => {
      if (source.kind === 'image') return recognizeReceipt(source.imageUrl);
      if (source.kind === 'document') return recognizeReceiptFromDocument(source.fileUrl, source.mimeHint);
      if (source.kind === 'text') return recognizeReceiptFromText(source.text);
      return recognizeReceiptFromAudio(source.audioUri);
    };

    const ret = await runWithRecognitionRetry(recognizeFn, { maxAttempts: 5, delayMs: 2000 });
    if (!ret.success) {
      console.error(
        '[receipt-processor] recognition failed after retries',
        source.kind,
        ret.error?.message,
        'isContentQuality:',
        ret.isContentQuality
      );
      const notice =
        getUserFacingMessage(ret) ||
        ret.error?.message ||
        'Recognition failed. Please try again later.';
      await markReceiptRecognitionFailed(
        receiptId,
        `${notice}\n\nIf recognition keeps failing, check connectivity and project AI (gemini-proxy / DeepSeek or Gemini secrets) configuration.`
      );
      return null;
    }

    const recognizedData = ret.result;
    let receipt = await convertGeminiResultToReceiptResilient(recognizedData);
    receipt = {
      ...receipt,
      spaceId: quotaSpaceId || receipt.spaceId || activeSpaceId,
    };

    let finalImageUrl = existingRow?.imageUrl;
    if (source.kind === 'image') {
      finalImageUrl = await uploadReceiptImage(source.localUri, receiptId, receipt.spaceId || '');
      if (
        source.imageUrl &&
        source.imageUrl !== finalImageUrl &&
        !source.skipDeleteSourceUrl
      ) {
        await deleteTempFile(source.imageUrl);
      }
    } else if (source.kind === 'document') {
      finalImageUrl = source.fileUrl;
    }

    await updateReceipt(
      receiptId,
      {
        ...receipt,
        ...(finalImageUrl ? { imageUrl: finalImageUrl } : {}),
        confidence: receipt.confidence,
        recognitionNotice: null,
      },
      true
    );

    if (receipt.status === 'needs_retake') {
      await incrementReceiptRecognitionFailCount(receiptId);
    } else {
      await resetReceiptRecognitionFailCount(receiptId);
    }

    await recordClientRecognitionSuccessIfEnforced(quotaSpaceId || receipt.spaceId || '');
    await finalizeDuplicateCheck(receiptId);

    const updated = await getReceiptById(receiptId);
    console.log(
      `[receipt-processor] done ${source.kind}`,
      receiptId,
      'status:',
      updated?.status ?? receipt.status
    );
    return updated;
  } catch (error) {
    console.error('[receipt-processor] background failed:', error);
    try {
      const notice =
        error instanceof Error ? error.message : 'Recognition failed. Please try again later.';
      await markReceiptRecognitionFailed(receiptId, notice);
    } catch (updateError) {
      console.error('[receipt-processor] failed to mark needs_retake:', updateError);
    }
    throw error;
  }
}

/** 图片：后台识别（不阻塞 UI） */
export async function processReceiptInBackground(
  imageUrl: string,
  receiptId: string,
  processedImageUri: string,
  options?: { skipDeleteSourceUrl?: boolean }
): Promise<void> {
  await processReceiptRecognition(receiptId, {
    kind: 'image',
    imageUrl,
    localUri: processedImageUri,
    skipDeleteSourceUrl: options?.skipDeleteSourceUrl,
  });
}

/** 文档（PDF 等）：后台识别 */
export async function processReceiptFromDocumentInBackground(
  fileUrl: string,
  receiptId: string,
  mimeHint?: string
): Promise<Receipt | null> {
  return processReceiptRecognition(receiptId, { kind: 'document', fileUrl, mimeHint });
}

/** 文字：后台识别 */
export async function processReceiptFromTextInBackground(
  text: string,
  receiptId: string
): Promise<Receipt | null> {
  return processReceiptRecognition(receiptId, { kind: 'text', text });
}

/** 语音：后台识别（传入本地或可下载的 audio URI） */
export async function processReceiptFromAudioInBackground(
  audioUri: string,
  receiptId: string
): Promise<Receipt | null> {
  return processReceiptRecognition(receiptId, { kind: 'audio', audioUri });
}
