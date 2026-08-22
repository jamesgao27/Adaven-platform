import { useState } from 'react';
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
import { resetPassword } from '@adaven/platform-core';
import { showToast } from '../lib/toast';
import { getProductUi } from '../product';

const isWeb = Platform.OS === 'web';

export default function ResetPasswordScreen() {
  const product = getProductUi();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleResetPassword = async () => {
    if (!email.trim()) {
      showToast('Please enter your email address', 'error');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      showToast('Please enter a valid email address', 'error');
      return;
    }

    setLoading(true);
    const { error } = await resetPassword(email.trim());
    setLoading(false);

    if (error) {
      showToast(error.message, 'error');
    } else {
      setEmailSent(true);
    }
  };

  // 发送成功后的提示与等待页
  if (emailSent) {
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
          <ScrollView contentContainerStyle={stylesWeb.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={stylesWeb.card}>
              <View style={stylesWeb.header}>
                <View style={stylesWeb.logoRow}>
                  <Image source={product.logo} style={stylesWeb.logoImg} resizeMode="contain" />
                  <Text style={stylesWeb.brandName}>{product.productName}</Text>
                </View>
                <View style={stylesWeb.successIconWrap}>
                  <Ionicons name="mail-open-outline" size={48} color="#6C5CE7" />
                </View>
                <Text style={stylesWeb.title}>Check your email</Text>
                <Text style={stylesWeb.subtitle}>
                  We've sent a password reset link to{'\n'}
                  <Text style={stylesWeb.emailHighlight}>{email.trim()}</Text>
                </Text>
                <Text style={stylesWeb.hint}>Please check your inbox and follow the link to set a new password.</Text>
              </View>
              <TouchableOpacity
                style={stylesWeb.btnWrap}
                onPress={() => router.back()}
                activeOpacity={0.9}
              >
                <LinearGradient
                  colors={['#6C5CE7', '#A29BFE']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={stylesWeb.mainBtn}
                >
                  <Text style={stylesWeb.mainBtnText}>Back to Sign In</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      );
    }
    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.content}>
            <View style={styles.header}>
              <View style={styles.iconContainer}>
                <View style={[styles.circle, styles.successCircle]}>
                  <Ionicons name="mail-open-outline" size={56} color="#6C5CE7" />
                </View>
              </View>
              <Text style={styles.title}>Check your email</Text>
              <Text style={styles.subtitle}>
                We've sent a password reset link to{'\n'}
                <Text style={styles.emailHighlight}>{email.trim()}</Text>
              </Text>
              <Text style={styles.hint}>Please check your inbox and follow the link to set a new password.</Text>
            </View>
            <TouchableOpacity style={styles.button} onPress={() => router.back()} activeOpacity={0.9}>
              <Text style={styles.buttonText}>Back to Sign In</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

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
              <Text style={stylesWeb.title}>Reset Password</Text>
              <Text style={stylesWeb.subtitle}>Enter your email and we'll send you a reset link</Text>
            </View>
            <View style={stylesWeb.form}>
              <Text style={stylesWeb.label}>Email Address</Text>
              <View style={stylesWeb.inputWrapper}>
                <Ionicons name="mail-outline" size={20} color="#636E72" style={stylesWeb.inputIcon} />
                <TextInput
                  style={stylesWeb.input}
                  placeholder="name@example.com"
                  placeholderTextColor="#95A5A6"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  editable={!loading}
                />
              </View>
              <TouchableOpacity
                style={[stylesWeb.btnWrap, loading && stylesWeb.btnDisabled]}
                onPress={handleResetPassword}
                disabled={loading}
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
                    <Text style={stylesWeb.mainBtnText}>Send Reset Link</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity style={stylesWeb.footerLink} onPress={() => router.back()} disabled={loading}>
                <Text style={stylesWeb.footerLinkP}>
                  Back to <Text style={stylesWeb.footerLinkSpan}>Sign In</Text>
                </Text>
              </TouchableOpacity>
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
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#2D3436" />
          </TouchableOpacity>

          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <View style={styles.circle}>
                <Ionicons name="lock-closed" size={60} color="#6C5CE7" />
              </View>
            </View>
            <Text style={styles.title}>Reset Password</Text>
            <Text style={styles.subtitle}>Enter your email address and we'll send you a password reset link</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={20} color="#636E72" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor="#95A5A6"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                editable={!loading}
              />
            </View>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleResetPassword}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Send Reset Link</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.linkButton} onPress={() => router.back()} disabled={loading}>
              <Text style={styles.linkText}>
                Back to <Text style={styles.linkTextBold}>Sign In</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const stylesWeb = StyleSheet.create({
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
  backBtn: { position: 'absolute', left: 24, top: 24, zIndex: 1, padding: 4 },
  header: { alignItems: 'center', marginBottom: 28 },
  logoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 20 },
  logoImg: { width: 64, height: 64 },
  brandName: { fontSize: 32, fontWeight: '800', color: '#6C5CE7', letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: '800', color: '#2D3436', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#636E72', textAlign: 'center' },
  successIconWrap: { marginBottom: 16 },
  emailHighlight: { color: '#6C5CE7', fontWeight: '600' },
  hint: { fontSize: 14, color: '#636E72', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  form: { gap: 24 },
  label: { fontSize: 14, fontWeight: '500', color: '#2D3436', marginLeft: 4 },
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
  btnWrap: { marginTop: 8, borderRadius: 16, overflow: 'hidden' },
  btnDisabled: { opacity: 0.7 },
  mainBtn: { paddingVertical: 16, alignItems: 'center', justifyContent: 'center', minHeight: 52 },
  mainBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  footerLink: { alignItems: 'center', marginTop: 20 },
  footerLinkP: { fontSize: 14, color: '#636E72' },
  footerLinkSpan: { color: '#6C5CE7', fontWeight: '600' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  scrollContent: { flexGrow: 1 },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 60, paddingBottom: 40 },
  backButton: { marginBottom: 20, width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  header: { alignItems: 'center', marginBottom: 40 },
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
  subtitle: { fontSize: 16, color: '#636E72', textAlign: 'center', paddingHorizontal: 20 },
  successCircle: {},
  emailHighlight: { color: '#6C5CE7', fontWeight: '600' },
  hint: { fontSize: 15, color: '#636E72', textAlign: 'center', marginTop: 12, paddingHorizontal: 16, lineHeight: 22 },
  form: { flex: 1, paddingBottom: 20 },
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
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16, color: '#2D3436', paddingVertical: 0, minHeight: 24 },
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
  linkButton: { alignItems: 'center' },
  linkText: { fontSize: 14, color: '#636E72' },
  linkTextBold: { color: '#6C5CE7', fontWeight: '600' },
});
