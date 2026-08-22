import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { DataTable, type DataTableColumn, showToast, useWebViewportKind } from '@adaven/platform-ui';
import { StatusPill } from '@/components/StatusPill';
import { NewOrderModal } from '@/components/NewOrderModal';
import { listPageStyles } from '@/lib/list-page-styles';
import {
  getDealer,
  listOrdersForDealer,
  requireProviderSpace,
  skuSummary,
  updateDealer,
  type ProviderDealer,
  type ProviderOrder,
} from '@/lib/provider';

const cellText = { fontSize: 14, color: '#2D3436' };

export default function DealerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isDesktopWeb } = useWebViewportKind();
  const [loading, setLoading] = useState(true);
  const [dealer, setDealer] = useState<ProviderDealer | null>(null);
  const [orders, setOrders] = useState<ProviderOrder[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [spaceId, setSpaceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const space = await requireProviderSpace();
    if (!space) {
      router.replace('/');
      return;
    }
    setSpaceId(space.id);
    const row = await getDealer(id);
    if (!row) {
      showToast('Dealer not found', 'error');
      router.replace('/dealers');
      return;
    }
    setDealer(row);
    setName(row.name);
    setContactName(row.contactName ?? '');
    setContactEmail(row.contactEmail ?? '');
    setOrders(await listOrdersForDealer(row.id));
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

  const columns: DataTableColumn<ProviderOrder>[] = [
    {
      id: 'skus',
      label: 'SKUs',
      minWidth: 200,
      getValue: (r) => <Text style={cellText}>{skuSummary(r)}</Text>,
    },
    {
      id: 'status',
      label: 'Status',
      minWidth: 100,
      getValue: (r) => <StatusPill status={r.status} />,
    },
    {
      id: 'createdAt',
      label: 'Created date',
      minWidth: 110,
      getValue: (r) => <Text style={cellText}>{format(new Date(r.createdAt), 'MMM dd, yyyy')}</Text>,
    },
  ];

  const save = async () => {
    if (!dealer) return;
    await updateDealer(dealer.id, { name, contactName, contactEmail });
    setEditing(false);
    await load();
  };

  if (loading || !dealer) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#6C5CE7" />
      </View>
    );
  }

  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <TouchableOpacity style={s.back} onPress={() => router.push('/dealers')}>
        <Ionicons name="chevron-back" size={20} color="#6C5CE7" />
        <Text style={s.backText}>Dealers</Text>
      </TouchableOpacity>

      <View style={s.card}>
        <View style={s.cardHead}>
          <Text style={s.kicker}>Info</Text>
          <TouchableOpacity onPress={() => (editing ? save() : setEditing(true))}>
            <Text style={s.link}>{editing ? 'Save' : 'Edit'}</Text>
          </TouchableOpacity>
        </View>
        {editing ? (
          <>
            <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Dealer name" />
            <TextInput style={s.input} value={contactName} onChangeText={setContactName} placeholder="Contact" />
            <TextInput style={s.input} value={contactEmail} onChangeText={setContactEmail} placeholder="Email" />
          </>
        ) : (
          <>
            <Text style={s.title}>{dealer.name}</Text>
            <Text style={s.meta}>{dealer.contactName || '—'}</Text>
            <Text style={s.meta}>{dealer.contactEmail || '—'}</Text>
            <View style={{ marginTop: 8 }}>
              <StatusPill status={dealer.status} />
            </View>
          </>
        )}
      </View>

      <View style={s.ordersHead}>
        <Text style={s.section}>Orders</Text>
        <TouchableOpacity style={listPageStyles.inviteButton} onPress={() => setShowAdd(true)}>
          <Ionicons name="add-circle-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />
          <Text style={listPageStyles.inviteButtonText}>Add order</Text>
        </TouchableOpacity>
      </View>

      {isDesktopWeb ? (
        <DataTable
          columns={columns}
          data={orders}
          keyExtractor={(r) => r.id}
          storageKey="wholestore-dealer-orders"
          onRowPress={(r) => router.push(`/orders/${r.id}`)}
          emptyMessage="No orders yet"
        />
      ) : (
        orders.map((r) => (
          <TouchableOpacity key={r.id} style={listPageStyles.card} onPress={() => router.push(`/orders/${r.id}`)}>
            <Text style={listPageStyles.cardTitle}>{skuSummary(r)}</Text>
            <StatusPill status={r.status} />
          </TouchableOpacity>
        ))
      )}

      {spaceId ? (
        <NewOrderModal
          visible={showAdd}
          providerSpaceId={spaceId}
          presetDealerId={dealer.id}
          onClose={() => setShowAdd(false)}
          onCreated={(orderId) => {
            setShowAdd(false);
            load();
            router.push(`/orders/${orderId}`);
          }}
        />
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
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  kicker: { fontSize: 11, fontWeight: '700', color: '#95A5A6', letterSpacing: 0.7, textTransform: 'uppercase' },
  link: { color: '#6C5CE7', fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '800', color: '#2D3436' },
  meta: { fontSize: 14, color: '#636E72', marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: '#F8F9FA',
  },
  ordersHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  section: { fontSize: 18, fontWeight: '600', color: '#2D3436' },
});
