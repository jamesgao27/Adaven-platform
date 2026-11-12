/**
 * Tax Filing (client): Service orders / projects list. English copy.
 * Reuses mobile receipts list style: SectionList + row layout (no card/grid view).
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  ScrollView,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { showTaxFiling } from '@/lib/feature-flags';
import { getCurrentSpace } from '@/lib/auth';
import EngagementConsentModal from '@/components/EngagementConsentModal';
import {
  getClientOrdersForClientSpace,
  confirmOrderAndCreateProjectTodos,
  updateOrderStatus,
  hideOrderForClientSpace,
  unhideOrderForClientSpace,
  type FirmOrderForClient,
} from '@/lib/firm';
import { preflightFirmEngagementConfirmOrAlert } from '@/lib/firm-engagement-preflight-ui';
import { showToast } from '@/lib/toast';
import { confirmDestructive } from '../../../shared-logic/alertWeb';
import { ServiceCatalogAddEntryTile } from '@/components/ServiceCatalogShared';
import { PinToTopIcon } from '@/components/ProjectListCardAndRow';
import { useClientSpaceTaxFilingListRealtime } from '../../lib/engagement-realtime';
import { useWebViewportKind } from '../../lib/web-viewport';

const PINNED_ORDER_IDS_KEY = 'tax_filing_pinned_order_ids';

/** In-memory fallback for pinned IDs (跨平台、安全，不依赖原生 AsyncStorage）。 */
const memoryFallback = new Map<string, string>();

async function safeGetItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      return localStorage.getItem(key);
    } catch {
      return memoryFallback.get(key) ?? null;
    }
  }
  // 非 Web 端一律使用内存 fallback，避免依赖原生 AsyncStorage（在 Expo Go / 未链接场景下会为 null）。
  return memoryFallback.get(key) ?? null;
}
async function safeSetItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(key, value);
    } catch {
      memoryFallback.set(key, value);
    }
    return;
  }
  // 非 Web 端：仅使用内存 fallback，不调用原生 AsyncStorage。
  memoryFallback.set(key, value);
}

const STAGE_LABEL: Record<string, string> = {
  onboarding: 'Onboarding',
  processing: 'Processing',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// Engagement 状态标签：深底色 + 白字色
const STAGE_SOLID: Record<string, string> = {
  onboarding: '#E67E22',
  processing: '#29B6F6',
  completed: '#00B894',
  cancelled: '#B2BEC3',
};

import { deriveTaxSeasonYear, getTaxSeasonColor, getTaxSeasonBgColor } from '@/lib/tax-season-colors';

/** 税季标签颜色（与报税项目 Info、订单详情、WEB 列表一致） */

/** Appends Service Marketplace row after active engagements (mobile SectionList). */
const TAX_FILING_MARKETPLACE_ROW_ID = '__tax_filing_service_marketplace__' as const;
type TaxFilingSectionItem = FirmOrderForClient | { id: typeof TAX_FILING_MARKETPLACE_ROW_ID };
type SectionData = { title: string; monthKey: string; data: TaxFilingSectionItem[]; count?: number };

function isMarketplaceSectionRow(item: TaxFilingSectionItem): item is { id: typeof TAX_FILING_MARKETPLACE_ROW_ID } {
  return item.id === TAX_FILING_MARKETPLACE_ROW_ID;
}

function getTaxSeasonYear(order: FirmOrderForClient): number | null {
  // 优先使用项目上的显式 taxSeasonYear（来自 shared-logic/firm.ts 的 project.tax_season_year）
  if (order.taxSeasonYear != null) {
    return order.taxSeasonYear;
  }
  const d = order.dueAt || order.createdAt || null;
  if (!d) return null;
  return deriveTaxSeasonYear(d);
}

function getOrderDisplayName(order: FirmOrderForClient, isOnboarding: boolean): string {
  return isOnboarding ? (order.skuName ?? 'Service order') : (order.projectName ?? order.skuName ?? 'Project');
}

function isAwaitingFirmConfirmation(order: FirmOrderForClient): boolean {
  return (
    order.status === 'onboarding' &&
    String((order as any).requestOrigin ?? 'firm_manual') === 'client_marketplace'
  );
}

export default function TaxFilingScreen() {
  const { isDesktopWeb } = useWebViewportKind();
  if (isDesktopWeb) {
    return <TaxFilingWebScreen />;
  }
  return <TaxFilingMobileScreen />;
}

function TaxFilingMobileScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [orders, setOrders] = useState<FirmOrderForClient[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [consentVisible, setConsentVisible] = useState(false);
  const [pendingConfirmOrder, setPendingConfirmOrder] = useState<FirmOrderForClient | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [pinnedOrderIds, setPinnedOrderIds] = useState<string[]>([]);
  const [hidingId, setHidingId] = useState<string | null>(null);
  const [unhidingId, setUnhidingId] = useState<string | null>(null);
  const [hiddenCollapsed, setHiddenCollapsed] = useState(true);

  const loadOrders = useCallback(async () => {
    const space = await getCurrentSpace(true);
    if (!space?.id) return [];
    return getClientOrdersForClientSpace(space.id);
  }, []);

  const refreshOrdersFromRealtime = useCallback(async () => {
    const next = await loadOrders();
    setOrders(next);
  }, [loadOrders]);
  useClientSpaceTaxFilingListRealtime(showTaxFiling, refreshOrdersFromRealtime);

  useEffect(() => {
    if (!showTaxFiling) {
      router.replace('/');
      return;
    }
    (async () => {
      setLoading(true);
      setOrders(await loadOrders());
      setLoading(false);
    })();
  }, [showTaxFiling, loadOrders, router]);

  useEffect(() => {
    (async () => {
      const raw = await safeGetItem(PINNED_ORDER_IDS_KEY);
      if (raw) {
        try {
          const ids = JSON.parse(raw) as string[];
          if (Array.isArray(ids)) setPinnedOrderIds(ids);
        } catch (_) {}
      }
    })();
  }, []);

  const sortedOrders = useMemo(() => {
    const visible = orders.filter((o) => !o.hiddenFromClientAt);
    return [...visible].sort((a, b) => {
      const pa = pinnedOrderIds.includes(a.id);
      const pb = pinnedOrderIds.includes(b.id);
      if (pa && !pb) return -1;
      if (!pa && pb) return 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }, [orders, pinnedOrderIds]);

  const hiddenOrders = useMemo(() => {
    return orders
      .filter((o) => o.hiddenFromClientAt)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [orders]);

  const sections = useMemo((): SectionData[] => {
    const activeData: TaxFilingSectionItem[] =
      loading && sortedOrders.length === 0
        ? []
        : sortedOrders.length > 0
          ? [...sortedOrders, { id: TAX_FILING_MARKETPLACE_ROW_ID }]
          : [{ id: TAX_FILING_MARKETPLACE_ROW_ID }];
    const out: SectionData[] = [{ title: 'Service Engagements', monthKey: 'active', data: activeData }];
    if (hiddenOrders.length > 0) {
      out.push({
        title: 'Recycle bin',
        monthKey: 'hidden',
        data: hiddenOrders,
        count: hiddenOrders.length,
      });
    }
    return out;
  }, [loading, sortedOrders, hiddenOrders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setOrders(await loadOrders());
    setRefreshing(false);
  }, [loadOrders]);

  const handleTogglePin = useCallback(async (orderId: string) => {
    setPinnedOrderIds((prev) => {
      const next = prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId];
      safeSetItem(PINNED_ORDER_IDS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const performConfirmOrder = async (order: FirmOrderForClient) => {
    setConfirmingId(order.id);
    const pre = await preflightFirmEngagementConfirmOrAlert(order.id, router);
    if (!pre) {
      setConfirmingId(null);
      return;
    }
    const { error } = await confirmOrderAndCreateProjectTodos(order.id);
    setConfirmingId(null);
    if (error) return;
    setOrders(await loadOrders());
    router.push(`/firm/engagement/${order.id}`);
  };

  const handleConfirmOrder = (order: FirmOrderForClient) => {
    if (confirmingId) return;
    setPendingConfirmOrder(order);
    setConsentVisible(true);
  };

  const handleRejectOrder = useCallback((order: FirmOrderForClient) => {
    confirmDestructive(
      'Reject order',
      'Are you sure you want to reject this order? You can’t undo this.',
      async () => {
        setRejectingId(order.id);
        const { error } = await updateOrderStatus(order.id, 'cancelled');
        setRejectingId(null);
        if (error) {
          showToast(error.message ?? 'Failed to reject', 'error');
          return;
        }
        showToast('Order rejected', 'success');
        setOrders(await loadOrders());
      },
      { confirmLabel: 'Reject order' },
    );
  }, [loadOrders]);

  const hideOrderForClient = useCallback(async (orderId: string) => {
    setHidingId(orderId);
    const { error } = await hideOrderForClientSpace(orderId);
    setHidingId(null);
    if (error) {
      showToast(error.message ?? 'Failed to hide', 'error');
      return;
    }
    setOrders(await loadOrders());
  }, [loadOrders]);

  const unhideOrderForClient = useCallback(async (orderId: string) => {
    setUnhidingId(orderId);
    const { error } = await unhideOrderForClientSpace(orderId);
    setUnhidingId(null);
    if (error) {
      showToast(error.message ?? 'Failed to unhide', 'error');
      return;
    }
    setOrders(await loadOrders());
  }, [loadOrders]);

  const goToTodos = (order: FirmOrderForClient) => {
    router.push(`/firm/engagement/${order.id}`);
  };

  const renderItem = useCallback(
    ({ item, section }: { item: TaxFilingSectionItem; section: SectionData }) => {
      if (section.monthKey === 'active' && isMarketplaceSectionRow(item)) {
        return (
          <View style={{ marginBottom: 8 }}>
            <ServiceCatalogAddEntryTile
              variant="list"
              label="Service Marketplace"
              onPress={() => router.push('/tax-filing/service-catalog')}
            />
          </View>
        );
      }
      const order = item as FirmOrderForClient;
      const isHiddenSection = section.monthKey === 'hidden';
      if (isHiddenSection && hiddenCollapsed) return null;
      const isOnboarding = order.status === 'onboarding';
      const awaitingFirmConfirmation = isAwaitingFirmConfirmation(order);
      const isCancelled = order.status === 'cancelled';
      const displayName = getOrderDisplayName(order, isOnboarding);
      const taxSeasonYear = getTaxSeasonYear(order);
      const progress =
        !isOnboarding && !isCancelled && (order.taskTotal ?? 0) > 0
          ? { completed: order.taskCompleted ?? 0, total: order.taskTotal ?? 0 }
          : null;
      const progressPercent =
        progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

      const canLongPressPin = !isHiddenSection && !isCancelled;
      const isPinned = pinnedOrderIds.includes(order.id);

      return (
        <View style={[styles.receiptItem, styles.receiptItemWrap]}>
          {!isHiddenSection && isPinned ? (
            <View style={styles.receiptPinnedBadge} pointerEvents="none">
              <View style={styles.receiptPinnedTriangle} />
              <View style={styles.receiptPinnedIconWrap}>
                <PinToTopIcon size={18} color="#FFFFFF" />
              </View>
            </View>
          ) : null}
          <View style={styles.receiptContent}>
            <Pressable
              onPress={() => goToTodos(order)}
              onLongPress={canLongPressPin ? () => handleTogglePin(order.id) : undefined}
              delayLongPress={450}
              accessibilityHint={canLongPressPin ? 'Long press to pin or unpin this engagement' : undefined}
              style={({ pressed }) => (pressed ? styles.receiptPressablePressed : null)}
            >
              <View>
                <View style={styles.firstRow}>
                  <View style={styles.firstRowLeft}>
                    {taxSeasonYear != null && (
                      <View
                        style={[
                          styles.taxSeasonPill,
                          { backgroundColor: getTaxSeasonBgColor(taxSeasonYear) },
                        ]}
                      >
                        <Text
                          style={[
                            styles.taxSeasonText,
                            { color: getTaxSeasonColor(taxSeasonYear) },
                          ]}
                        >
                          {taxSeasonYear}
                        </Text>
                      </View>
                    )}
                    <Text style={[styles.storeName, isCancelled && styles.mutedText]} numberOfLines={1}>
                      {displayName}
                    </Text>
                  </View>
                  {isHiddenSection ? <View style={styles.receiptRecycleTitleSpacer} pointerEvents="none" /> : null}
                </View>
                <View style={styles.secondRow}>
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: STAGE_SOLID[order.status] ?? '#636E72' },
                    ]}
                  >
                    <Text style={[styles.statusText, { color: '#FFFFFF' }]}>
                      {STAGE_LABEL[order.status] ?? order.status}
                    </Text>
                  </View>
                  {order.firmName ? (
                    <Text style={styles.footerText}>by {order.firmName}</Text>
                  ) : null}
                </View>
                {progress ? (
                  <View style={styles.progressRow}>
                    <View style={styles.progressBarTrack}>
                      <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
                    </View>
                    <Text style={styles.progressDetailText}>
                      {progress.completed}/{progress.total} • {progressPercent}%
                    </Text>
                  </View>
                ) : awaitingFirmConfirmation ? (
                  <View style={[styles.progressRow, styles.progressRowCentered]}>
                    <View style={styles.progressLabelPill}>
                      <Text style={styles.progressLabelPillText}>Awaiting firm confirmation</Text>
                    </View>
                  </View>
                ) : null}
              </View>
            </Pressable>
            {isOnboarding && !isCancelled && !isHiddenSection && !awaitingFirmConfirmation ? (
              <View style={styles.actionRow}>
                <>
                  <TouchableOpacity
                    style={styles.rejectBtn}
                    onPress={() => handleRejectOrder(order)}
                    disabled={rejectingId === order.id}
                  >
                    {rejectingId === order.id ? (
                      <ActivityIndicator size="small" color="#636E72" />
                    ) : (
                      <Text style={styles.rejectBtnText}>Reject</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.acceptBtn, confirmingId === order.id && styles.acceptBtnDisabled]}
                    onPress={() => handleConfirmOrder(order)}
                    disabled={confirmingId === order.id}
                  >
                    {confirmingId === order.id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.acceptBtnText}>Accept and Start</Text>
                    )}
                  </TouchableOpacity>
                </>
              </View>
            ) : null}
            {!isHiddenSection && isCancelled ? (
              <View style={styles.progressRow}>
                <TouchableOpacity
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => hideOrderForClient(order.id)}
                  disabled={hidingId === order.id}
                  style={styles.settingsIcon}
                >
                  {hidingId === order.id ? (
                    <ActivityIndicator size="small" color="#C0392B" />
                  ) : (
                    <Ionicons name="trash-outline" size={20} color="#C0392B" />
                  )}
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
          {isHiddenSection ? (
            <View style={styles.receiptRestoreBtnOverlay} pointerEvents="box-none">
              <TouchableOpacity
                style={styles.unhideBtn}
                onPress={() => unhideOrderForClient(order.id)}
                disabled={unhidingId === order.id}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Restore to Service Engagements"
              >
                {unhidingId === order.id ? (
                  <ActivityIndicator size="small" color="#95A5A6" />
                ) : (
                  <Ionicons name="arrow-undo-outline" size={22} color="#95A5A6" />
                )}
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      );
    },
    [
      router,
      confirmingId,
      rejectingId,
      hidingId,
      unhidingId,
      hiddenCollapsed,
      pinnedOrderIds,
      handleConfirmOrder,
      handleRejectOrder,
      handleTogglePin,
      hideOrderForClient,
      unhideOrderForClient,
    ],
  );

  const renderSectionHeader = useCallback(({ section }: { section: SectionData }) => {
    if (!section.title) return null;
    if (section.monthKey === 'hidden') {
      return (
        <TouchableOpacity
          style={styles.sectionHeader}
          onPress={() => setHiddenCollapsed((v) => !v)}
          activeOpacity={0.8}
        >
          <View style={styles.recycleBinHeaderRow}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Ionicons
              name={hiddenCollapsed ? 'chevron-down' : 'chevron-up'}
              size={18}
              color="#636E72"
              style={styles.recycleBinChevron}
            />
          </View>
        </TouchableOpacity>
      );
    }
    const orderCount =
      section.monthKey === 'active'
        ? section.data.filter((x) => !isMarketplaceSectionRow(x)).length
        : section.data.length;
    return (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <Text style={styles.sectionCount}>{orderCount} orders</Text>
      </View>
    );
  }, [hiddenCollapsed]);

  if (!showTaxFiling) return null;

  return (
    <View style={styles.container}>
      <EngagementConsentModal
        visible={consentVisible}
        loading={Boolean(confirmingId)}
        onClose={() => {
          if (!confirmingId) {
            setConsentVisible(false);
            setPendingConfirmOrder(null);
          }
        }}
        onConfirm={() => {
          if (!pendingConfirmOrder) return;
          setConsentVisible(false);
          void performConfirmOrder(pendingConfirmOrder).finally(() => {
            setPendingConfirmOrder(null);
          });
        }}
      />
      <SectionList<TaxFilingSectionItem, SectionData>
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={
          sections.every((s) => s.data.length === 0) ? styles.emptyList : styles.listContent
        }
        ListEmptyComponent={
          loading && orders.length === 0 ? (
            <View style={styles.emptyContainer}>
              <ActivityIndicator size="large" color="#6C5CE7" />
              <Text style={styles.emptyText}>Loading...</Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="document-text-outline" size={64} color="#BDC3C7" />
              <Text style={styles.emptyText}>No orders yet</Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  toolbarSlot: {
    height: 52,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
    justifyContent: 'center',
  },
  header: {
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'transparent',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2D3436',
  },
  receiptItem: {
    backgroundColor: '#fff',
    paddingTop: 14,
    paddingBottom: 10,
    paddingHorizontal: 12,
    paddingLeft: 24,
    borderBottomWidth: 0,
    borderBottomColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    borderRadius: 12,
    // 轻微底部阴影，让卡片与背景分层
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  // Recycle restore overlays without nesting Touchables inside Pressable (fixes long-press pin).
  receiptItemWrap: {
    position: 'relative',
  },
  receiptPressablePressed: {
    opacity: 0.85,
  },
  receiptRecycleTitleSpacer: {
    width: 36,
  },
  receiptRestoreBtnOverlay: {
    position: 'absolute',
    top: 14,
    right: 12,
    zIndex: 2,
  },
  receiptPinnedBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 72,
    height: 72,
    overflow: 'hidden',
    zIndex: 4,
    borderTopLeftRadius: 12,
  },
  receiptPinnedTriangle: {
    position: 'absolute',
    top: -36,
    left: -36,
    width: 72,
    height: 72,
    backgroundColor: '#ff7711',
    transform: [{ rotate: '-45deg' }],
  },
  receiptPinnedIconWrap: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptContent: {
    flex: 1,
  },
  firstRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  firstRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  firstRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  storeName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3436',
    marginRight: 12,
  },
  mutedText: {
    color: '#95A5A6',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  taxSeasonPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#F3F4FF',
  },
  taxSeasonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2D3436',
  },
  settingsIcon: {
    padding: 4,
  },
  secondRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerText: {
    fontSize: 12,
    color: '#636E72',
    flexShrink: 1,
  },
  progressText: {
    fontSize: 14,
    color: '#6C5CE7',
    fontWeight: '500',
  },
  dateText: {
    fontSize: 14,
    color: '#636E72',
    marginLeft: 'auto',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    minHeight: 30,
    marginTop: 4,
  },
  progressRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    minHeight: 30,
  },
  progressRowCentered: {
    justifyContent: 'center',
  },
  progressBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#00B894',
  },
  progressDetailText: {
    fontSize: 12,
    color: '#636E72',
    fontWeight: '500',
  },
  progressLabelPill: {
    maxWidth: '90%',
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressLabelPillText: {
    fontSize: 12,
    color: '#636E72',
    fontWeight: '600',
  },
  acceptBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    minHeight: 30,
    borderRadius: 10,
    backgroundColor: '#6C5CE7',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  acceptBtnDisabled: {
    opacity: 0.7,
  },
  acceptBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  rejectBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    minHeight: 30,
    borderRadius: 10,
    backgroundColor: '#FFE5E5',
    justifyContent: 'center',
    alignItems: 'center',
    // 更轻的阴影，避免过重的红色块感
    ...(Platform.OS === 'web' || Platform.OS === 'ios'
      ? { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2 }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 1 } : {}),
  },
  rejectBtnText: {
    fontSize: 14,
    color: '#C0392B',
    fontWeight: '600',
  },
  unhideBtn: {
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionHeader: {
    backgroundColor: '#F8F9FA',
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recycleBinHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
  },
  recycleBinChevron: {
    marginTop: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3436',
  },
  sectionCount: {
    fontSize: 14,
    color: '#636E72',
  },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 0,
    paddingBottom: 100,
  },
  emptyList: {
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 100,
  },
  emptyText: {
    fontSize: 18,
    color: '#636E72',
    marginTop: 16,
    fontWeight: '600',
  },
});

// ────────────────────────────────────────────────────────────────
// Web 端：沿用 commit faefe4ba0c56ac2a55037feea311f9a19a44cc76 的卡片/Grid 列表设计
// ────────────────────────────────────────────────────────────────

import {
  ProjectListCard,
  ProjectListRow,
  GRID_GAP as GRID_GAP_WEB,
  projectListStyles as projectListStylesWeb,
  type ProjectListCardItem as ProjectListCardItemWeb,
} from '@/components/ProjectListCardAndRow';
import { useWindowDimensions } from 'react-native';

const CARD_MAX_WIDTH_WEB = 320;
const PINNED_ORDER_IDS_KEY_WEB = 'tax_filing_pinned_order_ids_web';

const memoryFallbackWeb = new Map<string, string>();
const useNativeAsyncStorageWeb = Platform.OS !== 'web' && Constants.appOwnership !== 'expo';

async function safeGetItemWeb(key: string): Promise<string | null> {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      return localStorage.getItem(key);
    } catch {
      return memoryFallbackWeb.get(key) ?? null;
    }
  }
  if (!useNativeAsyncStorageWeb) {
    return memoryFallbackWeb.get(key) ?? null;
  }
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    return await AsyncStorage.getItem(key);
  } catch {
    return memoryFallbackWeb.get(key) ?? null;
  }
}

async function safeSetItemWeb(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(key, value);
    } catch {
      memoryFallbackWeb.set(key, value);
    }
    return;
  }
  if (!useNativeAsyncStorageWeb) {
    memoryFallbackWeb.set(key, value);
    return;
  }
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem(key, value);
  } catch {
    memoryFallbackWeb.set(key, value);
  }
}

const STAGE_LABEL_WEB: Record<string, string> = {
  onboarding: 'Onboarding',
  processing: 'Processing',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// Web 列表状态标签：深底色 + 白字色（在 ProjectListCardAndRow 中使用）
const STAGE_COLOR_WEB: Record<string, string> = {
  onboarding: '#E67E22',
  processing: '#29B6F6',
  completed: '#00B894',
  cancelled: '#B2BEC3',
};

const TAX_SEASON_COLORS_WEB = [
  '#6C5CE7', '#E17055', '#00B894', '#0984E3', '#FDCB6E',
  '#E84393', '#00CEC9', '#74B9FF', '#A29BFE', '#FD79A8',
];

function getTaxSeasonColorWeb(year: number): string {
  return TAX_SEASON_COLORS_WEB[Math.abs(year) % 10] ?? TAX_SEASON_COLORS_WEB[0];
}

type ViewModeWeb = 'grid' | 'list';

function TaxFilingWebScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<FirmOrderForClient[]>([]);
  const [viewMode, setViewMode] = useState<ViewModeWeb>('grid');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [consentVisible, setConsentVisible] = useState(false);
  const [pendingConfirmOrder, setPendingConfirmOrder] = useState<FirmOrderForClient | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [pinnedOrderIds, setPinnedOrderIds] = useState<string[]>([]);
  const [hidingId, setHidingId] = useState<string | null>(null);
  const [unhidingId, setUnhidingId] = useState<string | null>(null);
  const [hiddenCollapsedWeb, setHiddenCollapsedWeb] = useState(true);

  const loadOrders = useCallback(async () => {
    const space = await getCurrentSpace(true);
    if (!space?.id) return [];
    return getClientOrdersForClientSpace(space.id);
  }, []);

  const refreshOrdersFromRealtimeWeb = useCallback(async () => {
    const next = await loadOrders();
    setOrders(next);
  }, [loadOrders]);
  useClientSpaceTaxFilingListRealtime(showTaxFiling, refreshOrdersFromRealtimeWeb);

  useEffect(() => {
    if (!showTaxFiling) {
      router.replace('/');
      return;
    }
    (async () => {
      setLoading(true);
      setOrders(await loadOrders());
      setLoading(false);
    })();
  }, [showTaxFiling, loadOrders, router]);

  useEffect(() => {
    (async () => {
      const raw = await safeGetItemWeb(PINNED_ORDER_IDS_KEY_WEB);
      if (raw) {
        try {
          const ids = JSON.parse(raw) as string[];
          if (Array.isArray(ids)) setPinnedOrderIds(ids);
        } catch (_) {}
      }
    })();
  }, []);

  const sortedOrders = useMemo(() => {
    const visible = orders.filter((o) => !o.hiddenFromClientAt);
    return [...visible].sort((a, b) => {
      const pa = pinnedOrderIds.includes(a.id);
      const pb = pinnedOrderIds.includes(b.id);
      if (pa && !pb) return -1;
      if (!pa && pb) return 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }, [orders, pinnedOrderIds]);

  const hiddenOrders = useMemo(() => {
    return orders
      .filter((o) => o.hiddenFromClientAt)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [orders]);

  const handleTogglePin = useCallback(async (orderId: string) => {
    setPinnedOrderIds((prev) => {
      const next = prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId];
      safeSetItemWeb(PINNED_ORDER_IDS_KEY_WEB, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const performConfirmOrder = async (order: FirmOrderForClient) => {
    setConfirmingId(order.id);
    const pre = await preflightFirmEngagementConfirmOrAlert(order.id, router);
    if (!pre) {
      setConfirmingId(null);
      return;
    }
    const { error } = await confirmOrderAndCreateProjectTodos(order.id);
    setConfirmingId(null);
    if (error) return;
    setOrders(await loadOrders());
    router.push(`/firm/engagement/${order.id}`);
  };

  const handleConfirmOrder = (order: FirmOrderForClient) => {
    if (confirmingId) return;
    setPendingConfirmOrder(order);
    setConsentVisible(true);
  };

  const handleRejectOrder = useCallback((order: FirmOrderForClient) => {
    confirmDestructive(
      'Reject order',
      'Are you sure you want to reject this order? You can’t undo this.',
      async () => {
        setRejectingId(order.id);
        const { error } = await updateOrderStatus(order.id, 'cancelled');
        setRejectingId(null);
        if (error) {
          showToast(error.message ?? 'Failed to reject', 'error');
          return;
        }
        showToast('Order rejected', 'success');
        setOrders(await loadOrders());
      },
      { confirmLabel: 'Reject order' },
    );
  }, [loadOrders]);

  const hideOrderForClient = useCallback(async (orderId: string) => {
    setHidingId(orderId);
    const { error } = await hideOrderForClientSpace(orderId);
    setHidingId(null);
    if (error) {
      showToast(error.message ?? 'Failed to hide', 'error');
      return;
    }
    setOrders(await loadOrders());
  }, [loadOrders]);

  const unhideOrderForClient = useCallback(async (orderId: string) => {
    setUnhidingId(orderId);
    const { error } = await unhideOrderForClientSpace(orderId);
    setUnhidingId(null);
    if (error) {
      showToast(error.message ?? 'Failed to unhide', 'error');
      return;
    }
    setOrders(await loadOrders());
  }, [loadOrders]);

  const goToTodos = (order: FirmOrderForClient) => {
    router.push(`/firm/engagement/${order.id}`);
  };

  const goToInfo = (order: FirmOrderForClient) => {
    router.push(`/firm/engagement/${order.id}?tab=info&edit=1`);
  };

  const numColumns = Math.max(2, Math.floor((windowWidth - 48) / (200 + GRID_GAP_WEB)));
  const cardWidth = Math.min(
    CARD_MAX_WIDTH_WEB,
    (windowWidth - 48 - GRID_GAP_WEB * (numColumns - 1)) / numColumns,
  );

  if (!showTaxFiling) return null;

  return (
    <ScrollView style={stylesWeb.container} contentContainerStyle={stylesWeb.content}>
      <EngagementConsentModal
        visible={consentVisible}
        loading={Boolean(confirmingId)}
        onClose={() => {
          if (!confirmingId) {
            setConsentVisible(false);
            setPendingConfirmOrder(null);
          }
        }}
        onConfirm={() => {
          if (!pendingConfirmOrder) return;
          setConsentVisible(false);
          void performConfirmOrder(pendingConfirmOrder).finally(() => {
            setPendingConfirmOrder(null);
          });
        }}
      />
      {loading ? (
        <ActivityIndicator size="large" color="#6C5CE7" style={stylesWeb.loader} />
      ) : (
        <>
          <View style={stylesWeb.header}>
            <Text style={stylesWeb.sectionTitle}>Service Engagements</Text>
            <View style={stylesWeb.viewToggle}>
              <TouchableOpacity
                style={[stylesWeb.viewToggleBtn, viewMode === 'grid' && stylesWeb.viewToggleBtnActive]}
                onPress={() => setViewMode('grid')}
                activeOpacity={0.7}
              >
                <Ionicons name="grid-outline" size={20} color={viewMode === 'grid' ? '#6C5CE7' : '#636E72'} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[stylesWeb.viewToggleBtn, viewMode === 'list' && stylesWeb.viewToggleBtnActive]}
                onPress={() => setViewMode('list')}
                activeOpacity={0.7}
              >
                <Ionicons name="list" size={22} color={viewMode === 'list' ? '#6C5CE7' : '#636E72'} />
              </TouchableOpacity>
            </View>
          </View>
          {sortedOrders.length === 0 && hiddenOrders.length === 0 ? (
            <View style={stylesWeb.emptySection}>
              <View style={[stylesWeb.grid, { marginBottom: 16 }]}>
                <ServiceCatalogAddEntryTile
                  variant="grid"
                  label="Service Marketplace"
                  cardWidth={cardWidth}
                  onPress={() => router.push('/tax-filing/service-catalog')}
                />
              </View>
              <Text style={stylesWeb.emptySectionText}>No orders yet</Text>
            </View>
          ) : viewMode === 'list' ? (
            <View style={stylesWeb.listWrapper}>
              <View style={projectListStylesWeb.list}>
                {sortedOrders.map((o) => {
                  const item = orderToItemWeb(o, confirmingId, rejectingId, handleConfirmOrder, handleRejectOrder);
                  return (
                    <ProjectListRow
                      key={o.id}
                      item={item}
                      isPinned={pinnedOrderIds.includes(o.id)}
                      onTogglePin={() => handleTogglePin(o.id)}
                      onPress={() => goToTodos(o)}
                      onSettings={
                        o.status === 'cancelled'
                          ? () => hideOrderForClient(o.id)
                          : o.status !== 'onboarding'
                            ? () => goToInfo(o)
                            : undefined
                      }
                    />
                  );
                })}
                <ServiceCatalogAddEntryTile
                  variant="list"
                  label="Service Marketplace"
                  onPress={() => router.push('/tax-filing/service-catalog')}
                />
              </View>
            </View>
          ) : (
            <View style={stylesWeb.grid}>
              {sortedOrders.map((o) => {
                const item = orderToItemWeb(o, confirmingId, rejectingId, handleConfirmOrder, handleRejectOrder);
                return (
                  <ProjectListCard
                    key={o.id}
                    item={item}
                    cardWidth={cardWidth}
                    isPinned={pinnedOrderIds.includes(o.id)}
                    onTogglePin={() => handleTogglePin(o.id)}
                    onPress={() => goToTodos(o)}
                    onSettings={
                      o.status === 'cancelled'
                        ? () => hideOrderForClient(o.id)
                        : o.status !== 'onboarding'
                          ? () => goToInfo(o)
                          : undefined
                    }
                  />
                );
              })}
              <ServiceCatalogAddEntryTile
                variant="grid"
                label="Service Marketplace"
                cardWidth={cardWidth}
                onPress={() => router.push('/tax-filing/service-catalog')}
              />
            </View>
          )}
          {hiddenOrders.length > 0 ? (
            <View style={stylesWeb.hiddenSection}>
              <TouchableOpacity
                style={stylesWeb.recycleBinHeader}
                onPress={() => setHiddenCollapsedWeb((v) => !v)}
                activeOpacity={0.85}
              >
                <View style={stylesWeb.recycleBinHeaderRow}>
                  <Text style={stylesWeb.hiddenSectionTitle}>Recycle bin</Text>
                  <Ionicons
                    name={hiddenCollapsedWeb ? 'chevron-down' : 'chevron-up'}
                    size={18}
                    color="#636E72"
                    style={stylesWeb.recycleBinChevron}
                  />
                </View>
              </TouchableOpacity>

              {!hiddenCollapsedWeb ? (
                viewMode === 'list' ? (
                  <View style={stylesWeb.listWrapper}>
                    <View style={projectListStylesWeb.list}>
                      {hiddenOrders.map((o) => {
                        const item = orderToItemWeb(
                          o,
                          confirmingId,
                          rejectingId,
                          handleConfirmOrder,
                          handleRejectOrder,
                          { recycleBinRestore: true },
                        );
                        return (
                          <ProjectListRow
                            key={o.id}
                            item={item}
                            isPinned={pinnedOrderIds.includes(o.id)}
                            onTogglePin={() => handleTogglePin(o.id)}
                            onPress={() => goToTodos(o)}
                            onSettings={() => unhideOrderForClient(o.id)}
                          />
                        );
                      })}
                    </View>
                  </View>
                ) : (
                  <View style={stylesWeb.grid}>
                    {hiddenOrders.map((o) => {
                      const item = orderToItemWeb(
                        o,
                        confirmingId,
                        rejectingId,
                        handleConfirmOrder,
                        handleRejectOrder,
                        { recycleBinRestore: true },
                      );
                      return (
                        <ProjectListCard
                          key={o.id}
                          item={item}
                          cardWidth={cardWidth}
                          isPinned={pinnedOrderIds.includes(o.id)}
                          onTogglePin={() => handleTogglePin(o.id)}
                          onPress={() => goToTodos(o)}
                          onSettings={() => unhideOrderForClient(o.id)}
                        />
                      );
                    })}
                  </View>
                )
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function getTaxSeasonYearWeb(order: FirmOrderForClient): number | null {
  if (order.taxSeasonYear != null) {
    return order.taxSeasonYear;
  }
  const d = order.dueAt || order.createdAt || null;
  if (!d) return null;
  return deriveTaxSeasonYear(d);
}

function getOrderDisplayNameWeb(order: FirmOrderForClient, isOnboarding: boolean): string {
  return isOnboarding ? (order.skuName ?? 'Service order') : (order.projectName ?? order.skuName ?? 'Project');
}

function orderToItemWeb(
  order: FirmOrderForClient,
  confirmingId: string | null,
  rejectingId: string | null,
  onConfirm: (order: FirmOrderForClient) => void,
  onReject: (order: FirmOrderForClient) => void,
  opts?: { recycleBinRestore?: boolean },
): ProjectListCardItemWeb {
  const isOnboarding = order.status === 'onboarding';
  const awaitingFirmConfirmation = isAwaitingFirmConfirmation(order);
  const taxSeasonYear = getTaxSeasonYearWeb(order);
  const isCancelled = order.status === 'cancelled';
  return {
    id: order.id,
    displayName: getOrderDisplayNameWeb(order, isOnboarding),
    imageUrl: isOnboarding ? order.skuImageUrl ?? null : order.projectImageUrl ?? null,
    tagPill: taxSeasonYear != null ? { label: String(taxSeasonYear), color: getTaxSeasonColorWeb(taxSeasonYear) } : null,
    statusLabel: STAGE_LABEL_WEB[order.status] ?? order.status,
    statusColor: STAGE_COLOR_WEB[order.status] ?? '#636E72',
    statusFgColor: '#FFFFFF',
    isMuted: order.status === 'cancelled',
    footerText: order.firmName ? `By ${order.firmName}` : null,
    progress:
      !isOnboarding && !isCancelled && (order.taskTotal ?? 0) > 0
        ? { completed: order.taskCompleted ?? 0, total: order.taskTotal ?? 0 }
        : null,
    progressLabel: awaitingFirmConfirmation ? 'Awaiting firm confirmation' : null,
    action: isOnboarding && !isCancelled
      ? awaitingFirmConfirmation
        ? null
        : {
            label: 'Accept and Start',
            onPress: () => onConfirm(order),
            confirming: confirmingId === order.id,
            onReject: () => onReject(order),
            rejecting: rejectingId === order.id,
          }
      : null,
    settingsIconOverride: opts?.recycleBinRestore ? 'arrow-undo-outline' : undefined,
  };
}

const stylesWeb = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { padding: 20, paddingBottom: 40 },
  loader: { marginTop: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#2D3436' },
  viewToggle: { flexDirection: 'row', gap: 4 },
  viewToggleBtn: { padding: 8, borderRadius: 8 },
  viewToggleBtnActive: { backgroundColor: '#EDE9FE' },
  emptySection: { paddingVertical: 24, alignItems: 'center' },
  emptySectionText: { fontSize: 14, color: '#95A5A6' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP_WEB },
  hiddenSection: { marginTop: 24 },
  hiddenSectionTitle: { fontSize: 14, fontWeight: '600', color: '#636E72' },
  recycleBinHeader: { width: '100%' },
  recycleBinHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
  },
  recycleBinChevron: {
    marginTop: 1,
  },
  listWrapper: {
    borderRadius: 12,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    borderWidth: Platform.OS === 'web' ? StyleSheet.hairlineWidth : 1,
  },
});
