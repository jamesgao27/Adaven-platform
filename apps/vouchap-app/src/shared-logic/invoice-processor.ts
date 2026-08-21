// 后台处理发票识别（先落库 processing，再异步识别并 update）
import {
  recognizeInvoiceFromImage,
  recognizeInvoiceFromDocument,
  recognizeVoucherFromText,
  recognizeVoucherFromAudio,
} from './gemini';
import { convertGeminiResultToInvoice } from './receipt-helpers';
import { saveInvoice, getInvoiceById } from './invoices';
import { getUserFacingMessage, runWithRecognitionRetry } from './recognition-retry';
import { getCurrentUser } from './auth';
import {
  assertClientRecognitionAllowed,
  formatRecognitionQuotaBlockedNotice,
  recordClientRecognitionSuccessIfEnforced,
} from './client-recognition-quota';
import {
  recordInvoiceRecognitionFailure,
  resetInvoiceRecognitionFailCount,
} from './recognition-fail-count';
import { getLocalDateString } from './date-utils';
import type { InputType, Invoice } from './types';

/** 立即创建 processing 占位发票 */
export async function createProcessingInvoice(opts: {
  imageUrl?: string;
  inputType: InputType;
}): Promise<string> {
  const today = getLocalDateString();
  return saveInvoice(
    {
      spaceId: '',
      customerName: 'Processing...',
      totalAmount: 0,
      date: today,
      status: 'processing',
      items: [],
      imageUrl: opts.imageUrl,
      inputType: opts.inputType,
    },
    true
  );
}

async function resolveQuotaSpaceForInvoice(invoiceId: string): Promise<string> {
  const user = await getCurrentUser(true);
  const activeSpaceId = user?.currentSpaceId || user?.spaceId || '';
  const existing = await getInvoiceById(invoiceId);
  return existing?.spaceId && String(existing.spaceId).trim() !== ''
    ? String(existing.spaceId)
    : activeSpaceId;
}

async function markInvoiceRecognitionFailed(invoiceId: string, _notice?: string): Promise<void> {
  const existing = await getInvoiceById(invoiceId);
  await saveInvoice(
    {
      ...(existing ?? {
        spaceId: '',
        customerName: 'Processing...',
        totalAmount: 0,
        date: getLocalDateString(),
        items: [],
      }),
      id: invoiceId,
      status: 'needs_retake',
    } as Invoice,
    true
  );
  await recordInvoiceRecognitionFailure(invoiceId);
}

type InvoiceSource =
  | { kind: 'image'; imageUrl: string }
  | { kind: 'document'; fileUrl: string; mimeHint?: string }
  | { kind: 'text'; text: string }
  | { kind: 'audio'; audioUri: string };

async function processInvoiceRecognition(
  invoiceId: string,
  source: InvoiceSource
): Promise<Invoice | null> {
  try {
    const quotaSpaceId = await resolveQuotaSpaceForInvoice(invoiceId);
    const gate = await assertClientRecognitionAllowed(quotaSpaceId);
    if (!gate.allowed) {
      await markInvoiceRecognitionFailed(invoiceId, formatRecognitionQuotaBlockedNotice(gate.message));
      return null;
    }

    const recognizeFn = () => {
      if (source.kind === 'image') return recognizeInvoiceFromImage(source.imageUrl);
      if (source.kind === 'document') return recognizeInvoiceFromDocument(source.fileUrl, source.mimeHint);
      if (source.kind === 'text') return recognizeVoucherFromText(source.text, 'invoice');
      return recognizeVoucherFromAudio(source.audioUri, 'invoice');
    };

    const ret = await runWithRecognitionRetry(recognizeFn, { maxAttempts: 5, delayMs: 2000 });
    if (!ret.success) {
      const notice =
        getUserFacingMessage(ret) ||
        ret.error?.message ||
        'Recognition failed. Please try again later.';
      await markInvoiceRecognitionFailed(invoiceId, notice);
      return null;
    }

    const invoice = await convertGeminiResultToInvoice(ret.result as any);
    const imageUrl =
      source.kind === 'image'
        ? source.imageUrl
        : source.kind === 'document'
          ? source.fileUrl
          : (await getInvoiceById(invoiceId))?.imageUrl;

    await saveInvoice(
      {
        ...invoice,
        id: invoiceId,
        imageUrl,
        confidence: (ret.result as { confidence?: number }).confidence,
      } as Invoice,
      true
    );
    await resetInvoiceRecognitionFailCount(invoiceId);
    await recordClientRecognitionSuccessIfEnforced(quotaSpaceId);
    return getInvoiceById(invoiceId);
  } catch (error) {
    console.error('[invoice-processor] background failed:', error);
    try {
      await markInvoiceRecognitionFailed(
        invoiceId,
        error instanceof Error ? error.message : 'Recognition failed. Please try again later.'
      );
    } catch (updateError) {
      console.error('[invoice-processor] failed to mark needs_retake:', updateError);
    }
    throw error;
  }
}

export async function processInvoiceInBackground(
  imageUrl: string,
  invoiceId: string
): Promise<Invoice | null> {
  return processInvoiceRecognition(invoiceId, { kind: 'image', imageUrl });
}

export async function processInvoiceFromDocumentInBackground(
  fileUrl: string,
  invoiceId: string,
  mimeHint?: string
): Promise<Invoice | null> {
  return processInvoiceRecognition(invoiceId, { kind: 'document', fileUrl, mimeHint });
}

export async function processInvoiceFromTextInBackground(
  text: string,
  invoiceId: string
): Promise<Invoice | null> {
  return processInvoiceRecognition(invoiceId, { kind: 'text', text });
}

export async function processInvoiceFromAudioInBackground(
  audioUri: string,
  invoiceId: string
): Promise<Invoice | null> {
  return processInvoiceRecognition(invoiceId, { kind: 'audio', audioUri });
}
