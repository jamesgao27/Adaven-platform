import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Modal, ActivityIndicator, ScrollView, TextInput, useWindowDimensions, Platform, Linking, InteractionManager } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import { isAuthenticated, getCurrentUser, getCurrentSpace, setCurrentSpace, getUserSpaces, createSpace } from '@/lib/auth';
import { initializeAuthCache, isCacheInitialized, getCachedSpace } from '@/lib/auth-cache';
import { Space, UserSpace, User } from '@/types';
import { getPendingInvitationsForUser } from '@/lib/space-invitations';
import { uploadReceiptImageTempWithSpace } from '@/lib/supabase';
import { createProcessingReceipt, processReceiptInBackground } from '@/lib/receipt-processor';
import { createProcessingInvoice, processInvoiceInBackground } from '@/lib/invoice-processor';
import { processImageForUpload } from '@/lib/image-processor';
import { showToast } from '@/lib/toast';
import { showChoiceDialog } from '@/lib/confirmDialog';
import Svg, { Path, Rect, G, Circle, Text as SvgText } from 'react-native-svg';
import WebDashboardView from '@/components/WebDashboardView';
import CrmDashboardView from '@/components/CrmDashboardView';
import { FirmPendingOverlay } from '@/components/FirmPendingOverlay';
import { showAiInventory, showTaxFiling } from '@/lib/feature-flags';
import { getFirmClientsListBundle } from '@/lib/firm';
import { getPendingInviteesForEmail } from '@/lib/firm-clients';
import type { ClientDisplayStatus } from '@/types';
import { CLIENT_DISPLAY_STATUS_LABELS } from '@/types';
import { useWebViewportKind } from '../lib/web-viewport';
import { fetchSpaceEntitlements } from '@/lib/space-entitlements';
import { preflightRecognitionOrAlert } from '@/lib/recognition-preflight-ui';

/** 首页是否显示「AI 进销存」入口：由 app.config.js extra.showAiInventory 控制 */
const SHOW_AI_INVENTORY_ENTRY = Constants.expoConfig?.extra?.showAiInventory !== false;

const FIRM_CHART_COLORS = ['#6C5CE7', '#00B894', '#0984E3', '#FDCB6E', '#E17055'];
const FIRM_ORDER_STATUS_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  processing: 'Processing',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Document scan / gallery multi-select: max pages per batch (Android scanner uses maxNumDocuments). */
const MAX_CAPTURE_BATCH = 20;

/** iOS: dismiss RN Modal before presenting document scanner, or touches can stay dead on the home screen. */
function runAfterSuccessModalDismissed(action: () => void) {
  InteractionManager.runAfterInteractions(() => {
    if (Platform.OS === 'ios') {
      setTimeout(action, 150);
    } else {
      action();
    }
  });
}

export default function HomeScreen() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [currentSpace, setCurrentSpaceState] = useState<Space | null>(null);
  const [showSpaceSwitch, setShowSpaceSwitch] = useState(false);
  const [spaces, setSpaces] = useState<UserSpace[]>([]);
  const [switching, setSwitching] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceAddress, setNewSpaceAddress] = useState('');
  const [creating, setCreating] = useState(false);
  const [pendingInvitationsCount, setPendingInvitationsCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showRefreshAfterSwitchModal, setShowRefreshAfterSwitchModal] = useState(false);
  const [showSubscriptionExpiredModal, setShowSubscriptionExpiredModal] = useState(false);
  const [lastReceiptId, setLastReceiptId] = useState<string | null>(null);
  const [lastInvoiceId, setLastInvoiceId] = useState<string | null>(null);
  const [voucherType, setVoucherType] = useState<'receipt' | 'invoice'>('receipt');

  // Firm 移动端：图表数据（客户类别、订单类别）
  const [firmChartLoading, setFirmChartLoading] = useState(false);
  const [firmClientCountByStatus, setFirmClientCountByStatus] = useState<Record<ClientDisplayStatus, number>>({
    new: 0,
    to_follow_up: 0,
    in_service: 0,
    to_revisit: 0,
    churned: 0,
  });
  const [firmOrderCountByStatus, setFirmOrderCountByStatus] = useState<Record<string, number>>({});
  const [pendingClaimCount, setPendingClaimCount] = useState(0);

  /** useFocusEffect 内读取最新登录态，避免 isLoggedIn 从 false→true 时 callback 引用变化触发二次 focus 刷新（重复 getUserSpaces + 闪屏） */
  const isLoggedInRef = useRef<boolean | null>(null);
  isLoggedInRef.current = isLoggedIn;

  // Check if running in Expo Go
  const isExpoGo = Constants.appOwnership === 'expo';

  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { isDesktopWeb, isMobileWeb } = useWebViewportKind();
  const sloganFontSize = Math.min(32, Math.max(24, Math.round(screenWidth * 0.082)));
  const isCompact = screenHeight < 750 || screenWidth < 360;
  const mainCircleSize = isCompact ? 160 : 200;
  const chatCircleSize = isCompact ? 120 : 150;
  const sloganMarginBottom = isCompact ? 4 : 8;
  const sloganLineHeight = sloganFontSize * 1.15;
  const sloganBlockMarginBottom = isCompact ? 8 : 12;

  useEffect(() => {
    checkAuth();
  }, []);

  // Firm 空间移动端：拉取客户/订单统计用于图表
  useEffect(() => {
    if (Platform.OS === 'web' || currentSpace?.kind !== 'firm' || !currentSpace?.id) {
      return;
    }
    let cancelled = false;
    setFirmChartLoading(true);
    (async () => {
      try {
        const { clients, orderCountByStatus } = await getFirmClientsListBundle(currentSpace.id);
        if (cancelled) return;
        const byStatus: Record<ClientDisplayStatus, number> = {
          new: 0,
          to_follow_up: 0,
          in_service: 0,
          to_revisit: 0,
          churned: 0,
        };
        clients.forEach((c) => {
          byStatus[c.displayStatus] = (byStatus[c.displayStatus] ?? 0) + 1;
        });
        setFirmClientCountByStatus(byStatus);
        setFirmOrderCountByStatus(orderCountByStatus);
      } catch (e) {
        console.error('Firm chart load:', e);
      } finally {
        if (!cancelled) setFirmChartLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentSpace?.kind, currentSpace?.id]);

  /** Subscription gate: firm requires an active subscription; client may use credits without a subscription. */
  useEffect(() => {
    if (!isLoggedIn || !currentSpace?.id) {
      setShowSubscriptionExpiredModal(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const ent = await fetchSpaceEntitlements(currentSpace.id);
      if (cancelled || !ent?.ok) return;
      if (currentSpace.kind === 'firm') {
        setShowSubscriptionExpiredModal(!ent.active_subscription);
        return;
      }
      const credits = ent.client_recognition?.credits_balance ?? 0;
      const incRem = ent.client_recognition?.included_remaining ?? 0;
      const noSub = !ent.active_subscription;
      setShowSubscriptionExpiredModal(noSub && credits < 1 && incRem < 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, currentSpace?.id, currentSpace?.kind]);

  const checkAuth = async () => {
    let authenticated = await isAuthenticated();
    // Session may not be readable on the same tick as navigation from /login (in-memory storage / bridge timing).
    if (!authenticated) {
      await new Promise((r) => setTimeout(r, 150));
      authenticated = await isAuthenticated();
    }
    if (!authenticated) {
      router.replace('/login');
      return;
    }

    // 冷启动：先一次性灌入缓存，再继续校验（避免与 continueAuthCheck 并行打两套 RPC）
    if (!isCacheInitialized()) {
      try {
        const u = await getCurrentUser(true);
        const sp = u ? await getCurrentSpace(false) : null;
        await initializeAuthCache(u, sp);
      } catch (error) {
        console.error('Error initializing auth cache:', error);
      }
    }
    await continueAuthCheck();
  };

  /** 邀请 / claim 角标：与首屏 session 拉取解耦；须在 continueAuthCheck 之前声明以便闭包清晰 */
  const scheduleHomeSidebarBadges = useCallback((userEmail: string | null | undefined) => {
    InteractionManager.runAfterInteractions(() => {
      void (async () => {
        try {
          const invitations = await getPendingInvitationsForUser();
          setPendingInvitationsCount(invitations.length);
        } catch (e) {
          console.error('Error checking pending invitations:', e);
          setPendingInvitationsCount(0);
        }
        if (userEmail) {
          try {
            const { list } = await getPendingInviteesForEmail(userEmail);
            setPendingClaimCount(list.length);
          } catch (e) {
            console.error('Error loading pending claim count:', e);
          }
        }
      })();
    });
  }, []);

  const continueAuthCheck = async () => {
    // 流程：登录成功 -> member 邀请 -> firm 邀请 -> 当前/最新空间或新建空间（由本页与 login 共同完成）
    // 并行拉取 user + spaces，减少卡顿，直接进入后续流程
    const { getUserSpaces } = await import('@/lib/auth');
    let user: User | null;
    let spaces: UserSpace[];
    try {
      // 登录页已 initializeAuthCache 时走缓存，避免再触发一轮 get_user_by_id + spaces 全量刷新
      [user, spaces] = await Promise.all([getCurrentUser(false), getUserSpaces()]);
    } catch {
      console.log('Index: Error getting user, redirecting to setup-space');
      router.replace('/setup-space');
      return;
    }

    if (!user) {
      console.log('Index: No user, redirecting to setup-space');
      router.replace('/setup-space');
      return;
    }
    
    console.log('Index: User spaces count:', spaces.length);
    if (spaces.length > 0) {
      console.log('Index: User spaces:', spaces.map(s => ({
        spaceId: s.spaceId,
        spaceName: s.space?.name || 'Unknown',
      })));
    }
    
    // 先判断 currentSpaceId / spaceId 是否仍然指向一个「仍然属于该用户」的空间
    const ownedSpaceIds = new Set(spaces.map((s) => s.spaceId));
    const hasValidCurrentSpace =
      (user.currentSpaceId && ownedSpaceIds.has(user.currentSpaceId)) ||
      (user.spaceId && ownedSpaceIds.has(user.spaceId));

    if (hasValidCurrentSpace) {
      console.log('Index: User has valid current space, entering app');
      try {
        const space = getCachedSpace() ?? (await getCurrentSpace(false));
        setCurrentSpaceState(space);
        await initializeAuthCache(user, space);
      } catch (e) {
        console.error('Index: bootstrap space for valid current failed', e);
      }
      scheduleHomeSidebarBadges(user.email);
      setIsLoggedIn(true);
      return;
    }

    // 走到这里说明：
    // - 要么用户从未设置 currentSpaceId；
    // - 要么 currentSpaceId 指向的空间已经不在用户的空间列表里（例如被 admin 踢出或空间被删除）。

    // 没有任何空间：按新用户流程处理（可能是被踢出了最后一个空间）
    if (spaces.length === 0) {
      // 检查是否有待处理的邀请（新用户需要处理邀请）
      try {
        const { getPendingInvitationsForUser } = await import('@/lib/space-invitations');
        const invitations = await getPendingInvitationsForUser();
        
        if (invitations.length > 0) {
          // 新用户有邀请，跳转到邀请处理页面
          console.log('Index: New user with pending invitations, redirecting to handle-invitations');
          router.replace('/handle-invitations');
          return;
        }
      } catch (invError) {
        // 邀请检查失败不影响流程，静默继续
        console.log('Index: Invitation check failed (non-blocking):', invError);
      }
      
      // 新用户没有邀请，跳转到设置空间页面（创建空间）
      console.log('Index: No spaces, redirecting to setup-space');
      router.replace('/setup-space');
      return;
    }

    // 老用户：有空间但 currentSpaceId 已失效或从未设置
    if (spaces.length === 1) {
      // 只有一个空间，自动设置并进入
      console.log('Index: Setting single space for user without valid current:', spaces[0].spaceId);
      const { setCurrentSpace } = await import('@/lib/auth');
      await setCurrentSpace(spaces[0].spaceId);
      // 更新缓存（使用已设置的空间ID，避免再次查询）
      const updatedUser = await getCurrentUser(true);
      const updatedSpace = updatedUser ? await getCurrentSpace(false) : null;
      await initializeAuthCache(updatedUser, updatedSpace);
      setCurrentSpaceState(updatedSpace);
      scheduleHomeSidebarBadges(updatedUser?.email ?? user.email);
      setIsLoggedIn(true);
      return;
    } else {
      // 多个空间：自动选择「创建时间最新」的空间作为当前空间；
      // 如果没有 createdAt 字段，则退化为按 id 排序的最后一个。
      const sortedSpaces = [...spaces].sort((a, b) => {
        const at = a.createdAt ? Date.parse(a.createdAt) || 0 : 0;
        const bt = b.createdAt ? Date.parse(b.createdAt) || 0 : 0;
        if (at !== bt) return bt - at; // 新的在前
        // createdAt 相同或缺失时，按 id 字符串排序保证稳定性
        return (a.spaceId || '').localeCompare(b.spaceId || '');
      });
      const latest = sortedSpaces[0];
      let badgeEmail = user.email;
      if (latest) {
        console.log('Index: Auto-select latest space for user without valid current:', latest.spaceId);
        const { setCurrentSpace } = await import('@/lib/auth');
        await setCurrentSpace(latest.spaceId);
        const updatedUser = await getCurrentUser(true);
        const updatedSpace = updatedUser ? await getCurrentSpace(false) : null;
        await initializeAuthCache(updatedUser, updatedSpace);
        setCurrentSpaceState(updatedSpace);
        badgeEmail = updatedUser?.email ?? badgeEmail;
      }
      scheduleHomeSidebarBadges(badgeEmail);
      // 兜底：即使 sortedSpaces 为空（理论上不会），也进入首页
      setIsLoggedIn(true);
      return;
    }
  };

  const checkPendingInvitations = async () => {
    // 只有已登录的用户才检查 pending invitations
    if (!isLoggedIn) {
      setPendingInvitationsCount(0);
      return;
    }

    try {
      const invitations = await getPendingInvitationsForUser();
      setPendingInvitationsCount(invitations.length);
    } catch (error) {
      console.error('Error checking pending invitations:', error);
      // 静默失败，不影响页面显示
      setPendingInvitationsCount(0);
    }
  };

  /** 合并原 useEffect + 两个 useFocusEffect，避免 isLoggedIn 变 true 时重复 getUserSpaces / loadSpace */
  const homeSessionRefreshRef = useRef<Promise<void> | null>(null);

  const runHomeSessionRefresh = useCallback(() => {
    const loggedIn = isLoggedInRef.current;
    if (loggedIn !== true) {
      if (loggedIn === false) setPendingInvitationsCount(0);
      return Promise.resolve();
    }
    if (homeSessionRefreshRef.current) {
      return homeSessionRefreshRef.current;
    }
    const job = (async () => {
      try {
        let user = await getCurrentUser(false);
        if (!user) user = await getCurrentUser(true);
        if (!user) {
          router.replace('/setup-space');
          return;
        }
        const spaces = await getUserSpaces();
        if (spaces.length === 0) {
          router.replace('/setup-space');
          return;
        }
        if (!user.currentSpaceId && !user.spaceId) {
          router.replace('/setup-space');
          return;
        }
        let space = await getCurrentSpace(false);
        if (!space) space = await getCurrentSpace(true);
        setCurrentSpaceState(space);

        scheduleHomeSidebarBadges(user.email);
      } catch (error) {
        console.error('Error refreshing home session:', error);
        router.replace('/setup-space');
      }
    })();
    homeSessionRefreshRef.current = job;
    job.finally(() => {
      if (homeSessionRefreshRef.current === job) homeSessionRefreshRef.current = null;
    });
    return job;
  }, [router, scheduleHomeSidebarBadges]);

  /** 再次进入首页时刷新 session；依赖须稳定，勿绑定 isLoggedIn（否则登录后 callback 变引用会再跑一轮，重复打 getUserSpaces） */
  useFocusEffect(
    useCallback(() => {
      void runHomeSessionRefresh();
    }, [runHomeSessionRefresh]),
  );

  const loadSpace = async () => {
    try {
      // 强制刷新，确保从管理页切换空间后能获取最新数据
      const space = await getCurrentSpace(true);
      setCurrentSpaceState(space);
      
      // 加载空间后检查 pending invitations（已有关联空间的用户）
      await checkPendingInvitations();
    } catch (error) {
      console.error('Error loading space:', error);
    }
  };


  const ensureUserHasSpace = async (isNewUser: boolean = false) => {
    // 确保用户有当前空间，如果没有则设置到第一个空间或创建新空间
    const user = await getCurrentUser();
    if (!user) return;

    // 如果用户已经有当前空间，不需要处理
    if (user.currentSpaceId || user.spaceId) {
      return;
    }

    // 检查用户有哪些空间
    const spaces = await getUserSpaces();
    if (spaces.length > 0) {
      // 有空间但没有当前空间，设置到第一个空间
      const { error } = await setCurrentSpace(spaces[0].spaceId);
      if (!error) {
        // 更新缓存
        const updatedUser = await getCurrentUser(true);
        const updatedSpace = updatedUser ? await getCurrentSpace(true) : null;
        await initializeAuthCache(updatedUser, updatedSpace);
        // 更新当前显示的空间
        setCurrentSpaceState(updatedSpace);
      }
    } else if (isNewUser) {
      // 新用户没有空间，跳转到创建空间页面让用户手动创建
      router.replace('/setup-space');
      return;
    } else {
      // 老用户没有空间的情况不应该发生，但如果有，也跳转到创建空间页面
      router.replace('/setup-space');
    }
  };


  const loadSpaces = async () => {
    try {
      const data = await getUserSpaces();
      setSpaces(data);
    } catch (error) {
      console.error('Error loading spaces:', error);
      showToast('Failed to load spaces', 'error');
    }
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

      if (Platform.OS === 'web' && isDesktopWeb) {
        setShowRefreshAfterSwitchModal(true);
        return;
      }

      if (updatedSpace) {
        setCurrentSpaceState(updatedSpace);
      }

      try {
        const { getPendingInvitationsForUser } = await import('@/lib/space-invitations');
        const invitations = await getPendingInvitationsForUser();
        if (invitations.length > 0) {
          router.replace('/handle-invitations');
          return;
        }
      } catch (invError) {
        // 静默继续
      }

      await loadSpace();
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
      const { space, error } = await createSpace(
        newSpaceName.trim(),
        newSpaceAddress.trim() || undefined
      );

      if (error) {
        showToast(error.message || 'Failed to create space', 'error');
        setCreating(false);
        return;
      }

      if (space) {
        setShowCreateModal(false);
        setNewSpaceName('');
        setNewSpaceAddress('');
        await loadSpaces();
        await loadSpace();
        setShowSpaceSwitch(false);
        showToast('Space created successfully', 'success');
      }
    } catch (error) {
      console.error('Error creating space:', error);
      showToast('Failed to create space', 'error');
    } finally {
      setCreating(false);
    }
  };

  const scanDocument = async (type: 'receipt' | 'invoice' = 'receipt') => {
    // If we are in Expo Go, we can't use the native scanner
    if (isExpoGo) {
      showChoiceDialog(
        'Development Build Required',
        'Real-time edge detection and cropping requires a native development build. In Expo Go, please use the gallery picker option.',
        [
          { text: 'Cancel', onPress: () => {}, style: 'cancel' },
          {
            text: 'Pick from Gallery',
            onPress: () => {
              void (async () => {
                if (currentSpace?.kind === 'client' && currentSpace.id) {
                  const ok = await preflightRecognitionOrAlert(currentSpace.id, router, {
                    onSwitchSpace: () => {
                      void openSpaceSwitch();
                    },
                  });
                  if (!ok) return;
                }
                pickImage(type);
              })();
            },
            style: 'primary',
          },
        ]
      );
      return;
    }

    try {
      // 动态导入 DocumentScanner（只在非 Expo Go 环境中导入）
      const module = await import('react-native-document-scanner-plugin');
      const DocumentScanner = module?.default;
      
      // 额外防御：模块导入但没有正确挂载时，直接提示使用开发构建
      if (!DocumentScanner || typeof DocumentScanner.scanDocument !== 'function') {
        throw new Error('DocumentScanner module not loaded correctly');
      }

      const scanOptions: Record<string, unknown> = {
        croppedImageQuality: 90,
        letUserAdjustCrop: false,
      };
      if (Platform.OS === 'android') {
        scanOptions.maxNumDocuments = MAX_CAPTURE_BATCH;
      }

      const { scannedImages } = await DocumentScanner.scanDocument(scanOptions as any);

      if (scannedImages && scannedImages.length > 0) {
        // iOS VisionKit / Android：支持一次会话内多页；依次识别、逐条入库
        void processCapturedImages(scannedImages, false, false, type);
      }
    } catch (error) {
      console.error('Document scan error:', error);
      // 如果是模块未找到错误，提示使用开发构建
      if (error instanceof Error && error.message?.includes('TurboModuleRegistry')) {
        showChoiceDialog(
          'Development Build Required',
          'Document scanner requires a native development build. Please use a development build or use the gallery picker option.',
          [
            { text: 'Cancel', onPress: () => {}, style: 'cancel' },
            {
              text: 'Pick from Gallery',
              onPress: () => {
                void (async () => {
                  if (currentSpace?.kind === 'client' && currentSpace.id) {
                    const ok = await preflightRecognitionOrAlert(currentSpace.id, router, {
                      onSwitchSpace: () => {
                        void openSpaceSwitch();
                      },
                    });
                    if (!ok) return;
                  }
                  pickImage(type);
                })();
              },
              style: 'primary',
            },
          ]
        );
      } else {
        showToast('Failed to snap document. Please try again.', 'error');
      }
    }
  };

  const pickImage = async (type: 'receipt' | 'invoice' = 'receipt') => {
    if (currentSpace?.kind === 'client' && currentSpace.id) {
      const ok = await preflightRecognitionOrAlert(currentSpace.id, router, {
        onSwitchSpace: () => {
          void openSpaceSwitch();
        },
      });
      if (!ok) return;
    }
    try {
      const allowMulti = Platform.OS !== 'web';
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: allowMulti,
        ...(allowMulti ? { selectionLimit: MAX_CAPTURE_BATCH } : {}),
        allowsEditing: !allowMulti,
        quality: 0.9,
      });

      if (!result.canceled && result.assets?.length) {
        void processCapturedImages(
          result.assets.map((a) => a.uri),
          true,
          false,
          type
        );
      }
    } catch (error) {
      console.error('Image picker error:', error);
      showToast('Failed to pick image.', 'error');
    }
  };

  // fromGallery：true=相册/选择不裁剪不增强；false=实时拍摄/扫描。autoCrop：仅非相册时有效（扫描传 false）
  const processCapturedImages = async (
    imageUris: string[],
    fromGallery: boolean,
    autoCrop: boolean,
    type: 'receipt' | 'invoice' = 'receipt'
  ) => {
    const uris = imageUris.filter(Boolean);
    if (uris.length === 0) return;

    setShowSuccessModal(true);
    setVoucherType(type);
    setLastReceiptId(null);
    setLastInvoiceId(null);

    let hadError = false;
    for (let i = 0; i < uris.length; i++) {
      const imageUri = uris[i];
      try {
        const sp = await getCurrentSpace(true);
        if (sp?.kind === 'client' && sp.id) {
          const ok = await preflightRecognitionOrAlert(sp.id, router, {
            onSwitchSpace: () => {
              void openSpaceSwitch();
            },
          });
          if (!ok) {
            hadError = true;
            if (uris.length === 1) {
              setShowSuccessModal(false);
            }
            continue;
          }
        }

        console.log(`Processing captured image ${i + 1}/${uris.length} (${type}):`, imageUri, 'fromGallery:', fromGallery);

        let uriToUpload = imageUri;
        if (!fromGallery) {
          uriToUpload = await processImageForUpload(imageUri, { autoCrop, quality: 0.85 });
        }

        const tempFileName = `temp-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}`;
        const spaceId = currentSpace?.id ?? '';
        const imageUrl = await uploadReceiptImageTempWithSpace(uriToUpload, tempFileName, spaceId);

        if (type === 'invoice') {
          const invoiceId = await createProcessingInvoice({
            imageUrl,
            inputType: fromGallery ? 'image' : 'camera',
          });
          setLastInvoiceId(invoiceId);
          // 识别异步进行：上传+建单完成后即可继续下一张 / 退出界面
          void processInvoiceInBackground(imageUrl, invoiceId).catch((err) => {
            console.error('Invoice background recognition failed:', err);
          });
        } else {
          const receiptId = await createProcessingReceipt({
            imageUrl,
            inputType: fromGallery ? 'image' : 'camera',
          });
          setLastReceiptId(receiptId);
          void processReceiptInBackground(imageUrl, receiptId, uriToUpload).catch((err) => {
            console.error('Receipt background recognition failed:', err);
          });
        }
      } catch (error) {
        console.error('Processing error:', error);
        hadError = true;
        showToast(
          uris.length > 1
            ? `Failed to process ${type === 'invoice' ? 'income' : 'expense'} (image ${i + 1} of ${uris.length}).`
            : `Failed to process ${type === 'invoice' ? 'income' : 'expense'}.`,
          'error'
        );
        if (uris.length === 1) {
          setShowSuccessModal(false);
        }
      }
    }

    if (hadError && uris.length > 1) {
      showToast('Some images could not be processed. Check the list for saved items.', 'info');
    }
  };

  const processCapturedImage = (
    imageUri: string,
    fromGallery: boolean,
    autoCrop: boolean,
    type: 'receipt' | 'invoice' = 'receipt'
  ) => {
    void processCapturedImages([imageUri], fromGallery, autoCrop, type);
  };

  const handleCameraPress = (type: 'receipt' | 'invoice' = 'receipt') => {
    void (async () => {
      if (currentSpace?.kind === 'client' && currentSpace.id) {
        const ok = await preflightRecognitionOrAlert(currentSpace.id, router, {
          onSwitchSpace: () => {
            void openSpaceSwitch();
          },
        });
        if (!ok) return;
      }
      setVoucherType(type);
      scanDocument(type);
    })();
  };

  const handleChatPress = (type: 'receipt' | 'invoice' = 'receipt') => {
    void (async () => {
      if (currentSpace?.kind === 'client' && currentSpace.id) {
        const ok = await preflightRecognitionOrAlert(currentSpace.id, router, {
          onSwitchSpace: () => {
            void openSpaceSwitch();
          },
        });
        if (!ok) return;
      }
      if (type === 'invoice') {
        router.push('/chat-to-log?type=invoice');
      } else {
        router.push('/chat-to-log');
      }
    })();
  };

  // 认证 / 当前空间加载中：用占位替代全白屏（登录后曾出现 isLoggedIn 已 true 但 currentSpace 未就绪的长期空白）
  if (isLoggedIn === null) {
    return (
      <View style={styles.bootLoadingRoot}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color="#6C5CE7" />
      </View>
    );
  }

  if (!isLoggedIn) {
    return null; // 会跳转到登录页或设置家庭页面
  }

  if (!currentSpace) {
    return (
      <View style={styles.bootLoadingRoot}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color="#6C5CE7" />
      </View>
    );
  }

  const isFirmPending = currentSpace?.kind === 'firm' && currentSpace?.firmStatus !== 'approved';

  const subscriptionExpiredModal = (
    <Modal
      visible={showSubscriptionExpiredModal}
      animationType="fade"
      transparent
      {...(Platform.OS === 'ios' ? { presentationStyle: 'overFullScreen' as const } : {})}
      onRequestClose={() => {}}
    >
      <View style={styles.subscriptionExpiredOverlay}>
        <View style={styles.subscriptionExpiredCard}>
          <Text style={styles.subscriptionExpiredTitle}>Subscription inactive</Text>
          <Text style={styles.subscriptionExpiredBody}>
            This space has no active subscription (or no recognition allowance left). Renew in Subscription and
            billing, or switch to another space.
          </Text>
          <TouchableOpacity
            style={styles.subscriptionExpiredPrimary}
            onPress={() => {
              setShowSubscriptionExpiredModal(false);
              void openSpaceSwitch();
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.subscriptionExpiredPrimaryText}>Switch space</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.subscriptionExpiredSecondary}
            onPress={() => router.push('/management')}
            activeOpacity={0.85}
          >
            <Text style={styles.subscriptionExpiredSecondaryText}>Subscription and billing</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  // 桌面 Web：仅 Dashboard（侧栏在 _layout）；移动 Web 与原生共用下方壳层（顶栏 + 底栏）
  if (Platform.OS === 'web' && isDesktopWeb) {
    return (
      <>
        <View style={styles.container}>
          <StatusBar style="dark" />
          {currentSpace?.kind === 'firm' ? <CrmDashboardView /> : <WebDashboardView />}
        </View>
        {subscriptionExpiredModal}
      </>
    );
  }

  return (
    <>
    <View style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          currentSpace?.kind === 'firm' && {
            // firm 首页由 CrmDashboardView 自己控制左右内边距；
            // 顶部与系统状态栏/安全区保持与 client 端一致的 60 顶部留白
            paddingHorizontal: 0,
            paddingTop: 60,
            paddingBottom: 24,
          },
        ]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
      {/* 顶部栏：家庭名称和管理入口；左上角为 pending 角标（member 邀请 + engagement claim），样式复用、双类型时不同颜色角标 */}
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          {pendingInvitationsCount > 0 && (
            <TouchableOpacity
              style={styles.pendingBadgeButton}
              onPress={() => router.push('/handle-invitations')}
              activeOpacity={0.7}
            >
              <Ionicons name="mail-outline" size={24} color="#6C5CE7" />
              <View style={styles.invitationsBadge}>
                <Text style={styles.invitationsBadgeText}>
                  {pendingInvitationsCount > 99 ? '99+' : pendingInvitationsCount}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          {pendingClaimCount > 0 && (
            <TouchableOpacity
              style={styles.pendingBadgeButton}
              onPress={() => router.push('/auth/claim')}
              activeOpacity={0.7}
            >
              <Ionicons name="briefcase-outline" size={24} color="#6C5CE7" />
              <View style={styles.claimBadge}>
                <Text style={styles.invitationsBadgeText}>
                  {pendingClaimCount > 99 ? '99+' : pendingClaimCount}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={styles.householdNameContainer}
          onPress={openSpaceSwitch}
          activeOpacity={0.7}
        >
          <Text style={styles.householdName} numberOfLines={1}>
            {currentSpace?.name || 'Loading...'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.managementButton}
          onPress={() => router.push('/management')}
          activeOpacity={0.7}
        >
          <Ionicons name="settings-outline" size={24} color="#2D3436" />
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.content,
          currentSpace?.kind === 'firm' && {
            // firm Insights 不需要额外顶部 padding，由 CrmDashboardView 内部控制
            paddingTop: 0,
          },
        ]}
      >
        {isFirmPending ? (
          <FirmPendingOverlay />
        ) : currentSpace?.kind === 'firm' ? (
          <CrmDashboardView />
        ) : isMobileWeb ? (
          <WebDashboardView homeCompact />
        ) : (
          <>
            <Text style={[styles.title, { fontSize: sloganFontSize, lineHeight: sloganLineHeight, marginBottom: sloganMarginBottom }]}>📸</Text>
            <Text
              style={[styles.title, { fontSize: sloganFontSize, lineHeight: sloganLineHeight, marginBottom: sloganMarginBottom }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              Voucher Snapping,
            </Text>
            <Text
              style={[styles.subtitle, { fontSize: sloganFontSize, lineHeight: sloganLineHeight, marginBottom: sloganBlockMarginBottom }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              Balance Clarity.
            </Text>
            <View style={[styles.iconContainer, { marginTop: sloganBlockMarginBottom }]}>
              <View style={[styles.circle, { width: mainCircleSize, height: mainCircleSize, borderRadius: mainCircleSize / 2 }]}>
                <View style={styles.iconCenter}>
                  <Ionicons name="camera" size={mainCircleSize * 0.4} color="#6C5CE7" />
                </View>
                <TouchableOpacity style={[styles.halfButton, styles.leftHalf]} onPress={() => handleCameraPress('invoice')} activeOpacity={0.8} disabled={isProcessing} />
                <TouchableOpacity style={[styles.halfButton, styles.rightHalf]} onPress={() => handleCameraPress('receipt')} activeOpacity={0.8} disabled={isProcessing} />
              </View>
            </View>
            <View style={styles.chatIconContainer}>
              <View style={[styles.chatCircle, { width: chatCircleSize, height: chatCircleSize, borderRadius: chatCircleSize / 2 }]}>
                <View style={styles.iconCenter}>
                  <Ionicons name="chatbubble-outline" size={chatCircleSize * 0.4} color="#6C5CE7" />
                </View>
                <TouchableOpacity style={[styles.halfButton, styles.leftHalf]} onPress={() => handleChatPress('invoice')} activeOpacity={0.8} />
                <TouchableOpacity style={[styles.halfButton, styles.rightHalf]} onPress={() => handleChatPress('receipt')} activeOpacity={0.8} />
              </View>
            </View>
          </>
        )}
      </View>

      </ScrollView>

      {/* Bottom navigation buttons: always fixed at bottom on mobile */}
      {currentSpace?.kind === 'firm' && !isFirmPending ? (
        <View style={styles.bottomNav}>
          <View style={styles.buttonsRow}>
            <TouchableOpacity
              style={[styles.secondaryButton, styles.thirdWidthButton, styles.firmBottomIconButton]}
              onPress={() => router.push('/firm/clients')}
              accessibilityLabel="Clients"
            >
              <Ionicons name="people-outline" size={26} color="#6C5CE7" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, styles.thirdWidthButton, styles.firmBottomIconButton]}
              onPress={() => router.push('/firm/engagements')}
              accessibilityLabel="Engagements"
            >
              <Ionicons name="briefcase-outline" size={26} color="#6C5CE7" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, styles.thirdWidthButton, styles.firmBottomIconButton]}
              onPress={() => router.push('/firm/service-catalog')}
              accessibilityLabel="Service Catalog"
            >
              <Ionicons name="library-outline" size={26} color="#6C5CE7" />
            </TouchableOpacity>
          </View>
        </View>
      ) : currentSpace?.kind !== 'firm' ? (
        <View style={styles.bottomNav}>
          <View style={styles.buttonsRow}>
            <TouchableOpacity
              style={[styles.secondaryButton, styles.halfWidthButton]}
              onPress={() => router.push('/invoices')}
            >
              <Ionicons name="document-text-outline" size={20} color="#6C5CE7" style={styles.buttonIcon} />
              <Text style={styles.secondaryButtonText}>Income</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, styles.halfWidthButton]}
              onPress={() => router.push('/receipts')}
            >
              <Ionicons name="list-outline" size={20} color="#6C5CE7" style={styles.buttonIcon} />
              <Text style={styles.secondaryButtonText}>Expenses</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.buttonsRow, { marginTop: 12 }]}>
            <TouchableOpacity
              style={[styles.secondaryButton, styles.halfWidthButton]}
              onPress={() => router.push('/tax-filing')}
            >
              <Ionicons
                name="document-text-outline"
                size={20}
                color="#6C5CE7"
                style={styles.buttonIcon}
              />
              <Text style={styles.secondaryButtonText}>Tax Filing</Text>
            </TouchableOpacity>
          </View>
          {SHOW_AI_INVENTORY_ENTRY && (
            <View style={[styles.buttonsRow, { marginTop: 12 }]}>
              <TouchableOpacity
                style={[styles.secondaryButtonAlt, styles.halfWidthButton]}
                onPress={() => router.push('/ai-inventory')}
              >
                <Ionicons name="cube-outline" size={20} color="#FF9500" style={styles.buttonIcon} />
                <Text style={styles.secondaryButtonAltText}>AI Inventory</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : null}

      {/* Space Switch Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showSpaceSwitch}
        onRequestClose={() => setShowSpaceSwitch(false)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowSpaceSwitch(false)}
        >
          <View style={styles.pickerBottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHandle} />
            <View style={[styles.pickerHeader, styles.pickerHeaderCenter]}>
              <Text style={[styles.pickerTitle, switching && styles.pickerTitleHidden]}>Switch Space</Text>
              {switching && (
                <View style={styles.pickerHeaderSpinnerWrap}>
                  <ActivityIndicator size="small" color="#6C5CE7" />
                </View>
              )}
            </View>
            <ScrollView style={styles.pickerScrollView} showsVerticalScrollIndicator={false}>
              {spaces.map((userSpace) => (
                <TouchableOpacity
                  key={userSpace.spaceId}
                  style={[
                    styles.pickerOption,
                    currentSpace?.id === userSpace.spaceId && styles.pickerOptionSelected
                  ]}
                  onPress={() => handleSwitchSpace(userSpace.spaceId)}
                  disabled={switching || currentSpace?.id === userSpace.spaceId}
                >
                  <Ionicons 
                    name="home" 
                    size={20} 
                    color={currentSpace?.id === userSpace.spaceId ? "#6C5CE7" : "#636E72"} 
                  />
                  <View style={styles.householdOptionContent}>
                    <Text style={[
                      styles.pickerOptionText,
                      currentSpace?.id === userSpace.spaceId && styles.pickerOptionTextSelected
                    ]}>
                      {userSpace.space?.name || 'Unnamed Space'}
                    </Text>
                    {userSpace.space?.address && (
                      <Text style={styles.householdOptionAddress} numberOfLines={1}>
                        {userSpace.space.address}
                      </Text>
                    )}
                  </View>
                  {currentSpace?.id === userSpace.spaceId && (
                    <Ionicons name="checkmark" size={20} color="#6C5CE7" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.createHouseholdButton}
                onPress={() => {
                  setShowSpaceSwitch(false);
                  router.push('/setup-space');
                }}
                disabled={switching}
              >
                <Ionicons name="add-circle-outline" size={20} color="#6C5CE7" />
                <Text style={styles.createHouseholdButtonText}>Create a New</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Web only: switch space success – prompt to refresh */}
      <Modal
        visible={Platform.OS === 'web' && isDesktopWeb && showRefreshAfterSwitchModal}
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

      {/* Success Modal - 拍摄提交后的操作选单 */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={showSuccessModal}
        onRequestClose={() => setShowSuccessModal(false)}
      >
        <View style={styles.successModalOverlay}>
          <View style={styles.successModalContent}>
            <View style={styles.successIconContainer}>
              <Ionicons name="checkmark-circle" size={64} color="#00B894" />
            </View>
            <Text style={styles.successTitle}>
              {voucherType === 'invoice' ? 'Income Submitted!' : 'Expense Submitted!'}
            </Text>
            <Text style={styles.successSubtitle}>
              {voucherType === 'invoice' 
                ? 'Invoice is being processed' 
                : 'Receipt is being processed'}
            </Text>
            <View style={styles.successButtons}>
              <TouchableOpacity
                style={styles.successButton}
                onPress={() => {
                  const type = voucherType;
                  setShowSuccessModal(false);
                  runAfterSuccessModalDismissed(() => handleCameraPress(type));
                }}
              >
                <Ionicons name="camera-outline" size={24} color="#6C5CE7" />
                <Text style={styles.successButtonText}>Snap Another</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.successButton, !(voucherType === 'receipt' ? lastReceiptId : lastInvoiceId) && { opacity: 0.5 }]}
                disabled={!(voucherType === 'receipt' ? lastReceiptId : lastInvoiceId)}
                onPress={() => {
                  setShowSuccessModal(false);
                  if (voucherType === 'receipt' && lastReceiptId) {
                    router.push(`/receipt-details/${lastReceiptId}`);
                  } else if (voucherType === 'invoice' && lastInvoiceId) {
                    router.push(`/invoice-details/${lastInvoiceId}`);
                  }
                }}
              >
                {(voucherType === 'receipt' ? lastReceiptId : lastInvoiceId) ? (
                  <Ionicons name="eye-outline" size={24} color="#6C5CE7" />
                ) : (
                  <ActivityIndicator size="small" color="#6C5CE7" />
                )}
                <Text style={styles.successButtonText}>
                  {(voucherType === 'receipt' ? lastReceiptId : lastInvoiceId) ? 'View Detail' : 'Uploading...'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.successButton}
                onPress={() => {
                  setShowSuccessModal(false);
                  router.push(voucherType === 'receipt' ? '/receipts' : '/invoices');
                }}
              >
                <Ionicons name="list-outline" size={24} color="#6C5CE7" />
                <Text style={styles.successButtonText}>View List</Text>
              </TouchableOpacity>
            </View>
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
    {subscriptionExpiredModal}
    </>
  );
}

const styles = StyleSheet.create({
  subscriptionExpiredOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  subscriptionExpiredCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 28,
    maxWidth: 400,
    width: '100%',
  },
  subscriptionExpiredTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2D3436',
    marginBottom: 12,
    textAlign: 'center',
  },
  subscriptionExpiredBody: {
    fontSize: 15,
    color: '#636E72',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  subscriptionExpiredPrimary: {
    backgroundColor: '#6C5CE7',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  subscriptionExpiredPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  subscriptionExpiredSecondary: {
    backgroundColor: '#F0F4FF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  subscriptionExpiredSecondaryText: {
    color: '#6C5CE7',
    fontSize: 16,
    fontWeight: '600',
  },
  bootLoadingRoot: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    position: 'relative',
    paddingHorizontal: 12,
    width: '100%',
  },
  topBarLeft: {
    flexDirection: 'row',
    minWidth: 44,
    height: 44,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  pendingBadgeButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  invitationsBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#E74C3C',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  claimBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#6C5CE7',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  invitationsBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  householdNameContainer: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  householdName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2D3436',
    textAlign: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    paddingTop: 20,
  },
  /** Firm 首页统计卡片列：一列排布，左右各留 16 的外边距，卡片之间 16 间距由 card marginBottom 控制 */
  firmCardsColumn: {
    width: '100%',
    paddingHorizontal: 16,
  },
  title: {
    fontWeight: 'bold',
    color: '#2D3436',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontWeight: 'bold',
    color: '#2D3436',
    textAlign: 'center',
  },
  iconContainer: {
    marginTop: 12,
    alignItems: 'center',
  },
  circle: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#E9ECEF',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    flexDirection: 'row',
    position: 'relative',
  },
  chatIconContainer: {
    marginTop: 24,
    alignItems: 'center',
  },
  chatCircle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#E9ECEF',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    flexDirection: 'row',
    position: 'relative',
  },
  iconCenter: {
    position: 'absolute',
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  },
  halfButton: {
    flex: 1,
    height: '100%',
  },
  leftHalf: {
    backgroundColor: '#FFF2EB', // 低饱和度的橙色背景，用于income（#D35400的同色系）
  },
  rightHalf: {
    backgroundColor: '#F2EFF7', // 低饱和度的紫色背景，用于expenses（#6C5CE7的同色系）
  },
  button: {
    backgroundColor: '#6C5CE7',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  buttonIcon: {
    marginRight: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  bottomNav: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#F8F9FA',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#6C5CE7',
  },
  halfWidthButton: {
    flex: 1,
    paddingHorizontal: 16,
  },
  thirdWidthButton: {
    flex: 1,
    paddingHorizontal: 8,
  },
  firmBottomIconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  firmChartCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  firmChartCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 12,
  },
  firmChartWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#6C5CE7',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButtonAlt: {
    backgroundColor: 'rgba(255, 149, 0, 0.08)',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FF9500',
  },
  secondaryButtonAltText: {
    color: '#FF9500',
    fontSize: 16,
    fontWeight: '600',
  },
  managementButton: {
    width: 44,
    minWidth: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#2D3436',
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
  householdOptionContent: {
    flex: 1,
  },
  householdOptionAddress: {
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
  createHouseholdButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F4FF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 8,
  },
  createHouseholdButtonText: {
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
  modalCloseButton: {
    padding: 4,
  },
  processingModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingModalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    minWidth: 200,
  },
  processingModalText: {
    marginTop: 16,
    fontSize: 16,
    color: '#2D3436',
    fontWeight: '500',
  },
  successModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  successModalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 400,
  },
  successIconContainer: {
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2D3436',
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 16,
    color: '#636E72',
    marginBottom: 32,
  },
  successButtons: {
    width: '100%',
    gap: 12,
  },
  successButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: '#6C5CE7',
    gap: 12,
  },
  successButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6C5CE7',
  },
});

