/**
 * Vouchap product routing after platform invitation handling.
 * Platform screens must not import firm-clients directly.
 */
import { getPendingInviteesForEmail } from './firm-clients';

export async function shouldRedirectToFirmClaim(email?: string | null): Promise<boolean> {
  if (!email) return false;
  const { list } = await getPendingInviteesForEmail(email).catch(() => ({ list: [] as unknown[] }));
  return (list?.length ?? 0) > 0;
}
