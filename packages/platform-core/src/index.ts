export { bindPlatformClient, getPlatformClient } from './client';

export type { PlatformUser, PlatformSpace, PlatformUserSpace } from './types';

export {
  registerOnSpaceCreated,
  runOnSpaceCreated,
  type SpaceCreatedContext,
  type OnSpaceCreatedHandler,
} from './space-created-hooks';

export {
  configurePlatformAuth,
  getPlatformAuthConfig,
  getEnabledAuthProviders,
  signInWithOAuth,
  resolveRedirectTo,
  type AuthProviderId,
  type AuthProviderConfig,
  type PlatformAuthConfig,
} from './oauth';

export {
  initializeAuthCache,
  getCachedUser,
  getCachedSpace,
  updateCachedUser,
  updateCachedSpace,
  clearAuthCache,
  isCacheInitialized,
} from './auth-cache';

export {
  getCurrentUser,
  getCurrentSpace,
  getUserSpaces,
  setCurrentSpace,
  signUp,
  signIn,
  signOut,
  isAuthenticated,
  resetPassword,
  updatePassword,
} from './auth';

export { createSpaceCore } from './spaces';

export {
  createInvitation,
  getInvitationById,
  sendInvitationEmailForId,
  getPendingInvitationsForUser,
  subscribePendingInvitationsRealtime,
  acceptInvitation,
  declineInvitation,
  getSpaceInvitations,
  cancelInvitation,
  buildInviteUrl,
} from './invitations';
export type { SpaceInvitation } from './invitations';

export {
  getSpaceMembers,
  removeSpaceMember,
  setSpaceMemberAdmin,
  leaveSpace,
  isCurrentUserSpaceAdmin,
} from './members';
export type { SpaceMember } from './members';
