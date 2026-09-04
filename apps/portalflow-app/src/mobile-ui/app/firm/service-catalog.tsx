/**
 * Firm - Service Catalog: 完全复用 client 侧项目列表的卡片/列表（ProjectListCardAndRow），样式与交互一致。
 * 点击卡片/行进入 SKU 详情（Info Tab），列表末尾提供「New service」入口。
 */
import { useEffect, useState, useCallback } from 'react';
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
import { getCurrentSpace } from '@/lib/auth';
import { getFirmSkus } from '@/lib/firm';
import { supabase } from '@/lib/supabase';
import {
  ProjectListCard,
  ProjectListRow,
  projectListStyles,
} from '@/components/ProjectListCardAndRow';
import {
  SERVICE_CATALOG_CARD_MAX_WIDTH,
  firmSkuToProjectListItem,
  ServiceCatalogAddEntryTile,
  GRID_GAP,
} from '@/components/ServiceCatalogShared';
import type { FirmSku } from '@/types';
import { isMobileWebWidth } from '../../lib/web-viewport';

type ViewMode = 'grid' | 'list';

export default function FirmServiceCatalogScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const isDesktopCatalog = Platform.OS === 'web' && !isMobileWebWidth(windowWidth);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [skus, setSkus] = useState<FirmSku[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>(isDesktopCatalog ? 'grid' : 'list');

  const loadData = useCallback(async (forceRefresh = false) => {
    const space = await getCurrentSpace(forceRefresh);
    if (!space?.id || space.kind !== 'provider') {
      router.replace('/');
      return;
    }
    const list = await getFirmSkus(space.id);
    setSkus(list);
  }, [router]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadData(true);
      setLoading(false);
    })();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      loadData(true);
    }, [loadData]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  }, [loadData]);

  const openEdit = useCallback((s: FirmSku) => {
    router.push(`/firm/sku/${s.id}?tab=info&edit=1`);
  }, [router]);

  const goToDetail = useCallback((sku: FirmSku) => {
    router.push(`/firm/sku/${sku.id}`);
  }, [router]);

  const handleCreateSku = useCallback(async () => {
    try {
      const space = await getCurrentSpace(true);
      if (!space?.id || space.kind !== 'provider') return;
      const { data, error } = await supabase
        .schema('provider')
        .from('skus')
        .insert({
          provider_space_id: space.id,
          name: 'New Template',
          description: null,
          image_url: null,
          is_published: false,
          template_status: 'draft',
        })
        .select('*')
        .single();
      if (error || !data) {
        if (typeof window !== 'undefined') window.alert('Failed to create service');
        return;
      }
      router.push(`/firm/sku/${data.id}?tab=todos&edit=1&isNew=1`);
    } catch {
      if (typeof window !== 'undefined') window.alert('Failed to create service');
    }
  }, [router]);

  const numColumns = isDesktopCatalog
    ? Math.max(2, Math.floor((windowWidth - 48) / (200 + GRID_GAP)))
    : 2;
  const cardWidth = isDesktopCatalog
    ? Math.min(SERVICE_CATALOG_CARD_MAX_WIDTH, (windowWidth - 48 - GRID_GAP * (numColumns - 1)) / numColumns)
    : (windowWidth - 24 - GRID_GAP) / 2;
  const listStyle = projectListStyles.list;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, isDesktopCatalog && { paddingHorizontal: 20 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.subtitle}>
        Manage your Service Catalog: edit each Service Template and its document checklist.
      </Text>
      {loading ? (
        <ActivityIndicator size="large" color="#6C5CE7" style={styles.loader} />
      ) : (
        <>
          <View style={styles.header}>
            <Text style={styles.sectionTitle}>Service Templates</Text>
            <View style={styles.viewToggle}>
              <TouchableOpacity
                style={[styles.viewToggleBtn, viewMode === 'grid' && styles.viewToggleBtnActive]}
                onPress={() => setViewMode('grid')}
                activeOpacity={0.7}
              >
                <Ionicons name="grid-outline" size={20} color={viewMode === 'grid' ? '#6C5CE7' : '#636E72'} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.viewToggleBtn, viewMode === 'list' && styles.viewToggleBtnActive]}
                onPress={() => setViewMode('list')}
                activeOpacity={0.7}
              >
                <Ionicons name="list" size={22} color={viewMode === 'list' ? '#6C5CE7' : '#636E72'} />
              </TouchableOpacity>
            </View>
          </View>
          {viewMode === 'list' ? (
            <View style={projectListStyles.listChromeWrap}>
              <View style={listStyle}>
              {skus.map((s) => {
                const item = firmSkuToProjectListItem(s);
                return (
                  <ProjectListRow
                    key={s.id}
                    item={item}
                    onPress={() => goToDetail(s)}
                    onSettings={() => openEdit(s)}
                    listEditTrailing
                  />
                );
              })}
              <ServiceCatalogAddEntryTile variant="list" label="New Template" onPress={handleCreateSku} />
              </View>
            </View>
          ) : (
            <View style={styles.grid}>
              {skus.map((s) => {
                const item = firmSkuToProjectListItem(s);
                return (
                  <ProjectListCard
                    key={s.id}
                    item={item}
                    cardWidth={cardWidth}
                    onPress={() => goToDetail(s)}
                    onSettings={() => openEdit(s)}
                  />
                );
              })}
              <ServiceCatalogAddEntryTile
                variant="grid"
                label="New Template"
                cardWidth={cardWidth}
                onPress={handleCreateSku}
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
  content: {
    paddingTop: 20,
    paddingBottom: 40,
    paddingHorizontal: 12,
  },
  subtitle: { fontSize: 14, color: '#636E72', marginBottom: 24 },
  loader: { marginTop: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#2D3436' },
  viewToggle: { flexDirection: 'row', gap: 4 },
  viewToggleBtn: { padding: 8, borderRadius: 8 },
  viewToggleBtnActive: { backgroundColor: '#EDE9FE' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
});
