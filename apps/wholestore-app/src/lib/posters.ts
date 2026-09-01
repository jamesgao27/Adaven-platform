import { getPlatformClient } from '@adaven/platform-core';
import type { ProviderSku } from './provider';

export type ProviderPoster = {
  id: string;
  providerSpaceId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  isPublished: boolean;
  isMarketplaceFeatured: boolean;
  isSystemDefault: boolean;
  createdAt: string;
  updatedAt: string;
  skuIds: string[];
};

function db() {
  return getPlatformClient().schema('provider');
}

function mapPoster(row: Record<string, any>, skuIds: string[] = []): ProviderPoster {
  return {
    id: row.id,
    providerSpaceId: row.provider_space_id,
    name: row.name ?? '',
    description: row.description ?? null,
    imageUrl: row.image_url ?? null,
    isPublished: row.is_published === true,
    isMarketplaceFeatured: row.is_marketplace_featured === true,
    isSystemDefault: row.is_system_default === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    skuIds,
  };
}

export async function ensureDefaultPoster(providerSpaceId: string): Promise<string> {
  const { data, error } = await getPlatformClient().rpc('ensure_factory_default_poster', {
    p_provider_space_id: providerSpaceId,
  });
  if (error) throw error;
  return data as string;
}

async function skuIdsByPoster(posterIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!posterIds.length) return map;
  const { data, error } = await db()
    .from('poster_skus')
    .select('poster_id, sku_id, sort_order')
    .in('poster_id', posterIds)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  for (const row of data ?? []) {
    const list = map.get(row.poster_id) ?? [];
    list.push(row.sku_id);
    map.set(row.poster_id, list);
  }
  return map;
}

export async function listPosters(providerSpaceId: string): Promise<ProviderPoster[]> {
  await ensureDefaultPoster(providerSpaceId);
  const { data, error } = await db()
    .from('posters')
    .select('*')
    .eq('provider_space_id', providerSpaceId)
    .order('is_system_default', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const skuMap = await skuIdsByPoster(rows.map((r) => r.id));
  return rows.map((r) => mapPoster(r, skuMap.get(r.id) ?? []));
}

export async function getPoster(id: string): Promise<ProviderPoster | null> {
  const { data, error } = await db().from('posters').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const skuMap = await skuIdsByPoster([id]);
  return mapPoster(data, skuMap.get(id) ?? []);
}

export async function createPoster(providerSpaceId: string, name = 'New poster'): Promise<ProviderPoster> {
  const { data, error } = await db()
    .from('posters')
    .insert({
      provider_space_id: providerSpaceId,
      name,
      is_published: false,
      is_marketplace_featured: false,
      is_system_default: false,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapPoster(data, []);
}

export async function updatePoster(
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    imageUrl?: string | null;
    isPublished?: boolean;
    isMarketplaceFeatured?: boolean;
  }
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name != null) row.name = patch.name;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.imageUrl !== undefined) row.image_url = patch.imageUrl;
  if (patch.isPublished !== undefined) row.is_published = patch.isPublished;
  if (patch.isMarketplaceFeatured !== undefined) row.is_marketplace_featured = patch.isMarketplaceFeatured;
  const { error } = await db().from('posters').update(row).eq('id', id);
  if (error) throw error;
}

export async function deletePoster(id: string): Promise<void> {
  const { error } = await db().from('posters').delete().eq('id', id);
  if (error) throw error;
}

export async function setPosterSkus(posterId: string, skuIds: string[]): Promise<void> {
  const { error: delErr } = await db().from('poster_skus').delete().eq('poster_id', posterId);
  if (delErr) throw delErr;
  if (!skuIds.length) return;
  const { error } = await db()
    .from('poster_skus')
    .insert(skuIds.map((skuId, i) => ({ poster_id: posterId, sku_id: skuId, sort_order: i })));
  if (error) throw error;
}

export function posterSkuNames(poster: ProviderPoster, skus: ProviderSku[]): string {
  const names = poster.skuIds
    .map((id) => skus.find((s) => s.id === id)?.name)
    .filter((n): n is string => !!n);
  return names.join(', ');
}
