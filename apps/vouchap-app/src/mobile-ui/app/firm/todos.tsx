/**
 * Firm - Engagements (deprecated route): kept for backward compatibility, logic moved to app/firm/engagements.tsx.
 */
import { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getCurrentSpace } from '@/lib/auth';
import { getFirmOrders } from '@/lib/firm';
import type { FirmOrder } from '@/types';

const STATUS_LABEL: Record<string, string> = {
  onboarding: 'Onboarding',
  collecting: 'Collecting',
  processing: 'Processing',
  reviewing: 'Reviewing',
  filing: 'Filing',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export default function FirmOrdersScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<FirmOrder[]>([]);

  useEffect(() => {
    (async () => {
      const space = await getCurrentSpace(true);
      if (!space?.id || space.kind !== 'firm') {
        router.replace('/');
        return;
      }
      const list = await getFirmOrders(space.id);
      setOrders(list);
      setLoading(false);
    })();
  }, []);

  const groupedByClient = useMemo(() => {
    const map: Record<string, FirmOrder[]> = {};
    orders.forEach((o) => {
      const key = o.clientSpaceId;
      if (!map[key]) map[key] = [];
      map[key].push(o);
    });
    return Object.entries(map);
  }, [orders]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Engagements</Text>
      <Text style={styles.subtitle}>Engagements across clients</Text>
      {loading ? (
        <ActivityIndicator size="large" color="#6C5CE7" style={styles.loader} />
      ) : orders.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No engagements yet. Create from Service Catalog for clients.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {groupedByClient.map(([clientId, clientOrders]) => (
            <View key={clientId} style={styles.clientBlock}>
              <Text style={styles.clientTitle}>Client: {clientId.slice(0, 8)}…</Text>
              {clientOrders.map((o) => (
                <TouchableOpacity
                  key={o.id}
                  style={styles.card}
                  activeOpacity={0.7}
                  onPress={() => router.push(`/firm/engagement/${o.id}`)}
                >
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>{formatOrderTitle(o)}</Text>
                    <Text style={styles.status}>{STATUS_LABEL[o.status] || o.status}</Text>
                  </View>
                  {o.dueAt ? <Text style={styles.dueAt}>Due: {o.dueAt}</Text> : null}
                  <View style={styles.cardFooter}>
                    <Text style={styles.metaText}>Engagement ID: {o.id.slice(0, 8)}…</Text>
                    <Ionicons name="chevron-forward" size={16} color="#636E72" />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function formatOrderTitle(o: FirmOrder): string {
  const base = 'Service engagement';
  const d = o.dueAt || o.createdAt || null;
  if (!d) return base;
  try {
    const year = new Date(d).getFullYear();
    return `${year} · ${base}`;
  } catch {
    return base;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#2D3436', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#636E72', marginBottom: 24 },
  loader: { marginTop: 40 },
  empty: { marginTop: 24 },
  emptyText: { fontSize: 14, color: '#95A5A6' },
  list: { gap: 16 },
  clientBlock: { gap: 8 },
  clientTitle: { fontSize: 14, color: '#636E72', fontWeight: '500' },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#2D3436', flex: 1 },
  status: { fontSize: 12, color: '#6C5CE7', fontWeight: '500' },
  dueAt: { fontSize: 12, color: '#95A5A6', marginTop: 4 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  metaText: { fontSize: 12, color: '#95A5A6' },
});
