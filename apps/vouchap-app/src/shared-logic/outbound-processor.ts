// 后台处理出库单图片识别的模块
import { recognizeOutboundFromImage } from './gemini';
import { convertGeminiResultToOutbound } from './receipt-helpers';
import { saveOutbound, getOutboundById } from './outbound';
import { uploadOutboundImage, supabase } from './supabase';
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
    if (error) console.error('Error deleting outbound temp file:', error);
  } catch (error) {
    console.error('Error deleting temp file:', error);
  }
}

/** 后台处理出库单图片识别（不阻塞 UI） */
export async function processOutboundInBackground(
  imageUrl: string,
  outboundId: string,
  processedImageUri: string
): Promise<void> {
  console.log('[出库单处理] 开始处理，outboundId:', outboundId, 'imageUrl:', imageUrl);
  try {
    const existing = await getOutboundById(outboundId);
    const userFresh = await getCurrentUser(true);
    const activeSpaceId = userFresh?.currentSpaceId || userFresh?.spaceId || '';
    const quotaSpaceId =
      existing?.spaceId && String(existing.spaceId).trim() !== '' ? String(existing.spaceId) : activeSpaceId;
    const gate = await assertClientRecognitionAllowed(quotaSpaceId);
    if (!gate.allowed) {
      console.warn('[outbound-processor] recognition blocked by quota:', gate.message);
      return;
    }
    console.log('[出库单处理] 步骤1: 调用AI识别图片...');
    const recognizedData = await recognizeOutboundFromImage(imageUrl);
    console.log('[出库单处理] AI识别完成，结果:', JSON.stringify(recognizedData, null, 2));
    
    console.log('[出库单处理] 步骤2: 转换识别结果为出库单数据...');
    const outbound = await convertGeminiResultToOutbound(recognizedData);
    console.log('[出库单处理] 转换完成，出库单数据:', JSON.stringify(outbound, null, 2));
    
    console.log('[出库单处理] 步骤3: 上传正式图片...');
    const uploadSpaceId = activeSpaceId || existing?.spaceId || '';
    const finalImageUrl = await uploadOutboundImage(processedImageUri, outboundId, uploadSpaceId);
    console.log('[出库单处理] 图片上传完成，finalImageUrl:', finalImageUrl);
    
    if (imageUrl && imageUrl !== finalImageUrl) {
      console.log('[出库单处理] 删除临时文件:', imageUrl);
      await deleteTempFile(imageUrl);
    }
    
    console.log('[出库单处理] 步骤4: 保存出库单到数据库...');
    await saveOutbound({
      ...outbound,
      id: outboundId,
      imageUrl: finalImageUrl,
      confidence: recognizedData.confidence,
      inputType: 'image',
    });
    await recordClientRecognitionSuccessIfEnforced(quotaSpaceId);
    console.log('[出库单处理] ✅ 处理完成！');
  } catch (error) {
    console.error('[出库单处理] ❌ 后台处理出库单失败:');
    console.error('[出库单处理] 错误类型:', error?.constructor?.name);
    console.error('[出库单处理] 错误消息:', error instanceof Error ? error.message : String(error));
    console.error('[出库单处理] 错误堆栈:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('[出库单处理] 完整错误对象:', error);
    
    try {
      console.log('[出库单处理] 尝试更新出库单状态为pending...');
      const existing = await getOutboundById(outboundId);
      if (existing) {
        await saveOutbound({ ...existing, status: 'pending' });
        console.log('[出库单处理] 状态已更新为pending');
      } else {
        console.warn('[出库单处理] 未找到出库单记录，无法更新状态');
      }
    } catch (e) {
      console.error('[出库单处理] 更新出库单状态失败:', e);
      console.error('[出库单处理] 状态更新错误详情:', e instanceof Error ? e.message : String(e));
    }
    throw error;
  }
}
