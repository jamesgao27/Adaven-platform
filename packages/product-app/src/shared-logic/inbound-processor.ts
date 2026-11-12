// 后台处理入库单图片识别的模块
import { recognizeInboundFromImage } from './gemini';
import { convertGeminiResultToInbound } from './receipt-helpers';
import { saveInbound, getInboundById } from './inbound';
import { uploadInboundImage, supabase } from './supabase';
import { assertClientRecognitionAllowed, recordClientRecognitionSuccessIfEnforced } from './client-recognition-quota';
import { getCurrentUser } from './auth';

const STORAGE_BUCKET = 'receipts';

function extractFilePathFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const bucketIndex = pathParts.indexOf(STORAGE_BUCKET);
    if (bucketIndex !== -1 && bucketIndex + 1 < pathParts.length) {
      return pathParts.slice(bucketIndex + 1).join('/');
    }
    return null;
  } catch (error) {
    console.error('Error extracting file path from URL:', error);
    return null;
  }
}

async function deleteTempFile(imageUrl: string): Promise<void> {
  try {
    const filePath = extractFilePathFromUrl(imageUrl);
    if (!filePath) return;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
    if (error) console.error('Error deleting inbound temp file:', error);
  } catch (error) {
    console.error('Error deleting temp file:', error);
  }
}

/** 后台处理入库单图片识别（不阻塞 UI） */
export async function processInboundInBackground(
  imageUrl: string,
  inboundId: string,
  processedImageUri: string
): Promise<void> {
  try {
    const existing = await getInboundById(inboundId);
    const userFresh = await getCurrentUser(true);
    const activeSpaceId = userFresh?.currentSpaceId || userFresh?.spaceId || '';
    const quotaSpaceId =
      existing?.spaceId && String(existing.spaceId).trim() !== '' ? String(existing.spaceId) : activeSpaceId;
    const gate = await assertClientRecognitionAllowed(quotaSpaceId);
    if (!gate.allowed) {
      console.warn('[inbound-processor] recognition blocked by quota:', gate.message);
      if (existing) await saveInbound({ ...existing, status: 'pending' });
      return;
    }
    const recognizedData = await recognizeInboundFromImage(imageUrl);
    const inbound = await convertGeminiResultToInbound(recognizedData);
    const uploadSpaceId = activeSpaceId || existing?.spaceId || '';
    const finalImageUrl = await uploadInboundImage(processedImageUri, inboundId, uploadSpaceId);
    if (imageUrl && imageUrl !== finalImageUrl) {
      await deleteTempFile(imageUrl);
    }
    await saveInbound({
      ...inbound,
      id: inboundId,
      imageUrl: finalImageUrl,
      confidence: recognizedData.confidence,
      inputType: 'image',
    });
    await recordClientRecognitionSuccessIfEnforced(quotaSpaceId);
  } catch (error) {
    console.error('后台处理入库单失败:', error);
    try {
      const existing = await getInboundById(inboundId);
      if (existing) {
        await saveInbound({ ...existing, status: 'pending' });
      }
    } catch (e) {
      console.error('更新入库单状态失败:', e);
    }
    throw error;
  }
}
