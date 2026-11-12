import { supabase } from './supabase';
import { Inbound, InboundItem, Sku } from '@/types';
import { getCurrentUser } from './auth';
import { getSkuById } from './skus';
import { findOrCreateEntity, getEntityMergeMap, getEntityById, resolveEntityId } from './entities';

function rowToInbound(row: any, items: InboundItem[] = []): Inbound {
  const entity = row.entities ? {
    id: row.entities.id,
    spaceId: row.entities.space_id ?? row.entities.spaceId,
    name: row.entities.name,
    taxNumber: row.entities.tax_number ?? row.entities.taxNumber,
    phone: row.entities.phone,
    address: row.entities.address,
    isAiRecognized: row.entities.is_ai_recognized ?? row.entities.isAiRecognized,
    mergedIntoId: row.entities.merged_into_id ?? row.entities.mergedIntoId,
    createdAt: row.entities.created_at ?? row.entities.createdAt,
    updatedAt: row.entities.updated_at ?? row.entities.updatedAt,
  } : undefined;
  return {
    id: row.id,
    spaceId: row.space_id,
    documentNo: row.document_no ?? undefined,
    entityId: row.entity_id ?? undefined,
    entity,
    supplierName: row.supplier_name ?? row.entities?.name ?? undefined,
    warehouseId: row.warehouse_id ?? undefined,
    locationId: row.location_id ?? undefined,
    inboundType: row.inbound_type ?? undefined,
    totalAmount: row.total_amount != null ? Number(row.total_amount) : undefined,
    totalAmountChinese: row.total_amount_chinese ?? undefined,
    currency: row.currency ?? undefined,
    date: row.date,
    status: row.status ?? 'pending',
    handlerId: row.handler_id ?? undefined,
    handlerName: row.handler_name ?? undefined,
    warehouseKeeperId: row.warehouse_keeper_id ?? undefined,
    warehouseKeeperName: row.warehouse_keeper_name ?? undefined,
    accountantId: row.accountant_id ?? undefined,
    accountantName: row.accountant_name ?? undefined,
    remarks: row.remarks ?? undefined,
    imageUrl: row.image_url ?? undefined,
    inputType: row.input_type ?? 'image',
    confidence: row.confidence != null ? Number(row.confidence) : undefined,
    createdBy: row.created_by ?? undefined,
    items,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const FIRST_PAINT_LIMIT = 15;

/** 首屏极速加载：limit 15、含 entity merge 解析，用于立即渲染为合并后名称 */
export async function getInboundForListFirstPaint(): Promise<Inbound[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');
  const { data, error } = await supabase
    .from('inbound')
    .select(`
      *,
      entities (id, name)
    `)
    .eq('space_id', spaceId)
    .order('date', { ascending: false })
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
  for (const r of rows) {
    if (r.entity_id) {
      const resolvedId = resolveEntity(r.entity_id);
      if (!r.entities || r.entities.id !== resolvedId) needResolved.add(resolvedId);
    }
  }
  const resolvedEntityCache = new Map<string, Awaited<ReturnType<typeof getEntityById>>>();
  if (needResolved.size > 0) {
    await Promise.all(Array.from(needResolved).map(async (id) => {
      const e = await getEntityById(id);
      if (e) resolvedEntityCache.set(id, e);
    }));
  }
  return rows.map((r: any) => {
    const resolvedEntityId = r.entity_id ? resolveEntity(r.entity_id) : null;
    const entityRow = (resolvedEntityId ? resolvedEntityCache.get(resolvedEntityId) : null) ?? r.entities;
    const rc = { ...r, entities: entityRow, supplier_name: entityRow?.name ?? r.supplier_name };
    return rowToInbound(rc, []);
  });
}

/** 获取当前空间下所有入库单（列表用，含 entity merge 解析） */
export async function getAllInbound(): Promise<Inbound[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data, error } = await supabase
    .from('inbound')
    .select(`
      *,
      entities (*)
    `)
    .eq('space_id', spaceId)
    .order('date', { ascending: false });

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
  for (const r of rows) {
    if (r.entity_id) {
      const resolvedId = resolveEntity(r.entity_id);
      if (!r.entities || r.entities.id !== resolvedId) needResolved.add(resolvedId);
    }
  }
  const resolvedEntityCache = new Map<string, Awaited<ReturnType<typeof getEntityById>>>();
  if (needResolved.size > 0) {
    await Promise.all(Array.from(needResolved).map(async (id) => {
      const e = await getEntityById(id);
      if (e) resolvedEntityCache.set(id, e);
    }));
  }
  return rows.map((r: any) => {
    const resolvedEntityId = r.entity_id ? resolveEntity(r.entity_id) : null;
    const entityRow = (resolvedEntityId ? resolvedEntityCache.get(resolvedEntityId) : null) ?? r.entities;
    const rc = { ...r, entities: entityRow, supplier_name: entityRow?.name ?? r.supplier_name };
    return rowToInbound(rc, []);
  });
}

/** 根据 ID 获取入库单（含明细） */
export async function getInboundById(inboundId: string): Promise<Inbound | null> {
  const { data: row, error: rowError } = await supabase
    .from('inbound')
    .select('*')
    .eq('id', inboundId)
    .single();
  if (rowError || !row) return null;

  const { data: itemRows, error: itemsError } = await supabase
    .from('inbound_items')
    .select('*')
    .eq('inbound_id', inboundId)
    .order('id', { ascending: true });
  if (itemsError) return rowToInbound(row, []);

  const rawItems = (itemRows || []).map((r: any) => ({
    id: r.id,
    inboundId: r.inbound_id,
    skuId: r.sku_id ?? undefined,
    lineNo: r.line_no != null ? Number(r.line_no) : undefined,
    quantity: Number(r.quantity),
    qualifiedQuantity: r.qualified_quantity != null ? Number(r.qualified_quantity) : undefined,
    defectiveQuantity: r.defective_quantity != null ? Number(r.defective_quantity) : undefined,
    unitPrice: r.unit_price != null ? Number(r.unit_price) : undefined,
    amount: r.amount != null ? Number(r.amount) : undefined,
    locationId: r.location_id ?? undefined,
    confidence: r.confidence != null ? Number(r.confidence) : undefined,
    remarks: r.remarks ?? undefined,
  }));

  const skuIds = [...new Set(rawItems.map((i) => i.skuId).filter(Boolean))] as string[];
  const skuMap: Record<string, Sku> = {};
  await Promise.all(
    skuIds.map(async (id) => {
      const sku = await getSkuById(id);
      if (sku) skuMap[id] = sku;
    })
  );

  const items: InboundItem[] = rawItems.map((i) => {
    const sku = i.skuId ? skuMap[i.skuId] : null;
    return {
      ...i,
      productCode: sku?.code,
      productName: sku?.name,
      unit: sku?.unit ?? '件',
      specification: sku?.description,
    };
  });
  const user = await getCurrentUser();
  const spaceId = user?.currentSpaceId || user?.spaceId || row.space_id;
  let entities = row.entities;
  if (row.entity_id && spaceId) {
    const resolvedId = await resolveEntityId(spaceId, row.entity_id);
    const e = await getEntityById(resolvedId);
    if (e) {
      entities = {
        id: e.id,
        space_id: e.spaceId,
        name: e.name,
        tax_number: e.taxNumber,
        phone: e.phone,
        address: e.address,
        is_ai_recognized: e.isAiRecognized,
        merged_into_id: e.mergedIntoId,
        created_at: e.createdAt,
        updated_at: e.updatedAt,
      };
    }
  }
  return rowToInbound({ ...row, entities, supplier_name: entities?.name ?? row.supplier_name }, items);
}

const INVALID_ENTITY_NAMES = ['processing', 'processing...', 'pending', 'pending...', 'loading', 'loading...', '识别中', '处理中', '待处理'];

/** 保存入库单（新建或更新）；原纪录未关联 entities 且录入名称未匹配现有 entities 时，创建新 entity 并关联 */
export async function saveInbound(inbound: Inbound): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  let entityId = inbound.entityId ?? inbound.entity?.id ?? null;
  const supplierName = (inbound.supplierName ?? inbound.entity?.name ?? '').trim();
  const isValidName = supplierName.length > 0 && !INVALID_ENTITY_NAMES.includes(supplierName.toLowerCase());
  if (!entityId && isValidName) {
    try {
      const entity = await findOrCreateEntity(supplierName, false);
      entityId = entity.id;
    } catch (e) {
      console.warn('saveInbound: findOrCreateEntity failed', e);
    }
  }

  const headerPayload = (isUpdate: boolean) => {
    const base: Record<string, unknown> = {
      document_no: inbound.documentNo ?? null,
      entity_id: entityId ?? null,
      supplier_name: inbound.supplierName ?? inbound.entity?.name ?? null,
      warehouse_id: inbound.warehouseId ?? null,
      location_id: inbound.locationId ?? null,
      inbound_type: inbound.inboundType ?? null,
      total_amount: inbound.totalAmount ?? null,
      total_amount_chinese: inbound.totalAmountChinese ?? null,
      currency: inbound.currency ?? null,
      date: inbound.date,
      status: inbound.status,
      handler_id: inbound.handlerId ?? null,
      handler_name: inbound.handlerName ?? null,
      warehouse_keeper_id: inbound.warehouseKeeperId ?? null,
      warehouse_keeper_name: inbound.warehouseKeeperName ?? null,
      accountant_id: inbound.accountantId ?? null,
      accountant_name: inbound.accountantName ?? null,
      remarks: inbound.remarks ?? null,
      image_url: inbound.imageUrl ?? null,
      input_type: inbound.inputType ?? 'image',
      confidence: inbound.confidence ?? null,
    };
    if (isUpdate) base.updated_at = new Date().toISOString();
    else base.space_id = spaceId;
    if (!isUpdate) base.created_by = user.id;
    return base;
  };

  const itemPayload = (it: InboundItem, inboundId: string) => ({
    inbound_id: inboundId,
    sku_id: it.skuId ?? null,
    line_no: it.lineNo ?? null,
    quantity: it.quantity,
    qualified_quantity: it.qualifiedQuantity ?? null,
    defective_quantity: it.defectiveQuantity ?? null,
    unit_price: it.unitPrice ?? null,
    amount: it.amount ?? null,
    location_id: it.locationId ?? null,
    confidence: it.confidence ?? null,
    remarks: it.remarks ?? null,
  });

  if (inbound.id) {
    await supabase.from('inbound').update(headerPayload(true)).eq('id', inbound.id);
    if (inbound.items?.length) {
      await supabase.from('inbound_items').delete().eq('inbound_id', inbound.id);
      await supabase.from('inbound_items').insert(inbound.items.map((it) => itemPayload(it, inbound.id!)));
    }
    return inbound.id;
  }

  const { data: inserted, error } = await supabase
    .from('inbound')
    .insert(headerPayload(false))
    .select('id')
    .single();
  if (error) throw error;
  const id = inserted.id;
  if (inbound.items?.length) {
    await supabase.from('inbound_items').insert(inbound.items.map((it) => itemPayload(it, id)));
  }
  return id;
}

/** 删除入库单 */
export async function deleteInbound(inboundId: string): Promise<void> {
  const { error } = await supabase.from('inbound').delete().eq('id', inboundId);
  if (error) throw error;
}
