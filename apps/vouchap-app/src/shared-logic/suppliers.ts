import { supabase } from './supabase';
import { Supplier } from '@/types';
import { getCurrentUser } from './auth';
import { normalizeNameForCompare } from './name-utils';

// 获取当前空间的所有供应商（仅展示“无指向”的，即未被合并的）
export async function getSuppliers(): Promise<Supplier[]> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { data, error } = await supabase
      .from('entities')
      .select('*')
      .eq('space_id', spaceId)
      .is('merged_into_id', null)
      .order('is_ai_recognized', { ascending: false })
      .order('name', { ascending: true });

    if (error) throw error;

    return (data || []).map((row: any) => mapSupplierRow(row));
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    throw error;
  }
}

/** 获取全部供应商（含已合并指向的），供选单与大模型选项用 */
export async function getSuppliersForOptions(): Promise<Supplier[]> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { data, error } = await supabase
      .from('entities')
      .select('*')
      .eq('space_id', spaceId)
      .order('is_ai_recognized', { ascending: false })
      .order('name', { ascending: true });

    if (error) throw error;

    return (data || []).map((row: any) => mapSupplierRow(row));
  } catch (error) {
    console.error('Error fetching suppliers for options:', error);
    throw error;
  }
}

function mapSupplierRow(row: any): Supplier {
  return {
    id: row.id,
    spaceId: row.space_id,
    name: row.name,
    taxNumber: row.tax_number,
    phone: row.phone,
    address: row.address,
    isAiRecognized: row.is_ai_recognized,
    isCustomer: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// 创建供应商（写入 entities 表）
export async function createSupplier(
  name: string,
  isAiRecognized: boolean = false,
  taxNumber?: string,
  phone?: string,
  address?: string,
  _isCustomer: boolean = false
): Promise<Supplier> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { data, error } = await supabase
      .from('entities')
      .insert({
        space_id: spaceId,
        name: name.trim(),
        tax_number: taxNumber?.trim() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        is_ai_recognized: isAiRecognized,
      })
      .select('*')
      .single();

    if (error) {
      // 如果是因为名称重复导致的数据库约束错误（23505），尝试查找已存在的供应商并返回
      // 这种情况可能发生在并发场景：两个请求同时调用 findOrCreateSupplier，都找不到已存在的，然后都尝试创建
      if (error.code === '23505' && error.message?.includes('name') || error.message?.includes('供应商')) {
        console.log('供应商名称已存在（数据库约束），尝试查找已存在的供应商:', name.trim());
        const { data: existingSupplier } = await supabase
          .from('entities')
          .select('*')
          .eq('space_id', spaceId)
          .eq('name', name.trim())
          .single();
        if (existingSupplier) {
          console.log('找到已存在的供应商，返回:', existingSupplier.id);
          return mapSupplierRow(existingSupplier);
        }
      }
      throw error;
    }

    return mapSupplierRow(data);
  } catch (error) {
    console.error('Error creating supplier:', error);
    throw error;
  }
}

// 更新供应商（仅更新 suppliers 表，不创建/删除 customers 行）
export async function updateSupplier(
  supplierId: string,
  updates: {
    name?: string;
    taxNumber?: string;
    phone?: string;
    address?: string;
    isCustomer?: boolean;
  }
): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    // 改名称时：先按规范化名称检查是否与同空间其他供应商一致（含已合并），一致则抛错供管理页弹 维持/合并
    if (updates.name !== undefined) {
      const trimmedName = updates.name.trim();
      if (trimmedName.length > 0) {
        const all = await getSuppliersForOptions();
        const found = all.find((o) => normalizeNameForCompare(o.name) === normalizeNameForCompare(trimmedName));
        if (found) {
          const currentResolved = await resolveSupplierId(spaceId, supplierId);
          const targetResolved = await resolveSupplierId(spaceId, found.id);
          if (currentResolved !== targetResolved) {
            throw Object.assign(new Error('供应商名称已存在'), {
              code: 'SUPPLIER_NAME_EXISTS' as const,
              duplicateName: trimmedName,
              targetId: targetResolved,
              targetSource: 'supplier' as const,
            });
          }
        }
      }
    }

    const updateData: any = {};
    if (updates.name !== undefined) updateData.name = updates.name.trim();
    if (updates.taxNumber !== undefined) updateData.tax_number = updates.taxNumber?.trim() || null;
    if (updates.phone !== undefined) updateData.phone = updates.phone?.trim() || null;
    if (updates.address !== undefined) updateData.address = updates.address?.trim() || null;
    const { data: updated, error } = await supabase
      .from('entities')
      .update(updateData)
      .eq('id', supplierId)
      .eq('space_id', spaceId)
      .select('id')
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        console.warn('Supplier name already exists in this space:', error.message);
        throw new Error('供应商名称已存在');
      }
      throw error;
    }
    if (updated == null) {
      throw new Error('未找到要更新的供应商，请刷新后重试');
    }
  } catch (error) {
    if (error instanceof Error && error.message === '供应商名称已存在') throw error;
    console.error('Error updating supplier:', error);
    throw error;
  }
}

// 删除供应商
export async function deleteSupplier(supplierId: string): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    // 优先使用 currentSpaceId，如果没有则使用 spaceId（向后兼容）
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { error } = await supabase
      .from('entities')
      .delete()
      .eq('id', supplierId)
      .eq('space_id', spaceId);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting supplier:', error);
    throw error;
  }
}

// 标准化供应商名称（用于匹配）
function normalizeSupplierName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ') // 多个空格合并为一个
    .replace(/[：:]/g, ':') // 统一冒号
    .replace(/有限公司/g, '') // 移除常见后缀
    .replace(/股份有限公司/g, '')
    .replace(/有限责任公司/g, '')
    .replace(/公司/g, '')
    .replace(/商店/g, '')
    .replace(/超市/g, '')
    .replace(/商场/g, '');
}

// 检查供应商名称是否有效（排除处理状态等无效名称）
function isValidSupplierName(name: string): boolean {
  const trimmed = name.trim().toLowerCase();
  // 排除处理状态、占位符等无效名称
  const invalidNames = [
    'processing',
    'processing...',
    'pending',
    'pending...',
    'loading',
    'loading...',
    '识别中',
    '处理中',
    '待处理',
    '',
  ];
  return trimmed.length > 0 && !invalidNames.includes(trimmed);
}

// 根据名称查找或创建供应商（用于AI识别）
export async function findOrCreateSupplier(
  name: string,
  isAiRecognized: boolean = true,
  taxNumber?: string,
  phone?: string,
  address?: string
): Promise<Supplier> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const trimmedName = name.trim();
    if (!trimmedName || !isValidSupplierName(trimmedName)) {
      throw new Error('Invalid supplier name: Supplier name cannot be empty or a processing status');
    }

    // 优先使用 currentSpaceId，如果没有则使用 spaceId（向后兼容）
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    // 获取所有供应商
    const { data: allSuppliers, error: fetchError } = await supabase
      .from('entities')
      .select('*')
      .eq('space_id', spaceId);

    if (fetchError) throw fetchError;

    // 如果没有现有商家，直接创建
    if (!allSuppliers || allSuppliers.length === 0) {
      return await createSupplier(trimmedName, isAiRecognized, taxNumber, phone, address);
    }

    const normalizedName = normalizeSupplierName(trimmedName);

    // 0. 优先检查合并历史记录（用户手动合并的商家应自动归并）
    const mergeHistory = await getMergeHistory();
    const mergedTargetId = mergeHistory.get(normalizedName);
    if (mergedTargetId) {
      const mergedSupplier = allSuppliers.find(supplier => supplier.id === mergedTargetId);
      if (mergedSupplier) {
        console.log(`Found merged supplier in history: "${trimmedName}" -> "${mergedSupplier.name}"`);
        // 如果新识别的信息更完整，更新商家信息
        const shouldUpdate =
          (taxNumber && !mergedSupplier.tax_number) ||
          (phone && !mergedSupplier.phone) ||
          (address && !mergedSupplier.address);
        
        if (shouldUpdate) {
          try {
            await updateSupplier(mergedSupplier.id, {
              taxNumber: taxNumber || mergedSupplier.tax_number,
              phone: phone || mergedSupplier.phone,
              address: address || mergedSupplier.address,
            });
          } catch (error: any) {
            // 如果更新时遇到名称重复，静默处理（后台处理场景，不应该因为名称重复而失败）
            if (error?.code === 'SUPPLIER_NAME_EXISTS' || error?.message === '供应商名称已存在') {
              console.log('供应商名称已存在，跳过更新（使用已存在的供应商）');
            } else {
              throw error; // 其他错误继续抛出
            }
          }
          // 重新获取更新后的商家信息
          const { data: updatedSupplier } = await supabase
            .from('entities')
            .select('*')
            .eq('id', mergedSupplier.id)
            .single();
          if (updatedSupplier) {
            return {
              id: updatedSupplier.id,
              spaceId: updatedSupplier.space_id,
              name: updatedSupplier.name,
              taxNumber: updatedSupplier.tax_number,
              phone: updatedSupplier.phone,
              address: updatedSupplier.address,
              isAiRecognized: updatedSupplier.is_ai_recognized,
              createdAt: updatedSupplier.created_at,
              updatedAt: updatedSupplier.updated_at,
            };
          }
        }
        
        return {
          id: mergedSupplier.id,
          spaceId: mergedSupplier.space_id,
          name: mergedSupplier.name,
          taxNumber: mergedSupplier.tax_number,
          phone: mergedSupplier.phone,
          address: mergedSupplier.address,
          isAiRecognized: mergedSupplier.is_ai_recognized,
          createdAt: mergedSupplier.created_at,
          updatedAt: mergedSupplier.updated_at,
        };
      }
    }

    // 1. 精确匹配（完全相同的名称，忽略大小写和空格）
    const exactMatch = allSuppliers.find(supplier => 
      normalizeSupplierName(supplier.name) === normalizedName
    );

    if (exactMatch) {
      // 如果新识别的信息更完整，更新商家信息
      const shouldUpdate =
        (taxNumber && !exactMatch.tax_number) ||
        (phone && !exactMatch.phone) ||
        (address && !exactMatch.address);
      
      if (shouldUpdate) {
        try {
          await updateSupplier(exactMatch.id, {
            taxNumber: taxNumber || exactMatch.tax_number,
            phone: phone || exactMatch.phone,
            address: address || exactMatch.address,
          });
        } catch (error: any) {
          // 如果更新时遇到名称重复，静默处理（后台处理场景，不应该因为名称重复而失败）
          if (error?.code === 'SUPPLIER_NAME_EXISTS' || error?.message === '供应商名称已存在') {
            console.log('供应商名称已存在，跳过更新（使用已存在的供应商）');
          } else {
            throw error; // 其他错误继续抛出
          }
        }
        // 重新获取更新后的商家信息
        const { data: updatedSupplier } = await supabase
          .from('entities')
          .select('*')
          .eq('id', exactMatch.id)
          .single();
        if (updatedSupplier) {
          return {
            id: updatedSupplier.id,
            spaceId: updatedSupplier.space_id,
            name: updatedSupplier.name,
            taxNumber: updatedSupplier.tax_number,
            phone: updatedSupplier.phone,
            address: updatedSupplier.address,
            isAiRecognized: updatedSupplier.is_ai_recognized,
            createdAt: updatedSupplier.created_at,
            updatedAt: updatedSupplier.updated_at,
          };
        }
      }
      
      return {
        id: exactMatch.id,
        spaceId: exactMatch.space_id,
        name: exactMatch.name,
        taxNumber: exactMatch.tax_number,
        phone: exactMatch.phone,
        address: exactMatch.address,
        isAiRecognized: exactMatch.is_ai_recognized,
        createdAt: exactMatch.created_at,
        updatedAt: exactMatch.updated_at,
      };
    }

    // 2. 通过税号匹配（如果有税号且税号唯一）
    if (taxNumber && taxNumber.trim()) {
      const taxNumberMatch = allSuppliers.find(supplier => 
        supplier.tax_number && supplier.tax_number.trim() === taxNumber.trim()
      );
      if (taxNumberMatch) {
        console.log(`Found supplier by tax number: "${trimmedName}" -> "${taxNumberMatch.name}"`);
        // 更新商家名称（如果新名称更完整）
        if (trimmedName.length > taxNumberMatch.name.length) {
          try {
            await updateSupplier(taxNumberMatch.id, { name: trimmedName });
          } catch (error: any) {
            // 如果更新时遇到名称重复，静默处理（后台处理场景，不应该因为名称重复而失败）
            if (error?.code === 'SUPPLIER_NAME_EXISTS' || error?.message === '供应商名称已存在') {
              console.log('供应商名称已存在，跳过名称更新（使用已存在的供应商）');
            } else {
              throw error; // 其他错误继续抛出
            }
          }
        }
        // 更新其他信息（如果新信息更完整）
        const shouldUpdate =
          (phone && !taxNumberMatch.phone) ||
          (address && !taxNumberMatch.address);
        if (shouldUpdate) {
          try {
            await updateSupplier(taxNumberMatch.id, {
              phone: phone || taxNumberMatch.phone,
              address: address || taxNumberMatch.address,
            });
          } catch (error: any) {
            // 如果更新时遇到名称重复，静默处理（后台处理场景，不应该因为名称重复而失败）
            if (error?.code === 'SUPPLIER_NAME_EXISTS' || error?.message === '供应商名称已存在') {
              console.log('供应商名称已存在，跳过更新（使用已存在的供应商）');
            } else {
              throw error; // 其他错误继续抛出
            }
          }
        }
        // 重新获取更新后的商家信息
        const { data: updatedSupplier } = await supabase
          .from('entities')
          .select('*')
          .eq('id', taxNumberMatch.id)
          .single();
        if (updatedSupplier) {
          return {
            id: updatedSupplier.id,
            spaceId: updatedSupplier.space_id,
            name: updatedSupplier.name,
            taxNumber: updatedSupplier.tax_number,
            phone: updatedSupplier.phone,
            address: updatedSupplier.address,
            isAiRecognized: updatedSupplier.is_ai_recognized,
            createdAt: updatedSupplier.created_at,
            updatedAt: updatedSupplier.updated_at,
          };
        }
      }
    }

    // 3. 不进行模糊匹配，优先创建新商家
    // 只有精确匹配、合并历史匹配或税号匹配时才关联已有商家
    // 这样可以确保从小票识别出的商家名称被优先使用，而不是强制匹配到已有商家
    
    // 创建新的供应商（使用小票上识别出的完整名称和信息）
    console.log(`Creating new supplier from receipt: "${trimmedName}"`);
    return await createSupplier(trimmedName, isAiRecognized, taxNumber, phone, address);
  } catch (error) {
    console.error('Error finding or creating supplier:', error);
    throw error;
  }
}

// 合并供应商：只设置“合并指向”，不删记录、不修改小票；A.merged_into_id = 目标；若目标本身有指向则指到最终目标；指向源的所有记录一并指到最终目标
export async function mergeSupplier(
  sourceSupplierIds: string[],
  targetSupplierId: string
): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    if (sourceSupplierIds.length === 0) throw new Error('No source suppliers to merge');
    if (sourceSupplierIds.includes(targetSupplierId)) throw new Error('Cannot merge supplier to itself');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const allIds = [...sourceSupplierIds, targetSupplierId];
    const { data: allSuppliers, error: fetchError } = await supabase
      .from('entities')
      .select('id, merged_into_id')
      .eq('space_id', spaceId)
      .in('id', allIds);

    if (fetchError) throw fetchError;
    if (!allSuppliers || allSuppliers.length !== allIds.length) {
      throw new Error('Supplier does not exist or does not belong to current space');
    }

    const mergeMap = new Map<string, string>();
    const { data: withPointer } = await supabase
      .from('entities')
      .select('id, merged_into_id')
      .eq('space_id', spaceId)
      .not('merged_into_id', 'is', null);
    (withPointer || []).forEach((r: any) => {
      if (r.merged_into_id) mergeMap.set(r.id, r.merged_into_id);
    });

    const resolveToFinal = (id: string): string => {
      let current = id;
      const seen = new Set<string>();
      while (mergeMap.has(current) && !seen.has(current)) {
        seen.add(current);
        current = mergeMap.get(current)!;
      }
      return current;
    };

    const finalTargetId = resolveToFinal(targetSupplierId);

    for (const sourceId of sourceSupplierIds) {
      const { error: updatePointers } = await supabase
        .from('entities')
        .update({ merged_into_id: finalTargetId })
        .eq('space_id', spaceId)
        .eq('merged_into_id', sourceId);
      if (updatePointers) throw updatePointers;

      const { error: setSource } = await supabase
        .from('entities')
        .update({ merged_into_id: finalTargetId })
        .eq('id', sourceId)
        .eq('space_id', spaceId);
      if (setSource) throw setSource;
    }
  } catch (error) {
    console.error('Error merging supplier:', error);
    throw error;
  }
}

/** 取消合并：将子供应商的 merged_into_id 置为 null，使其重新成为根 */
export async function unmergeSupplier(supplierId: string): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { error } = await supabase
      .from('entities')
      .update({ merged_into_id: null })
      .eq('id', supplierId)
      .eq('space_id', spaceId);

    if (error) throw error;
  } catch (error) {
    console.error('Error unmerging supplier:', error);
    throw error;
  }
}

/** 合并历史用：无指向的根供应商列表 + 每个根下“指向其”的子供应商列表 */
export type SuppliersMergeHistoryData = {
  roots: Supplier[];
  childrenByRootId: Map<string, Supplier[]>;
};

export async function getSuppliersForMergeHistory(): Promise<SuppliersMergeHistoryData> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data: allRows, error } = await supabase
    .from('entities')
    .select('*')
    .eq('space_id', spaceId)
    .order('name', { ascending: true });

  if (error) throw error;
  const rows = allRows || [];

  const roots = rows.filter((r: any) => r.merged_into_id == null).map((row: any) => mapSupplierRow(row));
  const childrenByRootId = new Map<string, Supplier[]>();
  for (const root of roots) {
    const children = rows.filter((r: any) => r.merged_into_id === root.id).map((row: any) => mapSupplierRow(row));
    if (children.length) childrenByRootId.set(root.id, children);
  }
  return { roots, childrenByRootId };
}

/** 各关联方直接关联的 receipts 数量（按 entity_id 统计） */
export type SupplierUsageCounts = {
  receiptCountBySupplierId: Record<string, number>;
};

export async function getSupplierUsageCounts(): Promise<SupplierUsageCounts> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const receiptCountBySupplierId: Record<string, number> = {};
  const { data: receiptRows } = await supabase
    .from('receipts')
    .select('entity_id')
    .eq('space_id', spaceId)
    .not('entity_id', 'is', null);
  (receiptRows || []).forEach((r: any) => {
    if (r.entity_id) receiptCountBySupplierId[r.entity_id] = (receiptCountBySupplierId[r.entity_id] || 0) + 1;
  });
  return { receiptCountBySupplierId };
}

/** 从 suppliers 表构建合并指向映射 id -> merged_into_id（用于解析） */
export async function getSupplierMergeMap(spaceId: string): Promise<Map<string, string>> {
  const { data: rows } = await supabase
    .from('entities')
    .select('id, merged_into_id')
    .eq('space_id', spaceId)
    .not('merged_into_id', 'is', null);

  const map = new Map<string, string>();
  (rows || []).forEach((r: any) => {
    if (r.id && r.merged_into_id) map.set(r.id, r.merged_into_id);
  });
  return map;
}

/** 用已有 map 解析供应商 ID（同步） */
function resolveSupplierIdWithMap(map: Map<string, string>, supplierId: string): string {
  let current = supplierId;
  const seen = new Set<string>();
  while (map.has(current) && !seen.has(current)) {
    seen.add(current);
    current = map.get(current)!;
  }
  return current;
}

/** 按 merged_into_id 解析供应商 ID：返回应展示的目标 ID */
export async function resolveSupplierId(spaceId: string, supplierId: string): Promise<string> {
  const map = await getSupplierMergeMap(spaceId);
  return resolveSupplierIdWithMap(map, supplierId);
}

/** 按 ID 获取单个供应商（用于合并后展示） */
export async function getSupplierById(id: string): Promise<Supplier | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) return null;

  const { data, error } = await supabase
    .from('entities')
    .select('*')
    .eq('id', id)
    .eq('space_id', spaceId)
    .maybeSingle();

  if (error || !data) return null;
  return mapSupplierRow(data);
}

// 获取“名称 -> 应归并到的目标 ID”映射（用于 findOrCreateSupplier：已合并指向的记录按名称匹配到最终目标）
async function getMergeHistory(): Promise<Map<string, string>> {
  try {
    const user = await getCurrentUser();
    if (!user) return new Map();

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) return new Map();

    const { data: withPointer, error } = await supabase
      .from('entities')
      .select('id, name, merged_into_id')
      .eq('space_id', spaceId)
      .not('merged_into_id', 'is', null);

    if (error) return new Map();
    if (!withPointer?.length) return new Map();

    const mergeMap = new Map<string, string>();
    (withPointer || []).forEach((r: any) => {
      if (r.id && r.merged_into_id) mergeMap.set(r.id, r.merged_into_id);
    });
    const resolveToFinal = (id: string): string => {
      let current = id;
      const seen = new Set<string>();
      while (mergeMap.has(current) && !seen.has(current)) {
        seen.add(current);
        current = mergeMap.get(current)!;
      }
      return current;
    };

    const historyMap = new Map<string, string>();
    for (const r of withPointer) {
      const normalizedName = normalizeSupplierName(r.name);
      historyMap.set(normalizedName, resolveToFinal(r.id));
    }
    return historyMap;
  } catch (error) {
    console.warn('Error getting merge history:', error);
    return new Map();
  }
}
