import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { DataTable, type DataTableColumn, CenterModal, showToast } from '@adaven/platform-ui';
import { getCurrentSpace } from '@adaven/platform-core';
import { StatusPill } from '@/components/StatusPill';
import { listPageStyles } from '@/lib/list-page-styles';
import {
  deleteOrderLine,
  getOrder,
  listSkus,
  updateOrderStatus,
  upsertOrderLine,
  type OrderStatus,
  type ProviderOrder,
  type ProviderSku,
} from '@/lib/provider';

const STATUSES: OrderStatus[] = ['onboarding', 'processing', 'completed', 'cancelled'];
const cellText = { fontSize: 14, color: '#2D3436' };

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<'provider' | 'consumer' | null>(null);
  const [order, setOrder] = useState<ProviderOrder | null>(null);
  const [skus, setSkus] = useState<ProviderSku[]>([]);
  const [showAddSku, setShowAddSku] = useState(false);

  const load = useCallback(async () => {
    const space = await getCurrentSpace(true);
    if (!space?.id || (space.kind !== 'provider' && space.kind !== 'consumer')) {
      router.replace('/');
      return;
    }
    const row = await getOrder(id);
    if (!row) {
      showToast('Order not found', 'error');
      router.replace('/orders');
      return;
    }
    if (space.kind === 'consumer' && row.consumerSpaceId !== space.id) {
      showToast('Order not found', 'error');
      router.replace('/orders');
      return;
    }
    setKind(space.kind);
    setOrder(row);
    if (space.kind === 'provider') {
      setSkus(await listSkus(space.id));
    }
  }, [id, router]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  if (loading || !order) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#6C5CE7" />
      </View>
    );
  }

  const isProvider = kind === 'provider';
  const canCancelOnboarding = !isProvider && order.status === 'onboarding';

  const columns: DataTableColumn<ProviderOrder['lines'][number]>[] = [
    {
      id: 'sku',
      label: 'SKU',
      minWidth: 180,
      getValue: (r) => <Text style={cellText}>{r.skuName}</Text>,
    },
    {
      id: 'qty',
      label: 'Qty',
      minWidth: 80,
      stopRowPress: true,
      getValue: (r) =>
        isProvider ? (
          <TextInput
            style={s.qty}
            defaultValue={String(r.quantity)}
            keyboardType="decimal-pad"
            onEndEditing={async (e) => {
              const n = Number(e.nativeEvent.text);
              if (!n || n <= 0) return;
              await upsertOrderLine(order.id, r.skuId, n);
              await load();
            }}
          />
        ) : (
          <Text style={cellText}>{r.quantity}</Text>
        ),
    },
    ...(isProvider
      ? [
          {
            id: 'remove',
            label: '',
            minWidth: 60,
            stopRowPress: true,
            getValue: (r: ProviderOrder['lines'][number]) => (
              <TouchableOpacity
                onPress={async () => {
                  await deleteOrderLine(r.id);
                  await load();
                }}
              >
                <Ionicons name="trash-outline" size={18} color="#E74C3C" />
              </TouchableOpacity>
            ),
          } satisfies DataTableColumn<ProviderOrder['lines'][number]>,
        ]
      : []),
  ];

  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <TouchableOpacity style={s.back} onPress={() => router.push('/orders')}>
        <Ionicons name="chevron-back" size={20} color="#6C5CE7" />
        <Text style={s.backText}>Orders</Text>
      </TouchableOpacity>

      <View style={s.card}>
        <Text style={s.kicker}>Info</Text>
        <Text style={s.title}>{isProvider ? order.dealerName : order.factoryName}</Text>
        <Text style={s.meta}>Created {format(new Date(order.createdAt), 'MMM dd, yyyy')}</Text>
        {isProvider ? (
          <View style={s.statusRow}>
            {STATUSES.map((st) => (
              <TouchableOpacity
                key={st}
                onPress={async () => {
                  await updateOrderStatus(order.id, st);
                  await load();
                }}
              >
                <View style={{ opacity: order.status === st ? 1 : 0.45 }}>
                  <StatusPill status={st} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={[s.statusRow, { alignItems: 'center' }]}>
            <StatusPill status={order.status} />
            {canCancelOnboarding ? (
              <TouchableOpacity
                style={listPageStyles.inviteButton}
                onPress={async () => {
                  await updateOrderStatus(order.id, 'cancelled');
                  await load();
                }}
              >
                <Text style={listPageStyles.inviteButtonText}>Cancel order</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </View>

      <View style={s.linesHead}>
        <Text style={s.section}>SKUs</Text>
        {isProvider ? (
          <TouchableOpacity style={listPageStyles.inviteButton} onPress={() => setShowAddSku(true)}>
            <Ionicons name="add-circle-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />
            <Text style={listPageStyles.inviteButtonText}>Add SKU</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <DataTable
        columns={columns}
        data={order.lines}
        keyExtractor={(r) => r.id}
        storageKey="wholestore-order-lines"
        emptyMessage="No SKUs on this order"
      />

      {isProvider ? (
        <CenterModal visible={showAddSku} title="Add SKU" onClose={() => setShowAddSku(false)} maxWidth={440} cardHeight={420}>
          {skus
            .filter((sku) => !order.lines.some((l) => l.skuId === sku.id))
            .map((sku) => (
              <TouchableOpacity
                key={sku.id}
                style={s.pickRow}
                onPress={async () => {
                  await upsertOrderLine(order.id, sku.id, 1);
                  setShowAddSku(false);
                  await load();
                }}
              >
                <Text style={s.pickText}>{sku.name}</Text>
              </TouchableOpacity>
            ))}
        </CenterModal>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { padding: 20, paddingBottom: 48 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backText: { fontSize: 15, fontWeight: '600', color: '#6C5CE7' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DEE2E6',
    padding: 16,
    marginBottom: 20,
  },
  kicker: { fontSize: 11, fontWeight: '700', color: '#95A5A6', letterSpacing: 0.7, textTransform: 'uppercase' },
  title: { fontSize: 22, fontWeight: '800', color: '#2D3436', marginTop: 6 },
  meta: { fontSize: 14, color: '#636E72', marginTop: 4 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  linesHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  section: { fontSize: 18, fontWeight: '600', color: '#2D3436' },
  qty: {
    width: 64,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    textAlign: 'center',
  },
  pickRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E9ECEF' },
  pickText: { fontSize: 15, color: '#2D3436' },
});
