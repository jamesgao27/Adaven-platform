import { useState, useEffect } from 'react';
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
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { updatePassword, isAuthenticated, signOut } from '@/lib/auth';
import { showToast } from '@/lib/toast';
import { showChoiceDialog } from '@/lib/confirmDialog';

export default function SetPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.createElement('style');
    style.textContent = `
      #set-password-form input:-webkit-autofill,
      #set-password-form input:-webkit-autofill:hover,
      #set-password-form input:-webkit-autofill:focus {
        -webkit-box-shadow: 0 0 0 1000px #F8F9FA inset !important;
        box-shadow: 0 0 0 1000px #F8F9FA inset !important;
      }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  const checkAuth = async () => {
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      setTimeout(async () => {
        const retryAuth = await isAuthenticated();
        if (!retryAuth) {
          showChoiceDialog(
            'Link expired',
            'This link has expired or has already been used. Please request a new link.',
            [
              { text: 'Request New Link', onPress: () => router.replace('/reset-password'), style: 'primary' },
              { text: 'Cancel', onPress: () => router.replace('/login'), style: 'cancel' },
            ]
          );
        }
      }, 2000);
    }
  };

  const handleSetPassword = async () => {
    if (!password.trim()) {
      showToast('Please enter a new password', 'error');
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
    const { error } = await updatePassword(password.trim());
    setLoading(false);
    if (error) {
      showToast(error.message, 'error');
    } else {
      showToast('Your password has been set successfully. Please sign in with your new password.', 'success');
      try {
        await signOut();
      } catch (_) {}
      router.replace('/login');
    }
  };

  // 移动端：保持原有布局（大图标 + 标题 + 表单）
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
              <View style={styles.iconContainer}>
                <View style={styles.circle}>
                  <Ionicons name="lock-closed" size={60} color="#6C5CE7" />
                </View>
              </View>
              <Text style={styles.title}>Set New Password</Text>
              <Text style={styles.subtitle}>Enter your new password</Text>
            </View>
            <View style={styles.formMobile}>
              <View style={styles.inputContainer}>
                <Ionicons name="lock-closed-outline" size={20} color="#636E72" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="New Password"
                  placeholderTextColor="#95A5A6"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete="password-new"
                  textContentType="newPassword"
                  editable={!loading}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon} hitSlop={10}>
                  <Ionicons name={showPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#636E72" />
                </TouchableOpacity>
              </View>
              <View style={styles.inputContainer}>
                <Ionicons name="lock-closed-outline" size={20} color="#636E72" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Confirm New Password"
                  placeholderTextColor="#95A5A6"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoComplete="password-new"
                  textContentType="newPassword"
                  editable={!loading}
                />
                <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeIcon} hitSlop={10}>
                  <Ionicons name={showConfirmPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#636E72" />
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleSetPassword}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Set Password</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Web 端：与登录页同风格（背景球 + 白卡片 + 渐变按钮 + 输入样式）
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <StatusBar style="dark" />
      <View style={styles.bg}>
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
      </View>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.logoRow}>
              <Image source={require('../../../assets/logo.png')} style={styles.logoImg} resizeMode="contain" />
              <Text style={styles.brandName}>Portalflow</Text>
            </View>
            <Text style={styles.pageTitle}>Set New Password</Text>
            <Text style={styles.pageSubtitle}>Enter your new password below</Text>
          </View>

          <View style={styles.form} {...(Platform.OS === 'web' ? { nativeID: 'set-password-form' } : {})}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>New Password</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={20} color="#636E72" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  underlineColorAndroid="transparent"
                  placeholderTextColor="#95A5A6"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete="password-new"
                  textContentType="newPassword"
                  editable={!loading}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon} hitSlop={10}>
                  <Ionicons name={showPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#636E72" />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirm New Password</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={20} color="#636E72" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  underlineColorAndroid="transparent"
                  placeholderTextColor="#95A5A6"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoComplete="password-new"
                  textContentType="newPassword"
                  editable={!loading}
                />
                <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeIcon} hitSlop={10}>
                  <Ionicons name={showConfirmPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#636E72" />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.btnWrap, loading && styles.btnDisabled]}
              onPress={handleSetPassword}
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
                  <Text style={styles.loginBtnText}>Set Password</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.footerLink} onPress={() => router.replace('/login')}>
              <Text style={styles.footerLinkP}>Back to <Text style={styles.footerLinkSpan}>Sign In</Text></Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  orb1: { width: '100%', height: '100%', borderRadius: 400 },
  orb2Wrap: {
    position: 'absolute',
    width: 600,
    height: 480,
    bottom: -80,
    right: -100,
    borderRadius: 300,
    overflow: 'hidden',
  },
  orb2: { width: '100%', height: '100%', borderRadius: 300 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    padding: 32,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
  },
  header: { alignItems: 'center', marginBottom: 28 },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 20,
  },
  logoImg: { width: 64, height: 64 },
  brandName: {
    fontSize: 32,
    fontWeight: '800',
    color: '#6C5CE7',
    letterSpacing: -0.5,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#2D3436',
    marginBottom: 4,
  },
  pageSubtitle: {
    fontSize: 14,
    color: '#636E72',
    marginBottom: 8,
  },
  form: { gap: 24 },
  inputGroup: { gap: 8 },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#2D3436',
    marginLeft: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  inputIcon: { marginRight: 12 },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#2D3436',
    paddingVertical: 0,
    minHeight: 24,
    includeFontPadding: false,
    textAlignVertical: 'center',
    backgroundColor: '#F8F9FA',
    outlineStyle: 'none',
  },
  eyeIcon: { padding: 4 },
  btnWrap: { marginTop: 16, borderRadius: 16, overflow: 'hidden' },
  btnDisabled: { opacity: 0.7 },
  loginBtn: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  loginBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  footer: { marginTop: 28, alignItems: 'center' },
  footerLink: { paddingVertical: 4 },
  footerLinkP: { fontSize: 14, color: '#636E72' },
  footerLinkSpan: { color: '#6C5CE7', fontWeight: '600' },

  // 移动端专用
  scrollContentMobile: { flexGrow: 1 },
  contentMobile: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 80,
    paddingBottom: 40,
  },
  headerMobile: { alignItems: 'center', marginBottom: 40 },
  iconContainer: { marginBottom: 24 },
  circle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#E9ECEF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 28, fontWeight: 'bold', color: '#2D3436', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#636E72' },
  formMobile: { flex: 1, paddingBottom: 20 },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    minHeight: 56,
  },
  button: {
    backgroundColor: '#6C5CE7',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 24,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
