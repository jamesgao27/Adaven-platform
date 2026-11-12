import { supabase } from './supabase';

export type ClientRecognitionQuota = {
  enforce: boolean;
  spaceKind: string;
  includedPerMonth: number;
  monthlyCap: number | null;
  usedThisMonth: number;
  creditsBalance: number;
  processingLinked: boolean;
  activeSubscriptionSku?: string | null;
  subscriptionExpiresAt?: string | null;
};

/** RPC / JSON may return counts as string; missing fields must not zero-out credits incorrectly. */
function coerceNonNegativeInt(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return fallback;
}

function parseQuotaPayload(data: unknown): ClientRecognitionQuota | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  if (o.ok !== true) return null;
  if (o.enforce !== true) {
    return {
      enforce: false,
      spaceKind: typeof o.space_kind === 'string' ? o.space_kind : 'unknown',
      includedPerMonth: 0,
      monthlyCap: null,
      usedThisMonth: 0,
      creditsBalance: 0,
      processingLinked: false,
      activeSubscriptionSku: null,
      subscriptionExpiresAt: null,
    };
  }
  const monthlyCapRaw = o.monthly_cap;
  const monthlyCap =
    monthlyCapRaw === null || monthlyCapRaw === undefined
      ? null
      : coerceNonNegativeInt(monthlyCapRaw, 0);
  return {
    enforce: true,
    spaceKind: typeof o.space_kind === 'string' ? o.space_kind : 'client',
    includedPerMonth: coerceNonNegativeInt(o.included_per_month, 10),
    monthlyCap,
    usedThisMonth: coerceNonNegativeInt(o.used_this_month, 0),
    creditsBalance: coerceNonNegativeInt(o.credits_balance, 0),
    processingLinked: o.processing_linked === true,
    activeSubscriptionSku: typeof o.active_subscription_sku === 'string' ? o.active_subscription_sku : null,
    subscriptionExpiresAt: typeof o.subscription_expires_at === 'string' ? o.subscription_expires_at : null,
  };
}

/** Load quota for a client space (always enforced; included tier from catalog CLIENT_RECOGNITION_BASE). */
export async function fetchClientRecognitionQuota(spaceId: string): Promise<ClientRecognitionQuota | null> {
  if (!spaceId) return null;
  const { data, error } = await supabase.schema('crm').rpc('get_consumer_recognition_quota', {
    p_space_id: spaceId,
  });
  if (error) {
    console.warn('[client-recognition-quota] get_consumer_recognition_quota', error.message);
    return null;
  }
  return parseQuotaPayload(data);
}

/**
 * English copy for `receipts.recognition_notice` when the workspace hits plan/credits limits.
 * Clarifies this is the Portalflow workspace allowance, not the Gemini API vendor quota.
 */
export function formatRecognitionQuotaBlockedNotice(gateMessage?: string): string {
  const detail =
    gateMessage?.trim() ||
    'Your workspace has used its included AI recognitions for this period. Add credits or wait until the next cycle to continue.';
  return `${detail}\n\nThis limit applies to your Portalflow workspace (plan or credits). It is not the Google Gemini API usage shown in the cloud console.`;
}

/** Preflight for one recognition attempt (matches server rules; race-safe final check is record). */
export async function assertClientRecognitionAllowed(
  spaceId: string,
): Promise<{ allowed: boolean; message?: string; quota?: ClientRecognitionQuota | null }> {
  if (!spaceId) return { allowed: true };
  const quota = await fetchClientRecognitionQuota(spaceId);
  if (!quota || !quota.enforce) return { allowed: true, quota };

  if (quota.monthlyCap != null && quota.usedThisMonth >= quota.monthlyCap) {
    return {
      allowed: false,
      message: "You've reached this month's document recognition limit.",
      quota,
    };
  }
  if (quota.usedThisMonth >= quota.includedPerMonth && quota.creditsBalance < 1) {
    const noActiveSub =
      !quota.activeSubscriptionSku && quota.includedPerMonth === 0;
    return {
      allowed: false,
      message: noActiveSub
        ? 'No active subscription for this workspace. Open Subscription and billing or ask your administrator to assign a plan in CRM.'
        : 'Your included recognitions for this month are used up. Add credits to continue, or wait until next month.',
      quota,
    };
  }
  return { allowed: true, quota };
}

/** Call after a successful AI recognition for expense / income / tax docs on a client space. */
export async function recordClientRecognitionSuccessIfEnforced(
  spaceId: string,
): Promise<{ ok: boolean; code?: string; message?: string; skipped?: boolean }> {
  if (!spaceId) return { ok: true, skipped: true };
  const { data, error } = await supabase.schema('crm').rpc('record_consumer_recognition_success', {
    p_space_id: spaceId,
  });
  if (error) {
    console.warn('[client-recognition-quota] record_consumer_recognition_success', error.message);
    return { ok: false, code: 'RPC_ERROR', message: error.message };
  }
  if (!data || typeof data !== 'object') return { ok: false, code: 'BAD_PAYLOAD' };
  const o = data as Record<string, unknown>;
  if (o.skipped === true) return { ok: true, skipped: true };
  if (o.ok === true) return { ok: true };
  return {
    ok: false,
    code: typeof o.code === 'string' ? o.code : 'UNKNOWN',
    message: typeof o.message === 'string' ? o.message : undefined,
  };
}
