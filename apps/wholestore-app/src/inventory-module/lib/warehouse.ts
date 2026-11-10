import { supabase } from './supabase';
import { Warehouse, Location } from '@/types';
import { getCurrentUser } from './auth';
import { normalizeNameForCompare } from './name-utils';

function mapWarehouseRow(row: any): Warehouse {
  return {
    id: row.id,
    spaceId: row.space_id,
    name: row.name,
    code: row.code ?? undefined,
    address: row.address ?? undefined,
    mergedIntoId: row.merged_into_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 获取当前空间下所有仓库（仅展示未被合并的） */
export async function getWarehouses(): Promise<Warehouse[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data, error } = await supabase
    .from('warehouse')
    .select('*')
    .eq('space_id', spaceId)
    .is('merged_into_id', null)
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []).map(mapWarehouseRow);
}

/** 获取全部仓库（含已合并指向的），供选单与大模型选项用 */
export async function getWarehousesForOptions(): Promise<Warehouse[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data, error } = await supabase
    .from('warehouse')
    .select('*')
    .eq('space_id', spaceId)
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []).map(mapWarehouseRow);
}

/** 创建仓库 */
export async function createWarehouse(w: { name: string; code?: string; address?: string }): Promise<Warehouse> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data, error } = await supabase
    .from('warehouse')
    .insert({
      space_id: spaceId,
      name: w.name.trim(),
      code: w.code?.trim() || null,
      address: w.address?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    // 如果是因为名称重复导致的数据库约束错误（23505），尝试查找已存在的仓库并返回
    // 这种情况可能发生在并发场景：两个请求同时调用 findOrCreateWarehouseByName，都找不到已存在的，然后都尝试创建
    if (error.code === '23505' && (error.message?.includes('name') || error.message?.includes('仓库'))) {
      console.log('仓库名称已存在（数据库约束），尝试查找已存在的仓库:', w.name.trim());
      const { data: existingWarehouse } = await supabase
        .from('warehouse')
        .select('*')
        .eq('space_id', spaceId)
        .eq('name', w.name.trim())
        .single();
      if (existingWarehouse) {
        console.log('找到已存在的仓库，返回:', existingWarehouse.id);
        return mapWarehouseRow(existingWarehouse);
      }
    }
    throw error;
  }
  return mapWarehouseRow(data);
}

/** 更新仓库 */
export async function updateWarehouse(id: string, updates: { name?: string; code?: string; address?: string }): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name.trim();
  if (updates.code !== undefined) payload.code = updates.code?.trim() || null;
  if (updates.address !== undefined) payload.address = updates.address?.trim() || null;
  if (Object.keys(payload).length === 0) return;
  const { error } = await supabase.from('warehouse').update(payload).eq('id', id);
  if (error) throw error;
}

/** 删除仓库（会级联删除仓位） */
export async function deleteWarehouse(id: string): Promise<void> {
  const { error } = await supabase.from('warehouse').delete().eq('id', id);
  if (error) throw error;
}

function mapLocationRow(row: any): Location {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    name: row.name,
    code: row.code ?? undefined,
    mergedIntoId: row.merged_into_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 仓位按名称剔重展示：优先保留目标仓库下的同名仓位，被合并仓库仅展示名称不重复的（如 A 有 1、2，B 有 1、2、3，B→A 后展示 A1、A2、B3） */
function dedupeLocationsByName(locations: Location[], targetWarehouseId: string): Location[] {
  const target = locations.filter((l) => l.warehouseId === targetWarehouseId);
  const sources = locations.filter((l) => l.warehouseId !== targetWarehouseId);
  const targetNames = new Set(target.map((l) => normalizeNameForCompare(l.name)));
  const fromSources = sources.filter((l) => !targetNames.has(normalizeNameForCompare(l.name)));
  const combined = [...target, ...fromSources];
  return combined.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN'));
}

/** 获取某仓库下的所有仓位（仅展示未被合并的）。若该仓库是被合并后的“目标”，会包含“解析到该仓库”的源仓库下仓位，按名称剔重：同名只保留目标仓库的，源仓库仅展示名称不重复的 */
export async function getLocationsByWarehouse(warehouseId: string): Promise<Location[]> {
  const { data: wh, error: whError } = await supabase
    .from('warehouse')
    .select('space_id')
    .eq('id', warehouseId)
    .single();
  if (whError || !wh?.space_id) {
    const { data, error } = await supabase
      .from('location')
      .select('*')
      .eq('warehouse_id', warehouseId)
      .is('merged_into_id', null)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapLocationRow);
  }
  const warehouseIds = await getWarehouseIdsResolvingTo(wh.space_id, warehouseId);
  const { data, error } = await supabase
    .from('location')
    .select('*')
    .in('warehouse_id', warehouseIds)
    .is('merged_into_id', null)
    .order('name', { ascending: true });
  if (error) throw error;
  const list = (data || []).map(mapLocationRow);
  return dedupeLocationsByName(list, warehouseId);
}

/** 获取某仓库下全部仓位（含已合并指向的），供选单与大模型选项用；会包含“解析到该仓库”的源仓库下仓位，按名称剔重展示 */
export async function getLocationsByWarehouseForOptions(warehouseId: string): Promise<Location[]> {
  const { data: wh } = await supabase
    .from('warehouse')
    .select('space_id')
    .eq('id', warehouseId)
    .single();
  if (!wh?.space_id) {
    const { data, error } = await supabase
      .from('location')
      .select('*')
      .eq('warehouse_id', warehouseId)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapLocationRow);
  }
  const warehouseIds = await getWarehouseIdsResolvingTo(wh.space_id, warehouseId);
  const { data, error } = await supabase
    .from('location')
    .select('*')
    .in('warehouse_id', warehouseIds)
    .order('name', { ascending: true });
  if (error) throw error;
  const list = (data || []).map(mapLocationRow);
  return dedupeLocationsByName(list, warehouseId);
}

/** 创建仓位 */
export async function createLocation(l: { warehouseId: string; name: string; code?: string }): Promise<Location> {
  const { data, error } = await supabase
    .from('location')
    .insert({
      warehouse_id: l.warehouseId,
      name: l.name.trim(),
      code: l.code?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    // 如果是因为名称重复导致的数据库约束错误（23505），尝试查找已存在的仓位并返回
    // 这种情况可能发生在并发场景：两个请求同时调用 findOrCreateLocationByName，都找不到已存在的，然后都尝试创建
    if (error.code === '23505' && (error.message?.includes('name') || error.message?.includes('仓位'))) {
      console.log('仓位名称已存在（数据库约束），尝试查找已存在的仓位:', l.name.trim());
      const { data: existingLocation } = await supabase
        .from('location')
        .select('*')
        .eq('warehouse_id', l.warehouseId)
        .eq('name', l.name.trim())
        .single();
      if (existingLocation) {
        console.log('找到已存在的仓位，返回:', existingLocation.id);
        return mapLocationRow(existingLocation);
      }
    }
    throw error;
  }
  return mapLocationRow(data);
}

/** 更新仓位 */
export async function updateLocation(id: string, updates: { name?: string; code?: string }): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name.trim();
  if (updates.code !== undefined) payload.code = updates.code?.trim() || null;
  if (Object.keys(payload).length === 0) return;
  const { error } = await supabase.from('location').update(payload).eq('id', id);
  if (error) throw error;
}

/** 删除仓位 */
export async function deleteLocation(id: string): Promise<void> {
  const { error } = await supabase.from('location').delete().eq('id', id);
  if (error) throw error;
}

/** 根据名称查找或创建仓库（用于 AI 识别） */
export async function findOrCreateWarehouseByName(name: string): Promise<Warehouse> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const trimmed = name?.trim();
  if (!trimmed) {
    throw new Error('Invalid warehouse name');
  }
  const norm = normalizeNameForCompare(trimmed);

  const { data, error } = await supabase
    .from('warehouse')
    .select('*')
    .eq('space_id', spaceId)
    .is('merged_into_id', null);
  if (error) throw error;

  const unmerged = (data || []).map(mapWarehouseRow) as Warehouse[];

  const existing = unmerged.find((w) => normalizeNameForCompare(w.name) === norm);
  if (existing) return existing;

  return await createWarehouse({ name: trimmed });
}

/** 根据仓库 + 名称查找或创建仓位（用于 AI 识别） */
export async function findOrCreateLocationByName(
  warehouseId: string,
  name: string,
): Promise<Location> {
  const trimmed = name?.trim();
  if (!trimmed) {
    throw new Error('Invalid location name');
  }
  const norm = normalizeNameForCompare(trimmed);

  const { data, error } = await supabase
    .from('location')
    .select('*')
    .eq('warehouse_id', warehouseId)
    .is('merged_into_id', null);
  if (error) throw error;

  const unmerged = (data || []).map(mapLocationRow) as Location[];

  const existing = unmerged.find((l) => normalizeNameForCompare(l.name) === norm);
  if (existing) return existing;

  return await createLocation({ warehouseId, name: trimmed });
}

/** 从 warehouse 表构建合并指向映射 id -> merged_into_id（用于解析） */
export async function getWarehouseMergeMap(spaceId: string): Promise<Map<string, string>> {
  const { data: rows } = await supabase
    .from('warehouse')
    .select('id, merged_into_id')
    .eq('space_id', spaceId)
    .not('merged_into_id', 'is', null);

  const map = new Map<string, string>();
  (rows || []).forEach((r: any) => {
    if (r.id && r.merged_into_id) map.set(r.id, r.merged_into_id);
  });
  return map;
}

/** 按 merged_into_id 解析仓库 ID：返回应展示的目标 ID */
export async function resolveWarehouseId(spaceId: string, warehouseId: string): Promise<string> {
  const map = await getWarehouseMergeMap(spaceId);
  let current = warehouseId;
  const seen = new Set<string>();
  while (map.has(current) && !seen.has(current)) {
    seen.add(current);
    current = map.get(current)!;
  }
  return current;
}

/** 返回“解析到该仓库”的所有仓库 ID（含自身），用于查询时包含被合并仓库下的仓位，不改动原始数据 */
export async function getWarehouseIdsResolvingTo(spaceId: string, targetWarehouseId: string): Promise<string[]> {
  const map = await getWarehouseMergeMap(spaceId);
  const resolve = (id: string): string => {
    let current = id;
    const seen = new Set<string>();
    while (map.has(current) && !seen.has(current)) {
      seen.add(current);
      current = map.get(current)!;
    }
    return current;
  };
  const { data: rows } = await supabase
    .from('warehouse')
    .select('id')
    .eq('space_id', spaceId);
  const ids = (rows || []).map((r: any) => r.id).filter(Boolean) as string[];
  const targetSet = new Set<string>([targetWarehouseId]);
  ids.forEach((id) => {
    if (resolve(id) === targetWarehouseId) targetSet.add(id);
  });
  return Array.from(targetSet);
}

/** 合并仓库：只设置合并指向，不删记录、不修改出入库；指向源的所有记录一并指到最终目标 */
export async function mergeWarehouses(
  sourceWarehouseIds: string[],
  targetWarehouseId: string
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  if (sourceWarehouseIds.length === 0) throw new Error('No source warehouses to merge');
  if (sourceWarehouseIds.includes(targetWarehouseId)) throw new Error('Cannot merge warehouse into itself');

  const allIds = [...sourceWarehouseIds, targetWarehouseId];
  const { data: allRows, error: fetchError } = await supabase
    .from('warehouse')
    .select('id, merged_into_id')
    .eq('space_id', spaceId)
    .in('id', allIds);

  if (fetchError) throw fetchError;
  if (!allRows || allRows.length !== allIds.length) {
    throw new Error('Warehouse does not exist or does not belong to current space');
  }

  const mergeMap = new Map<string, string>();
  const { data: withPointer } = await supabase
    .from('warehouse')
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

  const finalTargetId = resolveToFinal(targetWarehouseId);

  for (const sourceId of sourceWarehouseIds) {
    await supabase
      .from('warehouse')
      .update({ merged_into_id: finalTargetId })
      .eq('space_id', spaceId)
      .eq('merged_into_id', sourceId);

    const { error: setSource } = await supabase
      .from('warehouse')
      .update({ merged_into_id: finalTargetId })
      .eq('id', sourceId)
      .eq('space_id', spaceId);
    if (setSource) throw setSource;
  }
}

/** 取消合并：将子仓库的 merged_into_id 置为 null，使其重新成为根 */
export async function unmergeWarehouse(warehouseId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { error } = await supabase
    .from('warehouse')
    .update({ merged_into_id: null })
    .eq('id', warehouseId)
    .eq('space_id', spaceId);

  if (error) throw error;
}

/** 合并历史用：无指向的根仓库列表 + 每个根下“指向其”的子仓库列表 */
export type WarehousesMergeHistoryData = {
  roots: Warehouse[];
  childrenByRootId: Map<string, Warehouse[]>;
};

export async function getWarehousesForMergeHistory(): Promise<WarehousesMergeHistoryData> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data: allRows, error } = await supabase
    .from('warehouse')
    .select('*')
    .eq('space_id', spaceId)
    .order('name', { ascending: true });

  if (error) throw error;
  const rows = allRows || [];

  const roots = rows.filter((r: any) => r.merged_into_id == null).map((row: any) => mapWarehouseRow(row));
  const childrenByRootId = new Map<string, Warehouse[]>();
  for (const root of roots) {
    const children = rows.filter((r: any) => r.merged_into_id === root.id).map((row: any) => mapWarehouseRow(row));
    if (children.length) childrenByRootId.set(root.id, children);
  }
  return { roots, childrenByRootId };
}

/** 各仓库直接关联的出入库单数量（按 warehouse_id 统计），暂无则返回空 */
export type WarehouseUsageCounts = {
  usageCountByWarehouseId: Record<string, number>;
};

export async function getWarehouseUsageCounts(): Promise<WarehouseUsageCounts> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const usageCountByWarehouseId: Record<string, number> = {};
  try {
    const { data: outbound } = await supabase.from('outbound').select('warehouse_id').eq('space_id', spaceId).not('warehouse_id', 'is', null);
    (outbound || []).forEach((r: any) => {
      if (r.warehouse_id) usageCountByWarehouseId[r.warehouse_id] = (usageCountByWarehouseId[r.warehouse_id] || 0) + 1;
    });
    const { data: inbound } = await supabase.from('inbound').select('warehouse_id').eq('space_id', spaceId).not('warehouse_id', 'is', null);
    (inbound || []).forEach((r: any) => {
      if (r.warehouse_id) usageCountByWarehouseId[r.warehouse_id] = (usageCountByWarehouseId[r.warehouse_id] || 0) + 1;
    });
  } catch {
    // 表可能不存在，忽略
  }
  return { usageCountByWarehouseId };
}

/** 从 location 表构建合并指向映射 id -> merged_into_id（同一仓库内） */
export async function getLocationMergeMap(warehouseId: string): Promise<Map<string, string>> {
  const { data: rows } = await supabase
    .from('location')
    .select('id, merged_into_id')
    .eq('warehouse_id', warehouseId)
    .not('merged_into_id', 'is', null);

  const map = new Map<string, string>();
  (rows || []).forEach((r: any) => {
    if (r.id && r.merged_into_id) map.set(r.id, r.merged_into_id);
  });
  return map;
}

/** 按 merged_into_id 解析仓位 ID：返回应展示的目标 ID（同仓库内） */
export async function resolveLocationId(warehouseId: string, locationId: string): Promise<string> {
  const map = await getLocationMergeMap(warehouseId);
  let current = locationId;
  const seen = new Set<string>();
  while (map.has(current) && !seen.has(current)) {
    seen.add(current);
    current = map.get(current)!;
  }
  return current;
}

/** 合并仓位（同仓库内）：只设置合并指向，不删记录、不修改出入库明细 */
export async function mergeLocations(
  sourceLocationIds: string[],
  targetLocationId: string
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');

  if (sourceLocationIds.length === 0) throw new Error('No source locations to merge');
  if (sourceLocationIds.includes(targetLocationId)) throw new Error('Cannot merge location into itself');

  const allIds = [...sourceLocationIds, targetLocationId];
  const { data: allRows, error: fetchError } = await supabase
    .from('location')
    .select('id, warehouse_id, merged_into_id')
    .in('id', allIds);

  if (fetchError) throw fetchError;
  if (!allRows || allRows.length !== allIds.length) {
    throw new Error('Location does not exist');
  }

  const warehouseId = allRows[0]?.warehouse_id;
  if (!warehouseId || !allRows.every((r: any) => r.warehouse_id === warehouseId)) {
    throw new Error('All locations must belong to the same warehouse');
  }

  const mergeMap = new Map<string, string>();
  const { data: withPointer } = await supabase
    .from('location')
    .select('id, merged_into_id')
    .eq('warehouse_id', warehouseId)
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

  const finalTargetId = resolveToFinal(targetLocationId);

  for (const sourceId of sourceLocationIds) {
    await supabase
      .from('location')
      .update({ merged_into_id: finalTargetId })
      .eq('warehouse_id', warehouseId)
      .eq('merged_into_id', sourceId);

    const { error: setSource } = await supabase
      .from('location')
      .update({ merged_into_id: finalTargetId })
      .eq('id', sourceId)
      .eq('warehouse_id', warehouseId);
    if (setSource) throw setSource;
  }
}

/** 取消合并：将子仓位的 merged_into_id 置为 null，使其重新成为根 */
export async function unmergeLocation(locationId: string, warehouseId: string): Promise<void> {
  const { error } = await supabase
    .from('location')
    .update({ merged_into_id: null })
    .eq('id', locationId)
    .eq('warehouse_id', warehouseId);

  if (error) throw error;
}

/** 合并历史用（同仓库内）：无指向的根仓位列表 + 每个根下“指向其”的子仓位列表 */
export type LocationsMergeHistoryData = {
  roots: Location[];
  childrenByRootId: Map<string, Location[]>;
};

export async function getLocationsForMergeHistory(warehouseId: string): Promise<LocationsMergeHistoryData> {
  const { data: allRows, error } = await supabase
    .from('location')
    .select('*')
    .eq('warehouse_id', warehouseId)
    .order('name', { ascending: true });

  if (error) throw error;
  const rows = allRows || [];

  const roots = rows.filter((r: any) => r.merged_into_id == null).map((row: any) => mapLocationRow(row));
  const childrenByRootId = new Map<string, Location[]>();
  for (const root of roots) {
    const children = rows.filter((r: any) => r.merged_into_id === root.id).map((row: any) => mapLocationRow(row));
    if (children.length) childrenByRootId.set(root.id, children);
  }
  return { roots, childrenByRootId };
}

/** 各仓位直接关联的出入库明细数量（按 location_id 统计），暂无则返回空 */
export type LocationUsageCounts = {
  usageCountByLocationId: Record<string, number>;
};

export async function getLocationUsageCounts(_warehouseId: string): Promise<LocationUsageCounts> {
  const usageCountByLocationId: Record<string, number> = {};
  try {
    const { data: outbound } = await supabase.from('outbound_item').select('location_id').not('location_id', 'is', null);
    (outbound || []).forEach((r: any) => {
      if (r.location_id) usageCountByLocationId[r.location_id] = (usageCountByLocationId[r.location_id] || 0) + 1;
    });
    const { data: inbound } = await supabase.from('inbound_item').select('location_id').not('location_id', 'is', null);
    (inbound || []).forEach((r: any) => {
      if (r.location_id) usageCountByLocationId[r.location_id] = (usageCountByLocationId[r.location_id] || 0) + 1;
    });
  } catch {
    // 表可能不存在，忽略
  }
  return { usageCountByLocationId };
}
