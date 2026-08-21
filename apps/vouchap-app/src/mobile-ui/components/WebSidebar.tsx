/**
 * Web 端左侧栏：品牌、空间选择、模块入口、Chat 两个按钮、用户信息。
 * 仅用于 Platform.OS === 'web'，由 _layout 包裹主内容区展示。
 */
import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
} from 'react-native';

import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getCurrentUser, getCurrentSpace } from '@/lib/auth';
import { getPendingInvitationsForUser, subscribePendingInvitationsRealtime } from '@/lib/space-invitations';
import { getPendingInviteesForEmail } from '@/lib/firm-clients';
import { Space, User } from '@/types';
import { showAiInventory, showTaxFiling } from '@/lib/feature-flags';

const SIDEBAR_WIDTH = 240;
const HIDE_SIDEBAR_ROUTES = [
  'login',
  'register',
  'reset-password',
  'set-password',
  'setup-space',
  'handle-invitations',
  'auth',
  'invite',
];

export function shouldShowWebSidebar(pathname: string): boolean {
  if (Platform.OS !== 'web') return false;
  const first = pathname.replace(/^\//, '').split('/')[0] || 'index';
  return !HIDE_SIDEBAR_ROUTES.includes(first);
}

interface NavItem {
  path: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  match?: (path: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: 'grid-outline', match: (p) => p === '/' || p === '' },
  { path: '/receipts', label: 'Expenses', icon: 'document-text-outline', match: (p) => p.startsWith('/receipts') || p.startsWith('/receipt-details') || p.startsWith('/receipt-items') },
  { path: '/invoices', label: 'Income', icon: 'arrow-up-circle-outline', match: (p) => p.startsWith('/invoices') || p.startsWith('/invoice-details') },
];

export default function WebSidebar() {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const [currentSpace, setCurrentSpaceState] = useState<Space | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [pendingInvitationsCount, setPendingInvitationsCount] = useState(0);
  const [pendingClaimCount, setPendingClaimCount] = useState(0);
  const [spaceLoaded, setSpaceLoaded] = useState(false);

  const loadData = useCallback(async (forceRefresh = false) => {
    try {
      const [spaceData, userData, invitations] = await Promise.all([
        getCurrentSpace(forceRefresh),
        getCurrentUser(forceRefresh),
        getPendingInvitationsForUser().catch(() => []),
      ]);
      setCurrentSpaceState(spaceData ?? null);
      setUser(userData ?? null);
      setPendingInvitationsCount(invitations?.length ?? 0);
      if (userData?.email) {
        const { list: claimList } = await getPendingInviteesForEmail(userData.email).catch(() => ({ list: [] }));
        setPendingClaimCount(claimList?.length ?? 0);
      } else {
        setPendingClaimCount(0);
      }
    } catch (e) {
      console.error('WebSidebar loadData:', e);
    } finally {
      setSpaceLoaded(true);
    }
  }, []);

  // 初始加载 + 路由变化时刷新
  useEffect(() => {
    loadData(true);
  }, [loadData, pathname]);

  // management 保存空间信息后：刷新当前 space 图像/字段
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handler = () => {
      loadData(true).catch(() => {});
    };
    window.addEventListener('vouchap_space_updated', handler);
    return () => window.removeEventListener('vouchap_space_updated', handler);
  }, [loadData]);

  // management 保存用户信息后：刷新当前用户 logo/name/email
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handler = () => {
      loadData(true).catch(() => {});
    };
    window.addEventListener('vouchap_user_updated', handler);
    return () => window.removeEventListener('vouchap_user_updated', handler);
  }, [loadData]);

  // Web 端：Supabase Realtime 订阅，邀请数据变化时刷新角标
  useEffect(() => {
    if (Platform.OS !== 'web' || !user?.email) return;
    const refreshCount = () => {
      getPendingInvitationsForUser()
        .then((inv) => setPendingInvitationsCount(inv.length))
        .catch(() => {});
    };
    const unsubscribe = subscribePendingInvitationsRealtime(user.email, refreshCount);
    return unsubscribe;
  }, [Platform.OS, user?.email]);

  const isActive = (item: NavItem) => {
    if (item.match) return item.match(pathname);
    return pathname === item.path || pathname.startsWith(item.path + '/');
  };

  return (
    <View style={styles.sidebar}>
      {/* 品牌：仅 Web 大屏左侧栏使用 logo3；其余页面用 logo.png */}
      <View style={styles.brand}>
        <Image
          source={require('../../../assets/logo3.png')}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <Text style={styles.brandText}>Vouchap</Text>
      </View>

      {/* 空间与主导航整体下移，为品牌区留出视觉空间 */}
      <View style={styles.mainNavSection}>
      {/* 空间名称：点击进入管理页（与底部个人信息一致） */}
      <TouchableOpacity
        style={styles.spaceButton}
        onPress={() => router.push('/management')}
        activeOpacity={0.7}
      >
        {currentSpace?.logoUrl ? (
          <Image
            source={{ uri: currentSpace.logoUrl }}
            style={styles.spaceIconImage}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.sidebarLogoPlaceholderSquare}>
            <Ionicons name="business-outline" size={24} color="#6C5CE7" />
          </View>
        )}
        <Text style={styles.spaceText} numberOfLines={1}>
          {currentSpace?.name || 'Select space'}
        </Text>
      </TouchableOpacity>

      {/* 主导航：firm 时完整展示 Insights + Clients + Engagements + Service Catalog（待审核时主内容区为遮罩）；普通 space 展示 Dashboard / Expenses / Income / AI Inventory / 报税 */}
      <View style={styles.nav}>
        {!spaceLoaded ? null : currentSpace?.kind === 'firm' ? (
          <>
            <TouchableOpacity
              style={[styles.navItem, (pathname === '/' || pathname === '') && styles.navItemActive]}
              onPress={() => router.push('/')}
              activeOpacity={0.7}
            >
              <Ionicons name="grid-outline" size={22} color={pathname === '/' || pathname === '' ? '#6C5CE7' : '#2D3436'} />
              <Text style={[styles.navText, (pathname === '/' || pathname === '') && styles.navTextActive]}>
                Insights
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.navItem, pathname.startsWith('/firm/clients') && styles.navItemActive]}
              onPress={() => router.push('/firm/clients')}
              activeOpacity={0.7}
            >
              <Ionicons name="people-outline" size={22} color={pathname.startsWith('/firm/clients') ? '#6C5CE7' : '#2D3436'} />
              <Text style={[styles.navText, pathname.startsWith('/firm/clients') && styles.navTextActive]}>Clients</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.navItem, pathname.startsWith('/firm/engagements') && styles.navItemActive]}
              onPress={() => router.push('/firm/engagements')}
              activeOpacity={0.7}
            >
              <Ionicons name="briefcase-outline" size={22} color={pathname.startsWith('/firm/engagements') ? '#6C5CE7' : '#2D3436'} />
              <Text style={[styles.navText, pathname.startsWith('/firm/engagements') && styles.navTextActive]}>Engagements</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.navItem, pathname.startsWith('/firm/service-catalog') && styles.navItemActive]}
              onPress={() => router.push('/firm/service-catalog')}
              activeOpacity={0.7}
            >
              <Ionicons name="library-outline" size={22} color={pathname.startsWith('/firm/service-catalog') ? '#6C5CE7' : '#2D3436'} />
              <Text style={[styles.navText, pathname.startsWith('/firm/service-catalog') && styles.navTextActive]}>Service Catalog</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {NAV_ITEMS.map((item) => {
              const active = isActive(item);
              return (
                <TouchableOpacity
                  key={item.path}
                  style={[styles.navItem, active && styles.navItemActive]}
                  onPress={() => router.push(item.path as any)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={item.icon}
                    size={22}
                    color={active ? '#6C5CE7' : '#2D3436'}
                  />
                  <Text style={[styles.navText, active && styles.navTextActive]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {showAiInventory && (
              <TouchableOpacity
                style={[styles.navItem, pathname.startsWith('/ai-inventory') && styles.navItemActive]}
                onPress={() => router.push('/ai-inventory')}
                activeOpacity={0.7}
              >
                <Ionicons name="cube-outline" size={22} color={pathname.startsWith('/ai-inventory') ? '#FF9500' : '#2D3436'} />
                <Text style={[styles.navText, pathname.startsWith('/ai-inventory') && styles.navTextAlt]}>
                  AI Inventory
                </Text>
              </TouchableOpacity>
            )}
            {showTaxFiling && (
              <TouchableOpacity
                style={[styles.navItem, pathname.startsWith('/tax-filing') && styles.navItemActive]}
                onPress={() => router.push('/tax-filing')}
                activeOpacity={0.7}
              >
                <Ionicons name="document-text-outline" size={22} color={pathname.startsWith('/tax-filing') ? '#0984e3' : '#2D3436'} />
                <Text style={[styles.navText, pathname.startsWith('/tax-filing') && styles.navTextActive]}>
                  Tax Filing
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
      </View>

      {/* 用户信息卡片：member 邀请 + engagement claim 两个 icon+角标（不同颜色）浮在卡片右上角 */}
      <View style={styles.userCardWrap}>
        <TouchableOpacity
          style={styles.userCard}
          onPress={() => router.push('/management')}
          activeOpacity={0.7}
        >
          <View style={styles.userAvatar}>
            {user?.logoUrl ? (
              <Image source={{ uri: user.logoUrl }} style={styles.userAvatarImage} resizeMode="cover" />
            ) : (
              <View style={styles.sidebarLogoPlaceholderSquare}>
                <Ionicons name="person-outline" size={24} color="#6C5CE7" />
              </View>
            )}
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName} numberOfLines={1}>
              {user?.name || 'User'}
            </Text>
            <Text style={styles.userEmail} numberOfLines={1}>
              {user?.email || ''}
            </Text>
          </View>
        </TouchableOpacity>
        {(pendingInvitationsCount > 0 || pendingClaimCount > 0) && (
          <View style={styles.pendingBadgesRow}>
            {pendingInvitationsCount > 0 && (
              <TouchableOpacity
                style={styles.pendingBadgeFloating}
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
                style={styles.pendingBadgeFloating}
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
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: SIDEBAR_WIDTH,
    minWidth: SIDEBAR_WIDTH,
    backgroundColor: '#fff',
    borderRightWidth: 1,
    borderRightColor: '#E9ECEF',
    paddingVertical: 16,
    paddingHorizontal: 12,
    flex: 0,
    justifyContent: 'space-between',
  },
  brand: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginBottom: 10,
    paddingBottom: 0,
  },
  /** Fixed 96 CSS px mark; logo3 asset is cropped to fill the box. */
  logoImage: {
    width: 96,
    height: 96,
    minWidth: 96,
    minHeight: 96,
    borderRadius: 18,
    alignSelf: 'center',
    marginBottom: 0,
  },
  /** Wordmark under mark */
  brandText: {
    marginTop: 4,
    textAlign: 'center',
    alignSelf: 'stretch',
    fontSize: 22,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: 0.2,
    ...(Platform.OS === 'web'
      ? ({
          fontFamily: 'Poppins, system-ui, sans-serif',
        } as Record<string, unknown>)
      : {}),
  },
  mainNavSection: {
    marginTop: 2,
    flex: 1,
    minHeight: 0,
    flexDirection: 'column',
  },
  spaceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    padding: 10,
    marginBottom: 32,
    gap: 10,
    minHeight: 62,
  },
  spaceIconImage: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#E9ECEF',
  },
  sidebarLogoPlaceholderSquare: {
    width: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    backgroundColor: '#F8F9FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spaceText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: '#2D3436',
  },
  nav: {
    flex: 1,
    gap: 2,
    minHeight: 0,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 10,
  },
  navItemActive: {
    backgroundColor: '#E8F4FD',
  },
  navText: {
    fontSize: 15,
    color: '#2D3436',
  },
  navTextActive: {
    color: '#6C5CE7',
    fontWeight: '600',
  },
  navTextAlt: {
    color: '#FF9500',
    fontWeight: '600',
  },
  userCardWrap: {
    position: 'relative',
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    padding: 10,
    gap: 10,
  },
  userAvatar: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#F8F9FA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  pendingBadgesRow: {
    position: 'absolute',
    top: -6,
    right: -6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  pendingBadgeFloating: {
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
  invitationsBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
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
  userInitial: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  userInfo: { flex: 1, minWidth: 0 },
  userName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3436',
  },
  userEmail: {
    fontSize: 12,
    color: '#636E72',
    marginTop: 2,
  },
});
