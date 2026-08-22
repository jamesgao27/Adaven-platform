import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { getCurrentUser, getUserSpaces, signOut, isAuthenticated, getPlatformClient } from '@adaven/platform-core';
import { getPendingInvitationsForUser, acceptInvitation, declineInvitation, SpaceInvitation } from '@adaven/platform-core';
import { initializeAuthCache } from '@adaven/platform-core';
import { showToast } from '../lib/toast';
import { confirmDestructive, confirmThen } from '../lib/alertWeb';
import { getProductUi } from '../product';

export default function SetupHouseholdScreen() {
  const product = getProductUi();
  const router = useRouter();
  const params = useLocalSearchParams<{ inviteId?: string }>();
  const [loading, setLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<SpaceInvitation[]>([]);
  const [selectedInvitation, setSelectedInvitation] = useState<SpaceInvitation | null>(null);
  const [spaceNames, setSpaceNames] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceAddress, setNewSpaceAddress] = useState('');
  const [spaceKind, setSpaceKind] = useState(product.defaultSpaceKind);
  const [extras, setExtras] = useState<Record<string, unknown>>({});
  const [mode, setMode] = useState<'invite' | 'create'>('invite'); // 'invite' 显示邀请，'create' 显示创建表单

  // 认证检查：未登录时重定向到登录页（若带 redirect+token 或 firmClientId 则传给 login 以便登录后回到 auth/setup）
  useEffect(() => {
    const checkAuth = async () => {
      const authed = await isAuthenticated();
      if (!authed) {
        router.replace('/login');
        return;
      }
      setIsAuthed(true);
      loadInvitations();
    };
    checkAuth();
  }, []);

  useEffect(() => {
    if (params.inviteId && pendingInvitations.length > 0) {
      const invitation = pendingInvitations.find(inv => inv.id === params.inviteId);
      if (invitation) {
        setSelectedInvitation(invitation);
        setMode('invite');
      }
    }
  }, [params.inviteId, pendingInvitations]);

  const loadInvitations = async () => {
    try {
      setLoading(true);
      const invitations = await getPendingInvitationsForUser();
      setPendingInvitations(invitations);

      // 使用邀请数据中的空间名称（已经在 getPendingInvitationsForUser 中通过 join 获取）
      const names: Record<string, string> = {};
      invitations.forEach(invitation => {
        if (invitation.spaceName) {
          names[invitation.spaceId] = invitation.spaceName;
        }
      });
      
      // 如果某些邀请没有空间名称，尝试批量查询补充
      const invitationsWithoutName = invitations.filter(inv => !inv.spaceName);
      if (invitationsWithoutName.length > 0) {
        const spaceIds = invitationsWithoutName.map(inv => inv.spaceId);
        const { data: spaces } = await getPlatformClient()
          .from('spaces')
          .select('id, name')
          .in('id', spaceIds);
        
        if (spaces) {
          spaces.forEach(space => {
            names[space.id] = space.name;
          });
        }
      }
      
      setSpaceNames(names);

      // 始终优先显示创建模式（首位展示创建新家庭）
      // 如果有邀请，可以通过按钮切换到邀请模式
      setMode('create');
    } catch (error) {
      console.error('Error loading invitations:', error);
      setMode('create');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptInvitation = async (invitation: SpaceInvitation) => {
    setAccepting(true);
    try {
      const { error } = await acceptInvitation(invitation.id);
      if (error) {
        showToast(error.message || 'Failed to join space', 'error');
        setAccepting(false);
        return;
      }
      
      // 更新缓存
      const { getCurrentUser, getCurrentSpace } = await import('@adaven/platform-core');
      const updatedUser = await getCurrentUser(true);
      const updatedSpace = updatedUser ? await getCurrentSpace(true) : null;
      await initializeAuthCache(updatedUser, updatedSpace);
      
      // 接受邀请后直接跳转，不显示 Alert（更流畅的体验）
      setAccepting(false);
      router.replace('/');
    } catch (error) {
      console.error('Error accepting invitation:', error);
      showToast('Failed to join space', 'error');
      setAccepting(false);
    }
  };

  const handleDeclineInvitation = async (invitation: SpaceInvitation) => {
    confirmDestructive(
      'Decline Invitation',
      `Are you sure you want to decline the invitation to join ${spaceNames[invitation.spaceId] || 'this space'}?`,
      async () => {
        try {
          const { error } = await declineInvitation(invitation.id);
          if (error) {
            showToast(error.message || 'Failed to decline invitation', 'error');
            return;
          }

          const remainingInvitations = pendingInvitations.filter(inv => inv.id !== invitation.id);
          setPendingInvitations(remainingInvitations);

          if (selectedInvitation?.id === invitation.id) {
            setSelectedInvitation(null);
          }

          const spaces = await getUserSpaces();

          if (spaces.length === 0) {
            if (remainingInvitations.length === 0) {
              setMode('create');
            } else {
              confirmThen(
                'Create Your Own Space',
                'You declined the invitation. Would you like to create your own space?',
                () => setMode('create'),
                { confirmText: 'Create', cancelText: 'Later' }
              );
            }
          } else {
            const updatedUser = await getCurrentUser(true);
            const { getCurrentSpace } = await import('@adaven/platform-core');
            const updatedSpace = updatedUser ? await getCurrentSpace(true) : null;
            await initializeAuthCache(updatedUser, updatedSpace);
            router.replace('/');
          }
        } catch (error) {
          console.error('Error declining invitation:', error);
          showToast('Failed to decline invitation', 'error');
        }
      },
      { confirmLabel: 'Decline' }
    );
  };

  const handleCreateSpace = async () => {
    if (!newSpaceName.trim()) {
      showToast('Please enter space name', 'error');
      return;
    }
    if (product.canSubmitSetup && !product.canSubmitSetup(spaceKind, extras)) {
      showToast('Please complete the required space details', 'error');
      return;
    }
    setCreating(true);
    try {
      const { error } = await product.createSpace({
        name: newSpaceName.trim(),
        address: newSpaceAddress.trim(),
        kind: spaceKind,
        extras,
      });

      if (error) {
        // 如果是需要邮箱确认的错误，显示友好提示
        if (error.message?.includes('confirm your email') || error.message?.includes('email confirmation')) {
          confirmThen(
            'Email Confirmation Required',
            'Please confirm your email address first, then try creating a space again. Check your email inbox for the confirmation link.',
            () => router.replace('/login'),
            { confirmText: 'OK', cancelText: 'Cancel' }
          );
        } else {
          showToast(error.message || 'Failed to create space', 'error');
        }
        setCreating(false);
        return;
      }

      const { getCurrentUser, getCurrentSpace } = await import('@adaven/platform-core');
      const updatedUser = await getCurrentUser(true);
      const created = updatedUser ? await getCurrentSpace(true) : null;
      await initializeAuthCache(updatedUser, created);
      setCreating(false);
      router.replace(product.homePath || '/');
    } catch (error) {
      console.error('Error creating space:', error);
      showToast('Failed to create space', 'error');
      setCreating(false);
    }
  };

  const handleSignOut = async () => {
    const doSignOut = async () => {
      try {
        const { error } = await signOut();
        if (error) {
          showToast(error.message || 'Failed to sign out', 'error');
          return;
        }
        router.replace('/login');
      } catch (error) {
        console.error('Error signing out:', error);
        showToast('Failed to sign out', 'error');
      }
    };
    confirmDestructive('Sign Out', 'Are you sure you want to sign out?', doSignOut, { confirmLabel: 'Sign Out' });
  };

  // 未认证时不渲染（等待重定向）
  if (isAuthed === null || isAuthed === false) {
    return null;
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6C5CE7" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  const isWeb = Platform.OS === 'web';

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
              <View style={stylesWeb.iconContainer}>
                <View style={stylesWeb.circle}>
                  <Ionicons name="home" size={48} color="#6C5CE7" />
                </View>
              </View>
              <Text style={stylesWeb.title}>Setup Space</Text>
              <Text style={stylesWeb.subtitle}>Create your space to get started</Text>
            </View>

            {mode === 'create' && (
              <View style={stylesWeb.form}>
                <Text style={stylesWeb.sectionLabel}>Space type</Text>
                <View style={stylesWeb.spaceKindRow}>
                  {product.spaceKinds.map((opt) => (
                    <TouchableOpacity
                      key={opt.id}
                      style={[stylesWeb.spaceKindOption, spaceKind === opt.id && stylesWeb.spaceKindOptionSelected]}
                      onPress={() => setSpaceKind(opt.id)}
                    >
                      <Ionicons
                        name={spaceKind === opt.id ? 'radio-button-on' : 'radio-button-off'}
                        size={22}
                        color={spaceKind === opt.id ? '#6C5CE7' : '#BDC3C7'}
                      />
                      <Text style={[stylesWeb.spaceKindText, spaceKind === opt.id && stylesWeb.spaceKindTextSelected]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {product.renderSetupExtras?.({ kind: spaceKind, extras, setExtras })}



                <Text style={stylesWeb.label}>Space Name *</Text>
                <View style={stylesWeb.inputWrapper}>
                  <Ionicons name="home-outline" size={20} color="#636E72" style={stylesWeb.inputIcon} />
                  <TextInput
                    style={stylesWeb.input}
                    placeholder="Space Name"
                    placeholderTextColor="#95A5A6"
                    value={newSpaceName}
                    onChangeText={setNewSpaceName}
                    editable={!creating}
                  />
                </View>

                <Text style={stylesWeb.label}>Address (Optional)</Text>
                <View style={[stylesWeb.inputWrapper, stylesWeb.addressInputWrapper]}>
                  <Ionicons name="location-outline" size={20} color="#636E72" style={stylesWeb.inputIcon} />
                  <TextInput
                    style={[stylesWeb.input, stylesWeb.addressInput]}
                    placeholder="Address"
                    placeholderTextColor="#95A5A6"
                    value={newSpaceAddress}
                    onChangeText={setNewSpaceAddress}
                    multiline
                    textAlignVertical="top"
                    editable={!creating}
                  />
                </View>

                <TouchableOpacity
                  style={[stylesWeb.btnWrap, creating && stylesWeb.btnDisabled]}
                  onPress={handleCreateSpace}
                  disabled={creating || !newSpaceName.trim() || product.canSubmitSetup?.(spaceKind, extras) === false}
                  activeOpacity={0.9}
                >
                  <LinearGradient
                    colors={['#6C5CE7', '#A29BFE']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={stylesWeb.mainBtn}
                  >
                    {creating ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={stylesWeb.mainBtnText}>Create Space</Text>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            )}

            {pendingInvitations.length > 0 && (
              <TouchableOpacity
                style={stylesWeb.invitationsButton}
                onPress={() => router.push('/handle-invitations')}
                activeOpacity={0.7}
              >
                <Ionicons name="mail-outline" size={20} color="#6C5CE7" />
                <Text style={stylesWeb.invitationsButtonText}>Invitations ({pendingInvitations.length})</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={stylesWeb.signOutButton} onPress={handleSignOut} activeOpacity={0.7}>
              <Ionicons name="log-out-outline" size={20} color="#E74C3C" />
              <Text style={stylesWeb.signOutButtonText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
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
          <View style={styles.iconContainer}>
            <View style={styles.circle}>
              <Ionicons name="home" size={60} color="#6C5CE7" />
            </View>
          </View>
          <Text style={styles.title}>Setup Space</Text>
          <Text style={styles.subtitle}>Create your space to get started</Text>
        </View>

        {/* 创建模式 - 首位展示 */}
        {mode === 'create' && (
          <View style={styles.createSection}>
            <Text style={styles.sectionLabel}>Space type</Text>
            <View style={styles.spaceKindRow}>
              {product.spaceKinds.map((opt) => (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.spaceKindOption, spaceKind === opt.id && styles.spaceKindOptionSelected]}
                  onPress={() => setSpaceKind(opt.id)}
                >
                  <Ionicons
                    name={spaceKind === opt.id ? 'radio-button-on' : 'radio-button-off'}
                    size={22}
                    color={spaceKind === opt.id ? '#6C5CE7' : '#BDC3C7'}
                  />
                  <Text style={[styles.spaceKindText, spaceKind === opt.id && styles.spaceKindTextSelected]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {product.renderSetupExtras?.({ kind: spaceKind, extras, setExtras })}



            <View style={styles.inputContainer}>
              <Ionicons name="home-outline" size={20} color="#636E72" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Space Name *"
                placeholderTextColor="#95A5A6"
                value={newSpaceName}
                onChangeText={setNewSpaceName}
              />
            </View>

            <View style={[styles.inputContainer, styles.addressInputContainer]}>
              <Ionicons name="location-outline" size={20} color="#636E72" style={styles.addressInputIcon} />
              <TextInput
                style={[styles.input, styles.addressInput]}
                placeholder="Address (Optional)"
                placeholderTextColor="#95A5A6"
                value={newSpaceAddress}
                onChangeText={setNewSpaceAddress}
                multiline
                textAlignVertical="top"
              />
            </View>

            <TouchableOpacity
              style={[styles.createButton, creating && styles.buttonDisabled]}
              onPress={handleCreateSpace}
              disabled={creating || !newSpaceName.trim() || product.canSubmitSetup?.(spaceKind, extras) === false}
            >
              {creating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.createButtonText}>Create Space</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Invitations Button - 如果有pending邀请 */}
        {pendingInvitations.length > 0 && (
          <TouchableOpacity
            style={styles.invitationsButton}
            onPress={() => router.push('/handle-invitations')}
            activeOpacity={0.7}
          >
            <Ionicons name="mail-outline" size={20} color="#6C5CE7" />
            <Text style={styles.invitationsButtonText}>
              Invitations ({pendingInvitations.length})
            </Text>
          </TouchableOpacity>
        )}

        {/* Sign Out Button - 底部 */}
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          activeOpacity={0.7}
        >
          <Ionicons name="log-out-outline" size={20} color="#E74C3C" />
          <Text style={styles.signOutButtonText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
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
  logoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 16 },
  logoImg: { width: 48, height: 48 },
  brandName: { fontSize: 24, fontWeight: '800', color: '#6C5CE7', letterSpacing: -0.5 },
  iconContainer: { marginBottom: 12 },
  circle: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#E9ECEF', justifyContent: 'center', alignItems: 'center', alignSelf: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: '#2D3436', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#636E72', textAlign: 'center' },
  form: { gap: 16 },
  sectionLabel: { fontSize: 14, fontWeight: '600', color: '#2D3436', marginLeft: 4 },
  spaceKindRow: { flexDirection: 'row', gap: 12 },
  spaceKindOption: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: '#E9ECEF', backgroundColor: '#F8F9FA' },
  spaceKindOptionSelected: { borderColor: '#6C5CE7', backgroundColor: 'rgba(108, 92, 231, 0.06)' },
  spaceKindText: { fontSize: 15, color: '#636E72' },
  spaceKindTextSelected: { color: '#6C5CE7', fontWeight: '600' },
  verificationSection: { marginTop: 4 },
  clientProfileSection: { marginTop: 4, gap: 8 },
  verificationLabel: { fontSize: 13, fontWeight: '600', color: '#636E72', marginBottom: 4 },
  verificationHint: { fontSize: 12, color: '#95A5A6', marginBottom: 8 },
  verificationButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1, borderColor: '#E9ECEF', backgroundColor: '#F8F9FA', borderStyle: 'dashed' },
  verificationButtonText: { fontSize: 15, color: '#6C5CE7', fontWeight: '500' },
  label: { fontSize: 14, fontWeight: '500', color: '#2D3436', marginLeft: 4 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F9FA', borderWidth: 1, borderColor: '#E9ECEF', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, minHeight: 52 },
  addressInputWrapper: { alignItems: 'flex-start' },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16, color: '#2D3436', paddingVertical: 0, minHeight: 24, includeFontPadding: false, textAlignVertical: 'center', backgroundColor: 'transparent', outlineStyle: 'none' },
  addressInput: { minHeight: 60, textAlignVertical: 'top' },
  btnWrap: { marginTop: 8, borderRadius: 16, overflow: 'hidden' },
  btnDisabled: { opacity: 0.7 },
  mainBtn: { paddingVertical: 16, alignItems: 'center', justifyContent: 'center', minHeight: 52 },
  mainBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  invitationsButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20, paddingVertical: 14, borderRadius: 16, backgroundColor: '#F0F4FF' },
  invitationsButtonText: { fontSize: 16, fontWeight: '600', color: '#6C5CE7' },
  signOutButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, paddingVertical: 14, borderRadius: 16, backgroundColor: '#FFF5F5' },
  signOutButtonText: { fontSize: 16, fontWeight: '600', color: '#E74C3C' },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#636E72',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconContainer: {
    marginBottom: 24,
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
  invitationsSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 16,
  },
  invitationCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  invitationHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  invitationInfo: {
    flex: 1,
    marginLeft: 12,
  },
  invitationHouseholdName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 4,
  },
  invitationText: {
    fontSize: 14,
    color: '#636E72',
  },
  invitationButtons: {
    flexDirection: 'column',
    width: '100%',
  },
  invitationButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginBottom: 12,
  },
  declineButton: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  declineButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#636E72',
  },
  acceptButton: {
    backgroundColor: '#6C5CE7',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  acceptButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  laterButton: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    marginBottom: 0, // 最后一个按钮不需要底部间距
  },
  laterButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#636E72',
  },
  createSection: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 10,
  },
  spaceKindRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  spaceKindOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    backgroundColor: '#FFF',
  },
  spaceKindOptionSelected: {
    borderColor: '#6C5CE7',
    backgroundColor: 'rgba(108, 92, 231, 0.06)',
  },
  spaceKindText: {
    fontSize: 15,
    color: '#636E72',
  },
  spaceKindTextSelected: {
    color: '#6C5CE7',
    fontWeight: '600',
  },
  verificationSection: {
    marginBottom: 16,
  },
  clientProfileSection: {
    marginBottom: 16,
    gap: 8,
  },
  verificationLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#636E72',
    marginBottom: 4,
  },
  verificationHint: {
    fontSize: 12,
    color: '#95A5A6',
    marginBottom: 8,
  },
  verificationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    backgroundColor: '#FFF',
    borderStyle: 'dashed',
  },
  verificationButtonText: {
    fontSize: 15,
    color: '#6C5CE7',
    fontWeight: '500',
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
  },
  addressInputContainer: {
    alignItems: 'flex-start',
  },
  inputIcon: {
    marginRight: 12,
  },
  addressInputIcon: {
    marginRight: 12,
    marginTop: 2, // 与第一行文字对齐
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#2D3436',
    paddingVertical: 0,
    minHeight: 24,
  },
  addressInput: {
    minHeight: 24,
    maxHeight: 120, // 限制最大高度，避免占用太多空间
    paddingTop: 0,
    textAlignVertical: 'top',
  },
  createButton: {
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
  createButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  invitationsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F4FF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 8,
    marginTop: 24,
    marginBottom: 12,
  },
  invitationsButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6C5CE7',
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF5F5',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 8,
    marginTop: 24,
    marginBottom: 20,
  },
  signOutButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#E74C3C',
  },
});

