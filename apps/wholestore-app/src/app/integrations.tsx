import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { showToast } from '@adaven/platform-ui';
import { requireProviderSpace } from '@/lib/provider';
import {
  getErpConnection,
  saveMockErpConnection,
  syncErpProducts,
  testErpConnection,
  type ErpConnection,
} from '@/lib/erp';

export default function IntegrationsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conn, setConn] = useState<ErpConnection | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const space = await requireProviderSpace();
    if (!space) {
      router.replace('/');
      return;
    }
    setSpaceId(space.id);
    setConn(await getErpConnection(space.id));
  }, [router]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Failed to load', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
    }, [load]),
  );

  const connectMock = async () => {
    if (!spaceId) return;
    setBusy(true);
    try {
      await saveMockErpConnection(spaceId);
      showToast('Mock ERP connected', 'success');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Connect failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!spaceId) return;
    setBusy(true);
    try {
      const res = await testErpConnection(spaceId);
      showToast(String(res.message || 'Connection OK'), 'success');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Test failed', 'error');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    if (!spaceId) return;
    setBusy(true);
    try {
      const res = await syncErpProducts(spaceId);
      showToast(`Synced ${res.upserted ?? 0} products`, 'success');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Sync failed', 'error');
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6C5CE7" />
      </View>
    );
  }

  const connected = conn?.status === 'connected';

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <Text style={styles.title}>Integrations</Text>
      <Text style={styles.sub}>Connect an ERP to sync SKUs. Pricing and publish stay in Wholestore.</Text>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Ionicons name="cube-outline" size={22} color="#6C5CE7" />
          <Text style={styles.cardTitle}>Mock ERP (Pouchpies catalog)</Text>
        </View>
        <Text style={styles.body}>
          Development connector seeded with curated food SKUs from pouchpies.com. No live Finale account
          required.
        </Text>
        <Text style={styles.meta}>
          Status: {conn?.status ?? 'disconnected'}
          {conn?.erpProvider ? ` · ${conn.erpProvider}` : ''}
        </Text>
        {conn?.lastSyncAt ? <Text style={styles.meta}>Last sync: {new Date(conn.lastSyncAt).toLocaleString()}</Text> : null}
        {conn?.lastError ? <Text style={styles.error}>{conn.lastError}</Text> : null}

        <View style={styles.row}>
          <TouchableOpacity style={[styles.btn, busy && styles.disabled]} onPress={connectMock} disabled={busy}>
            <Text style={styles.btnText}>{connected ? 'Reconnect Mock' : 'Connect Mock'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnSecondary, (!connected || busy) && styles.disabled]}
            onPress={test}
            disabled={!connected || busy}
          >
            <Text style={styles.btnSecondaryText}>Test</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, (!connected || busy) && styles.disabled]}
            onPress={sync}
            disabled={!connected || busy}
          >
            <Text style={styles.btnText}>Sync products</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.card, styles.mutedCard]}>
        <View style={styles.cardHead}>
          <Ionicons name="lock-closed-outline" size={22} color="#95A5A6" />
          <Text style={styles.cardTitle}>Finale Inventory</Text>
        </View>
        <Text style={styles.body}>
          Placeholder only. Connect after a Finale sandbox or Partner ID is available. Auth will use HTTP Basic
          (API key + secret).
        </Text>
        <TouchableOpacity style={[styles.btnSecondary, styles.disabled]} disabled>
          <Text style={styles.btnSecondaryText}>Unavailable</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { padding: 20, paddingBottom: 48, maxWidth: 720 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#2D3436', marginBottom: 6 },
  sub: { fontSize: 14, color: '#636E72', marginBottom: 20, lineHeight: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  mutedCard: { opacity: 0.9 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#2D3436' },
  body: { fontSize: 14, color: '#636E72', lineHeight: 20, marginBottom: 10 },
  meta: { fontSize: 13, color: '#2D3436', marginBottom: 4 },
  error: { fontSize: 13, color: '#D63031', marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  btn: {
    backgroundColor: '#6C5CE7',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  btnSecondary: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#DFE6E9',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnSecondaryText: { color: '#2D3436', fontWeight: '600', fontSize: 14 },
  disabled: { opacity: 0.5 },
});
