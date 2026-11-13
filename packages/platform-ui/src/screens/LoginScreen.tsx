import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { signIn, verifyEmailOtp, resendEmailOtp } from '@adaven/platform-core';
import { showToast } from '../lib/toast';
import { EmailCodeStep } from './EmailCodeStep';
import { ThirdPartyAuthButtons } from '../ThirdPartyAuthButtons';
import { getProductUi } from '../product';
import { AUTH_FORM } from '../styles/auth-form';

export default function LoginScreen() {
  const product = getProductUi();
  const router = useRouter();
  const params = useLocalSearchParams<{
    inviteId?: string;
    email?: string;
    redirect?: string;
    token?: string;
    firmClientId?: string;
  }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pendingConfirmEmail, setPendingConfirmEmail] = useState<string | null>(null);
  const passwordInputRef = useRef<TextInput>(null);

  useEffect(() => {
    const raw = params.email;
    const emailParam = Array.isArray(raw) ? raw[0] : raw;
    if (emailParam) setEmail(String(emailParam));
    checkExistingSession();
  }, [params]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.createElement('style');
    style.textContent = `
      #login-form input:-webkit-autofill,
      #login-form input:-webkit-autofill:hover,
      #login-form input:-webkit-autofill:focus {
        -webkit-box-shadow: 0 0 0 1000px #F8F9FA inset !important;
        box-shadow: 0 0 0 1000px #F8F9FA inset !important;
      }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  const checkExistingSession = async () => {
    try {
      const { isAuthenticated } = await import('@adaven/platform-core');
      if (!(await isAuthenticated())) return;
      if (params.redirect === '/auth/setup') {
        const t = (params.token ?? '').trim();
        const f = (params.firmClientId ?? '').trim();
        if (t) {
          router.replace({ pathname: '/auth/setup', params: { token: t } });
          return;
        }
        if (f) {
          router.replace({ pathname: '/auth/setup', params: { firmClientId: f } });
          return;
        }
      }
      if (params.redirect === '/dealer-join') {
        const t = (params.token ?? '').trim();
        router.replace(t ? { pathname: '/dealer-join', params: { token: t } } : '/dealer-join');
        return;
      }
      // 已登录且带邀请：进接受队列，勿直接踢回首页
      if ((params.inviteId ?? '').trim()) {
        router.replace('/handle-invitations');
        return;
      }
      try {
        const { getPendingInvitationsForUser } = await import('@adaven/platform-core');
        if ((await getPendingInvitationsForUser()).length > 0) {
          router.replace('/handle-invitations');
          return;
        }
      } catch (_) {}
            router.replace('/');
    } catch (_) {}
  };

  const continueAfterAuth = async () => {
    try {
      const { getCurrentUser, getCurrentSpace, initializeAuthCache } = await import('@adaven/platform-core');
      const u = await getCurrentUser(true);
      const s = u ? await getCurrentSpace(false) : null;
      await initializeAuthCache(u, s);
    } catch (_) {
      // Non-blocking; index will refresh auth state.
    }
    if (params.redirect === '/auth/setup') {
      const t = (params.token ?? '').trim();
      const f = (params.firmClientId ?? '').trim();
      if (t) {
        router.replace({ pathname: '/auth/setup', params: { token: t } });
        return;
      }
      if (f) {
        router.replace({ pathname: '/auth/setup', params: { firmClientId: f } });
        return;
      }
    }
    if (params.redirect === '/dealer-join') {
      const t = (params.token ?? '').trim();
      router.replace(t ? { pathname: '/dealer-join', params: { token: t } } : '/dealer-join');
      return;
    }
    if ((params.inviteId ?? '').trim()) {
      router.replace('/handle-invitations');
      return;
    }
    try {
      const { getPendingInvitationsForUser } = await import('@adaven/platform-core');
      if ((await getPendingInvitationsForUser()).length > 0) {
        router.replace('/handle-invitations');
        return;
      }
    } catch (_) {}
    router.replace('/');
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      showToast('Please enter email and password', 'error');
      return;
    }
    setLoading(true);
    const { error } = await signIn(email.trim(), password.trim());
    setLoading(false);
    if (error) {
      if (error.message === 'EMAIL_NOT_CONFIRMED') {
        const address = email.trim();
        setPendingConfirmEmail(address);
        const { error: resendError } = await resendEmailOtp(address, 'signup');
        if (resendError) showToast(resendError.message, 'error');
        return;
      }
      showToast(error.message, 'error');
      return;
    }
    await continueAfterAuth();
  };

  if (pendingConfirmEmail) {
    return (
      <EmailCodeStep
        email={pendingConfirmEmail}
        title="Confirm your email"
        message="Enter the 6-digit code we sent to"
        submitLabel="Confirm and sign in"
        autoSubmit
        onBack={() => setPendingConfirmEmail(null)}
        onResend={async () => {
          const { error } = await resendEmailOtp(pendingConfirmEmail, 'signup');
          if (error) throw error;
        }}
        onSubmit={async (code) => {
          const { error } = await verifyEmailOtp(pendingConfirmEmail, code, 'signup');
          if (error) throw error;
          await continueAfterAuth();
        }}
      />
    );
  }

  if (Platform.OS !== 'web') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <StatusBar style="dark" />
        <ScrollView
          contentContainerStyle={styles.scrollContentMobile}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.contentMobile}>
            <View style={styles.headerMobile}>
              <View style={styles.logoRowMobile}>
                <Image
                  source={product.logo}
                  style={[
                    styles.logoImgMobile,
                    {
                      width: product.authLogoSize ?? 64,
                      height: product.authLogoSize ?? 64,
                    },
                  ]}
                  resizeMode="contain"
                />
                <Text style={styles.brandNameMobile}>{product.productName}</Text>
              </View>
              <Text style={styles.sloganMobile}>
                <Text style={styles.sloganLine1Mobile}>{product.sloganLine1}</Text>
                {'\n'}
                <Text style={styles.sloganLine2Mobile}>{product.sloganLine2}</Text>
              </Text>
            </View>

            <View style={styles.formMobile}>
              <View style={styles.inputContainerMobile}>
                <Ionicons name="mail-outline" size={20} color="#636E72" style={styles.inputIconMobile} />
                <TextInput
                  style={styles.inputMobile}
                  placeholder="Email"
                  placeholderTextColor="#95A5A6"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  textContentType="emailAddress"
                  importantForAutofill="yes"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                  editable={!loading}
                />
              </View>

              <View style={styles.inputContainerMobile}>
                <Ionicons name="lock-closed-outline" size={20} color="#636E72" style={styles.inputIconMobile} />
                <TextInput
                  ref={passwordInputRef}
                  style={styles.inputMobile}
                  placeholder="Password"
                  placeholderTextColor="#95A5A6"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete="password"
                  textContentType="password"
                  importantForAutofill="yes"
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  editable={!loading}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeIconMobile}
                  hitSlop={10}
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Ionicons name={showPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#636E72" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.buttonMobile, loading && styles.buttonDisabledMobile]}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonTextMobile}>Sign In</Text>
                )}
              </TouchableOpacity>

              <ThirdPartyAuthButtons disabled={loading} onError={(message) => showToast(message, 'error')} />

              <View style={styles.linksContainerMobile}>
                <TouchableOpacity style={styles.linkButtonMobile} onPress={() => router.push('/reset-password')}>
                  <Text style={styles.linkTextMobile}>
                    Forgot password? <Text style={styles.linkTextBoldMobile}>Reset It</Text>
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.linkButtonMobile}
                  onPress={() =>
                    router.push({
                      pathname: '/register',
                      params: {
                        ...(params.redirect ? { redirect: params.redirect } : {}),
                        ...(params.token ? { token: params.token } : {}),
                        ...(params.firmClientId ? { firmClientId: params.firmClientId } : {}),
                        ...(params.email ? { email: params.email } : {}),
                      },
                    })
                  }
                >
                  <Text style={styles.linkTextMobile}>
                    Don't have an account? <Text style={styles.linkTextBoldMobile}>Sign Up</Text>
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <StatusBar style="dark" />
      <View style={styles.bg}>
        {Platform.OS === 'web' && (
          <>
            <View style={styles.orb1Wrap}>
              <LinearGradient
                colors={['rgba(108, 92, 231, 0.2)', 'rgba(108, 92, 231, 0.06)', 'transparent']}
                locations={[0, 0.5, 1]}
                start={{ x: 0.5, y: 0.5 }}
                end={{ x: 1, y: 1 }}
                style={styles.orb1}
              />
            </View>
            <View style={styles.orb2Wrap}>
              <LinearGradient
                colors={['rgba(162, 155, 254, 0.15)', 'rgba(162, 155, 254, 0.04)', 'transparent']}
                locations={[0, 0.5, 1]}
                start={{ x: 0.5, y: 0.5 }}
                end={{ x: 0, y: 0 }}
                style={styles.orb2}
              />
            </View>
          </>
        )}
      </View>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.logoRow}>
              <Image
                source={product.logo}
                style={[
                  styles.logoImg,
                  {
                    width: product.authLogoSize ?? 64,
                    height: product.authLogoSize ?? 64,
                  },
                ]}
                resizeMode="contain"
              />
              <Text style={styles.brandName}>{product.productName}</Text>
            </View>
            <Text style={styles.slogan}>
              <Text style={styles.sloganLine1}>{product.sloganLine1}</Text>
              {'\n'}
              <Text style={styles.sloganLine2}>{product.sloganLine2}</Text>
            </Text>
          </View>

          <View style={styles.form} {...(Platform.OS === 'web' ? { nativeID: 'login-form' } : {})}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email Address</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="mail-outline" size={20} color="#636E72" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="name@example.com"
                  underlineColorAndroid="transparent"
                  placeholderTextColor="#95A5A6"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                  editable={!loading}
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={20} color="#636E72" style={styles.inputIcon} />
                <TextInput
                  ref={passwordInputRef}
                  style={styles.input}
                  placeholder="••••••••"
                  underlineColorAndroid="transparent"
                  placeholderTextColor="#95A5A6"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete="password"
                  textContentType="password"
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  editable={!loading}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeIcon}
                  hitSlop={10}
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Ionicons name={showPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#636E72" />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.btnWrap, loading && styles.btnDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={['#6C5CE7', '#A29BFE']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.loginBtn}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.loginBtnText}>Sign In</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <ThirdPartyAuthButtons disabled={loading} onError={(message) => showToast(message, 'error')} />
          </View>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.footerLink} onPress={() => router.push('/reset-password')}>
              <Text style={styles.footerLinkP}>Forgot password? <Text style={styles.footerLinkSpan}>Reset It</Text></Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.footerLink}
              onPress={() =>
                router.push({
                  pathname: '/register',
                  params: {
                    ...(params.redirect ? { redirect: params.redirect } : {}),
                    ...(params.token ? { token: params.token } : {}),
                    ...(params.firmClientId ? { firmClientId: params.firmClientId } : {}),
                    ...(params.email ? { email: params.email } : {}),
                  },
                })
              }
            >
              <Text style={styles.footerLinkP}>Don't have an account? <Text style={styles.footerLinkSpan}>Sign Up</Text></Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContentMobile: { flexGrow: 1 },
  contentMobile: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 80,
    paddingBottom: 40,
  },
  headerMobile: { alignItems: 'center', marginBottom: 28 },
  logoRowMobile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 16,
  },
  logoImgMobile: { width: 64, height: 64, borderRadius: 16, overflow: 'hidden', backgroundColor: 'transparent' },
  brandNameMobile: {
    fontSize: 32,
    fontWeight: '800',
    color: '#6C5CE7',
    letterSpacing: -0.5,
  },
  sloganMobile: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 32,
  },
  sloganLine1Mobile: { color: '#2D3436' },
  sloganLine2Mobile: { color: '#6C5CE7' },
  formMobile: { flex: 1, paddingBottom: 20, gap: AUTH_FORM.fieldGap },
  inputContainerMobile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: AUTH_FORM.inputBgMobile,
    borderRadius: AUTH_FORM.controlRadius,
    paddingHorizontal: AUTH_FORM.horizontalPadding,
    borderWidth: 1,
    borderColor: AUTH_FORM.borderColor,
    minHeight: AUTH_FORM.controlMinHeight,
    justifyContent: 'flex-start',
  },
  inputIconMobile: { marginRight: 12 },
  inputMobile: {
    flex: 1,
    fontSize: AUTH_FORM.inputFontSize,
    color: AUTH_FORM.textColor,
    paddingVertical: 0,
    minHeight: 22,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  eyeIconMobile: { padding: 4 },
  buttonMobile: {
    backgroundColor: AUTH_FORM.primary,
    borderRadius: AUTH_FORM.controlRadius,
    minHeight: AUTH_FORM.controlMinHeight,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 0,
    shadowColor: AUTH_FORM.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  buttonDisabledMobile: { opacity: 0.6 },
  buttonTextMobile: { color: '#fff', fontSize: AUTH_FORM.buttonFontSize, fontWeight: '600' },
  linksContainerMobile: { gap: AUTH_FORM.sectionGap, marginTop: AUTH_FORM.sectionGap },
  linkButtonMobile: { alignItems: 'center', paddingVertical: 4 },
  linkTextMobile: { fontSize: 14, color: AUTH_FORM.mutedColor },
  linkTextBoldMobile: { color: AUTH_FORM.primary, fontWeight: '600' },
  bg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#F8F9FA',
    overflow: 'visible',
  },
  orb1Wrap: {
    position: 'absolute',
    width: 800,
    height: 500,
    top: -150,
    left: '50%',
    marginLeft: -400,
    borderRadius: 400,
    overflow: 'hidden',
  },
  orb1: {
    width: '100%',
    height: '100%',
    borderRadius: 400,
  },
  orb2Wrap: {
    position: 'absolute',
    width: 600,
    height: 480,
    bottom: -80,
    right: -100,
    borderRadius: 300,
    overflow: 'hidden',
  },
  orb2: {
    width: '100%',
    height: '100%',
    borderRadius: 300,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
  },
  header: {
    alignItems: 'center',
    marginBottom: 14,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 10,
  },
  logoImg: {
    width: 64,
    height: 64,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  brandName: {
    fontSize: 28,
    fontWeight: '800',
    color: '#6C5CE7',
    letterSpacing: -0.5,
  },
  slogan: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 28,
  },
  sloganLine1: {
    color: '#2D3436',
  },
  sloganLine2: {
    color: '#6C5CE7',
  },
  form: {
    gap: AUTH_FORM.fieldGap,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: AUTH_FORM.labelFontSize,
    fontWeight: '500',
    color: AUTH_FORM.textColor,
    marginLeft: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: AUTH_FORM.inputBg,
    borderWidth: 1,
    borderColor: AUTH_FORM.borderColor,
    borderRadius: AUTH_FORM.controlRadius,
    paddingHorizontal: AUTH_FORM.horizontalPadding,
    minHeight: AUTH_FORM.controlMinHeight,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: AUTH_FORM.inputFontSize,
    color: AUTH_FORM.textColor,
    paddingVertical: 0,
    minHeight: 22,
    includeFontPadding: false,
    textAlignVertical: 'center',
    backgroundColor: AUTH_FORM.inputBg,
    outlineStyle: 'none',
  },
  eyeIcon: {
    padding: 4,
  },
  btnWrap: {
    marginTop: 4,
    borderRadius: AUTH_FORM.controlRadius,
    overflow: 'hidden',
  },
  btnDisabled: {
    opacity: 0.7,
  },
  loginBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: AUTH_FORM.controlMinHeight,
  },
  loginBtnText: {
    color: '#fff',
    fontSize: AUTH_FORM.buttonFontSize,
    fontWeight: '600',
  },
  footer: {
    marginTop: AUTH_FORM.sectionGap,
    alignItems: 'center',
    gap: AUTH_FORM.fieldGap,
  },
  footerLink: {
    paddingVertical: 2,
  },
  footerLinkP: {
    fontSize: 13,
    color: '#636E72',
  },
  footerLinkSpan: {
    color: '#6C5CE7',
    fontWeight: '600',
  },
});
