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
import {
  DataTable,
  type DataTableColumn,
  CenterModal,
  useWebViewportKind,
  showToast,
} from '@adaven/platform-ui';
import { StatusPill } from '@/components/StatusPill';
import { listPageStyles as styles } from '@/lib/list-page-styles';
import {
  createDealer,
  deleteDealers,
  listDealers,
  requireProviderSpace,
  type ProviderDealer,
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

function getColumns(): DataTableColumn<ProviderDealer>[] {
  return [
    {
      id: 'name',
      label: 'Dealer',
      minWidth: 140,
      getValue: (r) => (
        <Text style={cellText} numberOfLines={1}>
          {r.name}
        </Text>
      ),
      getSortValue: (r) => (r.name || '').toLowerCase(),
    },
    {
      id: 'contact',
      label: 'Contact',
      minWidth: 120,
      getValue: (r) => (
        <Text style={cellText} numberOfLines={1}>
          {r.contactName ?? '—'}
        </Text>
      ),
      getSortValue: (r) => (r.contactName ?? '').toLowerCase(),
    },
    {
      id: 'contactEmail',
      label: 'Contact email',
      minWidth: 180,
      getValue: (r) => (
        <Text style={cellText} numberOfLines={1}>
          {r.contactEmail ?? '—'}
        </Text>
      ),
      getSortValue: (r) => (r.contactEmail ?? '').toLowerCase(),
    },
    {
      id: 'status',
      label: 'Status',
      minWidth: 100,
      getValue: (r) => <StatusPill status={r.status} />,
      getSortValue: (r) => r.status,
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

export default function DealersScreen() {
  const router = useRouter();
  const { isDesktopWeb } = useWebViewportKind();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<ProviderDealer[]>([]);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const load = useCallback(async () => {
    const space = await requireProviderSpace();
    if (!space) {
      router.replace('/');
      return;
    }
    setRows(await listDealers(space.id));
  }, [router]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Failed to load dealers', 'error');
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
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.contactName ?? '').toLowerCase().includes(q) ||
          (r.contactEmail ?? '').toLowerCase().includes(q)
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

  const handleCreate = async () => {
    if (!name.trim()) {
      showToast('Dealer name is required', 'error');
      return;
    }
    setSaving(true);
    try {
      const space = await requireProviderSpace();
      if (!space) return;
      const created = await createDealer({
        providerSpaceId: space.id,
        name: name.trim(),
        contactName,
        contactEmail,
      });
      setShowAdd(false);
      setName('');
      setContactName('');
      setContactEmail('');
      await load();
      router.push(`/dealers/${created.id}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to add dealer', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteDealers(selectedIds);
      setSelectedIds([]);
      await load();
      showToast('Dealers removed', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to delete', 'error');
    }
  };

  const columns = useMemo(() => getColumns(), []);

  return (
    <View style={isDesktopWeb ? styles.webContainer : styles.container}>
      <View style={styles.toolbarSlot}>
        {selectedIds.length > 0 ? (
          <View style={styles.bulkBar}>
            <Text style={styles.bulkText}>{selectedIds.length} selected</Text>
            <TouchableOpacity style={styles.bulkBtn} onPress={handleDelete} activeOpacity={0.7}>
              <Ionicons name="trash-outline" size={18} color="#fff" />
              <Text style={styles.bulkBtnText}>Delete</Text>
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
                <Text style={styles.inviteButtonText}>Add dealer</Text>
              </TouchableOpacity>
              <View style={styles.searchContainer}>
                <Ionicons name="search-outline" size={16} color="#95A5A6" style={styles.searchIcon} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search dealers"
                  placeholderTextColor="#95A5A6"
                />
                {query ? (
                  <TouchableOpacity onPress={() => setQuery('')} style={styles.searchClear}>
                    <Ionicons name="close-circle" size={16} color="#B2BEC3" />
                  </TouchableOpacity>
                ) : null}
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
            storageKey="wholestore-dealers"
            selectable
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(id, dir) => {
              setSortKey(id);
              setSortDirection(dir);
            }}
            onRowPress={(r) => router.push(`/dealers/${r.id}`)}
            emptyMessage="No dealers yet"
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
              onPress={() => router.push(`/dealers/${r.id}`)}
              activeOpacity={0.8}
            >
              <Text style={styles.cardTitle}>{r.name}</Text>
              <Text style={styles.cardSub}>{r.contactEmail || r.contactName || '—'}</Text>
              <View style={{ marginTop: 8 }}>
                <StatusPill status={r.status} />
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <CenterModal visible={showAdd} title="Add dealer" onClose={() => setShowAdd(false)} maxWidth={480} cardHeight={420}>
        <TextInput
          style={inputStyle}
          placeholder="Dealer name"
          placeholderTextColor="#95A5A6"
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={inputStyle}
          placeholder="Contact name"
          placeholderTextColor="#95A5A6"
          value={contactName}
          onChangeText={setContactName}
        />
        <TextInput
          style={inputStyle}
          placeholder="Contact email"
          placeholderTextColor="#95A5A6"
          autoCapitalize="none"
          value={contactEmail}
          onChangeText={setContactEmail}
        />
        <TouchableOpacity
          style={[styles.inviteButton, { alignSelf: 'flex-end', marginTop: 16, opacity: saving ? 0.6 : 1 }]}
          onPress={handleCreate}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#6C5CE7" /> : <Text style={styles.inviteButtonText}>Create</Text>}
        </TouchableOpacity>
      </CenterModal>
    </View>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: '#E9ECEF',
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontSize: 15,
  color: '#2D3436',
  marginBottom: 10,
  backgroundColor: '#F8F9FA',
};
