import { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import Svg, { Path } from 'react-native-svg';
import {
  getEnabledAuthProviders,
  getPlatformClient,
  signInWithOAuth,
  type AuthProviderId,
} from '@adaven/platform-core';

WebBrowser.maybeCompleteAuthSession();

const LABELS: Record<AuthProviderId, string> = {
  google: 'Continue with Google',
  apple: 'Continue with Apple',
  azure: 'Continue with Microsoft',
};

type Props = {
  disabled?: boolean;
  /** When true, SSO is blocked until the user has consented. */
  requiresConsent?: boolean;
  hasConsent?: boolean;
  onConsentRequired?: () => void;
  onError?: (message: string) => void;
};

function GoogleMark() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48">
      <Path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <Path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <Path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <Path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </Svg>
  );
}

function oauthRedirectTo(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}/auth/confirm`;
  }
  return Linking.createURL('auth/confirm');
}

async function finishNativeSession(returnedUrl: string): Promise<string | null> {
  const query = Linking.parse(returnedUrl).queryParams ?? {};
  const description = typeof query.error_description === 'string' ? query.error_description : null;
  if (description) return description;
  const code = typeof query.code === 'string' ? query.code : null;
  if (!code) return 'Google sign-in did not return a code.';
  const { error } = await getPlatformClient().auth.exchangeCodeForSession(code);
  return error ? error.message : null;
}

export function ThirdPartyAuthButtons({
  disabled,
  requiresConsent,
  hasConsent,
  onConsentRequired,
  onError,
}: Props) {
  const router = useRouter();
  const providers = getEnabledAuthProviders();
  const [busy, setBusy] = useState<AuthProviderId | null>(null);

  if (providers.length === 0) return null;

  const consentBlocked = !!requiresConsent && !hasConsent;

  const onPress = async (provider: AuthProviderId) => {
    if (disabled || busy) return;
    if (consentBlocked) {
      onConsentRequired?.();
      return;
    }
    setBusy(provider);
    try {
      const redirectTo = oauthRedirectTo();
      if (Platform.OS === 'web') {
        const { error } = await signInWithOAuth(provider, { redirectTo, skipBrowserRedirect: false });
        if (error) onError?.(error.message);
        return;
      }
      const { url, error } = await signInWithOAuth(provider, { redirectTo, skipBrowserRedirect: true });
      if (error || !url) {
        onError?.(error?.message || 'Google sign-in failed.');
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(url, redirectTo);
      if (result.type !== 'success') return;
      const failure = await finishNativeSession(result.url);
      if (failure) {
        onError?.(failure);
        return;
      }
      router.replace('/');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.dividerRow}>
        <View style={styles.line} />
        <Text style={styles.or}>or</Text>
        <View style={styles.line} />
      </View>
      {providers.map((provider) => (
        <TouchableOpacity
          key={provider}
          style={[styles.button, (disabled || busy || consentBlocked) && styles.buttonDisabled]}
          onPress={() => onPress(provider)}
          disabled={disabled || !!busy}
          activeOpacity={0.85}
        >
          {busy === provider ? (
            <ActivityIndicator color="#2D3436" />
          ) : (
            <View style={styles.labelRow}>
              {provider === 'google' ? <GoogleMark /> : null}
              <Text style={styles.buttonText}>{LABELS[provider]}</Text>
            </View>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4, marginBottom: 2, gap: 8 },
  button: {
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  buttonDisabled: { opacity: 0.55 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  buttonText: { fontSize: 15, fontWeight: '600', color: '#2D3436' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 2 },
  line: { flex: 1, height: 1, backgroundColor: '#E9ECEF' },
  or: { fontSize: 12, color: '#95A5A6' },
});
