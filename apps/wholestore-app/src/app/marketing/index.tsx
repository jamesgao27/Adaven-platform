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
  ServiceCatalogAddEntryTile,
  SERVICE_CATALOG_CARD_MAX_WIDTH,
  GRID_GAP,
  isMobileWebWidth,
  showToast,
} from '@adaven/platform-ui';
import { requireProviderSpace } from '@/lib/provider';
import { createPoster, listPosters, type ProviderPoster } from '@/lib/posters';

type ViewMode = 'grid' | 'list';

function posterToItem(poster: ProviderPoster) {
  const item = skuToCatalogListItem(poster);
  const badges: string[] = [];
  if (poster.isSystemDefault) badges.push('Default store');
  if (poster.isMarketplaceFeatured && poster.isPublished) badges.push('Featured');
  return {
    ...item,
    footerText: badges.join(' · ') || (poster.isPublished ? 'Published' : 'Draft'),
  };
}

export default function MarketingScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && !isMobileWebWidth(windowWidth);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [posters, setPosters] = useState<ProviderPoster[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>(isDesktop ? 'grid' : 'list');

  const loadData = useCallback(async () => {
    const space = await requireProviderSpace();
    if (!space) {
      router.replace('/');
      return;
    }
    setPosters(await listPosters(space.id));
  }, [router]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadData();
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Failed to load marketing', 'error');
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

  const handleCreate = useCallback(async () => {
    try {
      const space = await requireProviderSpace();
      if (!space) return;
      const created = await createPoster(space.id);
      router.push(`/marketing/${created.id}?edit=1&isNew=1`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to create poster', 'error');
    }
  }, [router]);

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
      <Text style={styles.subtitle}>
        Posters introduce your store and the SKUs on each storefront. The default poster always lists every
        published SKU. Set one published poster as the featured storefront.
      </Text>
      {loading ? (
        <ActivityIndicator size="large" color="#6C5CE7" style={styles.loader} />
      ) : (
        <>
          <View style={styles.header}>
            <Text style={styles.sectionTitle}>Posters</Text>
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
          {viewMode === 'list' ? (
            <View style={projectListStyles.listChromeWrap}>
              <View style={projectListStyles.list}>
                {posters.map((p) => {
                  const item = posterToItem(p);
                  return (
                    <ProjectListRow
                      key={p.id}
                      item={item}
                      onPress={() => router.push(`/marketing/${p.id}`)}
                      onSettings={() => router.push(`/marketing/${p.id}?edit=1`)}
                      listEditTrailing
                    />
                  );
                })}
                <ServiceCatalogAddEntryTile variant="list" label="New poster" onPress={handleCreate} />
              </View>
            </View>
          ) : (
            <View style={styles.grid}>
              {posters.map((p) => {
                const item = posterToItem(p);
                return (
                  <ProjectListCard
                    key={p.id}
                    item={item}
                    cardWidth={cardWidth}
                    onPress={() => router.push(`/marketing/${p.id}`)}
                    onSettings={() => router.push(`/marketing/${p.id}?edit=1`)}
                  />
                );
              })}
              <ServiceCatalogAddEntryTile
                variant="grid"
                label="New poster"
                cardWidth={cardWidth}
                onPress={handleCreate}
              />
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
  subtitle: { fontSize: 14, color: '#636E72', marginBottom: 24, lineHeight: 20 },
  loader: { marginTop: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#2D3436' },
  viewToggle: { flexDirection: 'row', gap: 4 },
  viewToggleBtn: { padding: 8, borderRadius: 8 },
  viewToggleBtnActive: { backgroundColor: '#EDE9FE' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
});
