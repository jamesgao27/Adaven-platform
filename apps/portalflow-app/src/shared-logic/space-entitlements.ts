import { supabase } from './supabase';

export type SpaceEntitlementsActiveSubscription = {
  order_id: string;
  sku_code: string;
  started_at: string;
  expires_at: string;
  is_trial: boolean;
};

export type SpaceEntitlementsClientRecognition = {
  enforce: boolean;
  included_per_month: number;
  /** Subscription-tier recognitions remaining this UTC month before credits (capped when processing-linked). */
  included_remaining: number;
  monthly_cap: number | null;
  used_this_month: number;
  credits_balance: number;
  processing_linked: boolean;
};

export type SpaceEntitlementsFirmEngagement = {
  has_subscription: boolean;
  window_start: string | null;
  window_end: string | null;
  included_per_period: number;
  addon_in_period: number;
  max_creates: number;
  /** Orders in the subscription window that already have a linked `public.projects` row (association succeeded). */
  used_in_period: number;
  /** Onboarding orders in the window with no project yet; counts toward create cap with `used_in_period`. */
  pending_onboarding: number;
};

export type SpaceEntitlements = {
  ok: boolean;
  code?: string;
  space_kind?: string;
  active_subscription?: SpaceEntitlementsActiveSubscription | null;
  client_recognition?: SpaceEntitlementsClientRecognition;
  firm_engagement?: SpaceEntitlementsFirmEngagement;
  warnings?: { code: string; days_left?: number }[];
  block_codes?: { code: string }[];
};

function parseSubscription(raw: unknown): SpaceEntitlementsActiveSubscription | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.order_id !== 'string' || typeof o.sku_code !== 'string') return null;
  return {
    order_id: o.order_id,
    sku_code: o.sku_code,
    started_at: typeof o.started_at === 'string' ? o.started_at : '',
    expires_at: typeof o.expires_at === 'string' ? o.expires_at : '',
    is_trial: o.is_trial === true,
  };
}

/** Member-readable plan snapshot (CRM `get_space_entitlements`). */
export async function fetchSpaceEntitlements(spaceId: string): Promise<SpaceEntitlements | null> {
  if (!spaceId) return null;
  const { data, error } = await supabase.schema('crm').rpc('get_space_entitlements', {
    p_space_id: spaceId,
  });
  if (error) {
    console.warn('[space-entitlements] get_space_entitlements', error.message);
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  if (o.ok !== true) {
    return {
      ok: false,
      code: typeof o.code === 'string' ? o.code : 'UNKNOWN',
    };
  }
  const cr = o.client_recognition;
  const fe = o.firm_engagement;
  return {
    ok: true,
    space_kind: typeof o.space_kind === 'string' ? o.space_kind : undefined,
    active_subscription: parseSubscription(o.active_subscription ?? null),
    client_recognition:
      cr && typeof cr === 'object'
        ? {
            enforce: (cr as Record<string, unknown>).enforce === true,
            included_per_month: Number((cr as Record<string, unknown>).included_per_month) || 0,
            included_remaining: Math.max(
              0,
              Number((cr as Record<string, unknown>).included_remaining) || 0,
            ),
            monthly_cap:
              (cr as Record<string, unknown>).monthly_cap === null
                ? null
                : typeof (cr as Record<string, unknown>).monthly_cap === 'number'
                  ? ((cr as Record<string, unknown>).monthly_cap as number)
                  : null,
            used_this_month: Number((cr as Record<string, unknown>).used_this_month) || 0,
            credits_balance: Number((cr as Record<string, unknown>).credits_balance) || 0,
            processing_linked: (cr as Record<string, unknown>).processing_linked === true,
          }
        : undefined,
    firm_engagement:
      fe && typeof fe === 'object'
        ? {
            has_subscription: (fe as Record<string, unknown>).has_subscription === true,
            window_start:
              typeof (fe as Record<string, unknown>).window_start === 'string'
                ? ((fe as Record<string, unknown>).window_start as string)
                : null,
            window_end:
              typeof (fe as Record<string, unknown>).window_end === 'string'
                ? ((fe as Record<string, unknown>).window_end as string)
                : null,
            included_per_period: Number((fe as Record<string, unknown>).included_per_period) || 0,
            addon_in_period: Number((fe as Record<string, unknown>).addon_in_period) || 0,
            max_creates: Number((fe as Record<string, unknown>).max_creates) || 0,
            used_in_period: Number((fe as Record<string, unknown>).used_in_period) || 0,
            pending_onboarding: Math.max(
              0,
              Number((fe as Record<string, unknown>).pending_onboarding) || 0,
            ),
          }
        : undefined,
    warnings: Array.isArray(o.warnings) ? (o.warnings as SpaceEntitlements['warnings']) : undefined,
    block_codes: Array.isArray(o.block_codes) ? (o.block_codes as SpaceEntitlements['block_codes']) : undefined,
  };
}
