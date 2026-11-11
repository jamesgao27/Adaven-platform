import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { getPlatformClient } from '@adaven/platform-core';

type ConfirmStatus = 'verifying' | 'success' | 'error';

async function readAuthParam(name: string): Promise<string | null> {
  if (typeof window !== 'undefined') {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const value = query.get(name) || hash.get(name);
    if (value) return value;
  }
  const url = await Linking.getInitialURL();
  if (!url) return null;
  const parsed = Linking.parse(url);
  const queryValue = parsed.queryParams?.[name];
  if (typeof queryValue === 'string') return queryValue;
  if (!parsed.queryParams && url.includes('?')) {
    return new URL(url).searchParams.get(name);
  }
  return null;
}

type NextRoute = { pathname: string; params?: Record<string, string> };

function loginRouteWithEmail(email: string | null): NextRoute {
  const trimmed = (email || '').trim();
  if (!trimmed) return { pathname: '/login' };
  return { pathname: '/login', params: { email: trimmed } };
}

export default function EmailConfirmScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<ConfirmStatus>('verifying');
  const [message, setMessage] = useState('Verifying your email...');
  const [nextRoute, setNextRoute] = useState<NextRoute>({ pathname: '/login' });

  useEffect(() => {
    let cancelled = false;

    async function confirm() {
      const type = await readAuthParam('type');
      const emailParam = await readAuthParam('email');
      const loginDestination = loginRouteWithEmail(emailParam);
      const errorDescription = await readAuthParam('error_description');
      if (errorDescription) {
        if (cancelled) return;
        setStatus('error');
        setMessage(errorDescription);
        setNextRoute(loginDestination);
        return;
      }

      const supabase = getPlatformClient();
      const code = await readAuthParam('code');
      const tokenHash = await readAuthParam('token_hash');
      const accessToken = await readAuthParam('access_token');
      const refreshToken = await readAuthParam('refresh_token');

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        } else if (tokenHash) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: (type || 'signup') as 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email',
          });
          if (error) throw error;
        } else {
          throw new Error('This confirmation link is missing its return path.');
        }

        if (typeof window !== 'undefined') {
          window.history.replaceState({}, '', '/auth/confirm');
        }
        if (cancelled) return;

        // New invitees: email already verified by this link — complete profile (no OTP).
        if (type === 'invite') {
          router.replace({ pathname: '/register', params: { fromInvite: '1' } });
          return;
        }

        if (type === 'recovery') {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          router.replace(loginRouteWithEmail(user?.email || emailParam) as never);
          return;
        }
        router.replace('/');
        return;
      } catch (error) {
        if (cancelled) return;
        // Prefer email from the link; fall back to session user if any.
        let emailForLogin = emailParam;
        if (!emailForLogin) {
          try {
            const {
              data: { user },
            } = await getPlatformClient().auth.getUser();
            emailForLogin = user?.email ?? null;
          } catch {
            /* ignore */
          }
        }
        setStatus('error');
        setMessage(
          error instanceof Error && error.message
            ? error.message
            : 'This link has expired or has already been used.',
        );
        // Invite / already-used links: go to login (not register) with email prefills when available.
        setNextRoute(loginRouteWithEmail(emailForLogin));
      }
    }

    void confirm();
    return () => {
      cancelled = true;
    };
  }, []);

  const goNext = () => {
    router.replace(
      nextRoute.params
        ? ({ pathname: nextRoute.pathname, params: nextRoute.params } as never)
        : (nextRoute.pathname as never),
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        {status === 'verifying' ? (
          <>
            <ActivityIndicator size="large" color="#6C5CE7" />
            <Text style={styles.message}>{message}</Text>
          </>
        ) : null}
        {status === 'success' ? (
          <>
            <Text style={styles.successIcon}>✓</Text>
            <Text style={styles.message}>{message}</Text>
            <TouchableOpacity style={styles.button} onPress={goNext}>
              <Text style={styles.buttonText}>Continue</Text>
            </TouchableOpacity>
          </>
        ) : null}
        {status === 'error' ? (
          <>
            <Text style={styles.errorIcon}>✗</Text>
            <Text style={styles.message}>{message}</Text>
            <TouchableOpacity style={styles.button} onPress={goNext}>
              <Text style={styles.buttonText}>Go to sign in</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  message: {
    marginTop: 20,
    fontSize: 16,
    lineHeight: 24,
    color: '#2D3436',
    textAlign: 'center',
  },
  successIcon: {
    fontSize: 64,
    color: '#00B894',
  },
  errorIcon: {
    fontSize: 64,
    color: '#E74C3C',
  },
  button: {
    marginTop: 24,
    backgroundColor: '#6C5CE7',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
