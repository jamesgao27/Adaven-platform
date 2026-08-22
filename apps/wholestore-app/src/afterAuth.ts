import {
  getCurrentSpace,
  getPendingInvitationsForUser,
} from '@adaven/platform-core';

export async function routeAfterAuth(replace: (href: string) => void): Promise<void> {
  const invitations = await getPendingInvitationsForUser();
  if (invitations.length > 0) {
    replace('/handle-invitations');
    return;
  }
  const space = await getCurrentSpace(true);
  replace(space ? '/' : '/setup-space');
}
