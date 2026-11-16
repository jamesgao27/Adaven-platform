import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
  RefreshControl,
  useWindowDimensions,
  TextInput,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  ProjectListCard,
  ProjectListRow,
  projectListStyles,
  skuToCatalogListItem,
  SERVICE_CATALOG_CARD_MAX_WIDTH,
  GRID_GAP,
  isMobileWebWidth,
  showToast,
} from '@adaven/platform-ui';
import {
  applyToFactory,
  createOrderFromMarketplace,
  getDealerStorefront,
  requireConsumerSpace,
  type DealerStorefront,
  type DealerStorefrontSku,
} from '@/lib/consumer';
import { pushOrderToErp } from '@/lib/erp';

type ViewMode = 'grid' | 'list';
type CartLine = { skuId: string; quantity: number };

export default function SupplierStoreScreen() {
  const router = useRouter();
  const { providerSpaceId } = useLocalSearchParams<{ providerSpaceId: string }>();
  const { width: windowWidth } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && !isMobileWebWidth(windowWidth);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [storefront, setStorefront] = useState<DealerStorefront | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>(isDesktop ? 'grid' : 'list');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const space = await requireConsumerSpace();
    if (!space) {
      router.replace('/');
      return;
    }
    if (!providerSpaceId) {
      router.replace('/suppliers');
      return;
    }
    setStorefront(await getDealerStorefront(space.id, providerSpaceId));
  }, [providerSpaceId, router]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadData();
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Failed to load store', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const accent = storefront?.poster?.accentColor || '#6C5CE7';
  const canOrder = storefront?.relationStatus === 'enrolled';
  const isPending = storefront?.relationStatus === 'pending';
  const skus = storefront?.skus ?? [];
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of skus) if (s.category?.trim()) set.add(s.category.trim().toUpperCase());
    return [...set].sort();
  }, [skus]);

  const visibleSkus = useMemo(() => {
    if (!categoryFilter) return skus;
    return skus.filter((s) => (s.category || '').toUpperCase() === categoryFilter);
  }, [skus, categoryFilter]);

  const selectedIds = useMemo(() => new Set(cart.map((l) => l.skuId)), [cart]);

  const toggleSku = (sku: DealerStorefrontSku) => {
    if (!canOrder) return;
    const moq = sku.moq ?? 1;
    setCart((prev) => {
      if (prev.some((l) => l.skuId === sku.skuId)) return prev.filter((l) => l.skuId !== sku.skuId);
      return [...prev, { skuId: sku.skuId, quantity: moq }];
    });
  };

  const setQty = (skuId: string, quantity: number) => {
    setCart((prev) => prev.map((l) => (l.skuId === skuId ? { ...l, quantity } : l)));
  };

  const apply = async () => {
    if (!providerSpaceId) return;
    setApplying(true);
    try {
      const space = await requireConsumerSpace();
      if (!space) return;
      await applyToFactory(providerSpaceId, space.id);
      showToast('Application sent. This supplier can approve you as a dealer.', 'success');
      await loadData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to apply', 'error');
    } finally {
      setApplying(false);
    }
  };

  const placeOrder = async () => {
    if (!cart.length) {
      showToast('Select at least one SKU', 'error');
      return;
    }
    for (const line of cart) {
      const priced = skus.find((s) => s.skuId === line.skuId);
      if (priced?.moq != null && line.quantity < priced.moq) {
        showToast(`Quantity below MOQ (${priced.moq}) for ${priced.name}`, 'error');
        return;
      }
    }
    setSaving(true);
    try {
      const space = await requireConsumerSpace();
      if (!space || !providerSpaceId) return;
      const orderId = await createOrderFromMarketplace(
        space.id,
        cart.map((c) => ({ skuId: c.skuId, quantity: c.quantity })),
      );
      try {
        await pushOrderToErp(providerSpaceId, orderId);
      } catch (pushErr) {
        showToast(
          pushErr instanceof Error
            ? `Order created; ERP push pending: ${pushErr.message}`
            : 'Order created; ERP push pending',
          'error',
        );
      }
      setCart([]);
      showToast('Order created', 'success');
      router.push(`/orders/${orderId}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to create order', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toItem = (sku: DealerStorefrontSku) => {
    const item = skuToCatalogListItem({
      id: sku.skuId,
      name: sku.name,
      description: sku.description,
      imageUrl: sku.imageUrl,
      isPublished: true,
    });
    const on = selectedIds.has(sku.skuId);
    const priceLabel =
      sku.unitPrice != null
        ? `$${sku.unitPrice.toFixed(2)}${sku.moq != null ? ` · MOQ ${sku.moq}` : ''}`
        : sku.category || undefined;
    return {
      ...item,
      footerText: [sku.category, priceLabel].filter(Boolean).join(' · ') || item.footerText,
      hideStatusBadge: true,
      statusCorner: null,
      action: canOrder
        ? {
            label: on ? 'Selected' : 'Select',
            onPress: () => toggleSku(sku),
            confirming: false,
          }
        : null,
    };
  };

  const numColumns = isDesktop ? Math.max(2, Math.floor((windowWidth - 48) / (200 + GRID_GAP))) : 2;
  const cardWidth = isDesktop
    ? Math.min(SERVICE_CATALOG_CARD_MAX_WIDTH, (windowWidth - 48 - GRID_GAP * (numColumns - 1)) / numColumns)
    : (windowWidth - 24 - GRID_GAP) / 2;

  return (
    <View style={styles.page}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, isDesktop && { paddingHorizontal: 20 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await loadData();
              setRefreshing(false);
            }}
          />
        }
      >
        <TouchableOpacity
          style={styles.back}
          onPress={() => router.push(canOrder ? '/suppliers' : '/suppliers/discover')}
        >
          <Ionicons name="chevron-back" size={20} color={accent} />
          <Text style={[styles.backText, { color: accent }]}>{canOrder ? 'Stores' : 'Find suppliers'}</Text>
        </TouchableOpacity>

        {storefront?.poster?.topImageUrl ? (
          <Image source={{ uri: storefront.poster.topImageUrl }} style={styles.band} resizeMode="cover" />
        ) : (
          <View style={[styles.bandPlaceholder, { borderColor: accent }]} />
        )}

        <Text style={styles.posterName}>{storefront?.poster?.name || 'Store'}</Text>
        {storefront?.poster?.description ? (
          <Text style={styles.intro}>{storefront.poster.description}</Text>
        ) : null}

        {!loading && !canOrder ? (
          <View style={styles.showcaseBox}>
            <Text style={styles.showcaseTitle}>{isPending ? 'Application sent' : 'Showcase only'}</Text>
            <Text style={styles.showcaseBody}>
              {isPending
                ? 'This supplier has your application. You can order after they approve you as a dealer.'
                : 'You can browse this supplier’s products but cannot order until you are an approved dealer.'}
            </Text>
            {!isPending ? (
              <TouchableOpacity
                style={[styles.applyBtn, { backgroundColor: accent }, applying && { opacity: 0.6 }]}
                onPress={apply}
                disabled={applying}
              >
                {applying ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.applyBtnText}>Apply to become a dealer</Text>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator size="large" color={accent} style={styles.loader} />
        ) : (
          <>
            <View style={styles.header}>
              <Text style={styles.sectionTitle}>{canOrder ? 'Products' : 'Catalog preview'}</Text>
              <View style={styles.viewToggle}>
                <TouchableOpacity
                  style={[styles.viewToggleBtn, viewMode === 'grid' && { backgroundColor: `${accent}22` }]}
                  onPress={() => setViewMode('grid')}
                >
                  <Ionicons name="grid-outline" size={20} color={viewMode === 'grid' ? accent : '#636E72'} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.viewToggleBtn, viewMode === 'list' && { backgroundColor: `${accent}22` }]}
                  onPress={() => setViewMode('list')}
                >
                  <Ionicons name="list" size={22} color={viewMode === 'list' ? accent : '#636E72'} />
                </TouchableOpacity>
              </View>
            </View>

            {categories.length > 0 ? (
              <ScrollView horizontal style={styles.catRow} showsHorizontalScrollIndicator={false}>
                <TouchableOpacity
                  style={[styles.catChip, !categoryFilter && { backgroundColor: `${accent}33` }]}
                  onPress={() => setCategoryFilter(null)}
                >
                  <Text style={styles.catChipText}>All</Text>
                </TouchableOpacity>
                {categories.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.catChip, categoryFilter === c && { backgroundColor: `${accent}33` }]}
                    onPress={() => setCategoryFilter(c)}
                  >
                    <Text style={styles.catChipText}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null}

            {visibleSkus.length === 0 ? (
              <Text style={styles.empty}>
                {canOrder ? 'No priced products on this showcase yet.' : 'No products on this showcase yet.'}
              </Text>
            ) : viewMode === 'list' ? (
              <View style={projectListStyles.listChromeWrap}>
                <View style={projectListStyles.list}>
                  {visibleSkus.map((s) => (
                    <View key={s.skuId}>
                      <ProjectListRow item={toItem(s)} onPress={() => toggleSku(s)} />
                      {selectedIds.has(s.skuId) && canOrder ? (
                        <View style={styles.qtyRow}>
                          <Text style={styles.qtyLabel}>Qty (MOQ {s.moq ?? 1})</Text>
                          <TextInput
                            style={styles.qtyInput}
                            keyboardType="decimal-pad"
                            value={String(cart.find((c) => c.skuId === s.skuId)?.quantity ?? 1)}
                            onChangeText={(t) => setQty(s.skuId, Number(t) || 0)}
                          />
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.grid}>
                {visibleSkus.map((s) => (
                  <View key={s.skuId} style={{ width: cardWidth }}>
                    <ProjectListCard item={toItem(s)} cardWidth={cardWidth} onPress={() => toggleSku(s)} />
                    {selectedIds.has(s.skuId) && canOrder ? (
                      <View style={styles.qtyRow}>
                        <Text style={styles.qtyLabel}>Qty</Text>
                        <TextInput
                          style={styles.qtyInput}
                          keyboardType="decimal-pad"
                          value={String(cart.find((c) => c.skuId === s.skuId)?.quantity ?? 1)}
                          onChangeText={(t) => setQty(s.skuId, Number(t) || 0)}
                        />
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {storefront?.poster?.bottomImageUrl ? (
          <Image
            source={{ uri: storefront.poster.bottomImageUrl }}
            style={[styles.band, { marginTop: 24 }]}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.bandPlaceholder, { marginTop: 24, borderColor: accent }]} />
        )}
      </ScrollView>

      {canOrder && cart.length > 0 ? (
        <View style={styles.bar}>
          <Text style={styles.barText}>
            {cart.length} SKU{cart.length === 1 ? '' : 's'}
          </Text>
          <TouchableOpacity
            style={[styles.place, { backgroundColor: accent }, saving && { opacity: 0.6 }]}
            onPress={placeOrder}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.placeText}>Place order</Text>}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F8F9FA' },
  container: { flex: 1 },
  content: { paddingTop: 20, paddingBottom: 88, paddingHorizontal: 12 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  backText: { fontSize: 15, fontWeight: '600' },
  band: { width: '100%', height: 120, borderRadius: 12, backgroundColor: '#E9ECEF', marginBottom: 12 },
  bandPlaceholder: {
    width: '100%',
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: 12,
    backgroundColor: '#F1F2F6',
  },
  posterName: { fontSize: 22, fontWeight: '800', color: '#2D3436', marginTop: 4 },
  intro: { fontSize: 14, color: '#636E72', lineHeight: 20, marginTop: 8, marginBottom: 8 },
  showcaseBox: {
    marginTop: 8,
    marginBottom: 4,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E4F0',
    backgroundColor: '#FDFBFF',
    gap: 8,
  },
  showcaseTitle: { fontSize: 15, fontWeight: '700', color: '#2D3436' },
  showcaseBody: { fontSize: 13, color: '#636E72', lineHeight: 18 },
  applyBtn: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 4,
  },
  applyBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  loader: { marginTop: 40 },
  empty: { fontSize: 14, color: '#95A5A6', marginTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#2D3436' },
  viewToggle: { flexDirection: 'row', gap: 4 },
  viewToggleBtn: { padding: 8, borderRadius: 8 },
  catRow: { marginBottom: 12, maxHeight: 40 },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F1F2F6',
    marginRight: 8,
  },
  catChipText: { fontSize: 12, fontWeight: '600', color: '#2D3436' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, marginBottom: 8 },
  qtyLabel: { fontSize: 12, color: '#636E72' },
  qtyInput: {
    width: 72,
    borderWidth: 1,
    borderColor: '#DFE6E9',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#fff',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E9ECEF',
    gap: 12,
  },
  barText: { fontSize: 14, fontWeight: '600', color: '#2D3436', flex: 1 },
  place: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 120,
    alignItems: 'center',
  },
  placeText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
