import { supabase } from './supabase';
import { getCurrentUser } from './auth';
import { getReceiptById } from './database';
import { getInvoiceById } from './invoices';

async function requireSpaceId(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return user.currentSpaceId || user.spaceId || null;
}

export async function incrementReceiptRecognitionFailCount(receiptId: string): Promise<void> {
  const spaceId = await requireSpaceId();
  if (!spaceId) return;
  const cur = await getReceiptById(receiptId);
  if (!cur) return;
  const n = (cur.recognitionFailCount ?? 0) + 1;
  await supabase.from('receipts').update({ recognition_fail_count: n }).eq('id', receiptId).eq('space_id', spaceId);
}

export async function resetReceiptRecognitionFailCount(receiptId: string): Promise<void> {
  const spaceId = await requireSpaceId();
  if (!spaceId) return;
  await supabase.from('receipts').update({ recognition_fail_count: 0 }).eq('id', receiptId).eq('space_id', spaceId);
}

export async function incrementInvoiceRecognitionFailCount(invoiceId: string): Promise<void> {
  const spaceId = await requireSpaceId();
  if (!spaceId) return;
  const cur = await getInvoiceById(invoiceId);
  if (!cur) return;
  const n = (cur.recognitionFailCount ?? 0) + 1;
  await supabase.from('invoices').update({ recognition_fail_count: n }).eq('id', invoiceId).eq('space_id', spaceId);
}

export async function resetInvoiceRecognitionFailCount(invoiceId: string): Promise<void> {
  const spaceId = await requireSpaceId();
  if (!spaceId) return;
  await supabase.from('invoices').update({ recognition_fail_count: 0 }).eq('id', invoiceId).eq('space_id', spaceId);
}

/** 收入图片识别在 index 失败时：标记 needs_retake 并增加失败次数 */
export async function recordInvoiceRecognitionFailure(invoiceId: string): Promise<void> {
  const spaceId = await requireSpaceId();
  if (!spaceId) return;
  await incrementInvoiceRecognitionFailCount(invoiceId);
  await supabase
    .from('invoices')
    .update({ status: 'needs_retake' })
    .eq('id', invoiceId)
    .eq('space_id', spaceId);
}
