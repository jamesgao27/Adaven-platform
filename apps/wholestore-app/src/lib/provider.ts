import { getCurrentSpace, getPlatformClient } from '@adaven/platform-core';
import { fetchSpaceEntitlements, requireActiveSubscription } from './space-entitlements';

export type DealerStatus = 'pending' | 'approved' | 'rejected';
export type OrderStatus = 'onboarding' | 'processing' | 'completed' | 'cancelled';

export type DealerDisplayStatus = 'new' | 'to_follow_up' | 'in_service' | 'to_revisit' | 'churned';

export const DEALER_DISPLAY_STATUS_LABELS: Record<DealerDisplayStatus, string> = {
  new: 'New',
  to_follow_up: 'To Follow Up',
  in_service: 'In Service',
  to_revisit: 'To Revisit',
  churned: 'Churned',
};

export type DealerFollowUpKind =
  | 'note'
  | 'order_created'
  | 'order_started'
  | 'order_completed'
  | 'order_cancelled';

export type DealerFollowUp = {
  id: string;
  providerSpaceId: string;
  consumerId: string;
  consumerSpaceId: string | null;
  content: string;
  kind: DealerFollowUpKind;
  referenceId: string | null;
  createdAt: string;
  createdBy: string | null;
};

export type ProviderDealer = {
  id: string;
  providerSpaceId: string;
  consumerSpaceId: string | null;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  status: DealerStatus;
  labels: string[];
  lastFollowUpAt: string | null;
  inviteTokenId: string | null;
  posterId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProviderDealerWithDetails = ProviderDealer & {
  isPendingClaim: boolean;
  displayStatus: DealerDisplayStatus;
  firstOrderAt: string | null;
  orderCount: number;
};

export type ProviderSku = {
  id: string;
  providerSpaceId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProviderOrderLine = {
  id: string;
  orderId: string;
  skuId: string;
  skuName: string;
  quantity: number;
  sortOrder: number;
};

export type OrderRequestOrigin = 'provider_manual' | 'consumer_marketplace';

export type ProviderOrder = {
  id: string;
  providerSpaceId: string;
  consumerId: string;
  consumerSpaceId: string | null;
  dealerName: string;
  factoryName: string;
  status: OrderStatus;
  requestOrigin: OrderRequestOrigin;
  createdAt: string;
  updatedAt: string;
  lines: ProviderOrderLine[];
};

function db() {
  return getPlatformClient().schema('provider');
}

function mapDealer(row: Record<string, any>): ProviderDealer {
  return {
    id: row.id,
    providerSpaceId: row.provider_space_id,
    consumerSpaceId: row.consumer_space_id ?? null,
    name: row.display_name || '—',
    contactName: row.contact_name ?? null,
    contactEmail: row.contact_email ?? null,
    status: (row.status as DealerStatus) || 'pending',
    labels: Array.isArray(row.labels) ? row.labels.filter((x: unknown) => typeof x === 'string' && x.trim()) : [],
    lastFollowUpAt: row.last_follow_up_at ?? null,
    inviteTokenId: row.invite_token_id ?? null,
    posterId: row.poster_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function computeDealerDisplayStatus(dealer: ProviderDealer, orders: ProviderOrder[]): DealerDisplayStatus {
  if (!dealer.consumerSpaceId && orders.length === 0) return 'new';
  const active = orders.filter((o) => o.status === 'onboarding' || o.status === 'processing');
  if (active.length) return 'in_service';
  if (orders.length === 0) return 'new';
  const closed = orders.every((o) => o.status === 'completed' || o.status === 'cancelled');
  if (closed) {
    if (!dealer.lastFollowUpAt) return 'to_follow_up';
    return 'churned';
  }
  if (!dealer.lastFollowUpAt) return 'to_follow_up';
  return 'to_revisit';
}

function mapSku(row: Record<string, any>): ProviderSku {
  return {
    id: row.id,
    providerSpaceId: row.provider_space_id,
    name: row.name,
    description: row.description ?? null,
    imageUrl: row.image_url ?? null,
    isPublished: row.is_published === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function requireProviderSpace() {
  const space = await getCurrentSpace(true);
  if (!space?.id || space.kind !== 'provider') return null;
  return space;
}

export async function listDealers(providerSpaceId: string): Promise<ProviderDealer[]> {
  const { data, error } = await db()
    .from('consumers')
    .select('*')
    .eq('provider_space_id', providerSpaceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapDealer);
}

export async function listDealersWithDetails(providerSpaceId: string): Promise<ProviderDealerWithDetails[]> {
  const [dealers, orders] = await Promise.all([listDealers(providerSpaceId), listOrders(providerSpaceId)]);
  const ordersByDealer = new Map<string, ProviderOrder[]>();
  for (const order of orders) {
    const list = ordersByDealer.get(order.consumerId) ?? [];
    list.push(order);
    ordersByDealer.set(order.consumerId, list);
  }
  return dealers.map((d) => {
    const dealerOrders = ordersByDealer.get(d.id) ?? [];
    const first = dealerOrders.reduce<string | null>((acc, o) => {
      if (!acc || o.createdAt < acc) return o.createdAt;
      return acc;
    }, null);
    return {
      ...d,
      isPendingClaim: !d.consumerSpaceId,
      displayStatus: computeDealerDisplayStatus(d, dealerOrders),
      firstOrderAt: first,
      orderCount: dealerOrders.length,
    };
  });
}

export async function updateDealerLabels(id: string, labels: string[]): Promise<void> {
  const cleaned = labels.map((t) => t.trim()).filter(Boolean);
  const { error } = await db().from('consumers').update({ labels: cleaned }).eq('id', id);
  if (error) throw error;
}

export async function getDealerFollowUps(consumerId: string): Promise<DealerFollowUp[]> {
  const { data, error } = await db()
    .from('consumer_follow_ups')
    .select('*')
    .eq('consumer_id', consumerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, any>) => ({
    id: row.id,
    providerSpaceId: row.provider_space_id,
    consumerId: row.consumer_id,
    consumerSpaceId: row.consumer_space_id ?? null,
    content: row.content ?? '',
    kind: (row.kind ?? 'note') as DealerFollowUpKind,
    referenceId: row.reference_id ?? null,
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
  }));
}

export async function addDealerFollowUp(
  providerSpaceId: string,
  consumerId: string,
  content: string,
  consumerSpaceId?: string | null
): Promise<void> {
  const { data: user } = await getPlatformClient().auth.getUser();
  const { error } = await db()
    .from('consumer_follow_ups')
    .insert({
      provider_space_id: providerSpaceId,
      consumer_id: consumerId,
      consumer_space_id: consumerSpaceId || null,
      content: content.trim(),
      kind: 'note',
      created_by: user.user?.id ?? null,
    });
  if (error) throw error;
}

export async function getDealer(id: string): Promise<ProviderDealer | null> {
  const { data, error } = await db().from('consumers').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapDealer(data) : null;
}

export async function createDealer(input: {
  providerSpaceId: string;
  name: string;
  contactName?: string;
  contactEmail?: string;
  posterId: string;
}): Promise<ProviderDealer> {
  requireActiveSubscription(await fetchSpaceEntitlements(input.providerSpaceId));
  const { data, error } = await db().rpc('create_consumer_with_space', {
    p_provider_space_id: input.providerSpaceId,
    p_consumer_name: input.name.trim(),
    p_contact_name: input.contactName?.trim() || null,
    p_contact_email: input.contactEmail?.trim() || null,
    p_poster_id: input.posterId,
  });
  if (error) throw error;
  const row = await getDealer(data as string);
  if (!row) throw new Error('Dealer created but not found');
  return row;
}

export async function updateDealer(
  id: string,
  patch: { name?: string; contactName?: string | null; contactEmail?: string | null; status?: DealerStatus }
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name != null) row.display_name = patch.name.trim();
  if (patch.contactName !== undefined) row.contact_name = patch.contactName?.trim() || null;
  if (patch.contactEmail !== undefined) row.contact_email = patch.contactEmail?.trim() || null;
  if (patch.status) row.status = patch.status;
  const { error } = await db().from('consumers').update(row).eq('id', id);
  if (error) throw error;
}

export async function deleteDealers(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await db().from('consumers').delete().in('id', ids);
  if (error) throw error;
}

export async function listSkus(providerSpaceId: string): Promise<ProviderSku[]> {
  const { data, error } = await db()
    .from('skus')
    .select('*')
    .eq('provider_space_id', providerSpaceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapSku);
}

export async function getSku(id: string): Promise<ProviderSku | null> {
  const { data, error } = await db().from('skus').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapSku(data) : null;
}

export async function createSku(providerSpaceId: string, name = 'New SKU'): Promise<ProviderSku> {
  const { data, error } = await db()
    .from('skus')
    .insert({
      provider_space_id: providerSpaceId,
      name,
      is_published: false,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapSku(data);
}

export async function updateSku(
  id: string,
  patch: { name?: string; description?: string | null; imageUrl?: string | null; isPublished?: boolean }
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name != null) row.name = patch.name;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.imageUrl !== undefined) row.image_url = patch.imageUrl;
  if (patch.isPublished !== undefined) row.is_published = patch.isPublished;
  const { error } = await db().from('skus').update(row).eq('id', id);
  if (error) throw error;
}

export async function deleteSku(id: string): Promise<void> {
  const { error } = await db().from('skus').delete().eq('id', id);
  if (error) throw error;
}

async function attachLines(orders: Record<string, any>[]): Promise<ProviderOrder[]> {
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const { data: lines, error } = await db()
    .from('order_lines')
    .select('id, order_id, sku_id, quantity, sort_order')
    .in('order_id', ids)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  const skuIds = [...new Set((lines ?? []).map((l) => l.sku_id))];
  const skuNameById = new Map<string, string>();
  if (skuIds.length) {
    const { data: skus } = await db().from('skus').select('id, name').in('id', skuIds);
    for (const s of skus ?? []) skuNameById.set(s.id, s.name || '—');
  }
  const byOrder = new Map<string, ProviderOrderLine[]>();
  for (const line of lines ?? []) {
    const item: ProviderOrderLine = {
      id: line.id,
      orderId: line.order_id,
      skuId: line.sku_id,
      skuName: skuNameById.get(line.sku_id) || '—',
      quantity: Number(line.quantity) || 1,
      sortOrder: line.sort_order ?? 0,
    };
    const list = byOrder.get(line.order_id) ?? [];
    list.push(item);
    byOrder.set(line.order_id, list);
  }
  const consumerIds = [...new Set(orders.map((o) => o.consumer_id))];
  const { data: dealers } = await db().from('consumers').select('id, display_name').in('id', consumerIds);
  const nameById = new Map((dealers ?? []).map((d) => [d.id, d.display_name || '—']));
  const factoryIds = [...new Set(orders.map((o) => o.provider_space_id).filter(Boolean))];
  const factoryNameById = new Map<string, string>();
  if (factoryIds.length) {
    const { data: factories } = await getPlatformClient().from('spaces').select('id, name').in('id', factoryIds);
    for (const s of factories ?? []) factoryNameById.set(s.id, s.name || '—');
  }
  return orders.map((o) => ({
    id: o.id,
    providerSpaceId: o.provider_space_id,
    consumerId: o.consumer_id,
    consumerSpaceId: o.consumer_space_id ?? null,
    dealerName: nameById.get(o.consumer_id) || '—',
    factoryName: factoryNameById.get(o.provider_space_id) || '—',
    status: (o.status as OrderStatus) || 'onboarding',
    requestOrigin: (o.request_origin as OrderRequestOrigin) || 'provider_manual',
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    lines: byOrder.get(o.id) ?? [],
  }));
}

export async function listOrders(providerSpaceId: string): Promise<ProviderOrder[]> {
  const { data, error } = await db()
    .from('orders')
    .select('*')
    .eq('provider_space_id', providerSpaceId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return attachLines(data ?? []);
}

export async function listOrdersForDealer(consumerId: string): Promise<ProviderOrder[]> {
  const { data, error } = await db()
    .from('orders')
    .select('*')
    .eq('consumer_id', consumerId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return attachLines(data ?? []);
}

export async function listOrdersForConsumerSpace(consumerSpaceId: string): Promise<ProviderOrder[]> {
  const { data, error } = await db()
    .from('orders')
    .select('*')
    .eq('consumer_space_id', consumerSpaceId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return attachLines(data ?? []);
}

export async function getOrder(id: string): Promise<ProviderOrder | null> {
  const { data, error } = await db().from('orders').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [order] = await attachLines([data]);
  return order ?? null;
}

export async function updateOrderStatus(id: string, status: OrderStatus): Promise<void> {
  const { error } = await db().from('orders').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function cancelOrders(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await db().from('orders').update({ status: 'cancelled' }).in('id', ids);
  if (error) throw error;
}

export async function upsertOrderLine(orderId: string, skuId: string, quantity: number): Promise<void> {
  const { data: existing } = await db()
    .from('order_lines')
    .select('id')
    .eq('order_id', orderId)
    .eq('sku_id', skuId)
    .maybeSingle();
  if (existing) {
    const { error } = await db().from('order_lines').update({ quantity }).eq('id', existing.id);
    if (error) throw error;
    return;
  }
  const { count } = await db().from('order_lines').select('id', { count: 'exact', head: true }).eq('order_id', orderId);
  const { error } = await db().from('order_lines').insert({
    order_id: orderId,
    sku_id: skuId,
    quantity,
    sort_order: count ?? 0,
  });
  if (error) throw error;
}

export async function deleteOrderLine(lineId: string): Promise<void> {
  const { error } = await db().from('order_lines').delete().eq('id', lineId);
  if (error) throw error;
}

export function skuSummary(order: ProviderOrder): string {
  if (!order.lines.length) return '—';
  return order.lines.map((l) => (l.quantity === 1 ? l.skuName : `${l.skuName} ×${l.quantity}`)).join(', ');
}
