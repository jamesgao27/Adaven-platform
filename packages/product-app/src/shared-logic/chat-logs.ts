import { supabase } from './supabase';
import { getCurrentUser } from './auth';

/** 记录类别：由列表页入口决定，不由大模型判断。空/未传表示历史数据即 receipt */
export type VoucherLogType = 'receipt' | 'invoice' | 'inbound' | 'outbound' | 'tax-filing' | 'client';

export interface ChatLog {
  id: string;
  spaceId: string;
  userId: string;
  receiptId?: string;
  invoiceId?: string | null;
  inboundId?: string | null;
  outboundId?: string | null;
  projectId?: string | null;
  /** 记录类别，空表示 receipt（兼容历史） */
  voucherType?: VoucherLogType | null;
  /**
   * type 语义：
   * - image: 图片（包括拍照和通过文件/相册上传的图片）
   * - text: 纯文本
   * - audio: 语音（无论是否识别成功都保持 audio）
   * - document: PDF/Word/Excel 等文档
   * - attachment: 无法识别类型的原始附件
   */
  type: 'image' | 'text' | 'audio' | 'document' | 'attachment';
  modelName?: string;
  prompt?: string;
  response?: string;
  requestData?: any;
  responseData?: any;
  success: boolean;
  errorMessage?: string;
  confidence?: number;
  processingTimeMs?: number;
  attachmentUrl?: string | null;
  /** 仅语音记录使用的附件 URL（从 attachmentUrl 映射而来，便于兼容旧代码） */
  audioUrl?: string | null;
  createdAt: string;
}

export interface CreateChatLogParams {
  receiptId?: string;
  invoiceId?: string;
  inboundId?: string;
  outboundId?: string;
  projectId?: string;
  /** 记录类别，空表示 receipt（兼容历史） */
  voucherType?: VoucherLogType | null;
  type: 'image' | 'text' | 'audio' | 'document' | 'attachment';
  modelName?: string;
  prompt?: string;
  response?: string;
  requestData?: any;
  responseData?: any;
  success?: boolean;
  errorMessage?: string;
  confidence?: number;
  processingTimeMs?: number;
  attachmentUrl?: string;
}

/**
 * 保存聊天日志到数据库
 */
export async function saveChatLog(params: CreateChatLogParams): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      console.warn('User not logged in, skipping chat log save');
      return;
    }

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) {
      console.warn('User has no space ID, skipping chat log save');
      return;
    }

    const row: Record<string, unknown> = {
      space_id: spaceId,
      user_id: user.id,
      receipt_id: params.receiptId || null,
      invoice_id: params.invoiceId || null,
      inbound_id: params.inboundId || null,
      outbound_id: params.outboundId || null,
      project_id: params.projectId || null,
      type: params.type,
      model_name: params.modelName || null,
      prompt: params.prompt || null,
      response: params.response || null,
      request_data: params.requestData || null,
      response_data: params.responseData || null,
      success: params.success !== undefined ? params.success : true,
      error_message: params.errorMessage || null,
      confidence: params.confidence || null,
      processing_time_ms: params.processingTimeMs || null,
      attachment_url: params.attachmentUrl || null,
    };

    let error = (await supabase.from('ai_chat_logs').insert({ ...row, voucher_type: params.voucherType ?? null })).error;

    if (error?.code === 'PGRST204' && error?.message?.includes('voucher_type')) {
      error = (await supabase.from('ai_chat_logs').insert(row)).error;
    }

    if (error) {
      console.error('Error saving chat log:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
    } else {
      console.log('✅ Chat log saved successfully');
    }
  } catch (error) {
    console.error('Exception saving chat log:', error);
    if (error instanceof Error) {
      console.error('Exception message:', error.message);
      console.error('Exception stack:', error.stack);
    }
    // 不抛出错误，避免影响主要功能
  }
}

/**
 * 获取空间的聊天日志列表
 */
export async function getChatLogs(limit: number = 100): Promise<ChatLog[]> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return [];
    }

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) {
      return [];
    }

    const { data, error } = await supabase
      .from('ai_chat_logs')
      .select('*')
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching chat logs:', error);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      spaceId: row.space_id,
      userId: row.user_id,
      receiptId: row.receipt_id,
      invoiceId: row.invoice_id ?? null,
      inboundId: row.inbound_id ?? null,
      outboundId: row.outbound_id ?? null,
      projectId: row.project_id ?? null,
      voucherType: row.voucher_type ?? undefined,
      type: row.type,
      modelName: row.model_name,
      prompt: row.prompt,
      response: row.response,
      requestData: row.request_data,
      responseData: row.response_data,
      success: row.success,
      errorMessage: row.error_message,
      confidence: row.confidence,
      processingTimeMs: row.processing_time_ms,
      attachmentUrl: row.attachment_url ?? null,
      audioUrl: row.type === 'audio' ? (row.attachment_url ?? null) : null,
      createdAt: row.created_at,
    }));
  } catch (error) {
    console.error('Exception fetching chat logs:', error);
    return [];
  }
}

/**
 * 分页获取聊天日志：用于“向上滚动加载更多”
 * - before: 只取某个时间之前的记录（基于 created_at 游标）
 * - voucherType: 只取该记录类别；receipt 时同时包含 voucher_type 为空的历史数据
 */
export async function getChatLogsPaginated(
  limit: number,
  before?: string,
  voucherType?: VoucherLogType | null,
  projectId?: string,
): Promise<ChatLog[]> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return [];
    }

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) {
      return [];
    }

    let query = supabase
      .from('ai_chat_logs')
      .select('*')
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt('created_at', before);
    }

    if (voucherType === 'tax-filing') {
      // 报税附件：按项目严格区分，不混合不同项目资料
      query = query.eq('voucher_type', 'tax-filing');
      if (projectId) {
        query = query.eq('project_id', projectId);
      } else {
        // 无 project 上下文时不返回任何记录，避免混展示多项目
        return [];
      }
    } else if (voucherType != null && voucherType !== '') {
      if (voucherType === 'receipt') {
        // 费用：兼容 voucher_type 为空的历史记录
        query = query.or('voucher_type.is.null,voucher_type.eq.receipt');
      } else {
        query = query.eq('voucher_type', voucherType);
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching paginated chat logs:', error);

      // 若后端报字段不存在（例如还未执行 project_id / voucher_type 等迁移），
      // 退化为仅按 space_id / created_at 筛选，再在前端按 voucherType 做一次轻量过滤，
      // 避免某些类型（尤其是 tax-filing）完全看不到历史。
      const msg = (error as any)?.message as string | undefined;
      if (msg && (msg.includes('project_id') || msg.includes('voucher_type'))) {
        try {
          let fbQuery = supabase
            .from('ai_chat_logs')
            .select('*')
            .eq('space_id', spaceId)
            .order('created_at', { ascending: false })
            .limit(limit);
          if (before) {
            fbQuery = fbQuery.lt('created_at', before);
          }
          const { data: fbData, error: fbError } = await fbQuery;
          if (fbError) {
            console.error('Fallback fetch chat logs also failed:', fbError);
            return [];
          }
          const rows = (fbData || []).filter((row: any) => {
            if (voucherType == null || voucherType === '') return true;
            const rowType = row.voucher_type as VoucherLogType | null | undefined;
            if (voucherType === 'receipt') {
              return rowType == null || rowType === 'receipt';
            }
            if (voucherType === 'tax-filing') {
              if (!projectId) return false;
              const matchType =
                rowType === 'tax-filing' ||
                !!row.response_data?.attachmentPreview ||
                !!row.request_data?.todoId;
              const matchProject = (row.project_id ?? null) === projectId;
              return matchType && matchProject;
            }
            if (voucherType === 'client') return rowType === 'client';
            return rowType === voucherType;
          });
          return rows.map((row: any) => ({
            id: row.id,
            spaceId: row.space_id,
            userId: row.user_id,
            receiptId: row.receipt_id,
            projectId: row.project_id ?? null,
            voucherType: row.voucher_type ?? undefined,
            type: row.type,
            modelName: row.model_name,
            prompt: row.prompt,
            response: row.response,
            requestData: row.request_data,
            responseData: row.response_data,
            success: row.success,
            errorMessage: row.error_message,
            confidence: row.confidence,
            processingTimeMs: row.processing_time_ms,
            attachmentUrl: row.attachment_url ?? null,
            audioUrl: row.type === 'audio' ? (row.attachment_url ?? null) : null,
            createdAt: row.created_at,
          }));
        } catch (fbEx) {
          console.error('Exception in fallback fetch chat logs:', fbEx);
        }
      }
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      spaceId: row.space_id,
      userId: row.user_id,
      receiptId: row.receipt_id,
      invoiceId: row.invoice_id ?? null,
      inboundId: row.inbound_id ?? null,
      outboundId: row.outbound_id ?? null,
      projectId: row.project_id ?? null,
      voucherType: row.voucher_type ?? undefined,
      type: row.type,
      modelName: row.model_name,
      prompt: row.prompt,
      response: row.response,
      requestData: row.request_data,
      responseData: row.response_data,
      success: row.success,
      errorMessage: row.error_message,
      confidence: row.confidence,
      processingTimeMs: row.processing_time_ms,
      attachmentUrl: row.attachment_url ?? null,
      audioUrl: row.type === 'audio' ? (row.attachment_url ?? null) : null,
      createdAt: row.created_at,
    }));
  } catch (error) {
    console.error('Exception fetching paginated chat logs:', error);
    return [];
  }
}

/**
 * Tax filing 模块：按附件 id 获取 ai_chat_logs 中最新一条 attachmentPreview
 * 用于 Todos 里的附件大浮窗兜底展示识别内容。
 */
export async function getLatestTaxFilingAttachmentPreviewByAttachmentId(
  attachmentId: string,
) {
  try {
    const user = await getCurrentUser();
    if (!user) return null;

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) return null;

    const { data, error } = await supabase
      .from('ai_chat_logs')
      .select('response_data, created_at')
      .eq('space_id', spaceId)
      .eq('voucher_type', 'tax-filing')
      .contains('response_data', { attachmentPreview: { id: attachmentId } })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    const preview = (data as any).response_data?.attachmentPreview;
    return preview ?? null;
  } catch (e) {
    console.error('Error fetching latest tax-filing attachmentPreview:', e);
    return null;
  }
}

/**
 * 获取特定小票的聊天日志
 */
export async function getChatLogsByReceiptId(receiptId: string): Promise<ChatLog[]> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return [];
    }

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) {
      return [];
    }

    const { data, error } = await supabase
      .from('ai_chat_logs')
      .select('*')
      .eq('space_id', spaceId)
      .eq('receipt_id', receiptId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching chat logs by receipt ID:', error);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      spaceId: row.space_id,
      userId: row.user_id,
      receiptId: row.receipt_id,
      invoiceId: row.invoice_id ?? null,
      inboundId: row.inbound_id ?? null,
      outboundId: row.outbound_id ?? null,
      projectId: row.project_id ?? null,
      voucherType: row.voucher_type ?? undefined,
      type: row.type,
      modelName: row.model_name,
      prompt: row.prompt,
      response: row.response,
      requestData: row.request_data,
      responseData: row.response_data,
      success: row.success,
      errorMessage: row.error_message,
      confidence: row.confidence,
      processingTimeMs: row.processing_time_ms,
      attachmentUrl: row.attachment_url ?? null,
      audioUrl: row.type === 'audio' ? (row.attachment_url ?? null) : null,
      createdAt: row.created_at,
    }));
  } catch (error) {
    console.error('Exception fetching chat logs by receipt ID:', error);
    return [];
  }
}

/**
 * 获取特定收入发票关联的聊天日志（语音附件 URL 等）
 */
export async function getChatLogsByInvoiceId(invoiceId: string): Promise<ChatLog[]> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return [];
    }

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) {
      return [];
    }

    const { data, error } = await supabase
      .from('ai_chat_logs')
      .select('*')
      .eq('space_id', spaceId)
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching chat logs by invoice ID:', error);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      spaceId: row.space_id,
      userId: row.user_id,
      receiptId: row.receipt_id,
      invoiceId: row.invoice_id ?? null,
      inboundId: row.inbound_id ?? null,
      outboundId: row.outbound_id ?? null,
      projectId: row.project_id ?? null,
      voucherType: row.voucher_type ?? undefined,
      type: row.type,
      modelName: row.model_name,
      prompt: row.prompt,
      response: row.response,
      requestData: row.request_data,
      responseData: row.response_data,
      success: row.success,
      errorMessage: row.error_message,
      confidence: row.confidence,
      processingTimeMs: row.processing_time_ms,
      attachmentUrl: row.attachment_url ?? null,
      audioUrl: row.type === 'audio' ? (row.attachment_url ?? null) : null,
      createdAt: row.created_at,
    }));
  } catch (error) {
    console.error('Exception fetching chat logs by invoice ID:', error);
    return [];
  }
}

/**
 * 更新某条 chat log 的 response_data（用于持久化 clientPreview.confirmed 等状态）
 */
export async function updateChatLogResponseData(
  logId: string,
  responseData: Record<string, unknown>,
): Promise<{ error: Error | null }> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { error: new Error('Not authenticated') };
    }

    const { error } = await supabase
      .from('ai_chat_logs')
      .update({ response_data: responseData })
      .eq('id', logId)
      .eq('space_id', user.currentSpaceId || user.spaceId);

    if (error) {
      return { error: new Error(error.message || 'Failed to update chat log') };
    }
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e : new Error('Failed to update chat log') };
  }
}

/** Persist latest receipt/invoice preview onto the newest chat log for that voucher (async recognition). */
export async function updateLatestChatLogPreviewForVoucher(opts: {
  receiptId?: string;
  invoiceId?: string;
  responseData: Record<string, unknown>;
}): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) return;
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) return;
    if (!opts.receiptId && !opts.invoiceId) return;

    let q = supabase
      .from('ai_chat_logs')
      .select('id')
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (opts.receiptId) q = q.eq('receipt_id', opts.receiptId);
    if (opts.invoiceId) q = q.eq('invoice_id', opts.invoiceId);

    const { data, error } = await q.maybeSingle();
    if (error || !data?.id) return;
    await updateChatLogResponseData(data.id, opts.responseData);
  } catch (e) {
    console.warn('[chat-logs] updateLatestChatLogPreviewForVoucher failed:', e);
  }
}
