/**
 * Re-run AI recognition using only media already linked to the voucher (no camera / gallery picker).
 */
import * as FileSystem from 'expo-file-system/legacy';
import {
  recognizeReceiptFromAudio,
  recognizeReceiptFromDocument,
  recognizeInvoiceFromImage,
  recognizeInvoiceFromDocument,
  recognizeVoucherFromAudio,
} from './gemini';
import {
  convertGeminiResultToReceiptResilient,
  convertGeminiResultToInvoice,
} from './receipt-helpers';
import { runWithRecognitionRetry } from './recognition-retry';
import { getReceiptById, updateReceipt } from './database';
import { getInvoiceById, saveInvoice } from './invoices';
import { processReceiptInBackground } from './receipt-processor';
import { getCurrentUser } from './auth';
import { checkDuplicateReceipt } from './receipt-duplicate-checker';
import { getChatLogsByReceiptId, getChatLogsByInvoiceId } from './chat-logs';
import {
  assertClientRecognitionAllowed,
  formatRecognitionQuotaBlockedNotice,
  recordClientRecognitionSuccessIfEnforced,
} from './client-recognition-quota';
import { getUserFacingMessage } from './recognition-retry';
import {
  incrementReceiptRecognitionFailCount,
  resetReceiptRecognitionFailCount,
  resetInvoiceRecognitionFailCount,
  recordInvoiceRecognitionFailure,
} from './recognition-fail-count';
import type { Receipt } from '@/types';
import type { Invoice } from '@/types';

function urlLooksPdf(url: string): boolean {
  const pathPart = url.split('?')[0].toLowerCase();
  return pathPart.endsWith('.pdf');
}

async function downloadRemoteToTempFile(url: string, ext: string): Promise<string> {
  const base =
    (FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '') || '';
  const dest = `${base}reproc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const res = await FileSystem.downloadAsync(url, dest);
  if (!res?.uri) throw new Error('Failed to download file');
  return res.uri;
}

function pickAudioUrlFromLogs(
  logs: { type?: string | null; audioUrl?: string | null; attachmentUrl?: string | null }[],
): string | null {
  for (const log of logs) {
    if (log.type && log.type !== 'audio') continue;
    const u = (log.audioUrl || log.attachmentUrl || '').trim();
    if (u) return u;
  }
  return null;
}

function shouldUseExpenseAudio(receipt: Receipt, audioUrl: string | null): boolean {
  if (!audioUrl) return false;
  if (receipt.inputType === 'audio') return true;
  if (!receipt.imageUrl) return true;
  return false;
}

async function finalizeExpenseDuplicateCheck(receiptId: string): Promise<void> {
  const updatedReceipt = await getReceiptById(receiptId);
  if (!updatedReceipt) return;
  const duplicateReceipt = await checkDuplicateReceipt(updatedReceipt);
  if (duplicateReceipt) {
    await updateReceipt(receiptId, { status: 'duplicate' }, true);
    await resetReceiptRecognitionFailCount(receiptId);
  }
}

/** 使用当前凭证已关联的图片 / PDF / 语音重新识别支出小票 */
export async function reprocessExpenseReceiptFromStoredMedia(receiptId: string): Promise<void> {
  const receipt = await getReceiptById(receiptId);
  if (!receipt) throw new Error('Expense not found');

  const userFresh = await getCurrentUser(true);
  const activeSpaceId = userFresh?.currentSpaceId || userFresh?.spaceId || '';
  const quotaSpaceId =
    receipt.spaceId && String(receipt.spaceId).trim() !== '' ? String(receipt.spaceId) : activeSpaceId;
  const isFailedRecognitionRetry =
    receipt.status === 'needs_retake' || (receipt.recognitionFailCount ?? 0) > 0;
  if (!isFailedRecognitionRetry) {
    const gate = await assertClientRecognitionAllowed(quotaSpaceId);
    if (!gate.allowed) {
      await updateReceipt(
        receiptId,
        {
          status: 'needs_retake',
          recognitionNotice: formatRecognitionQuotaBlockedNotice(gate.message),
        },
        true,
      );
      await incrementReceiptRecognitionFailCount(receiptId);
      throw new Error(gate.message || 'Recognition limit reached.');
    }
  }

  const chatLogs = await getChatLogsByReceiptId(receiptId);
  const audioUrl = pickAudioUrlFromLogs(chatLogs);

  if (shouldUseExpenseAudio(receipt, audioUrl)) {
    if (!audioUrl) {
      throw new Error('No voice attachment found for this expense.');
    }
    const localUri = await downloadRemoteToTempFile(audioUrl, 'm4a');
    const ret = await runWithRecognitionRetry(() => recognizeReceiptFromAudio(localUri), {
      maxAttempts: 5,
      delayMs: 2000,
    });
    try {
      await FileSystem.deleteAsync(localUri, { idempotent: true });
    } catch {
      /* ignore */
    }
    if (!ret.success) {
      const notice =
        getUserFacingMessage(ret) ||
        ret.error?.message ||
        'Recognition failed.';
      await updateReceipt(
        receiptId,
        {
          status: 'needs_retake',
          recognitionNotice: `${notice}\n\nIf recognition keeps failing, check connectivity and project AI (gemini-proxy / DeepSeek or Gemini secrets) configuration.`,
        },
        true,
      );
      await incrementReceiptRecognitionFailCount(receiptId);
      throw new Error(ret.error?.message || 'Voice recognition failed');
    }
    const converted = await convertGeminiResultToReceiptResilient(ret.result);
    await updateReceipt(
      receiptId,
      {
        ...converted,
        imageUrl: receipt.imageUrl,
        recognitionNotice: null,
      },
      true
    );
    if (converted.status === 'needs_retake') {
      await incrementReceiptRecognitionFailCount(receiptId);
    } else {
      await resetReceiptRecognitionFailCount(receiptId);
    }
    await recordClientRecognitionSuccessIfEnforced(quotaSpaceId);
    await finalizeExpenseDuplicateCheck(receiptId);
    return;
  }

  const imageUrl = receipt.imageUrl;
  if (!imageUrl?.trim()) {
    throw new Error('No receipt image or voice attachment found.');
  }

  if (urlLooksPdf(imageUrl)) {
    const ret = await runWithRecognitionRetry(() => recognizeReceiptFromDocument(imageUrl), {
      maxAttempts: 5,
      delayMs: 2000,
    });
    if (!ret.success) {
      const notice =
        getUserFacingMessage(ret) ||
        ret.error?.message ||
        'Recognition failed.';
      await updateReceipt(
        receiptId,
        {
          status: 'needs_retake',
          recognitionNotice: `${notice}\n\nIf recognition keeps failing, check connectivity and project AI (gemini-proxy / DeepSeek or Gemini secrets) configuration.`,
        },
        true,
      );
      await incrementReceiptRecognitionFailCount(receiptId);
      throw new Error(ret.error?.message || 'Document recognition failed');
    }
    const converted = await convertGeminiResultToReceiptResilient(ret.result);
    await updateReceipt(
      receiptId,
      {
        ...converted,
        imageUrl,
        recognitionNotice: null,
      },
      true
    );
    if (converted.status === 'needs_retake') {
      await incrementReceiptRecognitionFailCount(receiptId);
    } else {
      await resetReceiptRecognitionFailCount(receiptId);
    }
    await recordClientRecognitionSuccessIfEnforced(quotaSpaceId);
    await finalizeExpenseDuplicateCheck(receiptId);
    return;
  }

  const localImageUri = await downloadRemoteToTempFile(imageUrl, 'jpg');
  try {
    await processReceiptInBackground(imageUrl, receiptId, localImageUri, { skipDeleteSourceUrl: true });
  } finally {
    try {
      await FileSystem.deleteAsync(localImageUri, { idempotent: true });
    } catch {
      /* ignore */
    }
  }
}

function shouldUseIncomeAudio(invoice: Invoice, audioUrl: string | null): boolean {
  if (!audioUrl) return false;
  if (invoice.inputType === 'audio') return true;
  if (!invoice.imageUrl) return true;
  return false;
}

/** 使用当前凭证已关联的图片 / PDF / 语音重新识别收入发票 */
export async function reprocessIncomeInvoiceFromStoredMedia(invoiceId: string): Promise<void> {
  const invoice = await getInvoiceById(invoiceId);
  if (!invoice || !invoice.id) throw new Error('Income record not found');

  const userFresh = await getCurrentUser(true);
  const activeSpaceId = userFresh?.currentSpaceId || userFresh?.spaceId || '';
  const quotaSpaceId =
    invoice.spaceId && String(invoice.spaceId).trim() !== '' ? String(invoice.spaceId) : activeSpaceId;
  const gate = await assertClientRecognitionAllowed(quotaSpaceId);
  if (!gate.allowed) {
    await recordInvoiceRecognitionFailure(invoice.id);
    throw new Error(gate.message || 'Recognition limit reached.');
  }

  const chatLogs = await getChatLogsByInvoiceId(invoiceId);
  const audioUrl = pickAudioUrlFromLogs(chatLogs);

  if (shouldUseIncomeAudio(invoice, audioUrl)) {
    if (!audioUrl) {
      throw new Error('No voice attachment found for this income record.');
    }
    const localUri = await downloadRemoteToTempFile(audioUrl, 'm4a');
    const ret = await runWithRecognitionRetry(
      () => recognizeVoucherFromAudio(localUri, 'invoice'),
      { maxAttempts: 5, delayMs: 2000 }
    );
    try {
      await FileSystem.deleteAsync(localUri, { idempotent: true });
    } catch {
      /* ignore */
    }
    if (!ret.success) {
      await recordInvoiceRecognitionFailure(invoice.id);
      throw new Error(ret.error?.message || 'Voice recognition failed');
    }
    const converted = await convertGeminiResultToInvoice(ret.result);
    await saveInvoice(
      {
        ...converted,
        id: invoice.id,
        imageUrl: invoice.imageUrl,
        inputType: invoice.inputType ?? 'audio',
      },
      true
    );
    await resetInvoiceRecognitionFailCount(invoice.id);
    await recordClientRecognitionSuccessIfEnforced(quotaSpaceId);
    return;
  }

  const imageUrl = invoice.imageUrl;
  if (!imageUrl?.trim()) {
    throw new Error('No document image or voice attachment found.');
  }

  if (urlLooksPdf(imageUrl)) {
    const ret = await runWithRecognitionRetry(() => recognizeInvoiceFromDocument(imageUrl), {
      maxAttempts: 5,
      delayMs: 2000,
    });
    if (!ret.success) {
      await recordInvoiceRecognitionFailure(invoice.id);
      throw new Error(ret.error?.message || 'Document recognition failed');
    }
    const converted = await convertGeminiResultToInvoice(ret.result);
    await saveInvoice(
      {
        ...converted,
        id: invoice.id,
        imageUrl,
        inputType: invoice.inputType ?? 'document',
      },
      true
    );
    await resetInvoiceRecognitionFailCount(invoice.id);
    await recordClientRecognitionSuccessIfEnforced(quotaSpaceId);
    return;
  }

  const ret = await runWithRecognitionRetry(() => recognizeInvoiceFromImage(imageUrl), {
    maxAttempts: 5,
    delayMs: 2000,
  });
  if (!ret.success) {
    await recordInvoiceRecognitionFailure(invoice.id);
    throw new Error(ret.error?.message || 'Recognition failed');
  }
  const converted = await convertGeminiResultToInvoice(ret.result);
  await saveInvoice(
    {
      ...converted,
      id: invoice.id,
      imageUrl,
      confidence: ret.result.confidence,
      inputType: invoice.inputType ?? 'image',
    },
    true
  );
  await resetInvoiceRecognitionFailCount(invoice.id);
  await recordClientRecognitionSuccessIfEnforced(quotaSpaceId);
}
