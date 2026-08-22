import { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Modal,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { getCurrentSpace, getCurrentUser, getUserSpaces, setCurrentSpace, signOut, initializeAuthCache, updateCachedUser, updateCachedSpace, getPlatformClient, type PlatformSpace, type PlatformUserSpace, type PlatformUser } from '@adaven/platform-core';
import { showToast } from '../lib/toast';
import { confirmDestructive } from '../lib/alertWeb';
import { getProductUi, getManagementMenu } from '../product';
import { SpaceSwitcherModal } from '../SpaceSwitcherModal';
import { useWebViewportKind } from '../lib/web-viewport';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';

export default function ManagementScreen() {
  const product = getProductUi();
  const MAX_LOGO_FILE_SIZE = 500 * 1024;
  const router = useRouter();
  const { isDesktopWeb } = useWebViewportKind();
  const [space, setSpace] = useState<PlatformSpace | null>(null);
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [spaceName, setSpaceName] = useState('');
  const [spaceAddress, setSpaceAddress] = useState('');
  const [spaceImageUri, setSpaceImageUri] = useState<string | null>(null);
  const [spaceImageClear, setSpaceImageClear] = useState(false);
  const [saving, setSaving] = useState(false);
  const [canEditSpaceInfo, setCanEditSpaceInfo] = useState(false);
  const [editingPersonal, setEditingPersonal] = useState(false);
  const [personalName, setPersonalName] = useState('');
  const [userLogoUri, setUserLogoUri] = useState<string | null>(null);
  const [userLogoClear, setUserLogoClear] = useState(false);
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [showSpaceSwitch, setShowSpaceSwitch] = useState(false);
  const [spaces, setSpaces] = useState<PlatformUserSpace[]>([]);
  const [switching, setSwitching] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRefreshAfterSwitchModal, setShowRefreshAfterSwitchModal] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceAddress, setNewSpaceAddress] = useState('');
  const [creating, setCreating] = useState(false);

  const effectiveSpaceImageUri = spaceImageClear ? null : (spaceImageUri ?? space?.logoUrl ?? null);
  const effectiveUserLogoUri = userLogoClear ? null : (userLogoUri ?? user?.logoUrl ?? null);

  const getPickedAssetSize = async (asset: ImagePicker.ImagePickerAsset): Promise<number | null> => {
    if (typeof asset.fileSize === 'number' && Number.isFinite(asset.fileSize)) {
      return asset.fileSize;
    }
    try {
      if (Platform.OS !== 'web' && asset.uri.startsWith('file://')) {
        const info = await FileSystem.getInfoAsync(asset.uri, { size: true } as any);
        if (info.exists && typeof (info as any).size === 'number') {
          return (info as any).size;
        }
      }
    } catch (_) {}

    try {
      const res = await fetch(asset.uri);
      if (!res.ok) return null;
      const blob = await res.blob();
      return blob.size;
    } catch (_) {
      return null;
    }
  };

  const validateLogoFileSize = async (asset: ImagePicker.ImagePickerAsset): Promise<boolean> => {
    const size = await getPickedAssetSize(asset);
    if (size !== null && size > MAX_LOGO_FILE_SIZE) {
      showToast('Image must be 500KB or smaller', 'error');
      return false;
    }
    return true;
  };

  const getUriFileSize = async (uri: string): Promise<number | null> => {
    try {
      if (Platform.OS !== 'web' && uri.startsWith('file://')) {
        const info = await FileSystem.getInfoAsync(uri, { size: true } as any);
        if (info.exists && typeof (info as any).size === 'number') return (info as any).size;
      }
      const res = await fetch(uri);
      if (!res.ok) return null;
      const blob = await res.blob();
      return blob.size;
    } catch (_) {
      return null;
    }
  };

  const compressImageForLogoIfNeeded = async (
    uri: string,
    originWidth?: number,
    originHeight?: number
  ): Promise<string | null> => {
    let currentUri = uri;
    // Web 端补齐裁切：按中心裁成正方形；移动端已有系统裁切，此处不重复裁切
    if (Platform.OS === 'web' && originWidth && originHeight && originWidth > 0 && originHeight > 0) {
      const cropSize = Math.min(originWidth, originHeight);
      const cropX = Math.max(0, Math.floor((originWidth - cropSize) / 2));
      const cropY = Math.max(0, Math.floor((originHeight - cropSize) / 2));
      const cropped = await ImageManipulator.manipulateAsync(
        currentUri,
        [{ crop: { originX: cropX, originY: cropY, width: cropSize, height: cropSize } }],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      );
      currentUri = cropped.uri;
    }

    let currentSize = await getUriFileSize(currentUri);
    if (currentSize !== null && currentSize <= MAX_LOGO_FILE_SIZE) return currentUri;

    // 逐步降低质量并缩放，尽量压到 500KB 以下
    let width = 1280;
    let height = 1280;
    const qualitySteps = [0.82, 0.72, 0.62, 0.52, 0.42];

    for (let i = 0; i < qualitySteps.length; i++) {
      const manipulated = await ImageManipulator.manipulateAsync(
        currentUri,
        [{ resize: { width, height } }],
        { compress: qualitySteps[i], format: ImageManipulator.SaveFormat.JPEG }
      );
      currentUri = manipulated.uri;
      currentSize = await getUriFileSize(currentUri);
      if (currentSize !== null && currentSize <= MAX_LOGO_FILE_SIZE) return currentUri;

      width = Math.max(480, Math.round(width * 0.85));
      height = Math.max(480, Math.round(height * 0.85));
    }

    return null;
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!canEditSpaceInfo && editing) {
      setEditing(false);
    }
  }, [canEditSpaceInfo, editing]);

  const loadData = async () => {
    try {
      setLoading(true);
      // 使用缓存，不需要强制刷新（除非数据被修改了）
      const spaceData = await getCurrentSpace();
      if (spaceData) {
        setSpace(spaceData);
        setSpaceName(spaceData.name);
        setSpaceAddress(spaceData.address || '');
      }
      const userData = await getCurrentUser();
      setUser(userData);
      setPersonalName(userData?.name || '');

      // 仅当前空间管理员可编辑 Space Information
      if (spaceData?.id && userData?.id) {
        const { data: memberRow } = await getPlatformClient()
          .from('user_spaces')
          .select('is_admin')
          .eq('space_id', spaceData.id)
          .eq('user_id', userData.id)
          .maybeSingle();
        setCanEditSpaceInfo(memberRow?.is_admin === true);
      } else {
        setCanEditSpaceInfo(false);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      showToast('Failed to load space information', 'error');
    } finally {
      setLoading(false);
    }
  };

  // 只加载空间信息
  const loadSpaceOnly = async () => {
    try {
      const spaceData = await getCurrentSpace();
      if (spaceData) {
        setSpace(spaceData);
        setSpaceName(spaceData.name);
        setSpaceAddress(spaceData.address || '');
      }
      const userData = await getCurrentUser();
      if (spaceData?.id && userData?.id) {
        const { data: memberRow } = await getPlatformClient()
          .from('user_spaces')
          .select('is_admin')
          .eq('space_id', spaceData.id)
          .eq('user_id', userData.id)
          .maybeSingle();
        setCanEditSpaceInfo(memberRow?.is_admin === true);
      } else {
        setCanEditSpaceInfo(false);
      }
    } catch (error) {
      console.error('Error loading space:', error);
      // 失败时重新加载所有数据以确保一致性
      loadData();
    }
  };

  // 只加载用户信息
  const loadUserOnly = async () => {
    try {
      const userData = await getCurrentUser();
      setUser(userData);
      setPersonalName(userData?.name || '');
    } catch (error) {
      console.error('Error loading user:', error);
      // 失败时重新加载所有数据以确保一致性
      loadData();
    }
  };

  // 当页面获得焦点时不再重新加载数据（数据已在登录时缓存）
  // useFocusEffect 已移除，避免重复从数据库读取

  const loadSpaces = async () => {
    try {
      const data = await getUserSpaces();
      setSpaces(data);
    } catch (error) {
      console.error('Error loading spaces:', error);
      showToast('Failed to load spaces', 'error');
    }
  };

  const handleSave = async () => {
    if (!space || !spaceName.trim()) {
      showToast('Space name cannot be empty', 'error');
      return;
    }

    try {
      setSaving(true);
      const user = await getCurrentUser();
      if (!user) throw new Error('Not logged in');

      // 以页面当前正在编辑的 space.id 为准，避免缓存/当前空间不一致导致写到错误记录
      const spaceId = space.id;
      if (!spaceId) throw new Error('No space selected');

      let logoUrlUpdate: string | null | undefined;
      if (spaceImageClear) {
        logoUrlUpdate = null;
      } else if (spaceImageUri) {
        if (!product.uploadSpaceImage) {
          showToast('Logo upload is not available', 'error');
          setSaving(false);
          return;
        }
        logoUrlUpdate = await product.uploadSpaceImage(spaceImageUri, spaceId);
      }

      const { error } = await getPlatformClient()
        .from('spaces')
        .update({
          name: spaceName.trim(),
          address: spaceAddress.trim() || null,
          ...(logoUrlUpdate !== undefined ? { logo_url: logoUrlUpdate } : {}),
        })
        .eq('id', spaceId);

      if (error) throw error;

      // 读回 DB：避免 RLS/触发器导致 logo_url 没有真正落库
      let dbLogoUrl: string | null | undefined = undefined;
      if (logoUrlUpdate !== undefined) {
        const { data: refreshedRow, error: refreshedError } = await getPlatformClient()
          .from('spaces')
          .select('logo_url')
          .eq('id', spaceId)
          .maybeSingle();

        if (refreshedError) throw refreshedError;
        dbLogoUrl = refreshedRow?.logo_url ?? null;

        const expected = logoUrlUpdate ?? null;
        if (dbLogoUrl !== expected) {
          showToast('Space logo did not persist. Please check DB update permissions.', 'error');
        }
      }

      // 更新状态（以 DB 为准）
      const updatedSpace = space ? {
        ...space,
        name: spaceName.trim(),
        address: spaceAddress.trim() || undefined,
        logoUrl: logoUrlUpdate !== undefined ? dbLogoUrl ?? null : space.logoUrl,
      } : null;
      setSpace(updatedSpace);
      // 更新缓存
      if (updatedSpace) {
        updateCachedSpace(updatedSpace);
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('adaven_space_updated'));
        }
      }
      setSpaceImageUri(null);
      setSpaceImageClear(false);
      setEditing(false);
    } catch (error) {
      console.error('Error updating space:', error);
      showToast('Failed to update space information', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (space) {
      setSpaceName(space.name);
      setSpaceAddress(space.address || '');
    }
    setSpaceImageUri(null);
    setSpaceImageClear(false);
    setEditing(false);
  };

  const pickSpaceImage = async () => {
    if (!product.uploadSpaceImage) return;
    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          showToast('Image permission required', 'error');
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        const asset = result.assets[0];
        const compressedUri = await compressImageForLogoIfNeeded(asset.uri, asset.width, asset.height);
        if (!compressedUri) {
          showToast('Unable to compress image below 500KB. Please choose another one.', 'error');
          return;
        }
        let finalUri = compressedUri;

        // 兜底：如果压缩函数未拿到大小，仍使用原校验提示
        if (Platform.OS === 'web') {
          const finalSize = await getUriFileSize(finalUri);
          if (finalSize === null) {
            const valid = await validateLogoFileSize(asset);
            if (!valid) return;
          }
        }
        setSpaceImageClear(false);
        setSpaceImageUri(finalUri);
      }
    } catch (e) {
      console.error('pickSpaceImage error:', e);
      showToast('Failed to select image', 'error');
    }
  };

  const pickUserLogo = async () => {
    if (!product.uploadUserLogo) return;
    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          showToast('Image permission required', 'error');
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        const asset = result.assets[0];
        const compressedUri = await compressImageForLogoIfNeeded(asset.uri, asset.width, asset.height);
        if (!compressedUri) {
          showToast('Unable to compress image below 500KB. Please choose another one.', 'error');
          return;
        }
        let finalUri = compressedUri;

        if (Platform.OS === 'web') {
          const finalSize = await getUriFileSize(finalUri);
          if (finalSize === null) {
            const valid = await validateLogoFileSize(asset);
            if (!valid) return;
          }
        }
        setUserLogoClear(false);
        setUserLogoUri(finalUri);
      }
    } catch (e) {
      console.error('pickUserLogo error:', e);
      showToast('Failed to select image', 'error');
    }
  };

  const handleSavePersonal = async () => {
    if (!user) return;

    try {
      setSavingPersonal(true);

      let logoUrlUpdate: string | null | undefined = undefined;
      if (userLogoClear) {
        logoUrlUpdate = null;
      } else if (userLogoUri) {
        if (!product.uploadUserLogo) {
          showToast('Logo upload is not available', 'error');
          setSavingPersonal(false);
          return;
        }
        logoUrlUpdate = await product.uploadUserLogo(userLogoUri, user.id);
      }

      // 优先使用 RPC 函数绕过 RLS 限制
      let error: any = null;
      try {
        const { error: rpcError } = await getPlatformClient()
          .rpc('update_user_name', {
            p_user_id: user.id,
            p_name: personalName.trim() || null
          });
        
        if (rpcError) {
          // 如果 RPC 函数不存在或失败，回退到直接更新
          console.log('RPC function failed, falling back to direct update:', rpcError);
          const { error: directError } = await getPlatformClient()
            .from('users')
            .update({
              name: personalName.trim() || null,
              ...(logoUrlUpdate !== undefined ? { logo_url: logoUrlUpdate } : {}),
            })
            .eq('id', user.id);
          error = directError;
        } else if (logoUrlUpdate !== undefined) {
          const { error: logoError } = await getPlatformClient()
            .from('users')
            .update({ logo_url: logoUrlUpdate })
            .eq('id', user.id);
          error = logoError;
        }
      } catch (rpcErr) {
        // RPC 函数可能不存在，回退到直接更新
        console.log('RPC function not available, using direct update:', rpcErr);
        const { error: directError } = await getPlatformClient()
          .from('users')
          .update({
            name: personalName.trim() || null,
            ...(logoUrlUpdate !== undefined ? { logo_url: logoUrlUpdate } : {}),
          })
          .eq('id', user.id);
        error = directError;
      }

      if (error) throw error;

      // 读回 DB：避免 logo_url 没有真正落库（RLS/触发器）
      let dbLogoUrl: string | null | undefined = undefined;
      if (logoUrlUpdate !== undefined) {
        const { data: refreshedRow, error: refreshedError } = await getPlatformClient()
          .from('users')
          .select('logo_url')
          .eq('id', user.id)
          .maybeSingle();

        if (refreshedError) throw refreshedError;
        dbLogoUrl = refreshedRow?.logo_url ?? null;

        const expected = logoUrlUpdate ?? null;
        if (dbLogoUrl !== expected) {
          showToast('User avatar did not persist. Please check DB update permissions.', 'error');
        }
      }

      // 更新状态（以 DB 为准）
      const updatedUser = user ? {
        ...user,
        name: personalName.trim() || undefined,
        logoUrl: logoUrlUpdate !== undefined ? dbLogoUrl ?? null : user.logoUrl,
      } : null;
      setUser(updatedUser);
      // 更新缓存
      if (updatedUser) {
        updateCachedUser(updatedUser);
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('adaven_user_updated'));
        }
      }
      setUserLogoUri(null);
      setUserLogoClear(false);
      setEditingPersonal(false);
    } catch (error) {
      console.error('Error updating user:', error);
      showToast('Failed to update personal information', 'error');
    } finally {
      setSavingPersonal(false);
    }
  };

  const handleCancelPersonal = () => {
    setEditingPersonal(false);
    if (user) {
      setPersonalName(user.name || '');
    }
    setUserLogoUri(null);
    setUserLogoClear(false);
  };

  const handleSwitchSpace = async (spaceId: string) => {
    try {
      setSwitching(true);
      const { error } = await setCurrentSpace(spaceId);
      if (error) {
        showToast(error.message, 'error');
        setSwitching(false);
        return;
      }

      // 更新缓存
      const updatedUser = await getCurrentUser(true);
      const updatedSpace = updatedUser ? await getCurrentSpace(true) : null;
      await initializeAuthCache(updatedUser, updatedSpace);

      setShowSpaceSwitch(false);

      if (updatedSpace) {
        setSpace(updatedSpace);
        setSpaceName(updatedSpace.name);
        setSpaceAddress(updatedSpace.address || '');
      }
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('adaven_space_updated'));
      }
      await loadData();

      if (Platform.OS === 'web' && isDesktopWeb) {
        setShowRefreshAfterSwitchModal(true);
        return;
      }
    } catch (error) {
      console.error('Error switching space:', error);
      showToast('Failed to switch space', 'error');
    } finally {
      setSwitching(false);
    }
  };

  const openSpaceSwitch = async () => {
    await loadSpaces();
    setShowSpaceSwitch(true);
  };

  const handleCreateSpace = async () => {
    if (!newSpaceName.trim()) {
      showToast('Please enter space name', 'error');
      return;
    }

    try {
      setCreating(true);
      const { error } = await product.createSpace({
        name: newSpaceName.trim(),
        address: newSpaceAddress.trim(),
        kind: product.defaultSpaceKind,
        extras: {},
      });

      if (error) {
        showToast(error.message || 'Failed to create space', 'error');
        setCreating(false);
        return;
      }

      setShowCreateModal(false);
      setNewSpaceName('');
      setNewSpaceAddress('');
      await loadSpaces();
      await loadData();
      setShowSpaceSwitch(false);
      showToast('Space created successfully', 'success');
    } catch (error) {
      console.error('Error creating space:', error);
      showToast('Failed to create space', 'error');
    } finally {
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

  const visibleMenuItems = getManagementMenu(space);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Personal Information Section */}
        <Text style={styles.sectionTag}>Personal Information</Text>
        <View style={[styles.spaceInfoCard, styles.personalInfoCard, { marginBottom: 10 }]}>
          <View style={styles.cardHeader}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => {
                if (editingPersonal) {
                  pickUserLogo();
                  return;
                }
                setEditingPersonal(true);
              }}
            >
              <View style={styles.logoInteractiveWrap}>
                {effectiveUserLogoUri ? (
                  <Image
                    source={{ uri: effectiveUserLogoUri }}
                    style={styles.userLogoHeaderImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.logoPlaceholderWrap}>
                    <View style={styles.logoPlaceholderSquare}>
                      <Ionicons name="person-outline" size={24} color="#6C5CE7" />
                    </View>
                  </View>
                )}
                {editingPersonal && (
                  <View pointerEvents="none" style={styles.logoEditOverlay} />
                )}
                {editingPersonal && (
                  <View pointerEvents="none" style={styles.logoReplaceIconButton}>
                    <Ionicons name="cloud-upload-outline" size={12} color="#fff" />
                  </View>
                )}
                {editingPersonal && (effectiveUserLogoUri || user?.logoUrl || userLogoUri) && (
                  <TouchableOpacity
                    style={styles.logoRemoveIconButton}
                    onPress={(e: any) => {
                      e?.stopPropagation?.();
                      setUserLogoUri(null);
                      setUserLogoClear(true);
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="close" size={12} color="#fff" />
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
            {editingPersonal ? (
              <View style={styles.editContainer}>
                <TextInput
                  style={styles.input}
                  value={personalName}
                  onChangeText={setPersonalName}
                  placeholder="Enter your name"
                  placeholderTextColor="#95A5A6"
                  autoFocus
                />
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.button, styles.cancelButton]}
                    onPress={handleCancelPersonal}
                    disabled={savingPersonal}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.button, styles.saveButton]}
                    onPress={handleSavePersonal}
                    disabled={savingPersonal}
                  >
                    {savingPersonal ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.saveButtonText}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.viewContainer}>
                <View style={styles.viewContent}>
                  <View style={styles.nameRow}>
                    {loading && !user ? (
                      <>
                        <View style={styles.loadingPlaceholder}>
                          <ActivityIndicator size="small" color="#95A5A6" />
                          <Text style={styles.placeholderText}>Loading...</Text>
                        </View>
                        <View style={styles.nameRowEditSlot} />
                      </>
                    ) : (
                      <>
                        <Text style={styles.spaceName}>{user?.name || user?.email || 'N/A'}</Text>
                        <View style={styles.nameRowEditSlot}>
                          <TouchableOpacity
                            style={styles.editButton}
                            onPress={() => {
                              setUserLogoUri(null);
                              setUserLogoClear(false);
                              setEditingPersonal(true);
                            }}
                          >
                            <Ionicons name="create-outline" size={18} color="#6C5CE7" />
                          </TouchableOpacity>
                        </View>
                      </>
                    )}
                  </View>
                  {loading && !user ? (
                    <View style={styles.addressRow}>
                      <View style={{ width: 14, height: 14, marginTop: 2 }} />
                      <Text style={styles.spaceAddressPlaceholder}>Loading...</Text>
                    </View>
                  ) : (
                    user?.email ? (
                      <View style={styles.addressRow}>
                        <Ionicons name="mail-outline" size={14} color="#636E72" style={styles.addressIcon} />
                        <Text style={styles.spaceAddress}>{user.email}</Text>
                      </View>
                    ) : (
                      <Text style={styles.spaceAddressPlaceholder}>No email set</Text>
                    )
                  )}
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Space Information Section */}
        <Text style={styles.sectionTag}>Space Information</Text>
        <View style={styles.spaceInfoCard}>
          <View style={styles.cardHeader}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => {
                if (!canEditSpaceInfo) return;
                if (editing) {
                  pickSpaceImage();
                  return;
                }
                setEditing(true);
              }}
            >
              <View style={styles.logoInteractiveWrap}>
                {effectiveSpaceImageUri ? (
                  <Image
                    source={{ uri: effectiveSpaceImageUri }}
                    style={styles.spaceIconImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.logoPlaceholderWrap}>
                    <View style={styles.logoPlaceholderSquare}>
                      <Ionicons name="business-outline" size={24} color="#6C5CE7" />
                    </View>
                  </View>
                )}
                {editing && (
                  <View pointerEvents="none" style={styles.logoEditOverlay} />
                )}
                {editing && (
                  <View pointerEvents="none" style={styles.logoReplaceIconButton}>
                    <Ionicons name="cloud-upload-outline" size={12} color="#fff" />
                  </View>
                )}
                {editing && (effectiveSpaceImageUri || space?.logoUrl || spaceImageUri) && (
                  <TouchableOpacity
                    style={styles.logoRemoveIconButton}
                    onPress={(e: any) => {
                      e?.stopPropagation?.();
                      setSpaceImageUri(null);
                      setSpaceImageClear(true);
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="close" size={12} color="#fff" />
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
            {editing ? (
              <View style={styles.editContainer}>
                <TextInput
                  style={styles.input}
                  value={spaceName}
                  onChangeText={setSpaceName}
                  placeholder="Enter space name"
                  placeholderTextColor="#95A5A6"
                  autoFocus
                />
                <TextInput
                  style={[styles.input, styles.multilineInput]}
                  value={spaceAddress}
                  onChangeText={setSpaceAddress}
                  placeholder="Add notes about your team or company for easier identification"
                  placeholderTextColor="#95A5A6"
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.button, styles.cancelButton]}
                    onPress={handleCancel}
                    disabled={saving}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.button, styles.saveButton]}
                    onPress={handleSave}
                    disabled={saving || !spaceName.trim()}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.saveButtonText}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.viewContainer}>
                <View style={styles.viewContent}>
                  <View style={styles.nameRow}>
                    {loading && !space ? (
                      <>
                        <View style={styles.loadingPlaceholder}>
                          <ActivityIndicator size="small" color="#95A5A6" />
                          <Text style={styles.placeholderText}>Loading...</Text>
                        </View>
                        <View style={styles.nameRowEditSlot} />
                      </>
                    ) : (
                      <>
                        <Text style={styles.spaceName}>{space?.name || 'N/A'}</Text>
                        <View style={styles.nameRowEditSlot}>
                          {canEditSpaceInfo ? (
                            <TouchableOpacity
                              style={styles.editButton}
                              onPress={() => {
                                setSpaceImageUri(null);
                                setSpaceImageClear(false);
                                setEditing(true);
                              }}
                            >
                              <Ionicons name="create-outline" size={18} color="#6C5CE7" />
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </>
                    )}
                  </View>
                  {loading && !space ? (
                    <View style={styles.addressRow}>
                      <View style={{ width: 14, height: 14, marginTop: 2 }} />
                      <Text style={styles.spaceAddressPlaceholder}>Loading...</Text>
                    </View>
                  ) : (
                    space?.address ? (
                      <View style={styles.addressRow}>
                        <Ionicons
                          name="document-text-outline"
                          size={14}
                          color="#636E72"
                          style={styles.addressIcon}
                        />
                        <Text style={styles.spaceAddress}>{space.address}</Text>
                      </View>
                    ) : (
                      <Text style={styles.spaceAddressPlaceholder}>Add notes about your team or company for easier identification</Text>
                    )
                  )}
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Menu Items */}
        {visibleMenuItems.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.menuItem}
            onPress={() => router.push(item.route as any)}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemIcon}>
              <Ionicons name={item.icon as any} size={20} color="#6C5CE7" />
            </View>
            <View style={styles.menuItemContent}>
              <Text style={styles.menuItemTitle}>{item.title}</Text>
              <Text style={styles.menuItemDescription}>{item.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#95A5A6" />
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Switch Space Button and Sign Out Button */}
      <View style={styles.bottomContainer}>
        <TouchableOpacity
          style={styles.switchHouseholdButton}
          onPress={openSpaceSwitch}
          activeOpacity={0.7}
        >
          <Ionicons name="swap-horizontal-outline" size={20} color="#6C5CE7" />
          <Text style={styles.switchHouseholdButtonText}>Switch Space</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          activeOpacity={0.7}
        >
          <Ionicons name="log-out-outline" size={20} color="#E74C3C" />
          <Text style={styles.signOutButtonText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <SpaceSwitcherModal
        visible={showSpaceSwitch}
        spaces={spaces}
        currentSpaceId={space?.id}
        switching={switching}
        onClose={() => setShowSpaceSwitch(false)}
        onSwitch={handleSwitchSpace}
        onCreateNew={() => {
          setShowSpaceSwitch(false);
          router.push('/setup-space');
        }}
      />

      {/* Web only: switch space success – prompt to refresh */}
      <Modal
        visible={isDesktopWeb && showRefreshAfterSwitchModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowRefreshAfterSwitchModal(false)}
      >
        <View style={styles.refreshModalOverlay}>
          <View style={styles.refreshModalCard} onStartShouldSetResponder={() => true}>
            <View style={[styles.pickerHandle, { marginTop: 20, marginBottom: 16 }]} />
            <Text style={[styles.pickerTitle, styles.refreshModalTitle]}>Space switched successfully</Text>
            <TouchableOpacity
              style={styles.refreshModalPrimaryButton}
              onPress={() => {
                if (typeof window !== 'undefined') {
                  window.location.assign(window.location.origin + '/');
                }
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.refreshModalPrimaryButtonText}>Refresh page</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Create Space Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showCreateModal}
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.pickerOverlay}>
          <View style={styles.createModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create New Space</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowCreateModal(false);
                  setNewSpaceName('');
                  setNewSpaceAddress('');
                }}
                style={styles.modalCloseButton}
                disabled={creating}
              >
                <Ionicons name="close" size={24} color="#2D3436" />
              </TouchableOpacity>
            </View>
            <View style={styles.createModalBody}>
              <TextInput
                style={styles.createModalInput}
                placeholder="Space Name"
                placeholderTextColor="#95A5A6"
                value={newSpaceName}
                onChangeText={setNewSpaceName}
                autoCapitalize="words"
                editable={!creating}
              />
              <TextInput
                style={[styles.createModalInput, styles.createModalMultilineInput]}
                placeholder="Address (Optional)"
                placeholderTextColor="#95A5A6"
                value={newSpaceAddress}
                onChangeText={setNewSpaceAddress}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                editable={!creating}
              />
              <View style={styles.createModalButtonRow}>
                <TouchableOpacity
                  style={[styles.createModalButton, styles.createModalCancelButton]}
                  onPress={() => {
                    setShowCreateModal(false);
                    setNewSpaceName('');
                    setNewSpaceAddress('');
                  }}
                  disabled={creating}
                >
                  <Text style={styles.createModalCancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.createModalButton, styles.createModalConfirmButton]}
                  onPress={handleCreateSpace}
                  disabled={creating || !newSpaceName.trim()}
                >
                  {creating ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.createModalButtonText}>Create</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  loadingPlaceholder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minHeight: 28, // 与 nameRow / 编辑按钮槽同高，避免加载完成后卡片抖动
  },
  placeholderText: {
    fontSize: 15,
    color: '#95A5A6',
    fontStyle: 'italic',
    lineHeight: 20, // 匹配spaceName的lineHeight
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#2D3436',
  },
  headerRight: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 80,
  },
  sectionTag: {
    fontSize: 14,
    fontWeight: '600',
    color: '#636E72',
    marginBottom: 6,
    marginTop: 6,
  },
  spaceInfoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 0,
    marginLeft: 0,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  personalInfoCard: {
    backgroundColor: '#fff',
    borderColor: '#E9ECEF',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  spaceIconImage: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#E9ECEF',
  },
  userLogoHeaderImage: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#E9ECEF',
  },
  logoInteractiveWrap: {
    position: 'relative',
  },
  logoRemoveIconButton: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#636E72',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fff',
    zIndex: 3,
  },
  logoEditOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    backgroundColor: 'rgba(45, 52, 54, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  logoReplaceIconButton: {
    position: 'absolute',
    bottom: -5,
    right: -5,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#636E72',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fff',
    zIndex: 3,
  },
  logoPlaceholderWrap: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  logoPlaceholderSquare: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    backgroundColor: '#F8F9FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoPlaceholderText: {
    marginTop: 6,
    fontSize: 10,
    fontWeight: '600',
    color: '#6C5CE7',
    textAlign: 'center',
  },
  spaceOptionIconImage: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: '#E9ECEF',
  },
  spaceOptionPlaceholderSquare: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    backgroundColor: '#F8F9FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spaceImageEditorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  changeImageButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    backgroundColor: '#F8F9FA',
  },
  changeImageButtonDanger: {
    borderColor: '#E74C3C',
    backgroundColor: '#FFF1F1',
  },
  changeImageText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6C5CE7',
  },
  changeImageTextDanger: {
    color: '#E74C3C',
  },
  viewContainer: {
    flex: 1,
  },
  viewContent: {
    flex: 1,
    minHeight: 52, // nameRow min 28 + marginBottom 4 + addressRow min 20
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
    minHeight: 28, // 与 editButton 同高，管理员出现编辑图标时不增高
  },
  nameRowEditSlot: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronIcon: {
    marginLeft: 8,
  },
  spaceName: {
    fontSize: 16,
    color: '#2D3436',
    fontWeight: '600',
    flex: 1,
    lineHeight: 20, // 固定行高，确保高度一致
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 0,
    minHeight: 20, // 固定最小高度匹配spaceAddress的lineHeight
  },
  addressIcon: {
    marginTop: 2,
  },
  spaceAddress: {
    flex: 1,
    fontSize: 14,
    color: '#636E72',
    lineHeight: 20,
  },
  spaceAddressPlaceholder: {
    fontSize: 14,
    color: '#95A5A6',
    fontStyle: 'italic',
    lineHeight: 20, // 匹配spaceAddress的lineHeight
    minHeight: 20, // 固定最小高度
  },
  editButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editContainer: {
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    color: '#2D3436',
    backgroundColor: '#F8F9FA',
    marginBottom: 12,
  },
  multilineInput: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#E9ECEF',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#636E72',
  },
  saveButton: {
    backgroundColor: '#6C5CE7',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginLeft: 32,
    marginBottom: 0,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  menuItemIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F0F4FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  menuItemContent: {
    flex: 1,
  },
  menuItemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 2,
  },
  menuItemDescription: {
    fontSize: 13,
    color: '#636E72',
  },
  bottomContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E9ECEF',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 12,
  },
  switchHouseholdButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F4FF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 8,
  },
  switchHouseholdButtonText: {
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
  },
  signOutButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#E74C3C',
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  pickerBottomSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 20,
  },
  refreshModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  refreshModalCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingBottom: 32,
    maxWidth: 360,
    width: '100%',
  },
  refreshModalTitle: {
    marginBottom: 12,
  },
  refreshModalSubtitle: {
    fontSize: 16,
    color: '#636E72',
    textAlign: 'center',
    marginBottom: 24,
  },
  refreshModalPrimaryButton: {
    backgroundColor: '#6C5CE7',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshModalPrimaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  pickerHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#D1D5DB',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  pickerHeaderCenter: {
    justifyContent: 'center',
  },
  pickerTitleHidden: {
    opacity: 0,
  },
  pickerHeaderSpinnerWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#2D3436',
  },
  pickerScrollView: {
    maxHeight: 500,
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    gap: 12,
  },
  pickerOptionSelected: {
    backgroundColor: '#E8F4FD',
  },
  pickerOptionText: {
    flex: 1,
    fontSize: 16,
    color: '#2D3436',
    fontWeight: '500',
  },
  pickerOptionTextSelected: {
    color: '#6C5CE7',
    fontWeight: '600',
  },
  pickerManageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F0F0F0',
  },
  createSpacePickerOption: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E9ECEF',
    borderBottomWidth: 0,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#2D3436',
  },
  modalCloseButton: {
    padding: 4,
  },
  modalScrollView: {
    maxHeight: 400,
  },
  spaceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    gap: 12,
  },
  spaceOptionActive: {
    backgroundColor: '#F0F4FF',
  },
  spaceOptionContent: {
    flex: 1,
  },
  spaceOptionName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#2D3436',
    marginBottom: 4,
  },
  spaceOptionAddress: {
    fontSize: 14,
    color: '#636E72',
  },
  modalLoading: {
    padding: 20,
    alignItems: 'center',
  },
  modalFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: '#E9ECEF',
  },
  createSpaceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F4FF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 8,
  },
  createSpaceButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6C5CE7',
  },
  createModalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
  },
  createModalBody: {
    padding: 20,
  },
  createModalInput: {
    width: '100%',
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontSize: 16,
    color: '#2D3436',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    marginBottom: 15,
  },
  createModalMultilineInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  createModalButtonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 10,
    gap: 12,
  },
  createModalButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createModalCancelButton: {
    backgroundColor: '#E9ECEF',
  },
  createModalCancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#636E72',
  },
  createModalConfirmButton: {
    backgroundColor: '#6C5CE7',
  },
  createModalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
