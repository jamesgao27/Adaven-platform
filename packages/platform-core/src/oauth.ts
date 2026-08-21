import { getPlatformClient } from './client';
import type { AuthProviderId, AuthProviderConfig } from './oauth';

export type { AuthProviderId, AuthProviderConfig };

export type PlatformAuthConfig = {
  redirectTo?: string;
  emailRedirectTo?: string;
  inviteDeepLinkBase?: string;
  providers?: Partial<Record<AuthProviderId, AuthProviderConfig>>;
  validateConfig?: () => { valid: boolean; error?: string };
};

let authConfig: PlatformAuthConfig = {};

export function configurePlatformAuth(config: PlatformAuthConfig): void {
  authConfig = { ...authConfig, ...config };
}

export function getPlatformAuthConfig(): PlatformAuthConfig {
  return authConfig;
}

export function getEnabledAuthProviders(): AuthProviderId[] {
  const providers = authConfig.providers;
  if (!providers) return [];
  return (Object.keys(providers) as AuthProviderId[]).filter((id) => providers[id]?.enabled);
}

export function resolveRedirectTo(): string | undefined {
  if (authConfig.redirectTo) return authConfig.redirectTo;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/auth/confirm`;
  }
  return undefined;
}

export async function signInWithOAuth(
  provider: AuthProviderId
): Promise<{ error: Error | null }> {
  const check = authConfig.validateConfig?.();
  if (check && !check.valid) {
    return { error: new Error(check.error || 'App backend is not configured.') };
  }
  if (authConfig.providers?.[provider]?.enabled !== true) {
    return { error: new Error(`${provider} sign-in is not configured for this app.`) };
  }
  const supabaseProvider =
    (authConfig.providers?.[provider]?.supabaseProvider as AuthProviderId | undefined) ??
    provider;
  try {
    const supabase = getPlatformClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: supabaseProvider as 'google' | 'apple' | 'azure',
      options: {
        redirectTo: resolveRedirectTo(),
        skipBrowserRedirect: false,
      },
    });
    if (error) throw error;
    return { error: null };
  } catch (error) {
    console.error('signInWithOAuth failed:', error);
    return {
      error: error instanceof Error ? error : new Error(`Failed to sign in with ${provider}`),
    };
  }
}
