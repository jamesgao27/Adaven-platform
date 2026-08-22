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
  Modal,
  Image,
  Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { signUp, updatePassword, getCurrentUser } from '@adaven/platform-core';
import { getPlatformClient } from '@adaven/platform-core';
import { showToast } from '../lib/toast';
import { getProductUi } from '../product';

const isWeb = Platform.OS === 'web';

export default function RegisterScreen() {
  const product = getProductUi();
  const router = useRouter();
  const params = useLocalSearchParams<{
    inviteId?: string;
    email?: string;
    redirect?: string;
    token?: string;
    firmClientId?: string;
    fromInvite?: string;
  }>();
  const isFromInvite = params.fromInvite === '1' || params.fromInvite === 'true';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [userName, setUserName] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showEmailConfirmationModal, setShowEmailConfirmationModal] = useState(false);
  const [inviteReady, setInviteReady] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const emailInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);
  const confirmPasswordInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (params.email) {
      setEmail(params.email);
    }
  }, [params]);

  // 邀请补全：已通过邮件验证，从 session 取邮箱并锁定
  useEffect(() => {
    if (!isFromInvite) return;
    let cancelled = false;
    (async () => {
      const user = await getCurrentUser();
      if (cancelled) return;
      if (!user) {
        router.replace('/login');
        return;
      }
      setEmail(user.email || '');
      setInviteReady(true);
    })();
    return () => { cancelled = true; };
  }, [isFromInvite, router]);

  const handleRegister = async () => {
    if (!email.trim()) {
      showToast('Please enter email', 'error');
      return;
    }

    if (!isFromInvite && !agreedToTerms) {
      showToast('Please agree to the Privacy Policy and Terms of Service', 'error');
      return;
    }

    if (password.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }

    if (password !== confirmPassword) {
      showToast('Passwords do not match', 'error');
      return;
    }

    setLoading(true);
    try {
      // 邀请补全：已验证邮箱，只设置密码和名字，然后进入接受邀请/选空间流程
      if (isFromInvite) {
        const user = await getCurrentUser();
        if (!user) {
          setLoading(false);
          router.replace('/login');
          return;
        }
        const { error: pwdError } = await updatePassword(password.trim());
        if (pwdError) {
          setLoading(false);
          showToast(pwdError.message, 'error');
          return;
        }
        const name = userName.trim() || email.trim().split('@')[0] || 'User';
        const { error: updateError } = await getPlatformClient().from('users').update({ name }).eq('id', user.id);
        if (updateError) {
          console.warn('Update user name failed (non-blocking):', updateError);
        }
        setLoading(false);
        showToast('Profile saved. Welcome!', 'success');
        const { getPendingInvitationsForUser } = await import('@adaven/platform-core');
        const invitations = await getPendingInvitationsForUser();
        if (invitations.length > 0) {
          router.replace('/handle-invitations');
        } else {
          router.replace('/');
        }
        return;
      }

      // 普通注册：创建用户并走邮箱验证
      const { user, error } = await signUp(email.trim(), password, undefined, userName.trim() || undefined);
      
      if (error) {
        setLoading(false);
        
        // 检查是否是邮箱确认错误（这是正常的，不是真正的错误）
        const errorMessage = error.message || 'Unknown error';
        
        if (errorMessage === 'EMAIL_CONFIRMATION_REQUIRED') {
          // 注册成功，但需要邮箱确认，不打印错误日志
          setShowEmailConfirmationModal(true);
          return;
        }
        
        // 只有真正的错误才打印日志
        console.error('Registration error:', error);
        console.error('Error details:', {
          message: error.message,
          name: error.name,
          status: (error as any).status,
          details: (error as any).details,
        });
        
        let userMessage = errorMessage;
        
        if (errorMessage.includes('confirmation email') || errorMessage.includes('sending email')) {
          userMessage = 'Failed to send confirmation email. Please check:\n\n1. SMTP configuration in Supabase Dashboard\n2. Email server settings\n3. Check Supabase Auth Logs for details\n\nSee EMAIL_SMTP_TROUBLESHOOTING.md for help.';
        } else if (errorMessage.includes('already registered') || errorMessage.includes('email already')) {
          userMessage = 'This email is already registered. Please sign in instead.';
        }
        
        showToast(userMessage, 'error');
        return;
      }

      if (!user) {
        setLoading(false);
        showToast('Unknown error, please try again', 'error');
        return;
      }

      setLoading(false);
      showToast('Your account has been created. Please sign in to continue.', 'success');
      {
        const t = (params.token ?? '').trim();
        const f = (params.firmClientId ?? '').trim();
        if (params.redirect === '/auth/setup' && (t || f)) {
          router.replace({ pathname: '/auth/setup', params: t ? { token: t } : { firmClientId: f } });
        } else {
          const lp: Record<string, string> = {};
          if (params.redirect) lp.redirect = params.redirect;
          if (t) lp.token = t;
          if (f) lp.firmClientId = f;
          if ((params.inviteId ?? '').trim()) lp.inviteId = String(params.inviteId).trim();
          if (email.trim()) lp.email = email.trim();
          router.replace({ pathname: '/login', params: lp });
        }
      }
    } catch (err) {
      setLoading(false);
      console.error('Registration exception:', err);
      showToast(err instanceof Error ? err.message : 'Unknown error', 'error');
    }
  };

  const modalBlock = (
    <Modal
      visible={showEmailConfirmationModal}
      transparent={true}
      animationType="fade"
      onRequestClose={() => {
        setShowEmailConfirmationModal(false);
        {
          const t = (params.token ?? '').trim();
          const f = (params.firmClientId ?? '').trim();
          if (params.redirect === '/auth/setup' && (t || f)) {
            router.replace({ pathname: '/auth/setup', params: t ? { token: t } : { firmClientId: f } });
          } else {
            const lp: Record<string, string> = {};
            if (params.redirect) lp.redirect = params.redirect;
            if (t) lp.token = t;
            if (f) lp.firmClientId = f;
            if ((params.inviteId ?? '').trim()) lp.inviteId = String(params.inviteId).trim();
            if (email.trim()) lp.email = email.trim();
            router.replace({ pathname: '/login', params: lp });
          }
        }
      }}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalIconContainer}>
            <View style={styles.modalIconCircle}>
              <Ionicons name="mail" size={48} color="#6C5CE7" />
            </View>
          </View>
          <Text style={styles.modalTitle}>Check Your Email</Text>
          <Text style={styles.modalMessage}>
            You're just one step away from getting organized on {product.productName}.
          </Text>
          <Text style={styles.modalSubMessage}>
            Please check the email you received to verify your account.
          </Text>
          <TouchableOpacity
            style={styles.modalButton}
            onPress={() => {
              setShowEmailConfirmationModal(false);
              const t = (params.token ?? '').trim();
              const f = (params.firmClientId ?? '').trim();
              if (params.redirect === '/auth/setup' && (t || f)) {
                router.replace({ pathname: '/auth/setup', params: t ? { token: t } : { firmClientId: f } });
              } else {
                const lp: Record<string, string> = {};
                if (params.redirect) lp.redirect = params.redirect;
                if (t) lp.token = t;
                if (f) lp.firmClientId = f;
                if ((params.inviteId ?? '').trim()) lp.inviteId = String(params.inviteId).trim();
                if (email.trim()) lp.email = email.trim();
                router.replace({ pathname: '/login', params: lp });
              }
            }}
          >
            <Text style={styles.modalButtonText}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  if (isWeb) {
    return (
      <KeyboardAvoidingView style={stylesWeb.container} behavior={undefined}>
        <StatusBar style="dark" />
        <View style={stylesWeb.bg}>
          <View style={stylesWeb.orb1Wrap}>
            <LinearGradient
              colors={['rgba(108, 92, 231, 0.2)', 'rgba(108, 92, 231, 0.06)', 'transparent']}
              locations={[0, 0.5, 1]}
              start={{ x: 0.5, y: 0.5 }}
              end={{ x: 1, y: 1 }}
              style={stylesWeb.orb1}
            />
          </View>
          <View style={stylesWeb.orb2Wrap}>
            <LinearGradient
              colors={['rgba(162, 155, 254, 0.15)', 'rgba(162, 155, 254, 0.04)', 'transparent']}
              locations={[0, 0.5, 1]}
              start={{ x: 0.5, y: 0.5 }}
              end={{ x: 0, y: 0 }}
              style={stylesWeb.orb2}
            />
          </View>
        </View>
        <ScrollView
          contentContainerStyle={stylesWeb.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={stylesWeb.card}>
            <TouchableOpacity style={stylesWeb.backBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color="#2D3436" />
            </TouchableOpacity>
            <View style={stylesWeb.header}>
              <View style={stylesWeb.logoRow}>
                <Image source={product.logo} style={stylesWeb.logoImg} resizeMode="contain" />
                <Text style={stylesWeb.brandName}>{product.productName}</Text>
              </View>
              <Text style={stylesWeb.title}>{isFromInvite ? 'Complete your profile' : 'Create Account'}</Text>
              <Text style={stylesWeb.subtitle}>
                {isFromInvite ? 'Set your name and password to continue' : 'Start your receipt tracking journey'}
              </Text>
            </View>
            <View style={stylesWeb.form}>
              <Text style={stylesWeb.label}>Your name</Text>
              <View style={stylesWeb.inputWrapper}>
                <Ionicons name="person-outline" size={20} color="#636E72" style={stylesWeb.inputIcon} />
                <TextInput
                  style={stylesWeb.input}
                  placeholder="Your name"
                  placeholderTextColor="#95A5A6"
                  value={userName}
                  onChangeText={setUserName}
                  autoCapitalize="words"
                  autoComplete="name"
                  editable={!loading}
                />
              </View>
              <Text style={stylesWeb.label}>Email Address</Text>
              <View style={stylesWeb.inputWrapper}>
                <Ionicons name="mail-outline" size={20} color="#636E72" style={stylesWeb.inputIcon} />
                <TextInput
                  ref={emailInputRef}
                  style={[stylesWeb.input, isFromInvite && stylesWeb.inputReadOnly]}
                  placeholder="name@example.com"
                  placeholderTextColor="#95A5A6"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="username"
                  editable={!loading && !isFromInvite}
                />
              </View>
              <Text style={stylesWeb.label}>Password</Text>
              <View style={stylesWeb.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={20} color="#636E72" style={stylesWeb.inputIcon} />
                <TextInput
                  ref={passwordInputRef}
                  style={stylesWeb.input}
                  placeholder="••••••••"
                  placeholderTextColor="#95A5A6"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete="new-password"
                  editable={!loading}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={stylesWeb.eyeIcon} hitSlop={10}>
                  <Ionicons name={showPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#636E72" />
                </TouchableOpacity>
              </View>
              <Text style={stylesWeb.label}>Confirm Password</Text>
              <View style={stylesWeb.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={20} color="#636E72" style={stylesWeb.inputIcon} />
                <TextInput
                  ref={confirmPasswordInputRef}
                  style={stylesWeb.input}
                  placeholder="••••••••"
                  placeholderTextColor="#95A5A6"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoComplete="new-password"
                  editable={!loading}
                />
                <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={stylesWeb.eyeIcon} hitSlop={10}>
                  <Ionicons name={showConfirmPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#636E72" />
                </TouchableOpacity>
              </View>
              {!isFromInvite && (
                <View style={stylesWeb.agreementRow}>
                  <TouchableOpacity
                    style={stylesWeb.checkboxWrap}
                    onPress={() => setAgreedToTerms((v) => !v)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name={agreedToTerms ? 'checkbox' : 'square-outline'} size={22} color={agreedToTerms ? '#6C5CE7' : '#636E72'} />
                  </TouchableOpacity>
                  <View style={stylesWeb.agreementTextWrap}>
                    <Text style={stylesWeb.agreementText}>I agree to the </Text>
                    <TouchableOpacity onPress={() => Linking.openURL(product.privacyUrl)}>
                      <Text style={stylesWeb.linkText}>Privacy Policy</Text>
                    </TouchableOpacity>
                    <Text style={stylesWeb.agreementText}> and </Text>
                    <TouchableOpacity onPress={() => Linking.openURL(product.termsUrl)}>
                      <Text style={stylesWeb.linkText}>Terms of Service</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              <TouchableOpacity
                style={[stylesWeb.btnWrap, (loading || (isFromInvite && !inviteReady) || (!isFromInvite && !agreedToTerms)) && stylesWeb.btnDisabled]}
                onPress={handleRegister}
                disabled={loading || (isFromInvite && !inviteReady) || (!isFromInvite && !agreedToTerms)}
                activeOpacity={0.9}
              >
                <LinearGradient
                  colors={['#6C5CE7', '#A29BFE']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={stylesWeb.mainBtn}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={stylesWeb.mainBtnText}>{isFromInvite ? 'Continue' : 'Sign Up'}</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
              {!isFromInvite && (
                <TouchableOpacity
                  style={stylesWeb.footerLink}
                  onPress={() =>
                    router.push({
                      pathname: '/login',
                      params: {
                        ...(params.redirect ? { redirect: params.redirect } : {}),
                        ...(params.token ? { token: params.token } : {}),
                        ...(params.firmClientId ? { firmClientId: params.firmClientId } : {}),
                        ...(params.email ? { email: params.email } : {}),
                      },
                    })
                  }
                >
                  <Text style={stylesWeb.footerLinkP}>
                    Already have an account? <Text style={stylesWeb.footerLinkSpan}>Sign In</Text>
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </ScrollView>
        {modalBlock}
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="dark" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#2D3436" />
          </TouchableOpacity>
          <View style={styles.iconContainer}>
            <View style={styles.circle}>
              <Ionicons name="people" size={60} color="#6C5CE7" />
            </View>
          </View>
          <Text style={styles.title}>{isFromInvite ? 'Complete your profile' : 'Create Account'}</Text>
          <Text style={styles.subtitle}>
            {isFromInvite ? 'Set your name and password to continue' : 'Start your receipt tracking journey'}
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Ionicons name="person-outline" size={20} color="#636E72" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Your name"
              placeholderTextColor="#95A5A6"
              value={userName}
              onChangeText={setUserName}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => {
                if (!isFromInvite) emailInputRef.current?.focus();
                else passwordInputRef.current?.focus();
              }}
              accessibilityLabel="Your name"
              editable={!loading}
            />
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="mail-outline" size={20} color="#636E72" style={styles.inputIcon} />
            <TextInput
              ref={emailInputRef}
              style={[styles.input, isFromInvite && styles.inputReadOnly]}
              placeholder="Email *"
              placeholderTextColor="#95A5A6"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="username"
              textContentType="username"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => {
                passwordInputRef.current?.focus();
              }}
              accessibilityLabel="Email address"
              editable={!loading && !isFromInvite}
            />
          </View>


          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={20} color="#636E72" style={styles.inputIcon} />
            <TextInput
              ref={passwordInputRef}
              style={styles.input}
              placeholder="Password *"
              placeholderTextColor="#95A5A6"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="password-new"
              textContentType="newPassword"
              passwordRules="minlength: 6;"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => {
                confirmPasswordInputRef.current?.focus();
              }}
              accessibilityLabel="Password"
              editable={!loading}
            />
            <TouchableOpacity
              onPress={() => setShowPassword(!showPassword)}
              style={styles.eyeIcon}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel={showPassword ? "Hide password" : "Show password"}
            >
              <Ionicons
                name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                size={20}
                color="#636E72"
              />
            </TouchableOpacity>
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={20} color="#636E72" style={styles.inputIcon} />
            <TextInput
              ref={confirmPasswordInputRef}
              style={styles.input}
              placeholder="Confirm Password *"
              placeholderTextColor="#95A5A6"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showConfirmPassword}
              autoCapitalize="none"
              autoComplete="password-new"
              textContentType="newPassword"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleRegister}
              accessibilityLabel="Confirm password"
              editable={!loading}
            />
            <TouchableOpacity
              onPress={() => setShowConfirmPassword(!showConfirmPassword)}
              style={styles.eyeIcon}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel={showConfirmPassword ? "Hide password" : "Show password"}
            >
              <Ionicons
                name={showConfirmPassword ? 'eye-outline' : 'eye-off-outline'}
                size={20}
                color="#636E72"
              />
            </TouchableOpacity>
          </View>

          {!isFromInvite && (
            <View style={styles.agreementRow}>
              <TouchableOpacity
                style={styles.checkboxWrap}
                onPress={() => setAgreedToTerms((v) => !v)}
                activeOpacity={0.8}
              >
                <Ionicons name={agreedToTerms ? 'checkbox' : 'square-outline'} size={22} color={agreedToTerms ? '#6C5CE7' : '#636E72'} />
              </TouchableOpacity>
              <View style={styles.agreementTextWrap}>
                <Text style={styles.agreementText}>I agree to the </Text>
                <TouchableOpacity onPress={() => Linking.openURL(product.privacyUrl)}>
                  <Text style={styles.linkTextInline}>Privacy Policy</Text>
                </TouchableOpacity>
                <Text style={styles.agreementText}> and </Text>
                <TouchableOpacity onPress={() => Linking.openURL(product.termsUrl)}>
                  <Text style={styles.linkTextInline}>Terms of Service</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[styles.button, (loading || (isFromInvite && !inviteReady) || (!isFromInvite && !agreedToTerms)) && styles.buttonDisabled]}
            onPress={handleRegister}
            disabled={loading || (isFromInvite && !inviteReady) || (!isFromInvite && !agreedToTerms)}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>{isFromInvite ? 'Continue' : 'Sign Up'}</Text>
            )}
          </TouchableOpacity>

          {!isFromInvite && (
            <TouchableOpacity
              style={styles.linkButton}
              onPress={() =>
                router.push({
                  pathname: '/login',
                  params: {
                    ...(params.redirect ? { redirect: params.redirect } : {}),
                    ...(params.token ? { token: params.token } : {}),
                    ...(params.firmClientId ? { firmClientId: params.firmClientId } : {}),
                    ...(params.email ? { email: params.email } : {}),
                  },
                })
              }
            >
              <Text style={styles.linkText}>
                Already have an account? <Text style={styles.linkTextBold}>Sign In</Text>
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
      {modalBlock}
    </KeyboardAvoidingView>
  );
}

const stylesWeb = StyleSheet.create({
  container: { flex: 1 },
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: '#F8F9FA', overflow: 'visible' },
  orb1Wrap: { position: 'absolute', width: 800, height: 500, top: -150, left: '50%', marginLeft: -400, borderRadius: 400, overflow: 'hidden' },
  orb1: { width: '100%', height: '100%', borderRadius: 400 },
  orb2Wrap: { position: 'absolute', width: 600, height: 480, bottom: -80, right: -100, borderRadius: 300, overflow: 'hidden' },
  orb2: { width: '100%', height: '100%', borderRadius: 300 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  card: { width: '100%', maxWidth: 440, backgroundColor: '#FFFFFF', borderRadius: 32, padding: 32, borderWidth: 1, borderColor: '#E9ECEF', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 4 },
  backBtn: { position: 'absolute', left: 24, top: 24, zIndex: 1, padding: 4 },
  header: { alignItems: 'center', marginBottom: 24 },
  logoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 20 },
  logoImg: { width: 64, height: 64 },
  brandName: { fontSize: 32, fontWeight: '800', color: '#6C5CE7', letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: '800', color: '#2D3436', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#636E72', textAlign: 'center' },
  form: { gap: 20 },
  label: { fontSize: 14, fontWeight: '500', color: '#2D3436', marginLeft: 4 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F9FA', borderWidth: 1, borderColor: '#E9ECEF', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, minHeight: 52 },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16, color: '#2D3436', paddingVertical: 0, minHeight: 24, includeFontPadding: false, textAlignVertical: 'center', backgroundColor: '#F8F9FA', outlineStyle: 'none' },
  inputReadOnly: { color: '#636E72', opacity: 0.9 },
  eyeIcon: { padding: 4 },
  agreementRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 4 },
  checkboxWrap: { marginRight: 10, padding: 2 },
  agreementTextWrap: { flex: 1, flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center' },
  agreementText: { fontSize: 13, color: '#636E72' },
  linkText: { fontSize: 13, color: '#6C5CE7', fontWeight: '600', textDecorationLine: 'underline' },
  btnWrap: { marginTop: 8, borderRadius: 16, overflow: 'hidden' },
  btnDisabled: { opacity: 0.7 },
  mainBtn: { paddingVertical: 16, alignItems: 'center', justifyContent: 'center', minHeight: 52 },
  mainBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  footerLink: { alignItems: 'center', marginTop: 20 },
  footerLinkP: { fontSize: 14, color: '#636E72' },
  footerLinkSpan: { color: '#6C5CE7', fontWeight: '600' },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  backButton: {
    position: 'absolute',
    left: 0,
    top: 0,
    padding: 8,
  },
  iconContainer: {
    marginBottom: 24,
    marginTop: 20,
  },
  circle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#E9ECEF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2D3436',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#636E72',
    textAlign: 'center',
  },
  form: {
    flex: 1,
    paddingBottom: 20,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    minHeight: 52,
    // 优化触摸响应
    justifyContent: 'flex-start',
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#2D3436',
    paddingVertical: 0,
    minHeight: 24,
    // 优化输入响应性
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  inputReadOnly: {
    color: '#636E72',
    opacity: 0.9,
  },
  eyeIcon: {
    padding: 4,
  },
  agreementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 4,
  },
  checkboxWrap: {
    marginRight: 8,
    padding: 2,
  },
  agreementTextWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
  },
  agreementText: {
    fontSize: 12,
    color: '#636E72',
  },
  linkTextInline: {
    fontSize: 12,
    color: '#6C5CE7',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  button: {
    backgroundColor: '#6C5CE7',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 20,
    minHeight: 52,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  linkButton: {
    alignItems: 'center',
  },
  linkText: {
    fontSize: 14,
    color: '#636E72',
  },
  linkTextBold: {
    color: '#6C5CE7',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 32,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  modalIconContainer: {
    marginBottom: 24,
  },
  modalIconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#E8F4FD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2D3436',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 16,
    color: '#2D3436',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 24,
  },
  modalSubMessage: {
    fontSize: 15,
    color: '#636E72',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  modalButton: {
    backgroundColor: '#6C5CE7',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 48,
    minWidth: 200,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

