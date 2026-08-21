/**
 * Vouchap product overlay on platform Space creation.
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
      : 'vouchap://',
  emailRedirectTo:
    typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/auth/confirm`
      : Constants.expoConfig?.extra?.supabaseUrl?.includes('localhost') || process.env.NODE_ENV === 'development'
        ? 'exp://localhost:8081/--/auth/confirm'
        : 'https://vouchap.com/auth/confirm',
});

registerOnSpaceCreated(async ({ spaceId, kind, clientProfileType }) => {
  if (kind === 'firm') {
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
