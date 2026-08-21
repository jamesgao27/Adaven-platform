import { supabase } from './supabase';
import { Receipt, ReceiptItem, ReceiptLineItemListRow, ReceiptStatus } from '@/types';
import { coerceReceiptTaxBreakdownEntries } from './receipt-tax-breakdown';
import { resolveTaxBreakdownTaxKindIds, shapeTaxBreakdownForDb } from './receipt-tax-kind-resolve';
import { getCurrentUser } from './auth';
import { findCategoryByName } from './categories';
import { findOrCreateAccount, getAccountMergeMap, getAccountById } from './accounts';
import { updateEntity, getEntityMergeMap, getEntityById, resolveEntityId, findOrCreateEntity } from './entities';
import { getEntityOptionsForDuplicateCheck } from './entity-list';
import { normalizeNameForCompare } from './name-utils';
import { isMissingNestedAttributionEmbedError } from './postgrest-embed-errors';

const ATTRIBUTION_LOOKUP_CHUNK = 120;
const DEFAULT_RECEIPT_ITEM_NAME = 'Receipt item';

function normalizeReceiptItemNameForSave(name: unknown): string {
  const v = String(name ?? '').trim();
  return v.length > 0 ? v : DEFAULT_RECEIPT_ITEM_NAME;
}

/** Insert new rows first, then remove stale rows — avoids empty receipt_items after failed insert. */
async function replaceReceiptItemsForReceipt(receiptId: string, items: ReceiptItem[]): Promise<void> {
  const itemsToInsert: Record<string, unknown>[] = [];
  for (const item of items) {
    let categoryId = item.categoryId;
    if (!categoryId && item.category) {
      categoryId = item.category.id;
    }
    if (!categoryId) {
      throw new Error(`Item "${item.name}" is missing category ID`);
    }
    itemsToInsert.push({
      receipt_id: receiptId,
      name: normalizeReceiptItemNameForSave(item.name),
      item_alias: item.itemAlias?.trim() || null,
      category_id: categoryId,
      attribution_id: item.attributionId ?? null,
      price: item.price,
      is_asset: item.isAsset !== undefined ? item.isAsset : false,
      confidence: item.confidence,
    });
  }

  if (itemsToInsert.length === 0) {
    console.warn(
      '[database] replaceReceiptItemsForReceipt: empty items — keeping existing receipt_items',
      { receiptId },
    );
    return;
  }

  const { data: inserted, error: insertError } = await supabase
    .from('receipt_items')
    .insert(itemsToInsert)
    .select('id');

  if (insertError) {
    console.error('[database] receipt_items insert failed:', insertError.message, insertError);
    throw insertError;
  }

  const keepIds = (inserted ?? []).map((row) => String(row.id));
  let deleteQuery = supabase.from('receipt_items').delete().eq('receipt_id', receiptId);
  if (keepIds.length > 0) {
    deleteQuery = deleteQuery.not('id', 'in', `(${keepIds.join(',')})`);
  }
  const { error: delErr } = await deleteQuery;
  if (delErr) {
    console.error('[database] receipt_items stale-row delete failed:', delErr.message, delErr);
    if (keepIds.length > 0) {
      const { error: rollbackErr } = await supabase.from('receipt_items').delete().in('id', keepIds);
      if (rollbackErr) {
        console.warn('[database] receipt_items insert rollback failed:', rollbackErr.message);
      }
    }
    throw delErr;
  }
}

function receiptItemAttributionRefId(item: { attribution_id?: unknown }): string | null {
  const v = item.attribution_id;
  return v != null && v !== '' ? String(v) : null;
}

function collectAttributionIdsFromReceiptRows(rows: any[]): string[] {
  const s = new Set<string>();
  for (const row of rows) {
    for (const item of row.receipt_items || []) {
      const id = receiptItemAttributionRefId(item);
      if (id) s.add(id);
    }
  }
  return [...s];
}

function collectAttributionIdsFromReceiptItemRows(rows: any[]): string[] {
  const s = new Set<string>();
  for (const row of rows) {
    const id = receiptItemAttributionRefId(row);
    if (id) s.add(id);
  }
  return [...s];
}

function mapRowTaxBreakdown(row: { tax_breakdown?: unknown }): Receipt['taxBreakdown'] {
  return coerceReceiptTaxBreakdownEntries(row.tax_breakdown, null) ?? undefined;
}

/** PostgREST 未注册 attribution_id→attributions 外键时嵌套会失败；按 id 仅从 attributions 拉取。 */
export async function fetchAttributionRowsMapForSpace(spaceId: string, ids: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return map;

  for (let i = 0; i < unique.length; i += ATTRIBUTION_LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + ATTRIBUTION_LOOKUP_CHUNK);
    const { data: rows, error } = await supabase
      .from('attributions')
      .select('id, space_id, name, color, is_default, created_at, updated_at')
      .eq('space_id', spaceId)
      .in('id', chunk);
    if (!error && rows) for (const r of rows) map.set(r.id, r);
  }
  return map;
}

// 将日期数据转换为 YYYY-MM-DD 格式的字符串，完全忠实于票面日期，不做任何时区转换
function normalizeDate(dateValue: any): string {
  if (!dateValue) {
    // 如果日期为空，返回今天的日期（使用本地时区）
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 优先处理字符串，因为这是数据库 DATE 字段的原始格式
  if (typeof dateValue === 'string') {
    // 如果是 ISO 字符串（如 "2024-01-15T00:00:00Z"），只取日期部分，不进行时区转换
    if (dateValue.includes('T')) {
      return dateValue.split('T')[0];
    }
    // 如果已经是 YYYY-MM-DD 格式，直接返回，不做任何转换
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      return dateValue;
    }
  }

  // 如果是 Date 对象，需要小心处理时区问题
  // 为了避免时区转换问题，我们使用 UTC 方法而不是本地时区方法
  // 这样可以确保日期与数据库存储的日期一致
  if (dateValue instanceof Date) {
    // 使用 UTC 方法，确保与数据库 DATE 字段的存储方式一致
    // PostgreSQL DATE 类型不包含时区信息，总是按字面值存储
    const year = dateValue.getUTCFullYear();
    const month = String(dateValue.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dateValue.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 其他情况，尝试转换为字符串
  return String(dateValue);
}

// 保存小票到数据库
export async function saveReceipt(receipt: Receipt): Promise<string> {
  try {
    // Always refresh so inserts use the workspace user just switched to (avoid stale auth-cache space).
    const user = await getCurrentUser(true);
    if (!user) {
      console.error('User not logged in when trying to save receipt');
      throw new Error('Not logged in: Please sign in before saving receipt');
    }

    // 优先使用 currentSpaceId，如果没有则使用 spaceId（向后兼容）
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) {
      console.error('User has no space ID');
      throw new Error('User not associated with space account, please sign in again');
    }

    // 关联方（支出单 Payee）：entity_id 或按名称 findOrCreateEntity
    let entityId: string | null = receipt.entityId ?? null;
    const payeeName = receipt.supplierName || receipt.storeName;
    if (!entityId && payeeName) {
      const trimmed = payeeName.trim();
      const invalidNames = ['processing', 'processing...', 'pending', 'pending...', 'loading', 'loading...', '识别中', '处理中', '待处理'];
      if (trimmed && !invalidNames.includes(trimmed.toLowerCase())) {
        try {
          const entity = await findOrCreateEntity(trimmed, true);
          entityId = entity.id;
        } catch (error) {
          console.warn('Failed to create or find entity (Payee):', error);
        }
      }
    }
    if (!entityId && receipt.entity) entityId = receipt.entity.id;

    // 处理支付账户ID
    let accountId = receipt.accountId;
    if (!accountId && receipt.account) {
      const account = await findOrCreateAccount(receipt.account.name || receipt.account.id, true);
      accountId = account.id;
    }

    let taxBreakdownForInsert: Record<string, unknown>[] | null = null;
    if (receipt.taxBreakdown?.length) {
      let supplierAddress = receipt.entity?.address?.trim() || undefined;
      if (!supplierAddress && entityId) {
        try {
          const rid = await resolveEntityId(spaceId, entityId);
          supplierAddress = (await getEntityById(rid))?.address?.trim() || undefined;
        } catch {
          /* best-effort */
        }
      }
      try {
        const enriched = await resolveTaxBreakdownTaxKindIds(receipt.taxBreakdown, {
          currency: receipt.currency,
          currencyPrintedOnReceipt: receipt.currencyPrintedOnReceipt === true,
          supplierName: receipt.supplierName,
          supplierAddress,
          receiptDate: receipt.date,
        });
        taxBreakdownForInsert = shapeTaxBreakdownForDb(enriched);
      } catch (taxErr) {
        console.warn(
          '[saveReceipt] tax_breakdown resolve failed; saving coerced lines without tax_kind_id',
          taxErr,
        );
        taxBreakdownForInsert = shapeTaxBreakdownForDb(
          coerceReceiptTaxBreakdownEntries(receipt.taxBreakdown, null) ?? receipt.taxBreakdown,
        );
      }
    }

    // 先保存小票主记录（支出单 Payee 存 entity_id）
    const insertPayload: Record<string, unknown> = {
      space_id: spaceId,
      entity_id: entityId,
      total_amount: receipt.totalAmount,
      currency: receipt.currency,
      tax: receipt.tax,
      tax_breakdown: taxBreakdownForInsert,
      date: receipt.date,
      account_id: accountId,
      status: receipt.status,
      image_url: receipt.imageUrl,
      input_type: receipt.inputType || 'image',
      confidence: receipt.confidence,
      processed_by: receipt.processedBy,
      created_by: user.id,
    };
    const { data: receiptData, error: receiptError } = await supabase
      .from('receipts')
      .insert(insertPayload)
      .select()
      .single();

    if (receiptError) {
      console.error('Receipt insert error:', receiptError);
      console.error('User info:', {
        userId: user.id,
        spaceId: spaceId,
        email: user.email,
      });
      console.error('Receipt data being inserted:', {
        space_id: spaceId,
        total_amount: receipt.totalAmount,
        date: receipt.date,
      });

      if (receiptError.message?.includes('row-level security') || receiptError.code === '42501') {
        throw new Error(
          'Database permission error: Unable to save receipt\n\n' +
          'Possible causes:\n' +
          '1. RLS policy not configured correctly - Please execute fix-receipts-rls-force.sql in Supabase\n' +
          '2. get_user_space_id() function returns NULL - Check if user has associated space\n' +
          '3. space_id mismatch - Please sign in again\n\n' +
          'Current user info:\n' +
          `- User ID: ${user.id}\n` +
          `- Space ID: ${spaceId || 'NULL (not associated)'}\n` +
          `- Email: ${user.email}\n\n` +
          'Please execute diagnose-rls-issue.sql script to view detailed status'
        );
      }
      throw receiptError;
    }

    const receiptId = receiptData.id;

    // 保存商品项（需要将分类名称匹配到分类ID）
    console.log('Saving receipt items:', receipt.items?.length || 0, 'items');
    if (receipt.items && receipt.items.length > 0) {
      const itemsToInsert: any[] = [];

      for (const item of receipt.items) {
        let categoryId: string | null | undefined = item.categoryId;

        // 如果没有categoryId但有category对象，使用category.id
        if (!categoryId && item.category) {
          categoryId = item.category.id;
        }

        // 如果还是没有，尝试通过名称查找（支出分类）
        if (!categoryId) {
          const categoryNameHint =
            item.category?.name ??
            (item as { categoryName?: string }).categoryName ??
            'Other';
          const category = await findCategoryByName(categoryNameHint, 'expense');
          categoryId = category?.id || null;
        }

        if (!categoryId) {
          console.warn(`商品 "${item.name}" 的分类未找到，使用默认分类`);
          const defaultCategoryNames = ['Meal', 'Shopping', 'Food', '购物', '食品', 'Other', 'Grocery'];
          let defaultCategory = null;

          for (const defaultName of defaultCategoryNames) {
            defaultCategory = await findCategoryByName(defaultName, 'expense');
            if (defaultCategory) break;
          }

          if (!defaultCategory) {
            // 如果都找不到，尝试获取第一个默认分类
            const { data: defaultCategories } = await supabase
              .from('categories')
              .select('id')
              .eq('space_id', spaceId)
              .eq('is_default', true)
              .limit(1);

            if (!defaultCategories || defaultCategories.length === 0) {
              // 如果连默认分类都没有，尝试获取任何第一个分类
              const { data: anyCategories } = await supabase
                .from('categories')
                .select('id')
                .eq('space_id', spaceId)
                .limit(1);

              if (!anyCategories || anyCategories.length === 0) {
                throw new Error(
                  'No categories found.\n\n' +
                  'Please do one of the following:\n' +
                  '1. Execute add-default-categories-for-existing-users.sql in Supabase SQL Editor\n' +
                  '2. Or manually create at least one category in the app\n\n' +
                  'Current user space ID: ' + (spaceId || 'Unknown')
                );
              }
              categoryId = anyCategories[0].id;
            } else {
              categoryId = defaultCategories[0].id;
            }
          } else {
            categoryId = defaultCategory.id;
          }
        }

        itemsToInsert.push({
          receipt_id: receiptId,
          name: normalizeReceiptItemNameForSave(item.name),
          item_alias: item.itemAlias?.trim() || null,
          category_id: categoryId,
          attribution_id: item.attributionId ?? null,
          price: item.price,
          is_asset: item.isAsset !== undefined ? item.isAsset : false, // 确保 isAsset 不为 null
          confidence: item.confidence,
        });
      }

      if (itemsToInsert.length > 0) {
        const { error: itemsError } = await supabase
          .from('receipt_items')
          .insert(itemsToInsert);

        if (itemsError) {
          console.error('Receipt items insert error:', itemsError);
          if (itemsError.message?.includes('row-level security') || itemsError.code === '42501') {
            throw new Error('Database permission error: Unable to save items, please check RLS policy');
          }
          throw itemsError;
        }
      }
    }

    return receiptId;
  } catch (error) {
    console.error('Error saving receipt:', error);
    throw error;
  }
}

// 更新小票（关联方 Payee：有关联则更新 entity 名称，无关联则仅更新展示名称）
// autoResolveDuplicate: 为 true 时遇到重复名称自动使用已存在 entityId，不抛错
export async function updateReceipt(receiptId: string, receipt: Partial<Receipt>, autoResolveDuplicate: boolean = false): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    // Always update against the receipt's own space_id. Using the session's current space can
    // no-op the header update (0 rows) while receipt_items still write — looks like "items async, receipt stuck".
    const { data: existingRow, error: existingErr } = await supabase
      .from('receipts')
      .select('id, space_id')
      .eq('id', receiptId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existingRow?.space_id) throw new Error('Receipt not found');
    const spaceId = String(existingRow.space_id);

    let entityId = receipt.entityId ?? undefined;
    const payeeName = (receipt.supplierName ?? receipt.storeName ?? '').trim();
    const invalidNames = ['processing', 'processing...', 'pending', 'pending...', 'loading', 'loading...', '识别中', '处理中', '待处理'];
    const isValidName = payeeName.length > 0 && !invalidNames.includes(payeeName.toLowerCase());

    if (!entityId && receipt.entity) entityId = receipt.entity.id;

    if (isValidName) {
      const options = await getEntityOptionsForDuplicateCheck();
      const foundByName = options.find((o) => normalizeNameForCompare(o.name) === normalizeNameForCompare(payeeName));
      const currentResolvedId = entityId ? await resolveEntityId(spaceId, entityId) : null;
      if (foundByName) {
        const targetId = await resolveEntityId(spaceId, foundByName.id);
        if (targetId !== currentResolvedId) {
          if (autoResolveDuplicate) {
            entityId = targetId;
            console.log('关联方名称已存在，自动使用已存在的 entityId:', targetId);
          } else {
            throw Object.assign(new Error('关联方名称已存在'), {
              code: 'ENTITY_NAME_EXISTS' as const,
              duplicateName: payeeName,
              targetId,
            });
          }
        } else {
          entityId = targetId;
        }
      }
      // 原纪录未关联 entities 且录入名称未匹配现有 entities 时，创建新 entity 并关联
      if (!entityId) {
        try {
          const entity = await findOrCreateEntity(payeeName, false);
          entityId = entity.id;
        } catch (e) {
          console.warn('updateReceipt: findOrCreateEntity failed', e);
        }
      }
      if (entityId) {
        try {
          const targetId = await resolveEntityId(spaceId, entityId);
          await updateEntity(targetId, { name: payeeName });
        } catch (e) {
          if (e instanceof Error && e.message === '关联方名称已存在') {
            if (!autoResolveDuplicate) {
              let resolvedTarget: string | undefined;
              try {
                const opts = await getEntityOptionsForDuplicateCheck();
                const hit = opts.find((o) => normalizeNameForCompare(o.name) === normalizeNameForCompare(payeeName));
                if (hit) resolvedTarget = await resolveEntityId(spaceId, hit.id);
              } catch (_) {
                /* best-effort: UI needs targetId for Replace all (Merge) */
              }
              throw Object.assign(new Error(e.message), {
                code: 'ENTITY_NAME_EXISTS' as const,
                duplicateName: payeeName,
                ...(resolvedTarget ? { targetId: resolvedTarget } : {}),
              });
            }
          } else {
            console.warn('Failed to update entity name:', e);
          }
        }
      }
    }

    let accountId = receipt.accountId;
    if (!accountId && receipt.account) {
      const account = await findOrCreateAccount(receipt.account.name || receipt.account.id, true);
      accountId = account.id;
    }

    const updateData: any = {};
    if (entityId !== undefined) updateData.entity_id = entityId ?? null;
    if (receipt.totalAmount !== undefined) updateData.total_amount = receipt.totalAmount;
    if (receipt.currency !== undefined) updateData.currency = receipt.currency;
    if (receipt.tax !== undefined) updateData.tax = receipt.tax;
    if (receipt.taxBreakdown !== undefined) {
      if (receipt.taxBreakdown?.length) {
        let supplierAddress = receipt.entity?.address?.trim() || undefined;
        const eidForAddr = entityId ?? receipt.entityId ?? null;
        if (!supplierAddress && eidForAddr) {
          try {
            const rid = await resolveEntityId(spaceId, eidForAddr);
            supplierAddress = (await getEntityById(rid))?.address?.trim() || undefined;
          } catch {
            /* best-effort */
          }
        }
        try {
          const enriched = await resolveTaxBreakdownTaxKindIds(receipt.taxBreakdown, {
            currency: receipt.currency,
            currencyPrintedOnReceipt: receipt.currencyPrintedOnReceipt === true,
            supplierName: receipt.supplierName,
            supplierAddress,
            receiptDate: receipt.date,
          });
          updateData.tax_breakdown = shapeTaxBreakdownForDb(enriched);
        } catch (taxErr) {
          console.warn(
            '[updateReceipt] tax_breakdown resolve failed; saving coerced lines without tax_kind_id',
            taxErr,
          );
          updateData.tax_breakdown = shapeTaxBreakdownForDb(
            coerceReceiptTaxBreakdownEntries(receipt.taxBreakdown, null) ?? receipt.taxBreakdown,
          );
        }
      } else {
        updateData.tax_breakdown = null;
      }
    }
    if (receipt.date !== undefined) updateData.date = receipt.date;
    if (accountId !== undefined) updateData.account_id = accountId;
    if (receipt.status !== undefined) updateData.status = receipt.status;
    if (receipt.confidence !== undefined) updateData.confidence = receipt.confidence;
    if (receipt.imageUrl !== undefined) updateData.image_url = receipt.imageUrl;
    if (receipt.recognitionFailCount !== undefined) {
      updateData.recognition_fail_count = receipt.recognitionFailCount;
    }
    if (receipt.recognitionNotice !== undefined) {
      updateData.recognition_notice =
        receipt.recognitionNotice != null && String(receipt.recognitionNotice).trim()
          ? String(receipt.recognitionNotice).trim()
          : null;
    }

    const { data: updatedRows, error: receiptError } = await supabase
      .from('receipts')
      .update(updateData)
      .eq('id', receiptId)
      .eq('space_id', spaceId)
      .select('id');

    if (receiptError) throw receiptError;
    if (!updatedRows?.length) {
      throw new Error(`Receipt update matched no rows (id=${receiptId}, space_id=${spaceId})`);
    }

    if (receipt.items !== undefined) {
      await replaceReceiptItemsForReceipt(receiptId, receipt.items);
    }
  } catch (error: any) {
    if (error?.code === 'ENTITY_NAME_EXISTS') {
      if (autoResolveDuplicate) {
        console.warn('Unexpected duplicate name error in auto-resolve mode, ignoring:', error);
        return;
      }
      throw error;
    }
    console.error('Error updating receipt:', error);
    throw error;
  }
}

// 获取所有小票（当前家庭的）

/** 首屏极速加载：仅 receipts 表、limit 15、含 entity merge 解析，用于立即渲染为合并后名称，避免二次刷新 */
const FIRST_PAINT_LIMIT = 15;

export async function getReceiptsForListFirstPaint(): Promise<Receipt[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

    const { data, error } = await supabase
    .from('receipts')
    .select(`
      id, space_id, entity_id, total_amount, currency, tax, tax_breakdown, date, account_id, status, image_url, input_type, confidence, processed_by, recognition_notice, recognition_fail_count, created_at, updated_at, created_by,
      entities (id, name),
      created_by_user:users!created_by (id, email, name, current_space_id)
    `)
    .eq('space_id', spaceId)
    .order('created_at', { ascending: false })
    .limit(FIRST_PAINT_LIMIT);

  if (error) throw error;
  const rows = data || [];
  const entityMergeMap = await getEntityMergeMap(spaceId);
  const resolveEntity = (eid: string) => {
    let current = eid;
    const seen = new Set<string>();
    while (entityMergeMap.has(current) && !seen.has(current)) {
      seen.add(current);
      current = entityMergeMap.get(current)!;
    }
    return current;
  };
  const needResolved = new Set<string>();
  for (const row of rows) {
    if (row.entity_id) {
      const resolvedId = resolveEntity(row.entity_id);
      const ent = (row as any).entities;
      const joinedEntId = Array.isArray(ent) ? ent[0]?.id : ent?.id;
      if (joinedEntId !== resolvedId) needResolved.add(resolvedId);
    }
  }
  const resolvedEntityCache = new Map<string, Awaited<ReturnType<typeof getEntityById>>>();
  if (needResolved.size > 0) {
    await Promise.all(Array.from(needResolved).map(async (id) => {
      const e = await getEntityById(id);
      if (e) resolvedEntityCache.set(id, e);
    }));
  }
  return rows.map((row: any) => {
    const resolvedEntityId = row.entity_id ? resolveEntity(row.entity_id) : null;
    const entityRow = (resolvedEntityId ? resolvedEntityCache.get(resolvedEntityId) : null) ?? row.entities;
    const payeeName = entityRow?.name || '';
    return {
    id: row.id,
    spaceId: row.space_id,
    supplierName: payeeName,
    storeName: payeeName,
    entityId: row.entity_id ?? undefined,
    entity: entityRow ? { id: entityRow.id, spaceId: row.space_id, name: entityRow.name, isAiRecognized: false } : undefined,
    totalAmount: row.total_amount,
    currency: row.currency,
    tax: row.tax,
    taxBreakdown: mapRowTaxBreakdown(row),
    date: normalizeDate(row.date),
    accountId: row.account_id,
    account: row.account_id ? { id: row.account_id, spaceId, name: '', isAiRecognized: false, createdAt: '', updatedAt: '' } : undefined,
    status: row.status as ReceiptStatus,
    imageUrl: row.image_url,
    inputType: row.input_type || (row.image_url ? 'image' : 'text'),
    confidence: row.confidence,
    processedBy: row.processed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    createdByUser: row.created_by_user ? {
      id: row.created_by_user.id,
      email: row.created_by_user.email,
      name: row.created_by_user.name,
      spaceId: row.created_by_user.current_space_id,
    } : undefined,
    recognitionFailCount:
      row.recognition_fail_count != null ? Number(row.recognition_fail_count) : 0,
    recognitionNotice:
      row.recognition_notice != null && String(row.recognition_notice).trim()
        ? String(row.recognition_notice).trim()
        : undefined,
    items: [],
  };
  });
}

/** 获取当前空间下所有小票（列表用，含 merge 解析，不加载 items 明细） */
export async function getAllReceiptsForList(): Promise<Receipt[]> {
  try {
    console.log('📊 [getAllReceiptsForList] 开始查询小票数据（含 merge 解析）...');
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { data, error } = await supabase
      .from('receipts')
      .select(`
        *,
        entities (*),
        accounts (*),
        created_by_user:users!created_by (id, email, name, current_space_id)
      `)
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const rows = data || [];
    const [entityMergeMap, accountMergeMap] = await Promise.all([
      getEntityMergeMap(spaceId),
      getAccountMergeMap(spaceId),
    ]);

    const resolveEntity = (eid: string) => {
      let current = eid;
      const seen = new Set<string>();
      while (entityMergeMap.has(current) && !seen.has(current)) {
        seen.add(current);
        current = entityMergeMap.get(current)!;
      }
      return current;
    };
    const resolveAccount = (aid: string) => {
      let current = aid;
      const seen = new Set<string>();
      while (accountMergeMap.has(current) && !seen.has(current)) {
        seen.add(current);
        current = accountMergeMap.get(current)!;
      }
      return current;
    };

    // 优化：只查询 join 中缺失的数据
    const needResolvedEntity = new Set<string>();
    const needResolvedAccount = new Set<string>();
    for (const row of rows) {
      if (row.entity_id) {
        const resolvedId = resolveEntity(row.entity_id);
        const ent = (row as any).entities;
        const joinedEntId = Array.isArray(ent) ? ent[0]?.id : ent?.id;
        if (joinedEntId !== resolvedId) needResolvedEntity.add(resolvedId);
      }
      if (row.account_id) {
        const resolvedId = resolveAccount(row.account_id);
        const acc = (row as any).accounts;
        const joinedAccId = Array.isArray(acc) ? acc[0]?.id : acc?.id;
        if (joinedAccId !== resolvedId) needResolvedAccount.add(resolvedId);
      }
    }

    const [resolvedEntityCache, resolvedAccountCache] = await Promise.all([
      needResolvedEntity.size > 0 ? (async () => {
        const m = new Map<string, Awaited<ReturnType<typeof getEntityById>>>();
        await Promise.all(Array.from(needResolvedEntity).map(async (id) => {
          const e = await getEntityById(id);
          if (e) m.set(id, e);
        }));
        return m;
      })() : Promise.resolve(new Map()),
      needResolvedAccount.size > 0 ? (async () => {
        const m = new Map<string, Awaited<ReturnType<typeof getAccountById>>>();
        await Promise.all(Array.from(needResolvedAccount).map(async (id) => {
          const a = await getAccountById(id);
          if (a) m.set(id, a);
        }));
        return m;
      })() : Promise.resolve(new Map()),
    ]);

    const mappedReceipts = rows.map((row: any) => {
      const resolvedEntityId = row.entity_id ? resolveEntity(row.entity_id) : null;
      const resolvedAccountId = row.account_id ? resolveAccount(row.account_id) : null;
      const entityRow = (resolvedEntityId ? resolvedEntityCache.get(resolvedEntityId) : null) ?? row.entities;
      const accountRow = (resolvedAccountId ? resolvedAccountCache.get(resolvedAccountId) : null) ?? row.accounts;
      const payeeName = entityRow?.name ?? '';
      return {
        id: row.id,
        spaceId: row.space_id,
        supplierName: payeeName,
        storeName: payeeName,
        entityId: row.entity_id ?? undefined,
        entity: entityRow ? {
          id: entityRow.id,
          spaceId: entityRow.spaceId,
          name: entityRow.name,
          taxNumber: entityRow.taxNumber,
          phone: entityRow.phone,
          address: entityRow.address,
          isAiRecognized: entityRow.isAiRecognized,
          mergedIntoId: entityRow.mergedIntoId,
          createdAt: entityRow.createdAt,
          updatedAt: entityRow.updatedAt,
        } : undefined,
        totalAmount: row.total_amount,
        currency: row.currency,
        tax: row.tax,
        taxBreakdown: mapRowTaxBreakdown(row),
        date: normalizeDate(row.date),
        accountId: row.account_id,
        account: accountRow ? {
          id: accountRow.id,
          spaceId: (accountRow as any).space_id ?? accountRow.spaceId,
          name: accountRow.name,
          isAiRecognized: (accountRow as any).is_ai_recognized ?? accountRow.isAiRecognized,
          createdAt: (accountRow as any).created_at ?? accountRow.createdAt,
          updatedAt: (accountRow as any).updated_at ?? accountRow.updatedAt,
        } : undefined,
        status: row.status as ReceiptStatus,
        imageUrl: row.image_url,
        inputType: row.input_type || (row.image_url ? 'image' : 'text'),
        confidence: row.confidence,
        processedBy: row.processed_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        createdBy: row.created_by,
        createdByUser: row.created_by_user ? {
          id: row.created_by_user.id,
          email: row.created_by_user.email,
          name: row.created_by_user.name,
          spaceId: row.created_by_user.current_space_id,
        } : undefined,
        recognitionFailCount:
          row.recognition_fail_count != null ? Number(row.recognition_fail_count) : 0,
        recognitionNotice:
          row.recognition_notice != null && String(row.recognition_notice).trim()
            ? String(row.recognition_notice).trim()
            : undefined,
        items: [], // 列表页不加载 items，提升性能
      };
    });
    
    console.log(`✅ [getAllReceiptsForList] 数据映射完成，返回 ${mappedReceipts.length} 条小票（轻量级）`);
    return mappedReceipts;
  } catch (error) {
    console.error('❌ [getAllReceiptsForList] 查询失败:', error);
    throw error;
  }
}

/** 获取当前空间下所有小票（完整数据，包含 items，用于详情页等需要完整数据的场景） */
export async function getAllReceipts(): Promise<Receipt[]> {
  try {
    console.log('📊 [getAllReceipts] 开始查询小票数据（完整数据）...');
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const receiptItemsWithCategoriesOnly = `
        receipt_items (
          *,
          categories (*)
        )`;
    const queryReceiptsWithItems = () =>
      supabase
        .from('receipts')
        .select(`
        *,
        entities (*),
        accounts (*),
        created_by_user:users!created_by (
          id,
          email,
          name,
          current_space_id
        ),
        receipt_items (
          *,
          categories (*),
          attributions (*)
        )
      `)
        .eq('space_id', spaceId)
        .order('created_at', { ascending: false })
        .order('created_at', { foreignTable: 'receipt_items', ascending: true });

    const queryReceiptsItemsNoAttributionEmbed = () =>
      supabase
        .from('receipts')
        .select(`
        *,
        entities (*),
        accounts (*),
        created_by_user:users!created_by (
          id,
          email,
          name,
          current_space_id
        ),
        ${receiptItemsWithCategoriesOnly}
      `)
        .eq('space_id', spaceId)
        .order('created_at', { ascending: false })
        .order('created_at', { foreignTable: 'receipt_items', ascending: true });

    let { data, error } = await queryReceiptsWithItems();
    let attributionLookup: Map<string, any> | null = null;
    if (error && isMissingNestedAttributionEmbedError(error, 'receipt_items')) {
      const plain = await queryReceiptsItemsNoAttributionEmbed();
      data = plain.data;
      error = plain.error;
      if (!error && data?.length) {
        attributionLookup = await fetchAttributionRowsMapForSpace(spaceId, collectAttributionIdsFromReceiptRows(data));
      }
    }

    if (error) throw error;

    const [entityMergeMap, accountMergeMap] = await Promise.all([
      getEntityMergeMap(spaceId),
      getAccountMergeMap(spaceId),
    ]);
    const resolveEntity = (eid: string) => {
      let current = eid;
      const seen = new Set<string>();
      while (entityMergeMap.has(current) && !seen.has(current)) {
        seen.add(current);
        current = entityMergeMap.get(current)!;
      }
      return current;
    };
    const resolveAccount = (aid: string) => {
      let current = aid;
      const seen = new Set<string>();
      while (accountMergeMap.has(current) && !seen.has(current)) {
        seen.add(current);
        current = accountMergeMap.get(current)!;
      }
      return current;
    };

    const rows = data || [];
    const needResolvedEntity = new Set<string>();
    const needResolvedAccount = new Set<string>();
    for (const row of rows) {
      if (row.entity_id) {
        const resolvedId = resolveEntity(row.entity_id);
        const ent = (row as any).entities;
        const joinedEntId = Array.isArray(ent) ? ent[0]?.id : ent?.id;
        if (joinedEntId !== resolvedId) needResolvedEntity.add(resolvedId);
      }
      if (row.account_id) {
        const resolvedId = resolveAccount(row.account_id);
        const acc = (row as any).accounts;
        const joinedAccId = Array.isArray(acc) ? acc[0]?.id : acc?.id;
        if (joinedAccId !== resolvedId) needResolvedAccount.add(resolvedId);
      }
    }
    const [resolvedEntityCache, resolvedAccountCache] = await Promise.all([
      needResolvedEntity.size > 0 ? (async () => {
        const m = new Map<string, Awaited<ReturnType<typeof getEntityById>>>();
        await Promise.all(Array.from(needResolvedEntity).map(async (id) => {
          const e = await getEntityById(id);
          if (e) m.set(id, e);
        }));
        return m;
      })() : Promise.resolve(new Map()),
      needResolvedAccount.size > 0 ? (async () => {
        const m = new Map<string, Awaited<ReturnType<typeof getAccountById>>>();
        await Promise.all(Array.from(needResolvedAccount).map(async (id) => {
          const a = await getAccountById(id);
          if (a) m.set(id, a);
        }));
        return m;
      })() : Promise.resolve(new Map()),
    ]);

    const mappedReceipts = rows.map((row: any) => {
      const resolvedEntityId = row.entity_id ? resolveEntity(row.entity_id) : null;
      const resolvedAccountId = row.account_id ? resolveAccount(row.account_id) : null;
      const entityRow = (resolvedEntityId ? resolvedEntityCache.get(resolvedEntityId) : null) ?? row.entities;
      const accountRow = (resolvedAccountId ? resolvedAccountCache.get(resolvedAccountId) : null) ?? row.accounts;
      const payeeName = entityRow?.name ?? '';
      return {
        id: row.id,
        spaceId: row.space_id,
        supplierName: payeeName,
        storeName: payeeName,
        entityId: row.entity_id ?? undefined,
        entity: entityRow ? {
          id: entityRow.id,
          spaceId: entityRow.spaceId,
          name: entityRow.name,
          taxNumber: entityRow.taxNumber,
          phone: entityRow.phone,
          address: entityRow.address,
          isAiRecognized: entityRow.isAiRecognized,
          mergedIntoId: entityRow.mergedIntoId,
          createdAt: entityRow.createdAt,
          updatedAt: entityRow.updatedAt,
        } : undefined,
        totalAmount: row.total_amount,
        currency: row.currency,
        tax: row.tax,
        taxBreakdown: mapRowTaxBreakdown(row),
        date: normalizeDate(row.date),
        accountId: row.account_id,
        account: accountRow ? {
          id: accountRow.id,
          spaceId: (accountRow as any).space_id ?? accountRow.spaceId,
          name: accountRow.name,
          isAiRecognized: (accountRow as any).is_ai_recognized ?? accountRow.isAiRecognized,
          createdAt: (accountRow as any).created_at ?? accountRow.createdAt,
          updatedAt: (accountRow as any).updated_at ?? accountRow.updatedAt,
        } : undefined,
        status: row.status as ReceiptStatus,
        imageUrl: row.image_url,
        inputType: row.input_type || (row.image_url ? 'image' : 'text'),
        confidence: row.confidence,
        processedBy: row.processed_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        createdBy: row.created_by,
        createdByUser: row.created_by_user ? {
          id: row.created_by_user.id,
          email: row.created_by_user.email,
          name: row.created_by_user.name,
          spaceId: row.created_by_user.current_space_id,
        } : undefined,
        recognitionFailCount:
          row.recognition_fail_count != null ? Number(row.recognition_fail_count) : 0,
        recognitionNotice:
          row.recognition_notice != null && String(row.recognition_notice).trim()
            ? String(row.recognition_notice).trim()
            : undefined,
        items: (row.receipt_items || []).map((item: any) => {
          const attrId = receiptItemAttributionRefId(item);
          const attributionRow =
            item.attributions ?? (attrId && attributionLookup?.get(attrId));
          return {
          id: item.id,
          name: item.name,
          itemAlias: item.item_alias ?? undefined,
          categoryId: item.category_id,
          category: item.categories ? {
            id: item.categories.id,
            spaceId: item.categories.space_id,
            name: item.categories.name,
            color: item.categories.color,
            isDefault: item.categories.is_default,
            createdAt: item.categories.created_at,
            updatedAt: item.categories.updated_at,
          } : undefined,
          attributionId: attrId,
          attribution: attributionRow ? {
            id: attributionRow.id,
            spaceId: attributionRow.space_id,
            name: attributionRow.name,
            color: attributionRow.color,
            isDefault: attributionRow.is_default,
            createdAt: attributionRow.created_at,
            updatedAt: attributionRow.updated_at,
          } : undefined,
          price: item.price,
          isAsset: item.is_asset,
          confidence: item.confidence,
        };
        }),
      };
    });
    
    console.log(`✅ [getAllReceipts] 数据映射完成，返回 ${mappedReceipts.length} 条小票（完整数据）`);
    return mappedReceipts;
  } catch (error) {
    console.error('❌ [getAllReceipts] 查询失败:', error);
    throw error;
  }
}

/** 当前空间下所有 receipt_items（含小票币种、Payee、交易时间），供 Web 明细表使用 */
export async function getAllReceiptLineItemsForList(): Promise<ReceiptLineItemListRow[]> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const selectWithAttr = `
      *,
      receipts!inner (
        id,
        date,
        currency,
        space_id,
        entities (
          id,
          name
        )
      ),
      categories (*),
      attributions (*)
    `;
    const selectNoAttr = `
      *,
      receipts!inner (
        id,
        date,
        currency,
        space_id,
        entities (
          id,
          name
        )
      ),
      categories (*)
    `;

    let { data, error } = await supabase
      .from('receipt_items')
      .select(selectWithAttr)
      .eq('receipts.space_id', spaceId);

    let attributionLookup: Map<string, any> | null = null;
    if (error && isMissingNestedAttributionEmbedError(error, 'receipt_items')) {
      const plain = await supabase.from('receipt_items').select(selectNoAttr).eq('receipts.space_id', spaceId);
      data = plain.data;
      error = plain.error;
      if (!error && data?.length) {
        attributionLookup = await fetchAttributionRowsMapForSpace(
          spaceId,
          collectAttributionIdsFromReceiptItemRows(data)
        );
      }
    }

    if (error) throw error;

    const rows = data || [];
    const mapCategory = (c: any) =>
      c
        ? {
            id: c.id,
            spaceId: c.space_id,
            name: c.name,
            color: c.color,
            isDefault: c.is_default,
            scope: c.scope,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
          }
        : undefined;

    const mapAttribution = (a: any) =>
      a
        ? {
            id: a.id,
            spaceId: a.space_id,
            name: a.name,
            color: a.color,
            isDefault: a.is_default,
            scope: a.scope,
            createdAt: a.created_at,
            updatedAt: a.updated_at,
          }
        : undefined;

    const mapped: ReceiptLineItemListRow[] = rows.map((row: any) => {
      const rec = row.receipts;
      const payeeName = rec?.entities?.name ?? '';
      const attrId = receiptItemAttributionRefId(row);
      const attributionRow =
        row.attributions ?? (attrId && attributionLookup?.get(attrId));
      return {
        id: String(row.id),
        name: row.name || '—',
        price: Number(row.price) || 0,
        currency: rec?.currency || 'USD',
        categoryId: row.category_id ? String(row.category_id) : '',
        attributionId: attrId,
        category: mapCategory(row.categories),
        attribution: mapAttribution(attributionRow) ?? null,
        isAsset: !!row.is_asset,
        receiptId: String(rec?.id ?? row.receipt_id ?? ''),
        payeeName,
        receiptDate: normalizeDate(rec?.date),
      };
    });

    mapped.sort((a, b) => {
      const da = a.receiptDate || '';
      const db = b.receiptDate || '';
      if (da !== db) return db.localeCompare(da);
      return (a.name || '').localeCompare(b.name || '');
    });

    return mapped;
  } catch (error) {
    console.error('❌ [getAllReceiptLineItemsForList] 查询失败:', error);
    throw error;
  }
}

// 更新单个商品项的某个字段
export async function updateReceiptItem(
  receiptId: string,
  itemId: string,
  field: 'categoryId' | 'attributionId' | 'isAsset',
  value: any
): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    // 构建更新数据
    const updateData: any = {};
    if (field === 'categoryId') {
      updateData.category_id = value;
    } else if (field === 'attributionId') {
      updateData.attribution_id = value;
    } else if (field === 'isAsset') {
      updateData.is_asset = value;
    }

    // 更新商品项（直接使用 itemId，不依赖索引）
    const { error } = await supabase
      .from('receipt_items')
      .update(updateData)
      .eq('id', itemId)
      .eq('receipt_id', receiptId);

    if (error) throw error;
  } catch (error) {
    console.error('Error updating receipt item:', error);
    throw error;
  }
}

// 获取用户历史小票中最频繁的币种
export async function getMostFrequentCurrency(): Promise<string | null> {
  const currencies = await getCurrenciesByUsage();
  return currencies.length > 0 ? currencies[0] : null;
}

// 获取用户历史小票中所有币种（按使用频率降序排列）
export async function getCurrenciesByUsage(): Promise<string[]> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    // 优先使用 currentSpaceId，如果没有则使用 spaceId（向后兼容）
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    // 查询当前家庭的所有小票，统计币种出现频次
    const { data, error } = await supabase
      .from('receipts')
      .select('currency')
      .eq('space_id', spaceId)
      .not('currency', 'is', null);

    if (error) {
      console.warn('Error fetching currency statistics:', error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // 统计币种出现频次
    const currencyCount: Record<string, number> = {};
    data.forEach((receipt: any) => {
      const currency = receipt.currency;
      if (currency) {
        currencyCount[currency] = (currencyCount[currency] || 0) + 1;
      }
    });

    // 按使用频率降序排列
    const sortedCurrencies = Object.entries(currencyCount)
      .sort((a, b) => b[1] - a[1])
      .map(([currency]) => currency);

    return sortedCurrencies;
  } catch (error) {
    console.warn('Error getting currencies by usage:', error);
    return [];
  }
}

// 根据ID获取小票
export async function getReceiptById(receiptId: string): Promise<Receipt | null> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    // 优先使用 currentSpaceId，如果没有则使用 spaceId（向后兼容）
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const queryWithAttributionEmbed = () =>
      supabase
        .from('receipts')
        .select(`
          *,
          entities (*),
          accounts (*),
          created_by_user:users!created_by (
            id,
            email,
            name,
            current_space_id
          ),
          receipt_items (
            *,
            categories (*),
            attributions (*)
          )
        `)
        .eq('id', receiptId)
        .eq('space_id', spaceId)
        .order('created_at', { foreignTable: 'receipt_items', ascending: true })
        .single();

    const queryPlainSingle = () =>
      supabase
        .from('receipts')
        .select(`
          *,
          entities (*),
          accounts (*),
          created_by_user:users!created_by (
            id,
            email,
            name,
            current_space_id
          ),
          receipt_items (
            *,
            categories (*)
          )
        `)
        .eq('id', receiptId)
        .eq('space_id', spaceId)
        .order('created_at', { foreignTable: 'receipt_items', ascending: true })
        .single();

    let { data, error } = await queryWithAttributionEmbed();
    let attributionLookupById: Map<string, any> | null = null;
    if (error && isMissingNestedAttributionEmbedError(error, 'receipt_items')) {
      const plain = await queryPlainSingle();
      data = plain.data;
      error = plain.error;
      if (!error && data) {
        attributionLookupById = await fetchAttributionRowsMapForSpace(spaceId, collectAttributionIdsFromReceiptRows([data]));
      }
    }

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }
    if (!data) return null;

    let entityRow: Awaited<ReturnType<typeof getEntityById>> | undefined;
    if (data.entity_id) {
      const resolvedId = await resolveEntityId(spaceId, data.entity_id);
      entityRow = (await getEntityById(resolvedId)) ?? undefined;
    }
    if (!entityRow && data.entities) entityRow = data.entities as any;

    let accountRow: Awaited<ReturnType<typeof getAccountById>> | undefined;
    if (data.account_id) {
      const accountMergeMap = await getAccountMergeMap(spaceId);
      let current = data.account_id;
      const seen = new Set<string>();
      while (accountMergeMap.has(current) && !seen.has(current)) {
        seen.add(current);
        current = accountMergeMap.get(current)!;
      }
      accountRow = (await getAccountById(current)) ?? undefined;
    }
    if (!accountRow && data.accounts) accountRow = data.accounts;

    const payeeName = entityRow?.name ?? '';
    return {
      id: data.id,
      spaceId: data.space_id,
      supplierName: payeeName,
      storeName: payeeName,
      entityId: data.entity_id ?? undefined,
      entity: entityRow ? {
        id: entityRow.id,
        spaceId: (entityRow as any).space_id ?? entityRow.spaceId,
        name: entityRow.name,
        taxNumber: (entityRow as any).tax_number ?? entityRow.taxNumber,
        phone: entityRow.phone,
        address: entityRow.address,
        isAiRecognized: (entityRow as any).is_ai_recognized ?? entityRow.isAiRecognized,
        mergedIntoId: (entityRow as any).merged_into_id ?? entityRow.mergedIntoId,
        createdAt: (entityRow as any).created_at ?? entityRow.createdAt,
        updatedAt: (entityRow as any).updated_at ?? entityRow.updatedAt,
      } : undefined,
      totalAmount: data.total_amount,
      currency: data.currency,
      tax: data.tax,
      taxBreakdown: mapRowTaxBreakdown(data),
      date: normalizeDate(data.date),
      accountId: data.account_id,
      account: accountRow ? {
        id: accountRow.id,
        spaceId: (accountRow as any).space_id ?? accountRow.spaceId,
        name: accountRow.name,
        isAiRecognized: (accountRow as any).is_ai_recognized ?? accountRow.isAiRecognized,
        createdAt: (accountRow as any).created_at ?? accountRow.createdAt,
        updatedAt: (accountRow as any).updated_at ?? accountRow.updatedAt,
      } : undefined,
      status: data.status as ReceiptStatus,
      imageUrl: data.image_url,
      inputType: data.input_type || (data.image_url ? 'image' : 'text'),
      confidence: data.confidence,
      processedBy: data.processed_by,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      createdBy: data.created_by,
      createdByUser: data.created_by_user ? {
        id: data.created_by_user.id,
        email: data.created_by_user.email,
        name: data.created_by_user.name,
        spaceId: data.created_by_user.current_space_id,
      } : undefined,
      recognitionFailCount:
        data.recognition_fail_count != null ? Number(data.recognition_fail_count) : 0,
      recognitionNotice:
        data.recognition_notice != null && String(data.recognition_notice).trim()
          ? String(data.recognition_notice).trim()
          : undefined,
      items: (data.receipt_items || []).map((item: any) => {
        const attrId = receiptItemAttributionRefId(item);
        const attributionRow =
          item.attributions ??
          (attrId && attributionLookupById?.get(attrId));
        return {
        id: item.id,
        name: item.name,
        itemAlias: item.item_alias ?? undefined,
        categoryId: item.category_id,
        category: item.categories ? {
          id: item.categories.id,
          spaceId: item.categories.space_id,
          name: item.categories.name,
          color: item.categories.color,
          isDefault: item.categories.is_default,
          createdAt: item.categories.created_at,
          updatedAt: item.categories.updated_at,
        } : undefined,
        attributionId: attrId,
        attribution: attributionRow ? {
          id: attributionRow.id,
          spaceId: attributionRow.space_id,
          name: attributionRow.name,
          color: attributionRow.color,
          isDefault: attributionRow.is_default,
          createdAt: attributionRow.created_at,
          updatedAt: attributionRow.updated_at,
        } : undefined,
        price: item.price,
        isAsset: item.is_asset,
        confidence: item.confidence,
      };
      }),
    };
  } catch (error) {
    console.error('Error fetching receipt:', error);
    throw error;
  }
}

// 删除小票
export async function deleteReceipt(receiptId: string): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    // 优先使用 currentSpaceId，如果没有则使用 spaceId（向后兼容）
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    // 先获取小票信息，以便删除关联的文件和清理孤立数据
    const receipt = await getReceiptById(receiptId);
    if (!receipt) {
      console.warn('Receipt not found, nothing to delete');
      return;
    }

    const entityId = receipt.entityId;
    const accountId = receipt.accountId;

    // 1. 删除关联的图片
    if (receipt.imageUrl) {
      try {
        const urlParts = receipt.imageUrl.split('/');
        const lastPart = urlParts[urlParts.length - 1];
        const fileName = lastPart.split('?')[0];

        let filePaths: string[] = [];
        if (fileName && fileName.length > 0) {
          filePaths.push(fileName);
        }

        // 备选：使用 receiptId 构建可能的文件名
        const extensions = ['jpg', 'jpeg', 'png', 'webp'];
        for (const ext of extensions) {
          const testPath = `${receiptId}.${ext}`;
          if (!filePaths.includes(testPath)) {
            filePaths.push(testPath);
          }
        }

        if (filePaths.length > 0) {
          const { error: storageError } = await supabase.storage
            .from('receipts')
            .remove(filePaths);

          if (storageError) {
            console.warn('Failed to delete image from storage:', storageError);
          } else {
            console.log('Successfully deleted image(s):', filePaths);
          }
        }
      } catch (imageError) {
        console.warn('Error deleting image:', imageError);
      }
    }

    // 2. 删除关联的录音文件（从 ai_chat_logs 获取）
    try {
      const { data: chatLogs } = await supabase
        .from('ai_chat_logs')
        .select('audio_url')
        .eq('receipt_id', receiptId)
        .not('audio_url', 'is', null);

      if (chatLogs && chatLogs.length > 0) {
        const audioFilePaths: string[] = [];
        for (const log of chatLogs) {
          if (log.audio_url) {
            // 从 URL 提取文件名
            const urlParts = log.audio_url.split('/');
            const fileName = urlParts[urlParts.length - 1].split('?')[0];
            if (fileName) {
              audioFilePaths.push(fileName);
            }
          }
        }

        if (audioFilePaths.length > 0) {
          const { error: audioError } = await supabase.storage
            .from('chat-audio')
            .remove(audioFilePaths);

          if (audioError) {
            console.warn('Failed to delete audio from storage:', audioError);
          } else {
            console.log('Successfully deleted audio file(s):', audioFilePaths);
          }
        }
      }
    } catch (audioError) {
      console.warn('Error deleting audio files:', audioError);
    }

    // 3. 删除小票记录（会级联删除商品项）
    const { error } = await supabase
      .from('receipts')
      .delete()
      .eq('id', receiptId)
      .eq('space_id', spaceId);

    if (error) throw error;

    // 4. 清理孤立的关联方（如果未被其他小票引用）
    if (entityId) {
      try {
        const { count: entityRefCount } = await supabase
          .from('receipts')
          .select('id', { count: 'exact', head: true })
          .eq('entity_id', entityId);

        if (entityRefCount === 0) {
          const { count: pointedCount } = await supabase
            .from('entities')
            .select('id', { count: 'exact', head: true })
            .eq('merged_into_id', entityId);

          if (!pointedCount || pointedCount === 0) {
            const { error: deleteEntityError } = await supabase
              .from('entities')
              .delete()
              .eq('id', entityId);

            if (deleteEntityError) {
              console.warn('Failed to delete orphan entity:', deleteEntityError);
            } else {
              console.log('Deleted orphan entity:', entityId);
            }
          }
        }
      } catch (entityError) {
        console.warn('Error cleaning up entity:', entityError);
      }
    }

    // 5. 清理孤立的账户（若未被 receipts/invoices 引用）
    if (accountId) {
      try {
        const { count: receiptRefCount } = await supabase
          .from('receipts')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', accountId);
        const { count: invoiceRefCount } = await supabase
          .from('invoices')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', accountId);

        if (receiptRefCount === 0 && invoiceRefCount === 0) {
          const { count: pointedCount } = await supabase
            .from('accounts')
            .select('id', { count: 'exact', head: true })
            .eq('merged_into_id', accountId);
          if (!pointedCount || pointedCount === 0) {
            const { error: deleteAccountError } = await supabase
              .from('accounts')
              .delete()
              .eq('id', accountId);
            if (deleteAccountError) {
              console.warn('Failed to delete orphan account:', deleteAccountError);
            } else {
              console.log('Deleted orphan account:', accountId);
            }
          }
        }
      } catch (accountError) {
        console.warn('Error cleaning up account:', accountError);
      }
    }

    console.log('Receipt deleted successfully with cleanup:', receiptId);
  } catch (error) {
    console.error('Error deleting receipt:', error);
    throw error;
  }
}
