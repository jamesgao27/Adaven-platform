import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getCurrentSpace } from '@/lib/auth';
import { getFirmSkus, getSkuItems } from '@/lib/firm';
import type { FirmSku, FirmSkuItem } from '@/lib/firm';

export default function FirmInviteSkuPreviewScreen() {
  const router = useRouter();
  const { skuId } = useLocalSearchParams<{ skuId?: string }>();
  const [loading, setLoading] = useState(true);
  const [sku, setSku] = useState<FirmSku | null>(null);
  const [items, setItems] = useState<FirmSkuItem[]>([]);

  useEffect(() => {
    (async () => {
      if (!skuId) {
        setLoading(false);
        return;
      }
      try {
        const space = await getCurrentSpace(true);
        if (!space?.id || space.kind !== 'provider') {
          setLoading(false);
          return;
        }
        const skus = await getFirmSkus(space.id);
        const found = skus.find((s) => s.id === skuId) ?? null;
        setSku(found ?? null);
        if (found) {
          const skuItems = await getSkuItems(found.id);
          setItems(skuItems);
        }
      } catch (e) {
        console.error('FirmInviteSkuPreviewScreen load error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [skuId]);

  const handleBack = () => {
    router.back();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={24} color="#2D3436" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Service template
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6C5CE7" />
        </View>
      ) : !sku ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.emptyText}>Template not found.</Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.card}>
            <Text style={styles.skuName}>{sku.name}</Text>
            {sku.description ? <Text style={styles.skuDescription}>{sku.description}</Text> : null}

            <View style={styles.metaRow}>
              {sku.taxScenario ? (
                <Text style={styles.metaPill}>{sku.taxScenario}</Text>
              ) : null}
              {sku.taxCountry ? (
                <Text style={styles.metaPill}>{sku.taxCountry}</Text>
              ) : null}
            </View>

            {items.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>What is included</Text>
                {items.map((item) => (
                  <View key={item.id} style={styles.itemRow}>
                    <View style={styles.itemBullet} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemTitle} numberOfLines={2}>
                        {item.title}
                      </Text>
                      {item.description ? (
                        <Text style={styles.itemDescription} numberOfLines={3}>
                          {item.description}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}

      {/* 底部返回按钮：沿用 receipt Confirm 按钮的尺寸与阴影 */}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.7}>
          <Ionicons name="checkmark" size={24} color="#fff" />
          <Text style={styles.backButtonText}>Back to invite</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F3F5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 52 : 24,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '600',
    color: '#2D3436',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: { fontSize: 14, color: '#95A5A6' },
  scroll: { flex: 1 },
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  skuName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2D3436',
    marginBottom: 6,
  },
  skuDescription: {
    fontSize: 14,
    color: '#636E72',
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  metaPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#F1F3F5',
    fontSize: 12,
    color: '#636E72',
  },
  section: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 8,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  itemBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#6C5CE7',
    marginTop: 6,
    marginRight: 8,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#2D3436',
  },
  itemDescription: {
    fontSize: 13,
    color: '#636E72',
    marginTop: 2,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 8,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    gap: 12,
  },
  backButton: {
    flex: 1,
    backgroundColor: '#6C5CE7',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    ...(Platform.OS === 'android'
      ? { elevation: 0, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' }
      : { elevation: 4 }),
  },
  backButtonText: {
    marginLeft: 8,
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
});

