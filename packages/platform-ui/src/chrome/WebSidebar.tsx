/**
 * Web left rail chrome: brand, current space → Management, user card → Management.
 * Nav items are product business pages only (injected via getSidebarNavItems).
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
import {
  getCurrentUser,
  getCurrentSpace,
  getPendingInvitationsForUser,
  subscribePendingInvitationsRealtime,
  type PlatformSpace,
  type PlatformUser,
} from '@adaven/platform-core';

import { getProductUi } from '../product';

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

export default function WebSidebar() {
  const product = getProductUi();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const [currentSpace, setCurrentSpaceState] = useState<PlatformSpace | null>(null);
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [pendingInvitationsCount, setPendingInvitationsCount] = useState(0);
  const [pendingClaimCount, setPendingClaimCount] = useState(0);
  const [spaceLoaded, setSpaceLoaded] = useState(false);

  const navItems: NavItem[] = (product.getSidebarNavItems?.(currentSpace) ?? []).map((item) => ({
    path: item.path,
    label: item.label,
    icon: item.icon as keyof typeof Ionicons.glyphMap,
    match: item.match,
  }));

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
      if (userData?.email && product.getSidebarClaimCount) {
        setPendingClaimCount(await product.getSidebarClaimCount(userData.email).catch(() => 0));
      } else {
        setPendingClaimCount(0);
      }
    } catch (e) {
      console.error('WebSidebar loadData:', e);
    } finally {
      setSpaceLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadData(true);
  }, [loadData, pathname]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handler = () => {
      loadData(true).catch(() => {});
    };
    window.addEventListener('adaven_space_updated', handler);
    window.addEventListener('adaven_user_updated', handler);
    return () => {
      window.removeEventListener('adaven_space_updated', handler);
      window.removeEventListener('adaven_user_updated', handler);
    };
  }, [loadData]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !user?.email) return;
    const refreshCount = () => {
      getPendingInvitationsForUser()
        .then((inv) => setPendingInvitationsCount(inv.length))
        .catch(() => {});
    };
    const unsubscribe = subscribePendingInvitationsRealtime(user.email, refreshCount);
    return unsubscribe;
  }, [user?.email]);

  const isActive = (item: NavItem) => {
    if (item.match) return item.match(pathname);
    return pathname === item.path || pathname.startsWith(item.path + '/');
  };

  return (
    <View style={styles.sidebar}>
      <View style={styles.brand}>
        <Image
          source={product.sidebarLogo ?? product.logo}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <Text style={styles.brandText}>{product.productName}</Text>
      </View>

      <View style={styles.mainNavSection}>
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
            {spaceLoaded ? currentSpace?.name || 'Select space' : '…'}
          </Text>
        </TouchableOpacity>

        <View style={styles.nav}>
          {navItems.map((item) => {
            const active = isActive(item);
            return (
              <TouchableOpacity
                key={item.path}
                style={[styles.navItem, active && styles.navItemActive]}
                onPress={() => router.push(item.path as any)}
                activeOpacity={0.7}
              >
                <Ionicons name={item.icon} size={22} color={active ? '#6C5CE7' : '#2D3436'} />
                <Text style={[styles.navText, active && styles.navTextActive]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

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
            {pendingClaimCount > 0 && product.sidebarClaimRoute ? (
              <TouchableOpacity
                style={styles.pendingBadgeFloating}
                onPress={() => router.push(product.sidebarClaimRoute as any)}
                activeOpacity={0.7}
              >
                <Ionicons name="briefcase-outline" size={24} color="#6C5CE7" />
                <View style={styles.claimBadge}>
                  <Text style={styles.invitationsBadgeText}>
                    {pendingClaimCount > 99 ? '99+' : pendingClaimCount}
                  </Text>
                </View>
              </TouchableOpacity>
            ) : null}
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
  },
  logoImage: {
    width: 96,
    height: 96,
    minWidth: 96,
    minHeight: 96,
    borderRadius: 18,
    alignSelf: 'center',
  },
  brandText: {
    marginTop: 4,
    textAlign: 'center',
    alignSelf: 'stretch',
    fontSize: 22,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: 0.2,
    ...(Platform.OS === 'web'
      ? ({ fontFamily: 'Poppins, system-ui, sans-serif' } as Record<string, unknown>)
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
