/**
 * Client — Service Marketplace: published firm templates; Filter + Search toolbar matches firm Engagements (classification only; no provider filter).
 */
import { useEffect, useState, useCallback, useMemo, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Platform,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { showTaxFiling } from '@/lib/feature-flags';
import { getCurrentSpace } from '@/lib/auth';
import {
  getPublishedSkusForClientCatalog,
  clientCreateOnboardingOrderFromPublishedSku,
} from '@/lib/firm';
import { showToast } from '@/lib/toast';
import {
  ProjectListCard,
  ProjectListRow,
  projectListStyles,
} from '@/components/ProjectListCardAndRow';
import EngagementConsentModal from '@/components/EngagementConsentModal';
import MarketplaceServiceSelectionModal from '@/components/MarketplaceServiceSelectionModal';
import {
  SERVICE_CATALOG_CARD_MAX_WIDTH,
  firmSkuToProjectListItem,
  GRID_GAP,
} from '@/components/ServiceCatalogShared';
import EngagementClassificationFilterChips from '@/components/EngagementClassificationFilterChips';
import { WEB_POPOVER } from '@/components/DataTable';
import type { FirmSku } from '@/types';
import {
  CLIENT_MARKETPLACE_CLASSIFICATION_DIMENSIONS,
  type ClassificationDimension,
  collectClassificationOptionsForSkuDim,
  classificationFilterConstraintCount,
  emptyClassificationDimFilters,
  skuMatchesClassificationDimFilters,
} from '@/lib/firm-classification-dimensions';
import { isMobileWebWidth } from '../../lib/web-viewport';

type ViewMode = 'grid' | 'list';

const MARKETPLACE_FAVORITE_SKU_IDS_KEY = 'service_marketplace_favorite_sku_ids';
const marketplacePrefsFallback = new Map<string, string>();

async function marketplaceSafeGetItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      return localStorage.getItem(key);
    } catch {
      return marketplacePrefsFallback.get(key) ?? null;
    }
  }
  return marketplacePrefsFallback.get(key) ?? null;
}

async function marketplaceSafeSetItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(key, value);
    } catch {
      marketplacePrefsFallback.set(key, value);
    }
    return;
  }
  marketplacePrefsFallback.set(key, value);
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function skuSearchHaystack(sku: FirmSku): string {
  return [
    sku.name,
    sku.description,
    sku.firmName,
    sku.taxCountry,
    sku.taxScenario,
    ...(sku.tags ?? []),
  ]
    .map((x) => norm(typeof x === 'string' ? x : ''))
    .filter(Boolean)
    .join(' ');
}

export default function ClientServiceMarketplaceScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const isDesktopCatalog = Platform.OS === 'web' && !isMobileWebWidth(windowWidth);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [skus, setSkus] = useState<FirmSku[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>(isDesktopCatalog ? 'grid' : 'list');
  const [startingSkuId, setStartingSkuId] = useState<string | null>(null);
  const [pendingMarketplaceSku, setPendingMarketplaceSku] = useState<FirmSku | null>(null);
  const [selectionModalVisible, setSelectionModalVisible] = useState(false);
  const [consentVisible, setConsentVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [filterPopoverRect, setFilterPopoverRect] = useState<{ left: number; top: number } | null>(null);
  const [classFilterByDim, setClassFilterByDim] = useState(() => emptyClassificationDimFilters());
  const classOptionsRef = useRef<Record<ClassificationDimension, string[]>>({
    season: [],
    country: [],
    scenario: [],
    custom: [],
  });
  const filterAnchorRef = useRef<View | null>(null);
  const [favoriteSkuIds, setFavoriteSkuIds] = useState<string[]>([]);

  const loadData = useCallback(async (forceRefresh = false) => {
    const space = await getCurrentSpace(forceRefresh);
    if (!space?.id || space.kind !== 'client') {
      router.replace('/');
      return [];
    }
    return getPublishedSkusForClientCatalog();
  }, [router]);

  useEffect(() => {
    if (!showTaxFiling) {
      router.replace('/');
      return;
    }
    (async () => {
      setLoading(true);
      const list = await loadData(true);
      setSkus(list);
      setLoading(false);
    })();
  }, [showTaxFiling, loadData, router]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const list = await loadData(true);
        setSkus(list);
      })();
    }, [loadData]),
  );

  useEffect(() => {
    (async () => {
      const raw = await marketplaceSafeGetItem(MARKETPLACE_FAVORITE_SKU_IDS_KEY);
      if (raw) {
        try {
          const ids = JSON.parse(raw) as string[];
          if (Array.isArray(ids)) setFavoriteSkuIds(ids);
        } catch (_) {}
      }
    })();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const list = await loadData(true);
    setSkus(list);
    setRefreshing(false);
  }, [loadData]);

  const classificationOptionsByDim = useMemo(() => {
    const out: Record<ClassificationDimension, string[]> = {
      season: [],
      country: [],
      scenario: [],
      custom: [],
    };
    for (const d of CLIENT_MARKETPLACE_CLASSIFICATION_DIMENSIONS) {
      out[d] = collectClassificationOptionsForSkuDim(skus, d);
    }
    return out;
  }, [skus]);

  useEffect(() => {
    classOptionsRef.current = classificationOptionsByDim;
  }, [classificationOptionsByDim]);

  const classificationConstraintCount = useMemo(
    () =>
      classificationFilterConstraintCount(
        classFilterByDim,
        classificationOptionsByDim,
        CLIENT_MARKETPLACE_CLASSIFICATION_DIMENSIONS,
      ),
    [classFilterByDim, classificationOptionsByDim],
  );

  const toggleClassificationDimValue = useCallback((d: ClassificationDimension, value: string) => {
    const allVals = classOptionsRef.current[d];
    if (allVals.length === 0) return;
    setClassFilterByDim((prev) => {
      const cur = prev[d];
      if (cur.mode === 'all') {
        return { ...prev, [d]: { mode: 'include', values: new Set([value]) } };
      }
      const set = new Set(cur.values);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      const nextList = allVals.filter((x) => set.has(x));
      if (nextList.length === 0) {
        return { ...prev, [d]: { mode: 'all' } };
      }
      if (nextList.length === allVals.length) {
        return { ...prev, [d]: { mode: 'all' } };
      }
      return { ...prev, [d]: { mode: 'include', values: new Set(nextList) } };
    });
  }, []);

  const selectClassificationDimAll = useCallback((d: ClassificationDimension) => {
    const allVals = classOptionsRef.current[d];
    if (allVals.length === 0) return;
    setClassFilterByDim((prev) => {
      const cur = prev[d];
      if (cur.mode === 'all') {
        return { ...prev, [d]: { mode: 'include', values: new Set(allVals) } };
      }
      return { ...prev, [d]: { mode: 'all' } };
    });
  }, []);

  const filteredByClassification = useMemo(
    () =>
      skus.filter((s) =>
        skuMatchesClassificationDimFilters(
          s,
          classFilterByDim,
          classificationOptionsByDim,
          CLIENT_MARKETPLACE_CLASSIFICATION_DIMENSIONS,
        ),
      ),
    [skus, classFilterByDim, classificationOptionsByDim],
  );

  const trimmedQuery = searchQuery.trim().toLowerCase();

  const filteredSkus = useMemo(() => {
    if (trimmedQuery.length === 0) return filteredByClassification;
    return filteredByClassification.filter((s) => skuSearchHaystack(s).includes(trimmedQuery));
  }, [filteredByClassification, trimmedQuery]);

  const displaySkus = useMemo(() => {
    const order = new Map(favoriteSkuIds.map((id, i) => [id, i]));
    return [...filteredSkus].sort((a, b) => {
      const fa = order.has(a.id);
      const fb = order.has(b.id);
      if (fa && !fb) return -1;
      if (!fa && fb) return 1;
      if (fa && fb) return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
      return 0;
    });
  }, [filteredSkus, favoriteSkuIds]);

  const handleToggleFavoriteSku = useCallback((skuId: string) => {
    setFavoriteSkuIds((prev) => {
      const next = prev.includes(skuId) ? prev.filter((id) => id !== skuId) : [...prev, skuId];
      marketplaceSafeSetItem(MARKETPLACE_FAVORITE_SKU_IDS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const syncWebFilterPopoverPosition = useCallback(() => {
    if (Platform.OS !== 'web' || !isDesktopCatalog) return;
    const node = filterAnchorRef.current;
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      setFilterPopoverRect({ left: x, top: y + height + 6 });
    });
  }, [isDesktopCatalog]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!isDesktopCatalog || !showFilterMenu) {
      setFilterPopoverRect(null);
      return;
    }
    syncWebFilterPopoverPosition();
    const raf1 = requestAnimationFrame(() => syncWebFilterPopoverPosition());
    let rafInner = 0;
    const raf2 = requestAnimationFrame(() => {
      rafInner = requestAnimationFrame(() => syncWebFilterPopoverPosition());
    });
    const onWinChange = () => syncWebFilterPopoverPosition();
    window.addEventListener('scroll', onWinChange, true);
    window.addEventListener('resize', onWinChange);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (rafInner) cancelAnimationFrame(rafInner);
      window.removeEventListener('scroll', onWinChange, true);
      window.removeEventListener('resize', onWinChange);
      setFilterPopoverRect(null);
    };
  }, [showFilterMenu, isDesktopCatalog, syncWebFilterPopoverPosition]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !isDesktopCatalog) return;
    const handler = (e: PointerEvent) => {
      const target = e.target as Node;
      const filterBtn = document.getElementById('service-marketplace-filter-button');
      const filterPopover = document.getElementById('service-marketplace-filter-popover');
      if (
        showFilterMenu &&
        filterBtn &&
        !filterBtn.contains(target) &&
        filterPopover &&
        !filterPopover.contains(target)
      ) {
        setShowFilterMenu(false);
      }
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [showFilterMenu, isDesktopCatalog]);

  const openMarketplaceFlow = useCallback((sku: FirmSku) => {
    if (startingSkuId) return;
    setPendingMarketplaceSku(sku);
    setSelectionModalVisible(true);
  }, [startingSkuId]);

  const closeSelectionModal = useCallback(() => {
    setSelectionModalVisible(false);
    setPendingMarketplaceSku(null);
  }, []);

  const proceedFromSelectionToConsent = useCallback(() => {
    setSelectionModalVisible(false);
    setConsentVisible(true);
  }, []);

  const closeConsentModal = useCallback(() => {
    if (startingSkuId) return;
    setConsentVisible(false);
    setPendingMarketplaceSku(null);
  }, [startingSkuId]);

  const handleConsentConfirm = useCallback(
    async (_payload: { allowPullRecords: boolean }) => {
      const sku = pendingMarketplaceSku;
      if (!sku || startingSkuId) return;
      setStartingSkuId(sku.id);
      const space = await getCurrentSpace(true);
      if (!space?.id || space.kind !== 'client') {
        setStartingSkuId(null);
        return;
      }
      const { orderId, error } = await clientCreateOnboardingOrderFromPublishedSku(space.id, sku.id);
      setStartingSkuId(null);
      setConsentVisible(false);
      setPendingMarketplaceSku(null);
      if (error || !orderId) {
        showToast(error?.message ?? 'Could not start engagement', 'error');
        return;
      }
      showToast('Engagement created', 'success');
      router.replace(`/firm/engagement/${orderId}`);
    },
    [pendingMarketplaceSku, startingSkuId, router],
  );

  const numColumns = isDesktopCatalog
    ? Math.max(2, Math.floor((windowWidth - 48) / (200 + GRID_GAP)))
    : 2;
  const cardWidth = isDesktopCatalog
    ? Math.min(SERVICE_CATALOG_CARD_MAX_WIDTH, (windowWidth - 48 - GRID_GAP * (numColumns - 1)) / numColumns)
    : (windowWidth - 24 - GRID_GAP) / 2;
  const listStyle = projectListStyles.list;

  const emptyMessage = useMemo(() => {
    if (skus.length === 0) return null;
    if (filteredSkus.length > 0) return null;
    if (trimmedQuery.length > 0) return `No results for "${searchQuery.trim()}"`;
    if (classificationConstraintCount > 0) return 'No services match the selected classification filters.';
    return null;
  }, [skus.length, filteredSkus.length, trimmedQuery.length, searchQuery, classificationConstraintCount]);

  const chipStyles = {
    dimGroupsWrap: styles.dimGroupsWrap,
    dimBlock: styles.dimBlock,
    dimTitleRow: styles.dimTitleRow,
    dimTitle: styles.dimTitle,
    dimEmpty: styles.dimEmpty,
    scopeChipsWrap: styles.scopeChipsWrap,
    metaTag: styles.scopeChipMeta,
    scopeLabelChip: styles.scopeLabelChip,
    scopeLabelChipMin: styles.scopeLabelChipMin,
    scopeLabelChipText: styles.scopeLabelChipText,
  };

  if (!showTaxFiling) return null;

  const selectionFirmName =
    pendingMarketplaceSku?.firmName?.trim() || 'Participating firm';
  const selectionTemplateName = pendingMarketplaceSku?.name?.trim() || '—';

  return (
    <View style={styles.root}>
      <MarketplaceServiceSelectionModal
        visible={selectionModalVisible && pendingMarketplaceSku != null}
        firmName={selectionFirmName}
        templateName={selectionTemplateName}
        previewSku={pendingMarketplaceSku}
        onCancel={closeSelectionModal}
        onContinue={proceedFromSelectionToConsent}
      />
      <EngagementConsentModal
        visible={consentVisible && pendingMarketplaceSku != null}
        loading={Boolean(startingSkuId)}
        onClose={closeConsentModal}
        onConfirm={handleConsentConfirm}
      />
      <View style={styles.toolbarSlot}>
        <View style={styles.toolbarHeader}>
          <View style={styles.headerRow}>
            <View
              ref={filterAnchorRef}
              collapsable={false}
              style={styles.groupWrap}
              {...(isDesktopCatalog ? { nativeID: 'service-marketplace-filter-button' } : {})}
            >
              <TouchableOpacity
                style={styles.filterTrigger}
                onPress={() => setShowFilterMenu(!showFilterMenu)}
                activeOpacity={0.7}
              >
                <Ionicons name="filter-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />
                <Text style={styles.filterTriggerText}>Filter</Text>
                {classificationConstraintCount > 0 ? (
                  <Text style={styles.filterBadge}> ({classificationConstraintCount})</Text>
                ) : null}
                <Ionicons name="chevron-down" size={16} color="#636E72" />
              </TouchableOpacity>
              {showFilterMenu && (Platform.OS !== 'web' || !isDesktopCatalog) ? (
                <View style={[styles.groupDropdown, styles.marketplaceFilterDropdown]}>
                  <ScrollView nestedScrollEnabled style={styles.marketplaceFilterScroll} keyboardShouldPersistTaps="handled">
                    <Text style={styles.engagementFilterSectionLabel}>Classification</Text>
                    <EngagementClassificationFilterChips
                      dimensions={CLIENT_MARKETPLACE_CLASSIFICATION_DIMENSIONS}
                      optionsByDim={classificationOptionsByDim}
                      classFilterByDim={classFilterByDim}
                      onToggleValue={toggleClassificationDimValue}
                      onSelectAll={selectClassificationDimAll}
                      chipStyles={chipStyles}
                    />
                    {classificationConstraintCount > 0 ? (
                      <TouchableOpacity
                        style={styles.engagementFilterClearTags}
                        onPress={() => setClassFilterByDim(emptyClassificationDimFilters())}
                      >
                        <Text style={styles.engagementFilterClearTagsText}>Reset classification filters</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity style={styles.engagementFilterDoneRow} onPress={() => setShowFilterMenu(false)}>
                      <Text style={styles.engagementFilterDoneText}>Done</Text>
                    </TouchableOpacity>
                  </ScrollView>
                </View>
              ) : null}
            </View>
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={18} color="#636E72" style={styles.searchIcon} />
              <TextInput
                style={styles.toolbarSearchInput}
                placeholder="Search"
                placeholderTextColor="#95A5A6"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCorrect={false}
                autoCapitalize="none"
                accessibilityLabel="Search marketplace"
              />
              {searchQuery.trim() ? (
                <TouchableOpacity
                  onPress={() => setSearchQuery('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.searchClear}
                  accessibilityLabel="Clear search"
                >
                  <Ionicons name="close-circle" size={20} color="#95A5A6" />
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={styles.viewToggle}>
              <TouchableOpacity
                style={[styles.viewToggleBtn, viewMode === 'grid' && styles.viewToggleBtnActive]}
                onPress={() => setViewMode('grid')}
                activeOpacity={0.7}
                accessibilityLabel="Grid view"
                accessibilityState={{ selected: viewMode === 'grid' }}
              >
                <Ionicons name="grid-outline" size={20} color={viewMode === 'grid' ? '#6C5CE7' : '#636E72'} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.viewToggleBtn, viewMode === 'list' && styles.viewToggleBtnActive]}
                onPress={() => setViewMode('list')}
                activeOpacity={0.7}
                accessibilityLabel="List view"
                accessibilityState={{ selected: viewMode === 'list' }}
              >
                <Ionicons name="list" size={22} color={viewMode === 'list' ? '#6C5CE7' : '#636E72'} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {isDesktopCatalog &&
        showFilterMenu &&
        filterPopoverRect &&
        typeof document !== 'undefined' &&
        document.body &&
        createPortal(
          <div
            id="service-marketplace-filter-popover"
            style={{
              ...WEB_POPOVER.container,
              ...WEB_POPOVER.containerWide,
              left: filterPopoverRect.left,
              top: filterPopoverRect.top,
            }}
          >
            <View style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#495057' }}>Filter</Text>
              {classificationConstraintCount > 0 ? (
                <TouchableOpacity onPress={() => setClassFilterByDim(emptyClassificationDimFilters())} style={{ padding: 4 }}>
                  <Text style={{ fontSize: 13, color: '#6C5CE7' }}>Clear</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              <EngagementClassificationFilterChips
                dimensions={CLIENT_MARKETPLACE_CLASSIFICATION_DIMENSIONS}
                optionsByDim={classificationOptionsByDim}
                classFilterByDim={classFilterByDim}
                onToggleValue={toggleClassificationDimValue}
                onSelectAll={selectClassificationDimAll}
                chipStyles={chipStyles}
              />
            </ScrollView>
          </div>,
          document.body,
        )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, isDesktopCatalog && { paddingHorizontal: 20 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <ActivityIndicator size="large" color="#6C5CE7" style={styles.loader} />
        ) : (
          <>
            {skus.length === 0 ? (
              <Text style={styles.emptyText}>The marketplace is empty for now. Check back later.</Text>
            ) : emptyMessage ? (
              <Text style={styles.emptyText}>{emptyMessage}</Text>
            ) : viewMode === 'list' ? (
              <View style={projectListStyles.listChromeWrap}>
                <View style={listStyle}>
                {displaySkus.map((s) => {
                  const item = firmSkuToProjectListItem(s, { firmFooter: true, forClientMarketplace: true });
                  return (
                    <ProjectListRow
                      key={s.id}
                      item={item}
                      onPress={() => openMarketplaceFlow(s)}
                      isPinned={favoriteSkuIds.includes(s.id)}
                      onTogglePin={() => handleToggleFavoriteSku(s.id)}
                      pinAppearance="favorite"
                    />
                  );
                })}
                </View>
              </View>
            ) : (
              <View style={styles.grid}>
                {displaySkus.map((s) => {
                  const item = firmSkuToProjectListItem(s, { firmFooter: true, forClientMarketplace: true });
                  return (
                    <ProjectListCard
                      key={s.id}
                      item={item}
                      cardWidth={cardWidth}
                      onPress={() => openMarketplaceFlow(s)}
                      isPinned={favoriteSkuIds.includes(s.id)}
                      onTogglePin={() => handleToggleFavoriteSku(s.id)}
                      pinAppearance="favorite"
                    />
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  toolbarSlot: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
    zIndex: 100,
    elevation: 4,
    overflow: 'visible' as const,
  },
  toolbarHeader: {
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  groupWrap: {
    position: 'relative' as const,
    overflow: 'visible' as const,
    alignSelf: 'flex-start',
  },
  filterTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterTriggerText: {
    fontSize: 14,
    color: '#636E72',
    marginRight: 4,
    fontWeight: '500',
  },
  filterBadge: { fontSize: 14, color: '#6C5CE7', fontWeight: '600' },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  searchIcon: { marginRight: 8 },
  toolbarSearchInput: { flex: 1, fontSize: 14, color: '#2D3436', padding: 0 },
  searchClear: { marginLeft: 4 },
  groupDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 4,
    backgroundColor: '#FFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    paddingVertical: 8,
    minWidth: 260,
    zIndex: 99999,
    elevation: 99999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  marketplaceFilterDropdown: {
    paddingVertical: 0,
    maxHeight: 420,
  },
  marketplaceFilterScroll: { maxHeight: 400 },
  engagementFilterSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#95A5A6',
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 4,
    textTransform: 'uppercase',
  },
  engagementFilterClearTags: { paddingVertical: 12, paddingHorizontal: 14, marginTop: 4 },
  engagementFilterClearTagsText: { fontSize: 14, color: '#6C5CE7', fontWeight: '600' },
  engagementFilterDoneRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: '#E9ECEF',
    marginTop: 4,
    alignItems: 'center',
  },
  engagementFilterDoneText: { fontSize: 14, color: '#6C5CE7', fontWeight: '600' },
  dimGroupsWrap: { gap: 12, paddingHorizontal: 4, paddingBottom: 8 },
  dimBlock: { gap: 6 },
  dimTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dimTitle: { fontSize: 13, fontWeight: '600', color: '#2D3436' },
  dimEmpty: { fontSize: 12, color: '#95A5A6', fontStyle: 'italic' },
  scopeChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scopeChipMeta: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: '100%',
    alignSelf: 'flex-start',
    minHeight: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scopeLabelChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    minHeight: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scopeLabelChipMin: { minWidth: 74 },
  scopeLabelChipText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    minWidth: 35,
    ...Platform.select({
      android: { textAlignVertical: 'center' as const, includeFontPadding: false },
      default: {},
    }),
  },
  scroll: { flex: 1 },
  content: {
    paddingTop: 20,
    paddingBottom: 40,
    paddingHorizontal: 12,
  },
  loader: { marginTop: 40 },
  emptyText: { fontSize: 15, color: '#636E72', marginTop: 24, textAlign: 'center' },
  viewToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 'auto' },
  viewToggleBtn: { padding: 8, borderRadius: 8 },
  viewToggleBtnActive: { backgroundColor: '#EDE9FE' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
});
