import { supabase } from './supabase';
import { Outbound, OutboundItem, Sku } from '@/types';
import { getCurrentUser } from './auth';
import { getSkuById } from './skus';
import { findOrCreateEntity, getEntityMergeMap, getEntityById, resolveEntityId } from './entities';

function rowToOutbound(row: any, items: OutboundItem[] = []): Outbound {
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
    customerName: row.customer_name ?? row.entities?.name ?? undefined,
    warehouseId: row.warehouse_id ?? undefined,
    locationId: row.location_id ?? undefined,
    totalAmount: row.total_amount != null ? Number(row.total_amount) : undefined,
    totalTax: row.total_tax != null ? Number(row.total_tax) : undefined,
    currency: row.currency ?? undefined,
    date: row.date,
    status: row.status ?? 'pending',
    handlerId: row.handler_id ?? undefined,
    handlerName: row.handler_name ?? undefined,
    preparerId: row.preparer_id ?? undefined,
    preparerName: row.preparer_name ?? undefined,
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
export async function getOutboundForListFirstPaint(): Promise<Outbound[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');
  const { data, error } = await supabase
    .from('outbound')
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
    const rc = { ...r, entities: entityRow, customer_name: entityRow?.name ?? r.customer_name };
    return rowToOutbound(rc, []);
  });
}

/** 获取当前空间下所有出库单（列表用，含 entity merge 解析） */
export async function getAllOutbound(): Promise<Outbound[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data, error } = await supabase
    .from('outbound')
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
    const rc = { ...r, entities: entityRow, customer_name: entityRow?.name ?? r.customer_name };
    return rowToOutbound(rc, []);
  });
}

/** 根据 ID 获取出库单（含明细） */
export async function getOutboundById(outboundId: string): Promise<Outbound | null> {
  const { data: row, error: rowError } = await supabase
    .from('outbound')
    .select('*')
    .eq('id', outboundId)
    .single();
  if (rowError || !row) return null;

  const { data: itemRows, error: itemsError } = await supabase
    .from('outbound_items')
    .select('*')
    .eq('outbound_id', outboundId)
    .order('id', { ascending: true });
  if (itemsError) return rowToOutbound(row, []);

  const rawItems = (itemRows || []).map((r: any) => ({
    id: r.id,
    outboundId: r.outbound_id,
    skuId: r.sku_id ?? undefined,
    lineNo: r.line_no != null ? Number(r.line_no) : undefined,
    quantity: Number(r.quantity),
    unitPrice: r.unit_price != null ? Number(r.unit_price) : undefined,
    amount: r.amount != null ? Number(r.amount) : undefined,
    supplyPrice: r.supply_price != null ? Number(r.supply_price) : undefined,
    tax: r.tax != null ? Number(r.tax) : undefined,
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

  const items: OutboundItem[] = rawItems.map((i) => {
    const sku = i.skuId ? skuMap[i.skuId] : null;
    return {
      ...i,
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
  return rowToOutbound({ ...row, entities, customer_name: entities?.name ?? row.customer_name }, items);
}

const INVALID_ENTITY_NAMES = ['processing', 'processing...', 'pending', 'pending...', 'loading', 'loading...', '识别中', '处理中', '待处理'];

/** 保存出库单（新建或更新）；原纪录未关联 entities 且录入名称未匹配现有 entities 时，创建新 entity 并关联 */
export async function saveOutbound(outbound: Outbound): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  let entityId = outbound.entityId ?? outbound.entity?.id ?? null;
  const customerName = (outbound.customerName ?? outbound.entity?.name ?? '').trim();
  const isValidName = customerName.length > 0 && !INVALID_ENTITY_NAMES.includes(customerName.toLowerCase());
  if (!entityId && isValidName) {
    try {
      const entity = await findOrCreateEntity(customerName, false);
      entityId = entity.id;
    } catch (e) {
      console.warn('saveOutbound: findOrCreateEntity failed', e);
    }
  }

  const headerPayload = (isUpdate: boolean) => {
    const base: Record<string, unknown> = {
      document_no: outbound.documentNo ?? null,
      entity_id: entityId ?? null,
      customer_name: outbound.customerName ?? outbound.entity?.name ?? null,
      warehouse_id: outbound.warehouseId ?? null,
      location_id: outbound.locationId ?? null,
      total_amount: outbound.totalAmount ?? null,
      total_tax: outbound.totalTax ?? null,
      currency: outbound.currency ?? null,
      date: outbound.date,
      status: outbound.status,
      handler_id: outbound.handlerId ?? null,
      handler_name: outbound.handlerName ?? null,
      preparer_id: outbound.preparerId ?? null,
      preparer_name: outbound.preparerName ?? null,
      accountant_id: outbound.accountantId ?? null,
      accountant_name: outbound.accountantName ?? null,
      remarks: outbound.remarks ?? null,
      image_url: outbound.imageUrl ?? null,
      input_type: outbound.inputType ?? 'image',
      confidence: outbound.confidence ?? null,
    };
    if (isUpdate) base.updated_at = new Date().toISOString();
    else {
      base.space_id = spaceId;
      base.created_by = user.id;
    }
    return base;
  };

  const itemPayload = (it: OutboundItem, outboundId: string) => ({
    outbound_id: outboundId,
    sku_id: it.skuId ?? null,
    line_no: it.lineNo ?? null,
    quantity: it.quantity,
    unit_price: it.unitPrice ?? null,
    amount: it.amount ?? null,
    supply_price: it.supplyPrice ?? null,
    tax: it.tax ?? null,
    confidence: it.confidence ?? null,
    remarks: it.remarks ?? null,
  });

  if (outbound.id) {
    await supabase.from('outbound').update(headerPayload(true)).eq('id', outbound.id);
    if (outbound.items?.length) {
      await supabase.from('outbound_items').delete().eq('outbound_id', outbound.id);
      await supabase.from('outbound_items').insert(outbound.items.map((it) => itemPayload(it, outbound.id!)));
    }
    return outbound.id;
  }

  const { data: inserted, error } = await supabase
    .from('outbound')
    .insert(headerPayload(false))
    .select('id')
    .single();
  if (error) throw error;
  const id = inserted.id;
  if (outbound.items?.length) {
    await supabase.from('outbound_items').insert(outbound.items.map((it) => itemPayload(it, id)));
  }
  return id;
}

/** 删除出库单 */
export async function deleteOutbound(outboundId: string): Promise<void> {
  const { error } = await supabase.from('outbound').delete().eq('id', outboundId);
  if (error) throw error;
}
