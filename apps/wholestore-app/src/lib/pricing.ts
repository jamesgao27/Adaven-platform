import { getPlatformClient } from '@adaven/platform-core';

function db() {
  return getPlatformClient().schema('provider');
}

export type PriceList = {
  id: string;
  providerSpaceId: string;
  name: string;
  currency: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PriceListItem = {
  id: string;
  priceListId: string;
  skuId: string;
  skuName: string;
  skuCode: string | null;
  unitPrice: number;
  moq: number;
};

export type DealerShopSku = {
  skuId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  skuCode: string | null;
  qtyOnHand: number | null;
  unitPrice: number;
  moq: number;
  currency: string;
};

function mapList(row: Record<string, any>): PriceList {
  return {
    id: row.id,
    providerSpaceId: row.provider_space_id,
    name: row.name,
    currency: row.currency || 'USD',
    isDefault: row.is_default === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPriceLists(providerSpaceId: string): Promise<PriceList[]> {
  const { data, error } = await db()
    .from('price_lists')
    .select('*')
    .eq('provider_space_id', providerSpaceId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapList);
}

export async function createPriceList(providerSpaceId: string, name: string): Promise<PriceList> {
  const existing = await listPriceLists(providerSpaceId);
  const { data, error } = await db()
    .from('price_lists')
    .insert({
      provider_space_id: providerSpaceId,
      name: name.trim() || 'Price list',
      currency: 'USD',
      is_default: existing.length === 0,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapList(data);
}

export async function setDefaultPriceList(providerSpaceId: string, priceListId: string): Promise<void> {
  // Clear existing default first (partial unique index on is_default).
  const { error: clearErr } = await db()
    .from('price_lists')
    .update({ is_default: false })
    .eq('provider_space_id', providerSpaceId)
    .eq('is_default', true);
  if (clearErr) throw clearErr;
  const { error } = await db().from('price_lists').update({ is_default: true }).eq('id', priceListId);
  if (error) throw error;
}

export async function listPriceListItems(priceListId: string): Promise<PriceListItem[]> {
  const { data, error } = await db()
    .from('price_list_items')
    .select('id, price_list_id, sku_id, unit_price, moq')
    .eq('price_list_id', priceListId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const skuIds = [...new Set((data ?? []).map((r) => r.sku_id))];
  const nameById = new Map<string, { name: string; code: string | null }>();
  if (skuIds.length) {
    const { data: skus } = await db().from('skus').select('id, name, sku_code').in('id', skuIds);
    for (const s of skus ?? []) nameById.set(s.id, { name: s.name || '—', code: s.sku_code ?? null });
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    priceListId: row.price_list_id,
    skuId: row.sku_id,
    skuName: nameById.get(row.sku_id)?.name || '—',
    skuCode: nameById.get(row.sku_id)?.code ?? null,
    unitPrice: Number(row.unit_price),
    moq: Number(row.moq) || 1,
  }));
}

export async function upsertPriceListItem(
  priceListId: string,
  skuId: string,
  unitPrice: number,
  moq: number,
): Promise<void> {
  const { data: existing } = await db()
    .from('price_list_items')
    .select('id')
    .eq('price_list_id', priceListId)
    .eq('sku_id', skuId)
    .maybeSingle();
  if (existing) {
    const { error } = await db()
      .from('price_list_items')
      .update({ unit_price: unitPrice, moq })
      .eq('id', existing.id);
    if (error) throw error;
    return;
  }
  const { error } = await db().from('price_list_items').insert({
    price_list_id: priceListId,
    sku_id: skuId,
    unit_price: unitPrice,
    moq,
  });
  if (error) throw error;
}

export async function deletePriceListItem(id: string): Promise<void> {
  const { error } = await db().from('price_list_items').delete().eq('id', id);
  if (error) throw error;
}

export async function getConsumerPriceListId(consumerId: string): Promise<string | null> {
  const { data, error } = await db()
    .from('consumer_price_lists')
    .select('price_list_id')
    .eq('consumer_id', consumerId)
    .maybeSingle();
  if (error) throw error;
  return data?.price_list_id ?? null;
}

export async function assignPriceListToConsumer(consumerId: string, priceListId: string): Promise<void> {
  const { error } = await db().from('consumer_price_lists').upsert(
    { consumer_id: consumerId, price_list_id: priceListId },
    { onConflict: 'consumer_id' },
  );
  if (error) throw error;
}

export async function clearConsumerPriceList(consumerId: string): Promise<void> {
  const { error } = await db().from('consumer_price_lists').delete().eq('consumer_id', consumerId);
  if (error) throw error;
}

export async function listDealerShopSkus(
  consumerSpaceId: string,
  providerSpaceId: string,
): Promise<DealerShopSku[]> {
  const { data, error } = await db().rpc('list_dealer_shop_skus', {
    p_consumer_space_id: consumerSpaceId,
    p_provider_space_id: providerSpaceId,
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, any>) => ({
    skuId: row.sku_id,
    name: row.name,
    description: row.description ?? null,
    imageUrl: row.image_url ?? null,
    skuCode: row.sku_code ?? null,
    qtyOnHand: row.qty_on_hand != null ? Number(row.qty_on_hand) : null,
    unitPrice: Number(row.unit_price),
    moq: Number(row.moq) || 1,
    currency: row.currency || 'USD',
  }));
}
