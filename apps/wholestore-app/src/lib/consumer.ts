import { getCurrentSpace, getPlatformClient } from '@adaven/platform-core';
import { listOrdersForConsumerSpace, type ProviderOrder, type ProviderSku } from './provider';

export type MarketplaceSku = ProviderSku & { factoryName: string };

export type MarketplaceRelationStatus = 'none' | 'pending' | 'enrolled';

export type MarketplaceFactoryPoster = {
  providerSpaceId: string;
  factoryName: string;
  posterId: string;
  posterName: string;
  posterDescription: string | null;
  imageUrl: string | null;
  isSystemDefault: boolean;
  skuCount: number;
  relationStatus: MarketplaceRelationStatus;
};

function db() {
  return getPlatformClient().schema('provider');
}

export async function requireConsumerSpace() {
  const space = await getCurrentSpace(true);
  if (!space?.id || space.kind !== 'consumer') return null;
  return space;
}

function mapMarketplaceSku(row: Record<string, any>): MarketplaceSku {
  return {
    id: row.id,
    providerSpaceId: row.provider_space_id,
    name: row.name,
    description: row.description ?? null,
    imageUrl: row.image_url ?? null,
    isPublished: row.is_published === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    factoryName: row.factory_name || '—',
  };
}

/** Reserved for a future multi-factory SKU grid. Current UI uses factory posters + store. */
export async function listPublishedSkusForMarketplace(): Promise<MarketplaceSku[]> {
  const { data, error } = await db().rpc('list_published_skus_for_marketplace');
  if (error) throw error;
  return (data ?? []).map(mapMarketplaceSku);
}

export async function listMarketplaceFactoryPosters(): Promise<MarketplaceFactoryPoster[]> {
  const { data, error } = await db().rpc('list_marketplace_factory_posters');
  if (error) throw error;
  return (data ?? []).map((row: Record<string, any>) => ({
    providerSpaceId: row.provider_space_id,
    factoryName: row.factory_name || '—',
    posterId: row.poster_id,
    posterName: row.poster_name || row.factory_name || 'Store',
    posterDescription: row.poster_description ?? null,
    imageUrl: row.image_url ?? null,
    isSystemDefault: row.is_system_default === true,
    skuCount: Number(row.sku_count ?? 0),
    relationStatus: (row.relation_status as MarketplaceRelationStatus) || 'none',
  }));
}

export async function getMarketplaceFactoryPoster(
  providerSpaceId: string
): Promise<MarketplaceFactoryPoster | null> {
  const { data, error } = await db().rpc('get_marketplace_factory_poster', {
    p_provider_space_id: providerSpaceId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    providerSpaceId: row.provider_space_id,
    factoryName: row.factory_name || '—',
    posterId: row.poster_id,
    posterName: row.poster_name || row.factory_name || 'Store',
    posterDescription: row.poster_description ?? null,
    imageUrl: row.image_url ?? null,
    isSystemDefault: row.is_system_default === true,
    skuCount: 0,
    relationStatus: (row.relation_status as MarketplaceRelationStatus) || 'none',
  };
}

export async function applyToFactory(providerSpaceId: string, consumerSpaceId: string): Promise<void> {
  const { error } = await db().rpc('dealer_apply_to_factory', {
    p_provider_space_id: providerSpaceId,
    p_consumer_space_id: consumerSpaceId,
  });
  if (error) throw error;
}

export async function listStoreSkusForFactory(providerSpaceId: string): Promise<MarketplaceSku[]> {
  const { data, error } = await db().rpc('list_store_skus_for_factory', {
    p_provider_space_id: providerSpaceId,
  });
  if (error) throw error;
  return (data ?? []).map(mapMarketplaceSku);
}

export async function createOrderFromMarketplace(
  consumerSpaceId: string,
  lines: { skuId: string; quantity: number }[]
): Promise<string> {
  const payload = lines
    .filter((l) => l.skuId && l.quantity > 0)
    .map((l) => ({ sku_id: l.skuId, quantity: l.quantity }));
  const { data, error } = await db().rpc('consumer_create_order_from_published_skus', {
    p_consumer_space_id: consumerSpaceId,
    p_lines: payload,
  });
  if (error) throw error;
  return data as string;
}

/** One shared order per factory when the cart spans multiple catalogs. */
export async function createOrdersFromMarketplaceCart(
  consumerSpaceId: string,
  items: { skuId: string; providerSpaceId: string; quantity: number }[]
): Promise<string[]> {
  const groups = new Map<string, { skuId: string; quantity: number }[]>();
  for (const item of items) {
    if (!item.skuId || item.quantity <= 0) continue;
    const list = groups.get(item.providerSpaceId) ?? [];
    list.push({ skuId: item.skuId, quantity: item.quantity });
    groups.set(item.providerSpaceId, list);
  }
  const ids: string[] = [];
  for (const lines of groups.values()) {
    ids.push(await createOrderFromMarketplace(consumerSpaceId, lines));
  }
  return ids;
}

export async function listConsumerOrders(consumerSpaceId: string): Promise<ProviderOrder[]> {
  return listOrdersForConsumerSpace(consumerSpaceId);
}

export type PendingDealerInvite = {
  id: string;
  providerSpaceId: string;
  factoryName: string;
  dealerName: string;
  contactEmail: string | null;
  createdAt: string;
};

export async function listPendingDealersForMe(): Promise<PendingDealerInvite[]> {
  const { data, error } = await db().rpc('list_pending_dealers_for_me');
  if (error) throw error;
  return (data ?? []).map((row: Record<string, any>) => ({
    id: row.id,
    providerSpaceId: row.provider_space_id,
    factoryName: row.factory_name || '—',
    dealerName: row.dealer_name || '—',
    contactEmail: row.contact_email ?? null,
    createdAt: row.created_at,
  }));
}

export async function claimPendingDealer(enrollmentId: string, consumerSpaceId: string): Promise<void> {
  const { error } = await db().rpc('claim_pending_dealer', {
    p_enrollment_id: enrollmentId,
    p_consumer_space_id: consumerSpaceId,
  });
  if (error) throw error;
}
