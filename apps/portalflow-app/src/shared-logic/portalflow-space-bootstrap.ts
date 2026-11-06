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
import { isReceiptap } from './feature-flags';

const nativeScheme = isReceiptap ? 'receiptap://' : 'portalflow://';
const publicOrigin = isReceiptap ? 'https://vouchap.com' : 'https://portalflow.app';

function readAuthProvidersFromExtra(): Partial<Record<AuthProviderId, AuthProviderConfig>> {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const providers: Partial<Record<AuthProviderId, AuthProviderConfig>> = {};
  if (typeof extra.googleWebClientId === 'string' && extra.googleWebClientId.trim()) {
    providers.google = { enabled: true };
  }
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
  productName: isReceiptap ? 'Receiptap' : 'Portalflow',
  logo: isReceiptap ? require('../../assets/receiptap-icon.png') : require('../../assets/logo.png'),
  sidebarLogo: isReceiptap ? require('../../assets/receiptap-icon.png') : require('../../assets/logo3.png'),
  getBrand: (space) => {
    const receiptap = {
      productName: 'Receiptap',
      logo: require('../../assets/receiptap-icon.png') as number,
      sidebarLogo: require('../../assets/receiptap-icon.png') as number,
    };
    const portalflow = {
      productName: 'Portalflow',
      logo: require('../../assets/logo.png') as number,
      sidebarLogo: require('../../assets/logo3.png') as number,
    };
    if (isReceiptap) return receiptap;
    if (space?.kind === 'consumer') return receiptap;
    return portalflow;
  },
  sloganLine1: 'Voucher Snapping,',
  sloganLine2: 'Balance Clarity.',
  termsUrl: `${publicOrigin}/terms`,
  privacyUrl: `${publicOrigin}/privacy`,
  homePath: '/',
  spaceKinds: isReceiptap
    ? [{ id: 'consumer', label: 'Personal' }]
    : [
        { id: 'consumer', label: 'Client' },
        { id: 'provider', label: 'Firm' },
      ],
  defaultSpaceKind: 'consumer',
  ...(isReceiptap ? { allowedSpaceKinds: ['consumer'] } : {}),
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
    kind !== 'provider' || typeof extras.verificationFileUri === 'string',
  createSpace: async ({ name, address, kind, extras }) => {
    if (isReceiptap && kind === 'provider') {
      return { error: new Error('Receiptap only creates bookkeeping spaces.') };
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
