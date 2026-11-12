/**
 * Portalflow product overlay on platform Space creation.
 * Must be imported once at app start (see _layout.tsx).
 */
import Constants from 'expo-constants';
import { createDefaultCategoriesAndAccounts } from './auth-helper';
import { applyPresetSkusToFirm } from './firm';
import { validateSupabaseConfig } from './supabase';
import {
  configurePlatformAuth,
  registerOnSpaceCreated,
  type AuthProviderId,
  type AuthProviderConfig,
} from '@adaven/platform-core';
import { configureProductUi } from '@adaven/platform-ui';
import { PortalflowSetupExtras } from './portalflow-setup-extras';
import { getPortalflowSidebarNavItems } from './portalflow-sidebar-nav';
import { getPortalflowManagementMenuItems } from './portalflow-management-menu';
import { isVouchap } from './feature-flags';
const nativeScheme = isVouchap ? 'vouchap://' : 'portalflow://';
const publicOrigin = isVouchap ? 'https://vouchap.aim.link' : 'https://portalflow.aim.link';
const productName = isVouchap ? 'Vouchap' : 'Portalflow';
const productLogo = isVouchap
  ? require('../../assets/vouchap-icon.png')
  : require('../../assets/logo.png');
const sidebarLogo = isVouchap
  ? require('../../assets/vouchap-icon.png')
  : require('../../assets/logo.png');

function readAuthProvidersFromExtra(): Partial<Record<AuthProviderId, AuthProviderConfig>> {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  // Web Google SSO uses Supabase OAuth (no native googleWebClientId required).
  const providers: Partial<Record<AuthProviderId, AuthProviderConfig>> = {
    google: { enabled: true },
  };
  if (extra.appleSignIn === true || extra.appleAuthEnabled === true) {
    providers.apple = { enabled: true };
  }
  if (typeof extra.azureClientId === 'string' && extra.azureClientId.trim()) {
    providers.azure = { enabled: true, supabaseProvider: 'azure' };
  }
  return providers;
}

configurePlatformAuth({
  providers: readAuthProvidersFromExtra(),
  validateConfig: validateSupabaseConfig,
  inviteDeepLinkBase:
    Constants.expoConfig?.extra?.supabaseUrl?.includes('localhost') || process.env.NODE_ENV === 'development'
      ? 'exp://localhost:8081'
      : nativeScheme,
  emailRedirectTo:
    typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/auth/confirm`
      : Constants.expoConfig?.extra?.supabaseUrl?.includes('localhost') || process.env.NODE_ENV === 'development'
        ? 'exp://localhost:8081/--/auth/confirm'
        : `${publicOrigin}/auth/confirm`,
});

registerOnSpaceCreated(async ({ spaceId, kind, clientProfileType }) => {
  if (kind === 'provider') {
    const { error: presetErr } = await applyPresetSkusToFirm(spaceId);
    if (presetErr) {
      console.error(
        'applyPresetSkusToFirm failed (firm may have no preset templates):',
        presetErr?.message ?? presetErr,
        presetErr
      );
    }
    return;
  }

  try {
    await createDefaultCategoriesAndAccounts(
      spaceId,
      (clientProfileType === 'business' ? 'business' : 'household')
    );
  } catch (error) {
    console.warn('Failed to create default categories and accounts:', error);
  }
});

configureProductUi({
  productName,
  logo: productLogo,
  sidebarLogo,
  // Match Wholestore / Vouchap: transparent mark + contain fit.
  authLogoSize: 88,
  getBrand: () => ({
    productName,
    logo: productLogo as number,
    sidebarLogo: sidebarLogo as number,
  }),
  sloganLine1: isVouchap ? 'Receipts and income,' : 'Client services,',
  sloganLine2: isVouchap ? 'in one bookkeeping space.' : 'in one firm workspace.',
  termsUrl: `${publicOrigin}/terms`,
  privacyUrl: `${publicOrigin}/privacy`,
  homePath: '/',
  spaceKinds: isVouchap
    ? [{ id: 'consumer', label: 'Bookkeeping' }]
    : [{ id: 'provider', label: 'Firm' }],
  defaultSpaceKind: isVouchap ? 'consumer' : 'provider',
  allowedSpaceKinds: isVouchap ? ['consumer'] : ['provider'],
  allowAdditionalSpaces: true,
  formatSpaceTypeLabel: isVouchap
    ? ({ clientProfileType }) => {
        if (clientProfileType === 'business') return 'Business';
        if (clientProfileType === 'household') return 'Household';
        return null;
      }
    : ({ kind }) => (kind === 'provider' ? 'Firm' : null),
  adminOnMembersList: isVouchap,
  getSidebarNavItems: getPortalflowSidebarNavItems,
  getManagementMenuItems: (space) => getPortalflowManagementMenuItems(space?.kind as 'consumer' | 'provider' | undefined),
  uploadSpaceImage: async (fileUri, spaceId) => {
    const { uploadSpaceImage } = await import('./supabase');
    return uploadSpaceImage(fileUri, spaceId);
  },
  uploadUserLogo: async (fileUri, userId) => {
    const { uploadUserLogo } = await import('./supabase');
    return uploadUserLogo(fileUri, userId);
  },
  getSidebarClaimCount: async (email) => {
    const { getPendingInviteesForEmail } = await import('./firm-clients');
    const { list } = await getPendingInviteesForEmail(email).catch(() => ({ list: [] as unknown[] }));
    return list?.length ?? 0;
  },
  sidebarClaimRoute: '/auth/claim',
  renderSetupExtras: (ctx) => PortalflowSetupExtras(ctx),
  canSubmitSetup: (kind, extras) =>
    isVouchap || kind !== 'provider' || typeof extras.verificationFileUri === 'string',
  createSpace: async ({ name, address, kind, extras }) => {
    if (isVouchap && kind !== 'consumer') {
      return { error: new Error('Vouchap only creates personal bookkeeping spaces.') };
    }
    if (!isVouchap && kind !== 'provider') {
      return { error: new Error('Portalflow only creates firm workspaces.') };
    }
    const { createSpace } = await import('./auth');
    const { uploadFirmVerificationFile } = await import('./supabase');
    const { getCurrentUser } = await import('@adaven/platform-core');
    const { showToast } = await import('@adaven/platform-ui');
    let verificationAttachmentUrl: string | undefined;
    if (kind === 'provider') {
      const uri = extras.verificationFileUri as string | undefined;
      const user = await getCurrentUser();
      if (!user || !uri) {
        return { error: new Error('Firm registration requires a verification document.') };
      }
      try {
        verificationAttachmentUrl = await uploadFirmVerificationFile(uri, user.id);
      } catch {
        showToast('Verification document upload failed. Please try again.', 'error');
        return { error: new Error('Verification document upload failed. Please try again.') };
      }
    }
    const { error } = await createSpace(
      name,
      address || undefined,
      kind === 'provider'
        ? { kind: 'provider', verificationAttachmentUrl }
        : {
            kind: 'consumer',
            clientProfileType: extras.clientProfileType === 'business' ? 'business' : 'household',
          }
    );
    return { error };
  },
});
