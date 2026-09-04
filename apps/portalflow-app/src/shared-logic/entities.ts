import { supabase } from './supabase';
import { Entity } from '@/types';
import { getCurrentUser } from './auth';
import { normalizeNameForCompare } from './name-utils';

const TABLE = 'entities';

function mapRow(row: any): Entity {
  return {
    id: row.id,
    spaceId: row.space_id,
    name: row.name,
    taxNumber: row.tax_number,
    phone: row.phone,
    address: row.address,
    isAiRecognized: row.is_ai_recognized,
    mergedIntoId: row.merged_into_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 获取当前空间所有关联方（仅未被合并的，用于管理列表） */
export async function getEntities(): Promise<Entity[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('space_id', spaceId)
    .is('merged_into_id', null)
    .order('is_ai_recognized', { ascending: false })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []).map(mapRow);
}

/** 获取全部关联方（含已合并），供选单与大模型用 */
export async function getEntitiesForOptions(): Promise<Entity[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('space_id', spaceId)
    .order('is_ai_recognized', { ascending: false })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []).map(mapRow);
}

export async function createEntity(
  name: string,
  isAiRecognized: boolean = false,
  taxNumber?: string,
  phone?: string,
  address?: string
): Promise<Entity> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data, error } = await supabase
    .from(TABLE)
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
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from(TABLE)
        .select('*')
        .eq('space_id', spaceId)
        .eq('name', name.trim())
        .single();
      if (existing) return mapRow(existing);
    }
    throw error;
  }
  return mapRow(data);
}

export async function updateEntity(
  entityId: string,
  updates: { name?: string; taxNumber?: string; phone?: string; address?: string }
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  if (updates.name !== undefined) {
    const trimmed = updates.name.trim();
    if (trimmed.length > 0) {
      const all = await getEntitiesForOptions();
      const found = all.find((o) => normalizeNameForCompare(o.name) === normalizeNameForCompare(trimmed));
      if (found) {
        const current = await resolveEntityId(spaceId, entityId);
        const target = await resolveEntityId(spaceId, found.id);
        if (current !== target) {
          throw Object.assign(new Error('关联方名称已存在'), {
            code: 'ENTITY_NAME_EXISTS' as const,
            duplicateName: trimmed,
            targetId: target,
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
    .from(TABLE)
    .update(updateData)
    .eq('id', entityId)
    .eq('space_id', spaceId)
    .select('id')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') throw new Error('关联方名称已存在');
    throw error;
  }
  if (updated == null) throw new Error('未找到要更新的关联方，请刷新后重试');
}

export async function deleteEntity(entityId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { error } = await supabase.from(TABLE).delete().eq('id', entityId).eq('space_id', spaceId);
  if (error) throw error;
}

function normalizeEntityName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[：:]/g, ':')
    .replace(/有限公司/g, '')
    .replace(/股份有限公司/g, '')
    .replace(/有限责任公司/g, '')
    .replace(/公司/g, '')
    .replace(/商店/g, '')
    .replace(/超市/g, '')
    .replace(/商场/g, '');
}

function isValidEntityName(name: string): boolean {
  const trimmed = name.trim().toLowerCase();
  const invalid = ['processing', 'processing...', 'pending', 'pending...', 'loading', 'loading...', '识别中', '处理中', '待处理', ''];
  return trimmed.length > 0 && !invalid.includes(trimmed);
}

/** AI 识别到新对方时：查找或创建 entities 表记录 */
export async function findOrCreateEntity(
  name: string,
  isAiRecognized: boolean = true,
  taxNumber?: string,
  phone?: string,
  address?: string
): Promise<Entity> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const trimmedName = name.trim();
  if (!trimmedName || !isValidEntityName(trimmedName)) {
    throw new Error('Invalid entity name: name cannot be empty or a processing status');
  }
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data: allRows, error: fetchError } = await supabase.from(TABLE).select('*').eq('space_id', spaceId);
  if (fetchError) throw fetchError;
  if (!allRows?.length) return await createEntity(trimmedName, isAiRecognized, taxNumber, phone, address);

  const normalized = normalizeEntityName(trimmedName);
  const mergeHistory = await getMergeHistory();
  const mergedTargetId = mergeHistory.get(normalized);
  if (mergedTargetId) {
    const merged = allRows.find((r: any) => r.id === mergedTargetId);
    if (merged) {
      const shouldUpdate =
        (taxNumber && !merged.tax_number) || (phone && !merged.phone) || (address && !merged.address);
      if (shouldUpdate) {
        try {
          await updateEntity(merged.id, {
            taxNumber: taxNumber || merged.tax_number,
            phone: phone || merged.phone,
            address: address || merged.address,
          });
        } catch (e: any) {
          if (e?.code !== 'ENTITY_NAME_EXISTS' && e?.message !== '关联方名称已存在') throw e;
        }
      }
      const { data: updated } = await supabase.from(TABLE).select('*').eq('id', merged.id).single();
      if (updated) return mapRow(updated);
      return mapRow(merged);
    }
  }

  const exactMatch = allRows.find((r: any) => normalizeEntityName(r.name) === normalized);
  if (exactMatch) {
    const shouldUpdate =
      (taxNumber && !exactMatch.tax_number) || (phone && !exactMatch.phone) || (address && !exactMatch.address);
    if (shouldUpdate) {
      try {
        await updateEntity(exactMatch.id, {
          taxNumber: taxNumber || exactMatch.tax_number,
          phone: phone || exactMatch.phone,
          address: address || exactMatch.address,
        });
      } catch (e: any) {
        if (e?.code !== 'ENTITY_NAME_EXISTS' && e?.message !== '关联方名称已存在') throw e;
      }
    }
    const { data: updated } = await supabase.from(TABLE).select('*').eq('id', exactMatch.id).single();
    if (updated) return mapRow(updated);
    return mapRow(exactMatch);
  }

  if (taxNumber?.trim()) {
    const byTax = allRows.find((r: any) => r.tax_number?.trim() === taxNumber.trim());
    if (byTax) {
      if (trimmedName.length > byTax.name.length) {
        try {
          await updateEntity(byTax.id, { name: trimmedName });
        } catch (e: any) {
          if (e?.code !== 'ENTITY_NAME_EXISTS' && e?.message !== '关联方名称已存在') throw e;
        }
      }
      const { data: updated } = await supabase.from(TABLE).select('*').eq('id', byTax.id).single();
      if (updated) return mapRow(updated);
      return mapRow(byTax);
    }
  }

  return await createEntity(trimmedName, isAiRecognized, taxNumber, phone, address);
}

export async function mergeEntity(sourceEntityIds: string[], targetEntityId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  if (sourceEntityIds.length === 0) throw new Error('No source entities to merge');
  if (sourceEntityIds.includes(targetEntityId)) throw new Error('Cannot merge entity to itself');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const allIds = [...sourceEntityIds, targetEntityId];
  const { data: rows, error: fetchError } = await supabase
    .from(TABLE)
    .select('id, merged_into_id')
    .eq('space_id', spaceId)
    .in('id', allIds);
  if (fetchError) throw fetchError;
  if (!rows || rows.length !== allIds.length) throw new Error('Entity does not exist or does not belong to current space');

  const mergeMap = new Map<string, string>();
  const { data: withPointer } = await supabase
    .from(TABLE)
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
  const finalTargetId = resolveToFinal(targetEntityId);

  for (const sourceId of sourceEntityIds) {
    await supabase.from(TABLE).update({ merged_into_id: finalTargetId }).eq('space_id', spaceId).eq('merged_into_id', sourceId);
    const { error: setSource } = await supabase.from(TABLE).update({ merged_into_id: finalTargetId }).eq('id', sourceId).eq('space_id', spaceId);
    if (setSource) throw setSource;
  }
}

export async function unmergeEntity(entityId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');
  const { error } = await supabase.from(TABLE).update({ merged_into_id: null }).eq('id', entityId).eq('space_id', spaceId);
  if (error) throw error;
}

export type EntitiesMergeHistoryData = { roots: Entity[]; childrenByRootId: Map<string, Entity[]> };

export async function getEntitiesForMergeHistory(): Promise<EntitiesMergeHistoryData> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');
  const { data: rows, error } = await supabase.from(TABLE).select('*').eq('space_id', spaceId).order('name', { ascending: true });
  if (error) throw error;
  const list = rows || [];
  const roots = list.filter((r: any) => r.merged_into_id == null).map(mapRow);
  const childrenByRootId = new Map<string, Entity[]>();
  for (const root of roots) {
    const children = list.filter((r: any) => r.merged_into_id === root.id).map(mapRow);
    if (children.length) childrenByRootId.set(root.id, children);
  }
  return { roots, childrenByRootId };
}

export async function getEntityMergeMap(spaceId: string): Promise<Map<string, string>> {
  const { data: rows } = await supabase.from(TABLE).select('id, merged_into_id').eq('space_id', spaceId).not('merged_into_id', 'is', null);
  const map = new Map<string, string>();
  (rows || []).forEach((r: any) => {
    if (r.id && r.merged_into_id) map.set(r.id, r.merged_into_id);
  });
  return map;
}

export async function resolveEntityId(spaceId: string, entityId: string): Promise<string> {
  const map = await getEntityMergeMap(spaceId);
  let current = entityId;
  const seen = new Set<string>();
  while (map.has(current) && !seen.has(current)) {
    seen.add(current);
    current = map.get(current)!;
  }
  return current;
}

/** 列表分组 / 替换弹窗用：已 merge 的 entity 归一到最终目标 id。 */
export function getCanonicalEntityId(record?: {
  entityId?: string | null;
  entity?: { id?: string; mergedIntoId?: string | null } | null;
} | null): string | null {
  if (!record) return null;
  const merged = record.entity?.mergedIntoId;
  if (merged) return merged;
  if (record.entity?.id) return record.entity.id;
  return record.entityId ?? null;
}

export async function getEntityById(id: string): Promise<Entity | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) return null;
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).eq('space_id', spaceId).maybeSingle();
  if (error || !data) return null;
  return mapRow(data);
}

/** 各 entity 关联的凭证数量（receipts + invoices + inbound + outbound 的 entity_id 统计） */
export type EntityUsageCounts = {
  receiptCountByEntityId: Record<string, number>;
  invoiceCountByEntityId: Record<string, number>;
  inboundCountByEntityId: Record<string, number>;
  outboundCountByEntityId: Record<string, number>;
};

export async function getEntityUsageCounts(): Promise<EntityUsageCounts> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const receiptCountByEntityId: Record<string, number> = {};
  const invoiceCountByEntityId: Record<string, number> = {};
  const inboundCountByEntityId: Record<string, number> = {};
  const outboundCountByEntityId: Record<string, number> = {};

  const [receipts, invoices, inbounds, outbounds] = await Promise.all([
    supabase.from('receipts').select('entity_id').eq('space_id', spaceId).not('entity_id', 'is', null),
    supabase.from('invoices').select('entity_id').eq('space_id', spaceId).not('entity_id', 'is', null),
    supabase.from('inbound').select('entity_id').eq('space_id', spaceId).not('entity_id', 'is', null),
    supabase.from('outbound').select('entity_id').eq('space_id', spaceId).not('entity_id', 'is', null),
  ]);

  (receipts.data || []).forEach((r: any) => { if (r.entity_id) receiptCountByEntityId[r.entity_id] = (receiptCountByEntityId[r.entity_id] || 0) + 1; });
  (invoices.data || []).forEach((r: any) => { if (r.entity_id) invoiceCountByEntityId[r.entity_id] = (invoiceCountByEntityId[r.entity_id] || 0) + 1; });
  (inbounds.data || []).forEach((r: any) => { if (r.entity_id) inboundCountByEntityId[r.entity_id] = (inboundCountByEntityId[r.entity_id] || 0) + 1; });
  (outbounds.data || []).forEach((r: any) => { if (r.entity_id) outboundCountByEntityId[r.entity_id] = (outboundCountByEntityId[r.entity_id] || 0) + 1; });

  return { receiptCountByEntityId, invoiceCountByEntityId, inboundCountByEntityId, outboundCountByEntityId };
}

async function getMergeHistory(): Promise<Map<string, string>> {
  try {
    const user = await getCurrentUser();
    if (!user) return new Map();
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) return new Map();
    const { data: withPointer, error } = await supabase.from(TABLE).select('id, name, merged_into_id').eq('space_id', spaceId).not('merged_into_id', 'is', null);
    if (error || !withPointer?.length) return new Map();
    const mergeMap = new Map<string, string>();
    withPointer.forEach((r: any) => {
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
    const history = new Map<string, string>();
    for (const r of withPointer) {
      history.set(normalizeEntityName(r.name), resolveToFinal(r.id));
    }
    return history;
  } catch (e) {
    return new Map();
  }
}
