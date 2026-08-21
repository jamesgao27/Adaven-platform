import { supabase } from './supabase';
import { fetchSpaceEntitlements } from './space-entitlements';
import { showConfirmDialog } from './confirmDialog';

export type FirmRouterLike = {
  push: (href: string) => void;
};

function engagementBlockAlert(title: string, message: string, router: FirmRouterLike) {
  showConfirmDialog(title, message, () => router.push('/management'), {
    confirmText: 'Subscription and billing',
    cancelText: 'Close',
  });
}

/** Before firm creates a new onboarding order. */
export async function preflightFirmEngagementCreateOrAlert(
  firmSpaceId: string | null | undefined,
  router: FirmRouterLike,
): Promise<boolean> {
  if (!firmSpaceId) return true;
  const ent = await fetchSpaceEntitlements(firmSpaceId);
  if (!ent?.ok || ent.space_kind !== 'firm' || !ent.firm_engagement) return true;
  const fe = ent.firm_engagement;
  if (!fe.has_subscription) {
    engagementBlockAlert(
      'No active subscription',
      'This firm workspace does not have an active subscription. Renew in CRM or ask your administrator, or switch to another space.',
      router,
    );
    return false;
  }
  const used = fe.used_in_period ?? 0;
  const pending = fe.pending_onboarding ?? 0;
  const max = fe.max_creates ?? 0;
  if (max > 0 && used + pending >= max) {
    engagementBlockAlert(
      'Engagement capacity full',
      'All engagements for this subscription period are in use (linked projects plus open drafts). Complete or cancel an engagement, add capacity in CRM, or switch space.',
      router,
    );
    return false;
  }
  return true;
}

/** Before first project link (confirm materialization). Uses same rules as CRM assert_firm_can_confirm_engagement. */
export async function preflightFirmEngagementConfirmOrAlert(
  orderId: string,
  router: FirmRouterLike,
): Promise<boolean> {
  const { error } = await supabase.schema('crm').rpc('assert_firm_can_confirm_engagement', {
    p_order_id: orderId,
  });
  if (!error) return true;
  const msg = error.message || '';
  if (/ENGAGEMENT_NO_SUBSCRIPTION/i.test(msg)) {
    engagementBlockAlert(
      'No active subscription',
      'This firm workspace does not have an active subscription. Renew in CRM or ask your administrator.',
      router,
    );
    return false;
  }
  if (/ENGAGEMENT_CAPACITY_EXCEEDED|P0001/i.test(msg)) {
    engagementBlockAlert(
      'Engagement capacity full',
      'This subscription period’s engagement allowance is full. Add capacity in CRM or open Subscription and billing for details.',
      router,
    );
    return false;
  }
  return true;
}
