import { useCallback, useEffect, useState } from 'react';
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
import { useRouter, useFocusEffect } from 'expo-router';
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
  listMarketplaceFactoryPosters,
  requireConsumerSpace,
  type MarketplaceFactoryPoster,
} from '@/lib/consumer';

type ViewMode = 'grid' | 'list';

export default function SuppliersScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && !isMobileWebWidth(windowWidth);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [posters, setPosters] = useState<MarketplaceFactoryPoster[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>(isDesktop ? 'grid' : 'list');

  const loadData = useCallback(async () => {
    const space = await requireConsumerSpace();
    if (!space) {
      router.replace('/');
      return;
    }
    const all = await listMarketplaceFactoryPosters();
    setPosters(all.filter((p) => p.relationStatus === 'enrolled'));
  }, [router]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadData();
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Failed to load suppliers', 'error');
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

  const toItem = (poster: MarketplaceFactoryPoster) => {
    const item = skuToCatalogListItem({
      id: poster.posterId,
      name: poster.posterName || poster.factoryName,
      description: poster.posterDescription,
      imageUrl: poster.imageUrl,
      isPublished: true,
    });
    return {
      ...item,
      hideStatusBadge: true,
      statusCorner: null,
      footerText: `${poster.factoryName} · ${poster.skuCount} SKU${poster.skuCount === 1 ? '' : 's'}`,
      statusLabel: poster.factoryName,
      statusColor: '#636E72',
    };
  };

  const openStore = (poster: MarketplaceFactoryPoster) => {
    router.push(`/suppliers/${poster.providerSpaceId}`);
  };

  const numColumns = isDesktop ? Math.max(2, Math.floor((windowWidth - 48) / (200 + GRID_GAP))) : 2;
  const cardWidth = isDesktop
    ? Math.min(SERVICE_CATALOG_CARD_MAX_WIDTH, (windowWidth - 48 - GRID_GAP * (numColumns - 1)) / numColumns)
    : (windowWidth - 24 - GRID_GAP) / 2;

  return (
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
      <Text style={styles.title}>Suppliers</Text>
      <Text style={styles.subtitle}>
        Your supplier stores. Open a store to order. Use Find more suppliers to browse showcases and apply.
      </Text>
      {loading ? (
        <ActivityIndicator size="large" color="#6C5CE7" style={styles.loader} />
      ) : (
        <>
          <View style={styles.header}>
            <Text style={styles.sectionTitle}>Stores</Text>
            <View style={styles.headerRight}>
              <TouchableOpacity style={styles.findBtn} onPress={() => router.push('/suppliers/discover')} activeOpacity={0.8}>
                <Ionicons name="search-outline" size={16} color="#6C5CE7" />
                <Text style={styles.findBtnText}>Find more suppliers</Text>
              </TouchableOpacity>
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
          </View>
          {posters.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.empty}>You have no supplier stores yet.</Text>
              <TouchableOpacity style={styles.findBtn} onPress={() => router.push('/suppliers/discover')} activeOpacity={0.8}>
                <Ionicons name="search-outline" size={16} color="#6C5CE7" />
                <Text style={styles.findBtnText}>Find more suppliers</Text>
              </TouchableOpacity>
            </View>
          ) : viewMode === 'list' ? (
            <View style={projectListStyles.listChromeWrap}>
              <View style={projectListStyles.list}>
                {posters.map((p) => (
                  <ProjectListRow key={p.providerSpaceId} item={toItem(p)} onPress={() => openStore(p)} />
                ))}
              </View>
            </View>
          ) : (
            <View style={styles.grid}>
              {posters.map((p) => (
                <ProjectListCard
                  key={p.providerSpaceId}
                  item={toItem(p)}
                  cardWidth={cardWidth}
                  onPress={() => openStore(p)}
                />
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { paddingTop: 20, paddingBottom: 40, paddingHorizontal: 12 },
  title: { fontSize: 22, fontWeight: '800', color: '#2D3436', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#636E72', marginBottom: 24, lineHeight: 20 },
  loader: { marginTop: 40 },
  emptyBox: { gap: 12, marginTop: 8 },
  empty: { fontSize: 14, color: '#95A5A6' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#2D3436' },
  findBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#EAEAFF',
  },
  findBtnText: { fontSize: 13, fontWeight: '600', color: '#6C5CE7' },
  viewToggle: { flexDirection: 'row', gap: 4 },
  viewToggleBtn: { padding: 8, borderRadius: 8 },
  viewToggleBtnActive: { backgroundColor: '#EDE9FE' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
});
