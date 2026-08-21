import { supabase } from './supabase';
import { Customer } from '@/types';
import { getCurrentUser } from './auth';
import { normalizeNameForCompare } from './name-utils';

// 获取当前空间的所有客户（仅展示“无指向”的，即未被合并的）
export async function getCustomers(): Promise<Customer[]> {
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

    return (data || []).map(mapCustomerRow);
  } catch (error) {
    console.error('Error fetching customers:', error);
    throw error;
  }
}

/** 获取全部客户（含已合并指向的），供选单与大模型选项用 */
export async function getCustomersForOptions(): Promise<Customer[]> {
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

    return (data || []).map(mapCustomerRow);
  } catch (error) {
    console.error('Error fetching customers for options:', error);
    throw error;
  }
}

function mapCustomerRow(row: any): Customer {
  return {
    id: row.id,
    spaceId: row.space_id,
    name: row.name,
    taxNumber: row.tax_number,
    phone: row.phone,
    address: row.address,
    isAiRecognized: row.is_ai_recognized,
    isSupplier: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// 创建客户（写入 entities 表）
export async function createCustomer(
  name: string,
  isAiRecognized: boolean = false,
  taxNumber?: string,
  phone?: string,
  address?: string,
  _isSupplier: boolean = false
): Promise<Customer> {
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
      // 如果是因为名称重复导致的数据库约束错误（23505），尝试查找已存在的客户并返回
      // 这种情况可能发生在并发场景：两个请求同时调用 findOrCreateCustomer，都找不到已存在的，然后都尝试创建
      if (error.code === '23505' && (error.message?.includes('name') || error.message?.includes('客户'))) {
        console.log('客户名称已存在（数据库约束），尝试查找已存在的客户:', name.trim());
        const { data: existingCustomer } = await supabase
          .from('entities')
          .select('*')
          .eq('space_id', spaceId)
          .eq('name', name.trim())
          .single();
        if (existingCustomer) {
          console.log('找到已存在的客户，返回:', existingCustomer.id);
          return mapCustomerRow(existingCustomer);
        }
      }
      throw error;
    }

    return mapCustomerRow(data);
  } catch (error) {
    console.error('Error creating customer:', error);
    throw error;
  }
}

// 更新客户（仅更新 customers 表，不创建/删除 suppliers 行）
export async function updateCustomer(
  customerId: string,
  updates: {
    name?: string;
    taxNumber?: string;
    phone?: string;
    address?: string;
    isSupplier?: boolean;
  }
): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    // 改名称时：先按规范化名称检查是否与同空间其他客户一致（含已合并），一致则抛错供管理页弹 维持/合并
    if (updates.name !== undefined) {
      const trimmedName = updates.name.trim();
      if (trimmedName.length > 0) {
        const all = await getCustomersForOptions();
        const found = all.find((o) => normalizeNameForCompare(o.name) === normalizeNameForCompare(trimmedName));
        if (found) {
          const currentResolved = await resolveCustomerId(spaceId, customerId);
          const targetResolved = await resolveCustomerId(spaceId, found.id);
          if (currentResolved != null && targetResolved != null && currentResolved !== targetResolved) {
            throw Object.assign(new Error('客户名称已存在'), {
              code: 'CUSTOMER_NAME_EXISTS' as const,
              duplicateName: trimmedName,
              targetId: targetResolved,
              targetSource: 'customer' as const,
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
      .eq('id', customerId)
      .eq('space_id', spaceId)
      .select('id')
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        console.warn('Customer name already exists in this space:', error.message);
        throw new Error('客户名称已存在');
      }
      throw error;
    }
    if (updated == null) {
      throw new Error('未找到要更新的客户，请刷新后重试');
    }
  } catch (error) {
    if (error instanceof Error && error.message === '客户名称已存在') throw error;
    console.error('Error updating customer:', error);
    throw error;
  }
}

// 删除客户
export async function deleteCustomer(customerId: string): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    // 优先使用 currentSpaceId，如果没有则使用 spaceId（向后兼容）
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { error } = await supabase
      .from('entities')
      .delete()
      .eq('id', customerId)
      .eq('space_id', spaceId);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting customer:', error);
    throw error;
  }
}

// 标准化客户名称（用于匹配）
function normalizeCustomerName(name: string): string {
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

// 检查客户名称是否有效（排除处理状态等无效名称）
function isValidCustomerName(name: string): boolean {
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

// 根据名称查找或创建客户（用于AI识别）
export async function findOrCreateCustomer(
  name: string,
  isAiRecognized: boolean = true,
  taxNumber?: string,
  phone?: string,
  address?: string
): Promise<Customer> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const trimmedName = name.trim();
    if (!trimmedName || !isValidCustomerName(trimmedName)) {
      throw new Error('Invalid customer name: Customer name cannot be empty or a processing status');
    }

    // 优先使用 currentSpaceId，如果没有则使用 spaceId（向后兼容）
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    // 获取所有客户
    const { data: allCustomers, error: fetchError } = await supabase
      .from('entities')
      .select('*')
      .eq('space_id', spaceId);

    if (fetchError) throw fetchError;

    // 如果没有现有客户，直接创建
    if (!allCustomers || allCustomers.length === 0) {
      return await createCustomer(trimmedName, isAiRecognized, taxNumber, phone, address);
    }

    const normalizedName = normalizeCustomerName(trimmedName);

    // 1. 精确匹配（完全相同的名称，忽略大小写和空格）
    const exactMatch = allCustomers.find(customer => 
      normalizeCustomerName(customer.name) === normalizedName
    );

    if (exactMatch) {
      // 如果新识别的信息更完整，更新客户信息
      const shouldUpdate =
        (taxNumber && !exactMatch.tax_number) ||
        (phone && !exactMatch.phone) ||
        (address && !exactMatch.address);
      
      if (shouldUpdate) {
        await updateCustomer(exactMatch.id, {
          taxNumber: taxNumber || exactMatch.tax_number,
          phone: phone || exactMatch.phone,
          address: address || exactMatch.address,
        });
        // 重新获取更新后的客户信息
        const { data: updatedCustomer } = await supabase
          .from('entities')
          .select('*')
          .eq('id', exactMatch.id)
          .single();
        if (updatedCustomer) {
        return {
          id: updatedCustomer.id,
          spaceId: updatedCustomer.space_id,
          name: updatedCustomer.name,
          taxNumber: updatedCustomer.tax_number,
          phone: updatedCustomer.phone,
          address: updatedCustomer.address,
          isAiRecognized: updatedCustomer.is_ai_recognized,
          isSupplier: false,
          createdAt: updatedCustomer.created_at,
          updatedAt: updatedCustomer.updated_at,
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
        isSupplier: false,
        createdAt: exactMatch.created_at,
        updatedAt: exactMatch.updated_at,
      };
    }

    // 2. 通过税号匹配（如果有税号且税号唯一）
    if (taxNumber && taxNumber.trim()) {
      const taxNumberMatch = allCustomers.find(customer => 
        customer.tax_number && customer.tax_number.trim() === taxNumber.trim()
      );
      if (taxNumberMatch) {
        console.log(`Found customer by tax number: "${trimmedName}" -> "${taxNumberMatch.name}"`);
        // 更新客户名称（如果新名称更完整）
        if (trimmedName.length > taxNumberMatch.name.length) {
          await updateCustomer(taxNumberMatch.id, { name: trimmedName });
        }
        // 更新其他信息（如果新信息更完整）
        const shouldUpdate =
          (phone && !taxNumberMatch.phone) ||
          (address && !taxNumberMatch.address);
        if (shouldUpdate) {
          await updateCustomer(taxNumberMatch.id, {
            phone: phone || taxNumberMatch.phone,
            address: address || taxNumberMatch.address,
          });
        }
        // 重新获取更新后的客户信息
        const { data: updatedCustomer } = await supabase
          .from('entities')
          .select('*')
          .eq('id', taxNumberMatch.id)
          .single();
        if (updatedCustomer) {
        return {
          id: updatedCustomer.id,
          spaceId: updatedCustomer.space_id,
          name: updatedCustomer.name,
          taxNumber: updatedCustomer.tax_number,
          phone: updatedCustomer.phone,
          address: updatedCustomer.address,
          isAiRecognized: updatedCustomer.is_ai_recognized,
          isSupplier: false,
          createdAt: updatedCustomer.created_at,
          updatedAt: updatedCustomer.updated_at,
        };
        }
      }
    }

    // 3. 创建新客户（使用发票上识别出的完整名称和信息）
    console.log(`Creating new customer from invoice: "${trimmedName}"`);
    return await createCustomer(trimmedName, isAiRecognized, taxNumber, phone, address);
  } catch (error) {
    console.error('Error finding or creating customer:', error);
    throw error;
  }
}

// 合并客户：只设置“合并指向”，不删记录、不修改小票/发票；A.merged_into_id = 最终目标；指向源的所有记录一并指到最终目标
export async function mergeCustomer(
  sourceCustomerIds: string[],
  targetCustomerId: string
): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    if (sourceCustomerIds.length === 0) throw new Error('No source customers to merge');
    if (sourceCustomerIds.includes(targetCustomerId)) throw new Error('Cannot merge customer to itself');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const allIds = [...sourceCustomerIds, targetCustomerId];
    const { data: allCustomers, error: fetchError } = await supabase
      .from('entities')
      .select('id, merged_into_id')
      .eq('space_id', spaceId)
      .in('id', allIds);

    if (fetchError) throw fetchError;
    if (!allCustomers || allCustomers.length !== allIds.length) {
      throw new Error('Customer does not exist or does not belong to current space');
    }

    const { data: withPointer } = await supabase
      .from('entities')
      .select('id, merged_into_id')
      .eq('space_id', spaceId)
      .not('merged_into_id', 'is', null);

    const mergeMap = new Map<string, string>();
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

    const finalTargetId = resolveToFinal(targetCustomerId);

    for (const sourceId of sourceCustomerIds) {
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
    console.error('Error merging customer:', error);
    throw error;
  }
}

/** 取消合并：将子客户的 merged_into_id 置为 null，使其重新成为根 */
export async function unmergeCustomer(customerId: string): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { error } = await supabase
      .from('entities')
      .update({ merged_into_id: null })
      .eq('id', customerId)
      .eq('space_id', spaceId);

    if (error) throw error;
  } catch (error) {
    console.error('Error unmerging customer:', error);
    throw error;
  }
}

/** 合并历史用：无指向的根客户列表 + 每个根下“指向其”的子客户列表 */
export type CustomersMergeHistoryData = {
  roots: Customer[];
  childrenByRootId: Map<string, Customer[]>;
};

export async function getCustomersForMergeHistory(): Promise<CustomersMergeHistoryData> {
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

  const roots = rows.filter((r: any) => r.merged_into_id == null).map(mapCustomerRow);
  const childrenByRootId = new Map<string, Customer[]>();
  for (const root of roots) {
    const children = rows.filter((r: any) => r.merged_into_id === root.id).map(mapCustomerRow);
    if (children.length) childrenByRootId.set(root.id, children);
  }
  return { roots, childrenByRootId };
}

/** 各客户直接关联的 invoices 数量（按 customer_id 统计，仅 customers 表 id） */
export type CustomerUsageCounts = {
  invoiceCountByCustomerId: Record<string, number>;
};

export async function getCustomerUsageCounts(): Promise<CustomerUsageCounts> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const invoiceCountByCustomerId: Record<string, number> = {};
  const { data: invoiceRows } = await supabase
    .from('invoices')
    .select('customer_id')
    .eq('space_id', spaceId)
    .not('customer_id', 'is', null);
  (invoiceRows || []).forEach((r: any) => {
    if (r.customer_id) invoiceCountByCustomerId[r.customer_id] = (invoiceCountByCustomerId[r.customer_id] || 0) + 1;
  });
  return { invoiceCountByCustomerId };
}

/** 从 customers 表构建合并指向映射 id -> merged_into_id */
export async function getCustomerMergeMap(spaceId: string): Promise<Map<string, string>> {
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

/** 按合并历史解析客户 ID */
export async function resolveCustomerId(spaceId: string, customerId: string): Promise<string | null> {
  const map = await getCustomerMergeMap(spaceId);
  let current = customerId;
  const seen = new Set<string>();
  while (map.has(current) && !seen.has(current)) {
    seen.add(current);
    current = map.get(current)!;
  }
  return current;
}

/** 按 ID 获取单个客户（用于合并后展示） */
export async function getCustomerById(id: string): Promise<Customer | null> {
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
  return mapCustomerRow(data);
}
