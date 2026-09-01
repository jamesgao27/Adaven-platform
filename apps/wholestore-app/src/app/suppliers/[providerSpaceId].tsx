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
  getMarketplaceFactoryPoster,
  listStoreSkusForFactory,
  requireConsumerSpace,
  type MarketplaceFactoryPoster,
  type MarketplaceSku,
} from '@/lib/consumer';

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
  const [poster, setPoster] = useState<MarketplaceFactoryPoster | null>(null);
  const [skus, setSkus] = useState<MarketplaceSku[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>(isDesktop ? 'grid' : 'list');

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
    const [storePoster, storeSkus] = await Promise.all([
      getMarketplaceFactoryPoster(providerSpaceId),
      listStoreSkusForFactory(providerSpaceId),
    ]);
    setPoster(storePoster);
    setSkus(storeSkus);
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
    }, [loadData])
  );

  const selectedIds = useMemo(() => new Set(cart.map((l) => l.skuId)), [cart]);
  const canOrder = poster?.relationStatus === 'enrolled';
  const isPending = poster?.relationStatus === 'pending';

  const toggleSku = (sku: MarketplaceSku) => {
    if (!canOrder) return;
    setCart((prev) => {
      if (prev.some((l) => l.skuId === sku.id)) return prev.filter((l) => l.skuId !== sku.id);
      return [...prev, { skuId: sku.id, quantity: 1 }];
    });
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
    setSaving(true);
    try {
      const space = await requireConsumerSpace();
      if (!space) return;
      const orderId = await createOrderFromMarketplace(space.id, cart);
      setCart([]);
      showToast('Order created', 'success');
      router.push(`/orders/${orderId}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to create order', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toItem = (sku: MarketplaceSku) => {
    const item = skuToCatalogListItem(sku);
    const on = selectedIds.has(sku.id);
    return {
      ...item,
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
          <Ionicons name="chevron-back" size={20} color="#6C5CE7" />
          <Text style={styles.backText}>{canOrder ? 'Stores' : 'Find suppliers'}</Text>
        </TouchableOpacity>
        <Text style={styles.factory}>{poster?.factoryName || 'Supplier'}</Text>
        <Text style={styles.posterName}>{poster?.posterName || 'Showcase'}</Text>
        {poster?.posterDescription ? <Text style={styles.intro}>{poster.posterDescription}</Text> : null}
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
                style={[styles.applyBtn, applying && { opacity: 0.6 }]}
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
          <ActivityIndicator size="large" color="#6C5CE7" style={styles.loader} />
        ) : (
          <>
            <View style={styles.header}>
              <Text style={styles.sectionTitle}>{canOrder ? 'Products' : 'Catalog preview'}</Text>
              <View style={styles.viewToggle}>
                <TouchableOpacity
                  style={[styles.viewToggleBtn, viewMode === 'grid' && styles.viewToggleBtnActive]}
                  onPress={() => setViewMode('grid')}
                >
                  <Ionicons name="grid-outline" size={20} color={viewMode === 'grid' ? '#6C5CE7' : '#636E72'} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.viewToggleBtn, viewMode === 'list' && styles.viewToggleBtnActive]}
                  onPress={() => setViewMode('list')}
                >
                  <Ionicons name="list" size={22} color={viewMode === 'list' ? '#6C5CE7' : '#636E72'} />
                </TouchableOpacity>
              </View>
            </View>
            {skus.length === 0 ? (
              <Text style={styles.empty}>This supplier has no published products yet.</Text>
            ) : viewMode === 'list' ? (
              <View style={projectListStyles.listChromeWrap}>
                <View style={projectListStyles.list}>
                  {skus.map((s) => (
                    <ProjectListRow key={s.id} item={toItem(s)} onPress={() => toggleSku(s)} />
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.grid}>
                {skus.map((s) => (
                  <ProjectListCard
                    key={s.id}
                    item={toItem(s)}
                    cardWidth={cardWidth}
                    onPress={() => toggleSku(s)}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
      {canOrder && cart.length > 0 ? (
        <View style={styles.bar}>
          <Text style={styles.barText}>
            {cart.length} SKU{cart.length === 1 ? '' : 's'}
          </Text>
          <TouchableOpacity style={[styles.place, saving && { opacity: 0.6 }]} onPress={placeOrder} disabled={saving}>
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
  backText: { fontSize: 15, fontWeight: '600', color: '#6C5CE7' },
  factory: { fontSize: 13, fontWeight: '700', color: '#95A5A6', textTransform: 'uppercase', letterSpacing: 0.6 },
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
    backgroundColor: '#6C5CE7',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 4,
  },
  applyBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  loader: { marginTop: 40 },
  empty: { fontSize: 14, color: '#95A5A6', marginTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#2D3436' },
  viewToggle: { flexDirection: 'row', gap: 4 },
  viewToggleBtn: { padding: 8, borderRadius: 8 },
  viewToggleBtnActive: { backgroundColor: '#EDE9FE' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
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
    backgroundColor: '#6C5CE7',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 120,
    alignItems: 'center',
  },
  placeText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
