import { supabase } from './supabase';

export type SpaceOrderRow = {
  id: string;
  sku_code: string;
  sku_name: string;
  status: string;
  started_at: string;
  expires_at: string | null;
  created_at: string;
  source: string;
  metadata: Record<string, unknown> | null;
};

export async function listSpaceOrdersForMember(spaceId: string): Promise<SpaceOrderRow[]> {
  const { data, error } = await supabase.schema('crm').rpc('list_space_orders_for_space_member', {
    p_space_id: spaceId,
  });
  if (error) {
    console.warn('[space-orders] list_space_orders_for_space_member', error.message);
    throw error;
  }
  if (!data || !Array.isArray(data)) return [];
  return data as SpaceOrderRow[];
}
