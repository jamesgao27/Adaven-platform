import { supabase } from './supabase';
import { Sku } from '@/types';
import { getCurrentUser } from './auth';
import { normalizeNameForCompare } from './name-utils';

/** 获取当前空间下所有 SKU（仅展示未被合并的） */
export async function getSkus(): Promise<Sku[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data, error } = await supabase
    .from('skus')
    .select('*')
    .eq('space_id', spaceId)
    .is('merged_into_id', null)
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []).map(mapSkuRow);
}

/** 获取全部 SKU（含已合并指向的），供选单与大模型选项用 */
export async function getSkusForOptions(): Promise<Sku[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data, error } = await supabase
    .from('skus')
    .select('*')
    .eq('space_id', spaceId)
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []).map(mapSkuRow);
}

function mapSkuRow(row: any): Sku {
  return {
    id: row.id,
    spaceId: row.space_id,
    code: row.code ?? undefined,
    name: row.name,
    unit: row.unit ?? '件',
    description: row.description ?? undefined,
    isAiRecognized: row.is_ai_recognized ?? false,
    mergedIntoId: row.merged_into_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 创建 SKU */
export async function createSku(sku: {
  name: string;
  code?: string;
  unit?: string;
  description?: string;
  isAiRecognized?: boolean;
}): Promise<Sku> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data, error } = await supabase
    .from('skus')
    .insert({
      space_id: spaceId,
      name: sku.name.trim(),
      code: sku.code?.trim() || null,
      unit: sku.unit?.trim() || '件',
      description: sku.description?.trim() || null,
      is_ai_recognized: sku.isAiRecognized ?? false,
    })
    .select()
    .single();

  if (error) {
    // 如果是因为名称重复导致的数据库约束错误（23505），尝试查找已存在的 SKU 并返回
    // 这种情况可能发生在并发场景：两个请求同时调用 findOrCreateSkuByNameAndUnit，都找不到已存在的，然后都尝试创建
    if (error.code === '23505' && (error.message?.includes('name') || error.message?.includes('sku') || error.message?.includes('SKU'))) {
      console.log('SKU名称已存在（数据库约束），尝试查找已存在的SKU:', sku.name.trim());
      const { data: existingSku } = await supabase
        .from('skus')
        .select('*')
        .eq('space_id', spaceId)
        .eq('name', sku.name.trim())
        .eq('unit', sku.unit?.trim() || '件')
        .single();
      if (existingSku) {
        console.log('找到已存在的SKU，返回:', existingSku.id);
        return mapSkuRow(existingSku);
      }
    }
    throw error;
  }
  return {
    id: data.id,
    spaceId: data.space_id,
    code: data.code ?? undefined,
    name: data.name,
    unit: data.unit ?? '件',
    description: data.description ?? undefined,
    isAiRecognized: data.is_ai_recognized ?? false,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/** 更新 SKU */
export async function updateSku(
  skuId: string,
  updates: { name?: string; code?: string; unit?: string; description?: string }
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');

  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name.trim();
  if (updates.code !== undefined) payload.code = updates.code?.trim() || null;
  if (updates.unit !== undefined) payload.unit = updates.unit?.trim() || '件';
  if (updates.description !== undefined) payload.description = updates.description?.trim() || null;
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from('skus').update(payload).eq('id', skuId);
  if (error) throw error;
}

/** 删除 SKU */
export async function deleteSku(skuId: string): Promise<void> {
  const { error } = await supabase.from('skus').delete().eq('id', skuId);
  if (error) throw error;
}

/** 根据 ID 获取单个 SKU（用于详情/编辑） */
export async function getSkuById(skuId: string): Promise<Sku | null> {
  const { data, error } = await supabase.from('skus').select('*').eq('id', skuId).single();
  if (error || !data) return null;
  return mapSkuRow(data);
}

/**
 * 根据名称/编码/单位查找或创建 SKU（用于 AI 识别的自动归一化）
 */
export async function findOrCreateSkuByNameAndUnit(params: {
  name: string;
  unit?: string;
  code?: string;
}): Promise<Sku> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const trimmedName = params.name?.trim();
  if (!trimmedName) {
    throw new Error('Invalid SKU name');
  }
  const normalizedName = normalizeNameForCompare(trimmedName);
  const targetUnit = (params.unit || '件').trim();
  const targetCode = params.code?.trim();

  const { data: rows, error } = await supabase
    .from('skus')
    .select('*')
    .eq('space_id', spaceId)
    .is('merged_into_id', null);
  if (error) throw error;

  const unmerged = (rows || []).map((row: any) => mapSkuRow(row)) as Sku[];

  // 1. 优先按 code 精确匹配（仅未合并记录）
  if (targetCode) {
    const byCode = unmerged.find((s) => s.code && s.code.trim() === targetCode);
    if (byCode) return byCode;
  }

  // 2. 按名称 + 单位 归一化匹配（仅未合并记录）
  const byNameAndUnit = unmerged.find(
    (s) =>
      normalizeNameForCompare(s.name) === normalizedName &&
      (s.unit || '件') === targetUnit,
  );
  if (byNameAndUnit) return byNameAndUnit;

  // 3. 创建新的 SKU
  return await createSku({
    name: trimmedName,
    unit: targetUnit,
    code: targetCode,
    isAiRecognized: true,
  });
}

/** 从 skus 表构建合并指向映射 id -> merged_into_id（用于解析） */
export async function getSkuMergeMap(spaceId: string): Promise<Map<string, string>> {
  const { data: rows } = await supabase
    .from('skus')
    .select('id, merged_into_id')
    .eq('space_id', spaceId)
    .not('merged_into_id', 'is', null);

  const map = new Map<string, string>();
  (rows || []).forEach((r: any) => {
    if (r.id && r.merged_into_id) map.set(r.id, r.merged_into_id);
  });
  return map;
}

/** 按 merged_into_id 解析 SKU ID：返回应展示的目标 ID */
export async function resolveSkuId(spaceId: string, skuId: string): Promise<string> {
  const map = await getSkuMergeMap(spaceId);
  let current = skuId;
  const seen = new Set<string>();
  while (map.has(current) && !seen.has(current)) {
    seen.add(current);
    current = map.get(current)!;
  }
  return current;
}

/** 合并 SKU：只设置合并指向，不删记录、不修改出入库明细；指向源的所有记录一并指到最终目标 */
export async function mergeSkus(
  sourceSkuIds: string[],
  targetSkuId: string
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  if (sourceSkuIds.length === 0) throw new Error('No source SKUs to merge');
  if (sourceSkuIds.includes(targetSkuId)) throw new Error('Cannot merge SKU into itself');

  const allIds = [...sourceSkuIds, targetSkuId];
  const { data: allRows, error: fetchError } = await supabase
    .from('skus')
    .select('id, merged_into_id')
    .eq('space_id', spaceId)
    .in('id', allIds);

  if (fetchError) throw fetchError;
  if (!allRows || allRows.length !== allIds.length) {
    throw new Error('SKU does not exist or does not belong to current space');
  }

  const mergeMap = new Map<string, string>();
  const { data: withPointer } = await supabase
    .from('skus')
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

  const finalTargetId = resolveToFinal(targetSkuId);

  for (const sourceId of sourceSkuIds) {
    await supabase
      .from('skus')
      .update({ merged_into_id: finalTargetId })
      .eq('space_id', spaceId)
      .eq('merged_into_id', sourceId);

    const { error: setSource } = await supabase
      .from('skus')
      .update({ merged_into_id: finalTargetId })
      .eq('id', sourceId)
      .eq('space_id', spaceId);
    if (setSource) throw setSource;
  }
}

/** 取消合并：将子 SKU 的 merged_into_id 置为 null，使其重新成为根 */
export async function unmergeSku(skuId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { error } = await supabase
    .from('skus')
    .update({ merged_into_id: null })
    .eq('id', skuId)
    .eq('space_id', spaceId);

  if (error) throw error;
}

/** 合并历史用：无指向的根 SKU 列表 + 每个根下“指向其”的子 SKU 列表 */
export type SkusMergeHistoryData = {
  roots: Sku[];
  childrenByRootId: Map<string, Sku[]>;
};

export async function getSkusForMergeHistory(): Promise<SkusMergeHistoryData> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data: allRows, error } = await supabase
    .from('skus')
    .select('*')
    .eq('space_id', spaceId)
    .order('name', { ascending: true });

  if (error) throw error;
  const rows = allRows || [];

  const roots = rows.filter((r: any) => r.merged_into_id == null).map((row: any) => mapSkuRow(row));
  const childrenByRootId = new Map<string, Sku[]>();
  for (const root of roots) {
    const children = rows.filter((r: any) => r.merged_into_id === root.id).map((row: any) => mapSkuRow(row));
    if (children.length) childrenByRootId.set(root.id, children);
  }
  return { roots, childrenByRootId };
}

/** 各 SKU 直接关联的出入库明细数量（按 sku_id 统计），暂无则返回空 */
export type SkuUsageCounts = {
  usageCountBySkuId: Record<string, number>;
};

export async function getSkuUsageCounts(): Promise<SkuUsageCounts> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const usageCountBySkuId: Record<string, number> = {};
  try {
    const { data: outbound } = await supabase.from('outbound_item').select('sku_id').not('sku_id', 'is', null);
    (outbound || []).forEach((r: any) => {
      if (r.sku_id) usageCountBySkuId[r.sku_id] = (usageCountBySkuId[r.sku_id] || 0) + 1;
    });
    const { data: inbound } = await supabase.from('inbound_item').select('sku_id').not('sku_id', 'is', null);
    (inbound || []).forEach((r: any) => {
      if (r.sku_id) usageCountBySkuId[r.sku_id] = (usageCountBySkuId[r.sku_id] || 0) + 1;
    });
  } catch {
    // 表可能不存在，忽略
  }
  return { usageCountBySkuId };
}
