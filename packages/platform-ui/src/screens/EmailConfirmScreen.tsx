import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { getPlatformClient } from '@adaven/platform-core';

type ConfirmStatus = 'verifying' | 'success' | 'error';

function paramFromUrlString(url: string, name: string): string | null {
  try {
    const parsed = Linking.parse(url);
    const fromQuery = parsed.queryParams?.[name];
    if (typeof fromQuery === 'string' && fromQuery) return fromQuery;
  } catch {
    // fall through
  }
  try {
    const normalized = url.includes('://') ? url.replace(/^([^:]+):\/\//, 'https://') : `https://x/?${url}`;
    const u = new URL(normalized);
    const fromSearch = u.searchParams.get(name);
    if (fromSearch) return fromSearch;
    const hash = u.hash?.replace(/^#/, '') ?? '';
    if (hash) {
      const fromHash = new URLSearchParams(hash).get(name);
      if (fromHash) return fromHash;
    }
  } catch {
    // fall through
  }
  const m = url.match(new RegExp(`[?#&]${name}=([^&#]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

async function readAuthParam(name: string, preferUrl?: string | null): Promise<string | null> {
  if (preferUrl) {
    const fromPrefer = paramFromUrlString(preferUrl, name);
    if (fromPrefer) return fromPrefer;
  }
  if (typeof window !== 'undefined') {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const value = query.get(name) || hash.get(name);
    if (value) return value;
  }
  const url = await Linking.getInitialURL();
  if (!url) return null;
  return paramFromUrlString(url, name);
}

/** Wait briefly for the OAuth / magic-link deep link — cold start often mounts confirm before the URL is ready. */
async function waitForAuthLandingUrl(timeoutMs = 2500): Promise<string | null> {
  const existing = await Linking.getInitialURL();
  if (existing && (existing.includes('code=') || existing.includes('token_hash=') || existing.includes('access_token=') || existing.includes('error'))) {
    return existing;
  }
  if (typeof window !== 'undefined') {
    const href = window.location.href;
    if (href.includes('code=') || href.includes('token_hash=') || href.includes('access_token=') || href.includes('error')) {
      return href;
    }
  }
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (url: string | null) => {
      if (settled) return;
      settled = true;
      sub.remove();
      clearTimeout(timer);
      resolve(url);
    };
    const sub = Linking.addEventListener('url', ({ url }) => finish(url));
    const timer = setTimeout(() => finish(existing), timeoutMs);
  });
}

type NextRoute = { pathname: string; params?: Record<string, string> };

function loginRouteWithEmail(email: string | null): NextRoute {
  const trimmed = (email || '').trim();
  if (!trimmed) return { pathname: '/login' };
  return { pathname: '/login', params: { email: trimmed } };
}

function isBenignCodeReuseError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('already') ||
    m.includes('expired') ||
    m.includes('invalid') ||
    m.includes('verifier') ||
    m.includes('code challenge')
  );
}

export default function EmailConfirmScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<ConfirmStatus>('verifying');
  const [message, setMessage] = useState('Signing you in...');
  const [nextRoute, setNextRoute] = useState<NextRoute>({ pathname: '/login' });

  useEffect(() => {
    let cancelled = false;

    async function confirm() {
      const landingUrl = await waitForAuthLandingUrl();
      if (cancelled) return;

      const type = await readAuthParam('type', landingUrl);
      const emailParam = await readAuthParam('email', landingUrl);
      const loginDestination = loginRouteWithEmail(emailParam);
      const errorDescription = await readAuthParam('error_description', landingUrl);
      if (errorDescription) {
        if (cancelled) return;
        setStatus('error');
        setMessage(errorDescription);
        setNextRoute(loginDestination);
        return;
      }

      const supabase = getPlatformClient();

      // Native Google SSO often exchanges the code in ThirdPartyAuthButtons first, then this
      // route still opens briefly. If a session already exists, go home without showing ✗.
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user && !cancelled) {
          router.replace('/');
          return;
        }
      } catch {
        // continue with link params
      }

      const code = await readAuthParam('code', landingUrl);
      const tokenHash = await readAuthParam('token_hash', landingUrl);
      const accessToken = await readAuthParam('access_token', landingUrl);
      const refreshToken = await readAuthParam('refresh_token', landingUrl);

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
          // Still no params — one more session check (SSO may have finished in parallel).
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session?.user) {
            if (!cancelled) router.replace('/');
            return;
          }
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

        // Code already consumed by native WebBrowser handler → treat as success if signed in.
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session?.user) {
            router.replace('/');
            return;
          }
        } catch {
          /* ignore */
        }

        const errMsg =
          error instanceof Error && error.message
            ? error.message
            : 'This link has expired or has already been used.';

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

        // Avoid flashing a scary error for transient double-exchange races; keep verifying then login.
        if (isBenignCodeReuseError(errMsg) && !emailForLogin) {
          router.replace('/login');
          return;
        }

        setStatus('error');
        setMessage(errMsg);
        setNextRoute(loginRouteWithEmail(emailForLogin));
      }
    }

    void confirm();
    return () => {
      cancelled = true;
    };
  }, [router]);

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
