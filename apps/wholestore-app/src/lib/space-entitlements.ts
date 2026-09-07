import { getPlatformClient } from '@adaven/platform-core';

export type WholestoreEntitlements = {
  ok: boolean;
  code?: string;
  space_kind?: string;
  active_subscription?: {
    order_id: string;
    sku_code: string;
    started_at: string;
    expires_at: string;
    is_trial: boolean;
  } | null;
  consumer_orders?: {
    included_per_period: number;
    used_in_period: number;
    credits_balance: number;
    max_creates: number;
  };
  provider_enrollment?: {
    max_consumers: number;
    used: number;
  };
};

export async function fetchSpaceEntitlements(spaceId: string): Promise<WholestoreEntitlements | null> {
  if (!spaceId) return null;
  const { data, error } = await getPlatformClient().schema('crm').rpc('get_space_entitlements', {
    p_space_id: spaceId,
  });
  if (error) {
    console.warn('[space-entitlements]', error.message);
    return null;
  }
  return (data ?? null) as WholestoreEntitlements | null;
}

export function requireActiveSubscription(ent: WholestoreEntitlements | null): void {
  if (!ent?.ok || !ent.active_subscription) {
    throw new Error('An active subscription is required for this space.');
  }
}
