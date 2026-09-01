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

export default function DiscoverSuppliersScreen() {
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
    setPosters(all.filter((p) => p.relationStatus !== 'enrolled'));
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
      footerText: `${poster.factoryName} · ${
        poster.relationStatus === 'pending' ? 'Application sent' : 'Showcase'
      } · ${poster.skuCount} SKU${poster.skuCount === 1 ? '' : 's'}`,
      statusLabel: poster.factoryName,
      statusColor: '#636E72',
    };
  };

  const openShowcase = (poster: MarketplaceFactoryPoster) => {
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
      <TouchableOpacity style={styles.back} onPress={() => router.push('/suppliers')}>
        <Ionicons name="chevron-back" size={20} color="#6C5CE7" />
        <Text style={styles.backText}>Suppliers</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Find more suppliers</Text>
      <Text style={styles.subtitle}>
        Browse supplier posters and apply. These are showcases — you can look, but you cannot order until you are
        approved.
      </Text>
      {loading ? (
        <ActivityIndicator size="large" color="#6C5CE7" style={styles.loader} />
      ) : (
        <>
          <View style={styles.header}>
            <Text style={styles.sectionTitle}>Showcases</Text>
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
          {posters.length === 0 ? (
            <Text style={styles.empty}>No other supplier posters to browse right now.</Text>
          ) : viewMode === 'list' ? (
            <View style={projectListStyles.listChromeWrap}>
              <View style={projectListStyles.list}>
                {posters.map((p) => (
                  <ProjectListRow key={p.providerSpaceId} item={toItem(p)} onPress={() => openShowcase(p)} />
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
                  onPress={() => openShowcase(p)}
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
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  backText: { fontSize: 15, fontWeight: '600', color: '#6C5CE7' },
  title: { fontSize: 22, fontWeight: '800', color: '#2D3436', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#636E72', marginBottom: 24, lineHeight: 20 },
  loader: { marginTop: 40 },
  empty: { fontSize: 14, color: '#95A5A6', marginTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#2D3436' },
  viewToggle: { flexDirection: 'row', gap: 4 },
  viewToggleBtn: { padding: 8, borderRadius: 8 },
  viewToggleBtnActive: { backgroundColor: '#EDE9FE' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
});
