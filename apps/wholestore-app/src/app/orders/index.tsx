import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { DataTable, type DataTableColumn, useWebViewportKind, showToast } from '@adaven/platform-ui';
import { StatusPill } from '@/components/StatusPill';
import { NewOrderModal } from '@/components/NewOrderModal';
import { listPageStyles as styles } from '@/lib/list-page-styles';
import {
  cancelOrders,
  listOrders,
  requireProviderSpace,
  skuSummary,
  type ProviderOrder,
} from '@/lib/provider';

const cellText = { fontSize: 14, color: '#2D3436' };

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'MMM dd, yyyy');
  } catch {
    return '—';
  }
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'MMM dd, yyyy HH:mm');
  } catch {
    return '—';
  }
}

function getColumns(): DataTableColumn<ProviderOrder>[] {
  return [
    {
      id: 'dealerName',
      label: 'Dealer',
      minWidth: 140,
      getValue: (r) => (
        <Text style={cellText} numberOfLines={1}>
          {r.dealerName}
        </Text>
      ),
      getSortValue: (r) => r.dealerName.toLowerCase(),
    },
    {
      id: 'skus',
      label: 'SKUs',
      minWidth: 200,
      getValue: (r) => (
        <Text style={cellText} numberOfLines={1}>
          {skuSummary(r)}
        </Text>
      ),
      getSortValue: (r) => skuSummary(r).toLowerCase(),
    },
    {
      id: 'status',
      label: 'Status',
      minWidth: 100,
      getValue: (r) => <StatusPill status={r.status} />,
      getSortValue: (r) => r.status,
    },
    {
      id: 'updatedAt',
      label: 'Updated',
      minWidth: 120,
      getValue: (r) => <Text style={cellText}>{formatDateTime(r.updatedAt)}</Text>,
      getSortValue: (r) => r.updatedAt,
    },
    {
      id: 'createdAt',
      label: 'Created date',
      minWidth: 110,
      getValue: (r) => <Text style={cellText}>{formatDate(r.createdAt)}</Text>,
      getSortValue: (r) => r.createdAt,
    },
  ];
}

export default function OrdersScreen() {
  const router = useRouter();
  const { isDesktopWeb } = useWebViewportKind();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<ProviderOrder[]>([]);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>('updatedAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    const space = await requireProviderSpace();
    if (!space) {
      router.replace('/');
      return;
    }
    setSpaceId(space.id);
    setRows(await listOrders(space.id));
  }, [router]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Failed to load orders', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = list.filter(
        (r) => r.dealerName.toLowerCase().includes(q) || skuSummary(r).toLowerCase().includes(q) || r.status.includes(q)
      );
    }
    if (sortKey) {
      const dir = sortDirection === 'asc' ? 1 : -1;
      const col = getColumns().find((c) => c.id === sortKey);
      list = [...list].sort((a, b) => {
        const av = String(col?.getSortValue?.(a) ?? '').toLowerCase();
        const bv = String(col?.getSortValue?.(b) ?? '').toLowerCase();
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    }
    return list;
  }, [rows, query, sortKey, sortDirection]);

  const columns = useMemo(() => getColumns(), []);

  return (
    <View style={isDesktopWeb ? styles.webContainer : styles.container}>
      <View style={styles.toolbarSlot}>
        {selectedIds.length > 0 ? (
          <View style={styles.bulkBar}>
            <Text style={styles.bulkText}>{selectedIds.length} selected</Text>
            <TouchableOpacity
              style={styles.bulkBtn}
              onPress={async () => {
                await cancelOrders(selectedIds);
                setSelectedIds([]);
                await load();
              }}
            >
              <Ionicons name="close-circle-outline" size={18} color="#fff" />
              <Text style={styles.bulkBtnText}>Cancel orders</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bulkBtnClear} onPress={() => setSelectedIds([])}>
              <Text style={styles.bulkBtnClearText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <TouchableOpacity style={styles.inviteButton} onPress={() => setShowAdd(true)} activeOpacity={0.7}>
                <Ionicons name="add-circle-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />
                <Text style={styles.inviteButtonText}>Add order</Text>
              </TouchableOpacity>
              <View style={styles.searchContainer}>
                <Ionicons name="search-outline" size={16} color="#95A5A6" style={styles.searchIcon} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search orders"
                  placeholderTextColor="#95A5A6"
                />
              </View>
            </View>
          </View>
        )}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#6C5CE7" style={styles.loader} />
      ) : isDesktopWeb ? (
        <View style={styles.tableWrap}>
          <DataTable
            columns={columns}
            data={filtered}
            keyExtractor={(r) => r.id}
            storageKey="wholestore-orders"
            selectable
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(id, dir) => {
              setSortKey(id);
              setSortDirection(dir);
            }}
            onRowPress={(r) => router.push(`/orders/${r.id}`)}
            emptyMessage="No orders yet"
          />
        </View>
      ) : (
        <ScrollView
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
          {filtered.map((r) => (
            <TouchableOpacity
              key={r.id}
              style={styles.card}
              onPress={() => router.push(`/orders/${r.id}`)}
              activeOpacity={0.8}
            >
              <Text style={styles.cardTitle}>{r.dealerName}</Text>
              <Text style={styles.cardSub}>{skuSummary(r)}</Text>
              <View style={{ marginTop: 8 }}>
                <StatusPill status={r.status} />
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {spaceId ? (
        <NewOrderModal
          visible={showAdd}
          providerSpaceId={spaceId}
          onClose={() => setShowAdd(false)}
          onCreated={(id) => {
            setShowAdd(false);
            load();
            router.push(`/orders/${id}`);
          }}
        />
      ) : null}
    </View>
  );
}
