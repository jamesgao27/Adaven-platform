import { useEffect, useState, useMemo, useCallback, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
  Platform,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import QRCode from 'react-native-qrcode-svg';
import {
  DataTable,
  type DataTableColumn,
  CenterModal,
  WEB_POPOVER,
  useWebViewportKind,
  showToast,
  showConfirmDestructiveDialog,
} from '@adaven/platform-ui';
import { listPageStyles as chrome } from '@/lib/list-page-styles';
import {
  deleteDealers,
  listDealersWithDetails,
  listSkus,
  requireProviderSpace,
  type ProviderDealerWithDetails,
  DEALER_DISPLAY_STATUS_LABELS,
} from '@/lib/provider';
import { listPosters, posterSkuNames, type ProviderPoster } from '@/lib/posters';
import {
  buildDealerInviteUrl,
  createDealerInviteToken,
  deleteDealerInviteToken,
  getDealerInviteHistory,
  setDealerInviteActive,
  type DealerInviteToken,
} from '@/lib/dealer-invites';
import FactoryAddDealerModal from '@/components/FactoryAddDealerModal';
import FactoryOpenInviteHistoryTable from '@/components/FactoryOpenInviteHistoryTable';

const cellText = { fontSize: 14, color: '#2D3436' };
const CLIENT_TYPE_DOT = { client: '#27AE60', pendingInvitee: '#F39C12' } as const;
const DISPLAY_STATUS_COLOR: Record<string, string> = {
  new: '#0984E3',
  to_follow_up: '#F39C12',
  in_service: '#00B894',
  to_revisit: '#6C5CE7',
  churned: '#B2BEC3',
};

type GroupByType = 'none' | 'byName' | 'byStatus';
type FilterStatus = 'all' | 'new' | 'to_follow_up' | 'in_service' | 'to_revisit' | 'churned';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'MMM dd, yyyy');
  } catch {
    return '—';
  }
}

function DealerNameCell({ name, isPendingClaim }: { name: string; isPendingClaim?: boolean }) {
  const color = isPendingClaim ? CLIENT_TYPE_DOT.pendingInvitee : CLIENT_TYPE_DOT.client;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginRight: 6, flexShrink: 0 }} />
      <Text style={[cellText, { flex: 1, minWidth: 0 }]} numberOfLines={1}>
        {name || '—'}
      </Text>
    </View>
  );
}

function getDealerColumns(): DataTableColumn<ProviderDealerWithDetails>[] {
  return [
    {
      id: 'name',
      label: 'Dealer',
      minWidth: 140,
      getValue: (r) => <DealerNameCell name={r.name} isPendingClaim={r.isPendingClaim} />,
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
      id: 'displayStatus',
      label: 'Status',
      minWidth: 100,
      getValue: (r) => {
        const firstTag = r.labels?.[0];
        if (firstTag) {
          return (
            <View style={{ flexDirection: 'row', alignSelf: 'flex-start' }}>
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: '#6C5CE7' }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#fff' }} numberOfLines={1}>
                  {firstTag}
                </Text>
              </View>
            </View>
          );
        }
        const raw = r.displayStatus ?? '';
        const label = DEALER_DISPLAY_STATUS_LABELS[raw] ?? raw ?? '—';
        const color = DISPLAY_STATUS_COLOR[raw] ?? '#636E72';
        return (
          <View style={{ flexDirection: 'row', alignSelf: 'flex-start' }}>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: color }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#fff' }} numberOfLines={1}>
                {label}
              </Text>
            </View>
          </View>
        );
      },
      getSortValue: (r) => r.labels?.[0] ?? r.displayStatus ?? '',
    },
    {
      id: 'assignee',
      label: 'Assignee',
      minWidth: 100,
      getValue: () => (
        <Text style={cellText} numberOfLines={1}>
          —
        </Text>
      ),
      getSortValue: () => '',
    },
    {
      id: 'lastFollowUpAt',
      label: 'Last follow-up',
      minWidth: 110,
      getValue: (r) => (
        <Text style={cellText} numberOfLines={1}>
          {formatDate(r.lastFollowUpAt)}
        </Text>
      ),
      getSortValue: (r) => r.lastFollowUpAt ?? '',
    },
    {
      id: 'serviceStartAt',
      label: 'First order',
      minWidth: 110,
      getValue: (r) => (
        <Text style={cellText} numberOfLines={1}>
          {formatDate(r.firstOrderAt)}
        </Text>
      ),
      getSortValue: (r) => r.firstOrderAt ?? '',
    },
  ];
}

function matchQuery(q: string, dealer: ProviderDealerWithDetails): boolean {
  const lower = q.trim().toLowerCase();
  if (!lower) return true;
  return (
    dealer.name.toLowerCase().includes(lower) ||
    (dealer.contactName || '').toLowerCase().includes(lower) ||
    (dealer.contactEmail || '').toLowerCase().includes(lower) ||
    (dealer.displayStatus || '').toLowerCase().includes(lower) ||
    (dealer.labels || []).join(' ').toLowerCase().includes(lower)
  );
}

export default function DealersScreen() {
  const router = useRouter();
  const { isDesktopWeb } = useWebViewportKind();
  const qrRef = useRef<any | null>(null);
  const columns = useMemo(() => getDealerColumns(), []);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<ProviderDealerWithDetails[]>([]);
  const [providerSpaceId, setProviderSpaceId] = useState<string | null>(null);
  const [factoryName, setFactoryName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupByType>('none');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [groupPopoverRect, setGroupPopoverRect] = useState<{ left: number; top: number } | null>(null);
  const [filterPopoverRect, setFilterPopoverRect] = useState<{ left: number; top: number } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [showInviteHistory, setShowInviteHistory] = useState(false);
  const [inviteFromHistory, setInviteFromHistory] = useState(false);
  const [invitePosters, setInvitePosters] = useState<ProviderPoster[]>([]);
  const [invitePosterId, setInvitePosterId] = useState<string | null>(null);
  const [inviteCatalogSkus, setInviteCatalogSkus] = useState<Awaited<ReturnType<typeof listSkus>>>([]);
  const [inviteExpiresInDays, setInviteExpiresInDays] = useState<number | null>(7);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteHistory, setInviteHistory] = useState<DealerInviteToken[]>([]);
  const [inviteHistoryLoading, setInviteHistoryLoading] = useState(false);
  const [inviteHistoryError, setInviteHistoryError] = useState<string | null>(null);
  const [updatingInviteId, setUpdatingInviteId] = useState<string | null>(null);
  const [deletingInviteId, setDeletingInviteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const space = await requireProviderSpace();
    if (!space) {
      router.replace('/');
      return;
    }
    setProviderSpaceId(space.id);
    setFactoryName(space.name ?? '');
    setRows(await listDealersWithDetails(space.id));
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

  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    if (showGroupMenu) {
      const measure = () => {
        const el = document.getElementById('factory-dealers-group-button');
        if (el) {
          const r = el.getBoundingClientRect();
          setGroupPopoverRect({ left: r.left, top: r.bottom + 6 });
        }
      };
      measure();
      const t = requestAnimationFrame(measure);
      return () => cancelAnimationFrame(t);
    }
    setGroupPopoverRect(null);
  }, [showGroupMenu]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    if (showFilterMenu) {
      const measure = () => {
        const el = document.getElementById('factory-dealers-filter-button');
        if (el) {
          const r = el.getBoundingClientRect();
          setFilterPopoverRect({ left: r.left, top: r.bottom + 6 });
        }
      };
      measure();
      const t = requestAnimationFrame(measure);
      return () => cancelAnimationFrame(t);
    }
    setFilterPopoverRect(null);
  }, [showFilterMenu]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: PointerEvent) => {
      const target = e.target as Node;
      const groupBtn = document.getElementById('factory-dealers-group-button');
      const groupPopover = document.getElementById('factory-dealers-group-popover');
      const filterBtn = document.getElementById('factory-dealers-filter-button');
      const filterPopover = document.getElementById('factory-dealers-filter-popover');
      if (showGroupMenu && groupBtn && !groupBtn.contains(target) && groupPopover && !groupPopover.contains(target)) {
        setShowGroupMenu(false);
      }
      if (showFilterMenu && filterBtn && !filterBtn.contains(target) && filterPopover && !filterPopover.contains(target)) {
        setShowFilterMenu(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [showGroupMenu, showFilterMenu]);

  const filtered = useMemo(() => {
    const byStatus = filterStatus === 'all' ? rows : rows.filter((r) => r.displayStatus === filterStatus);
    return byStatus.filter((r) => matchQuery(searchQuery, r));
  }, [rows, filterStatus, searchQuery]);

  const sortRows = useCallback(
    <T,>(list: T[], col: { getSortValue?: (row: T) => string | number | Date | null | undefined } | undefined, dir: 'asc' | 'desc') => {
      if (!col?.getSortValue) return list;
      return [...list].sort((a, b) => {
        const va = col.getSortValue!(a);
        const vb = col.getSortValue!(b);
        const cmp = va === vb ? 0 : va == null ? 1 : vb == null ? -1 : va < vb ? -1 : 1;
        return dir === 'asc' ? cmp : -cmp;
      });
    },
    []
  );

  const groupedSections = useMemo(() => {
    if (groupBy === 'none') return [{ title: 'All', data: filtered }];
    if (groupBy === 'byName') {
      const byLetter: Record<string, ProviderDealerWithDetails[]> = {};
      filtered.forEach((c) => {
        const first = (c.name || '').trim().charAt(0).toUpperCase();
        const key = /[A-Z]/.test(first) ? first : '#';
        if (!byLetter[key]) byLetter[key] = [];
        byLetter[key].push(c);
      });
      const keys = Object.keys(byLetter).sort((a, b) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)));
      return keys.map((k) => ({ title: k, data: byLetter[k] }));
    }
    const order: FilterStatus[] = ['new', 'to_follow_up', 'in_service', 'to_revisit', 'churned'];
    const byStatus: Record<string, ProviderDealerWithDetails[]> = {};
    filtered.forEach((c) => {
      const key = c.displayStatus ?? 'new';
      if (!byStatus[key]) byStatus[key] = [];
      byStatus[key].push(c);
    });
    return order
      .filter((k) => (byStatus[k]?.length ?? 0) > 0)
      .map((k) => ({ title: DEALER_DISPLAY_STATUS_LABELS[k] ?? k, data: byStatus[k] ?? [] }));
  }, [groupBy, filtered]);

  const tableSections = useMemo(() => {
    const col = sortKey ? columns.find((c) => c.id === sortKey) : undefined;
    return groupedSections.map((sec) => ({
      title: sec.title,
      data: sortRows(sec.data, col, sortDirection),
      count: sec.data.length,
      countLabel: 'dealers',
    }));
  }, [groupedSections, sortKey, sortDirection, columns, sortRows]);

  const sortedDataForTable = useMemo(() => {
    const col = sortKey ? columns.find((c) => c.id === sortKey) : undefined;
    return sortRows(filtered, col, sortDirection);
  }, [filtered, sortKey, sortDirection, columns, sortRows]);

  const loadPublishedPosters = useCallback(async () => {
    if (!providerSpaceId) return [];
    const [all, catalog] = await Promise.all([listPosters(providerSpaceId), listSkus(providerSpaceId)]);
    const published = all.filter((p) => p.isPublished);
    setInvitePosters(published);
    setInviteCatalogSkus(catalog);
    if (published.length && !invitePosterId) {
      const featured = published.find((p) => p.isMarketplaceFeatured) ?? published.find((p) => p.isSystemDefault);
      setInvitePosterId((featured ?? published[0]).id);
    }
    return published;
  }, [providerSpaceId, invitePosterId]);

  const handleOpenInviteHistory = useCallback(async () => {
    if (!providerSpaceId) return;
    setShowInviteHistory(true);
    setInviteHistoryLoading(true);
    setInviteHistoryError(null);
    const [history, posters, catalog] = await Promise.all([
      getDealerInviteHistory(providerSpaceId),
      listPosters(providerSpaceId),
      listSkus(providerSpaceId),
    ]);
    setInvitePosters(posters);
    setInviteCatalogSkus(catalog);
    if (history.error) setInviteHistoryError(history.error.message);
    setInviteHistory(history.invites);
    setInviteHistoryLoading(false);
  }, [providerSpaceId]);

  const handleCreateNewFromHistory = useCallback(async () => {
    setShowInviteHistory(false);
    setInviteFromHistory(false);
    setInviteError(null);
    setInviteLink(null);
    setInviteExpiresInDays(7);
    setShowInvitePanel(true);
    const posters = await loadPublishedPosters();
    if (posters.length) {
      const featured = posters.find((p) => p.isMarketplaceFeatured) ?? posters.find((p) => p.isSystemDefault);
      setInvitePosterId((featured ?? posters[0]).id);
    }
  }, [loadPublishedPosters]);

  const handleOpenInviteFromHistory = useCallback(
    (row: DealerInviteToken) => {
      setInviteLink(buildDealerInviteUrl(row.token, factoryName));
      setInvitePosterId(row.posterId);
      setInviteExpiresInDays(row.expiresAt ? 7 : null);
      setShowInviteHistory(false);
      setInviteFromHistory(true);
      setShowInvitePanel(true);
    },
    [factoryName]
  );

  const handleCreateInvite = useCallback(async () => {
    if (!providerSpaceId || !invitePosterId) return;
    setInviteLoading(true);
    setInviteError(null);
    const { token, url, error } = await createDealerInviteToken(
      providerSpaceId,
      invitePosterId,
      inviteExpiresInDays ?? undefined
    );
    setInviteLoading(false);
    if (error || !token) {
      setInviteError(error?.message || 'Failed to create invite. Please try again.');
      return;
    }
    const linkUrl = url || buildDealerInviteUrl(token, factoryName);
    setInviteLink(linkUrl);
    if (typeof window !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(linkUrl);
      } catch {
        /* ignore */
      }
    }
  }, [providerSpaceId, invitePosterId, inviteExpiresInDays, factoryName]);

  const handleCopyInviteLink = useCallback(async () => {
    if (!inviteLink || typeof window === 'undefined') return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      showToast('Link copied', 'success');
    } catch {
      /* ignore */
    }
  }, [inviteLink]);

  const handleDownloadInviteQr = useCallback(() => {
    if (!inviteLink || !qrRef.current || Platform.OS !== 'web') return;
    try {
      qrRef.current.toDataURL((data: string) => {
        const a = document.createElement('a');
        a.href = `data:image/png;base64,${data}`;
        a.download = 'wholestore-dealer-invite-qr.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
    } catch {
      /* ignore */
    }
  }, [inviteLink]);

  const handleToggleInviteActive = useCallback(async (row: DealerInviteToken) => {
    const next = !row.isActive;
    setUpdatingInviteId(row.id);
    setInviteHistory((prev) => prev.map((it) => (it.id === row.id ? { ...it, isActive: next } : it)));
    const { error } = await setDealerInviteActive(row.id, next);
    setUpdatingInviteId(null);
    if (error) {
      setInviteHistory((prev) => prev.map((it) => (it.id === row.id ? { ...it, isActive: row.isActive } : it)));
      setInviteHistoryError(error.message);
    }
  }, []);

  const handleDeleteInvite = useCallback((row: DealerInviteToken) => {
    showConfirmDestructiveDialog(
      'Delete invite',
      'Delete this invite? The link will stop working.',
      async () => {
        setDeletingInviteId(row.id);
        const { error } = await deleteDealerInviteToken(row.id);
        setDeletingInviteId(null);
        if (error) {
          setInviteHistoryError(error.message);
          return;
        }
        setInviteHistory((prev) => prev.filter((it) => it.id !== row.id));
      },
      { confirmLabel: 'Delete' }
    );
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (!selectedIds.length) return;
    setBulkDeleting(true);
    try {
      await deleteDealers(selectedIds);
      setSelectedIds([]);
      await load();
      showToast('Dealers removed', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to delete', 'error');
    } finally {
      setBulkDeleting(false);
    }
  }, [selectedIds, load]);

  const selectedPoster = invitePosters.find((p) => p.id === invitePosterId) ?? null;

  const toolbar = (
    <View style={[chrome.toolbarSlot, (showGroupMenu || showFilterMenu) && chrome.toolbarSlotDropdownOpen]}>
      {selectedIds.length > 0 ? (
        <View style={chrome.bulkBar}>
          <Text style={chrome.bulkText}>{selectedIds.length} selected</Text>
          <TouchableOpacity
            style={[chrome.bulkBtn, chrome.bulkBtnDanger, bulkDeleting && chrome.bulkBtnDisabled]}
            onPress={handleBulkDelete}
            disabled={bulkDeleting}
            activeOpacity={0.7}
          >
            {bulkDeleting ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="trash-outline" size={18} color="#fff" />}
            <Text style={chrome.bulkBtnText}>Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity style={chrome.bulkBtnClear} onPress={() => setSelectedIds([])} activeOpacity={0.7}>
            <Text style={chrome.bulkBtnClearText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={chrome.header}>
          <View style={chrome.headerRow}>
            <TouchableOpacity
              style={[chrome.inviteButton, { marginRight: 8 }]}
              onPress={() => setShowAddModal(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="person-add-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />
              <Text style={chrome.inviteButtonText}>Add dealer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={chrome.inviteHistoryButton} onPress={handleOpenInviteHistory} activeOpacity={0.7}>
              <Ionicons name="qr-code-outline" size={18} color="#636E72" style={{ marginRight: 4 }} />
              <Text style={chrome.inviteHistoryButtonText}>Open invite</Text>
            </TouchableOpacity>
            <View style={chrome.groupWrap} {...(isDesktopWeb ? { nativeID: 'factory-dealers-group-button' } : {})}>
              <TouchableOpacity
                style={chrome.sortButton}
                onPress={() => {
                  setShowFilterMenu(false);
                  setShowGroupMenu(true);
                }}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={groupBy === 'byName' ? 'albums-outline' : groupBy === 'byStatus' ? 'flag-outline' : 'list-outline'}
                  size={18}
                  color="#6C5CE7"
                  style={{ marginRight: 4 }}
                />
                <Text style={chrome.sortText}>Group</Text>
                <Ionicons name="chevron-down" size={16} color="#636E72" />
              </TouchableOpacity>
              {showGroupMenu && Platform.OS !== 'web' ? (
                <View style={chrome.groupDropdown}>
                  {(['none', 'byName', 'byStatus'] as GroupByType[]).map((key) => (
                    <TouchableOpacity
                      key={key}
                      style={[chrome.groupOption, groupBy === key && chrome.groupOptionSelected]}
                      onPress={() => {
                        setGroupBy(key);
                        setShowGroupMenu(false);
                      }}
                    >
                      <Text style={[chrome.groupOptionText, groupBy === key && chrome.groupOptionTextSelected]}>
                        {key === 'none' ? 'None' : key === 'byName' ? 'By name' : 'By status'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>
            <View style={chrome.groupWrap} {...(isDesktopWeb ? { nativeID: 'factory-dealers-filter-button' } : {})}>
              <TouchableOpacity
                style={chrome.filterButton}
                onPress={() => {
                  setShowGroupMenu(false);
                  setShowFilterMenu(true);
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="filter-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />
                <Text style={chrome.filterText}>
                  Filter
                  {filterStatus !== 'all' ? <Text style={chrome.filterBadge}> (1)</Text> : null}
                </Text>
                <Ionicons name="chevron-down" size={16} color="#636E72" />
              </TouchableOpacity>
            </View>
            <View style={chrome.searchContainer}>
              <Ionicons name="search" size={18} color="#636E72" style={chrome.searchIcon} />
              <TextInput
                style={chrome.searchInput}
                placeholder="Search"
                placeholderTextColor="#95A5A6"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchQuery.trim() ? (
                <TouchableOpacity onPress={() => setSearchQuery('')} style={chrome.searchClear}>
                  <Ionicons name="close-circle" size={20} color="#95A5A6" />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      )}
    </View>
  );

  return (
    <View style={isDesktopWeb ? chrome.webContainer : chrome.container}>
      {toolbar}
      {loading && rows.length === 0 ? (
        <View style={chrome.emptyContainer}>
          <ActivityIndicator size="large" color="#6C5CE7" />
          <Text style={chrome.emptyText}>Loading...</Text>
        </View>
      ) : isDesktopWeb ? (
        <ScrollView
          style={chrome.tableScroll}
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
          <View style={chrome.tableWrap}>
            <DataTable
              columns={columns}
              data={groupBy === 'none' ? sortedDataForTable : undefined}
              sections={groupBy !== 'none' ? tableSections : undefined}
              keyExtractor={(r) => r.id}
              storageKey="wholestore-dealers"
              selectable
              selectableRevealOnHover
              selectedIds={selectedIds}
              onSelectedIdsChange={setSelectedIds}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={(id, dir) => {
                setSortKey(id);
                setSortDirection(dir);
              }}
              onRowPress={(r) => router.push(`/dealers/${r.id}`)}
              emptyMessage={rows.length === 0 ? 'No dealers yet. Add a directed invite or share an open invite.' : `No results for "${searchQuery}"`}
            />
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={chrome.content}
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
          {sortedDataForTable.map((r) => (
            <TouchableOpacity key={r.id} style={chrome.card} onPress={() => router.push(`/dealers/${r.id}`)} activeOpacity={0.8}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <DealerNameCell name={r.name} isPendingClaim={r.isPendingClaim} />
              </View>
              <Text style={chrome.cardSub}>{r.contactEmail || r.contactName || '—'}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <CenterModal
        visible={showInvitePanel}
        title="Invite new dealers"
        onClose={() => {
          setShowInvitePanel(false);
          if (inviteFromHistory) {
            setShowInviteHistory(true);
            setInviteFromHistory(false);
          }
        }}
        maxWidth={900}
        cardHeight={720}
      >
        <View style={inviteStyles.inviteHeader}>
          <Text style={inviteStyles.inviteSubtitle}>
            Step 1: choose a published poster for this invite.{'\n'}Step 2: configure invite expiry and share the link / QR.
          </Text>
        </View>
        <View style={inviteStyles.inviteBodyRow}>
          <View style={inviteStyles.inviteLeftColumn}>
            <Text style={inviteStyles.inviteSectionTitle}>Step 1 · Select poster</Text>
            <View style={inviteStyles.inviteSkuTable}>
              <View style={inviteStyles.inviteSkuHeaderRow}>
                <Text style={[inviteStyles.inviteSkuHeaderText, { flex: 1.6 }]}>Poster</Text>
              </View>
              <ScrollView style={inviteStyles.inviteSkuList} contentContainerStyle={inviteStyles.inviteSkuListContent}>
                {invitePosters.map((poster, index) => (
                  <TouchableOpacity
                    key={poster.id}
                    style={[
                      inviteStyles.inviteSkuRow,
                      invitePosterId === poster.id && inviteStyles.inviteSkuRowSelected,
                      index === invitePosters.length - 1 && { borderBottomWidth: 0 },
                    ]}
                    onPress={inviteFromHistory ? undefined : () => setInvitePosterId(poster.id)}
                    activeOpacity={inviteFromHistory ? 1 : 0.7}
                  >
                    <Text
                      style={[
                        inviteStyles.inviteSkuName,
                        invitePosterId === poster.id && inviteStyles.inviteSkuNameSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {poster.name}
                      {poster.isSystemDefault ? ' · Default' : ''}
                      {poster.isMarketplaceFeatured ? ' · Featured' : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
                {invitePosters.length === 0 ? (
                  <Text style={inviteStyles.inviteHintText}>Publish a poster in Marketing first.</Text>
                ) : null}
              </ScrollView>
            </View>
            <View style={{ marginTop: 36 }}>
              <Text style={inviteStyles.inviteSectionTitle}>Step 2 · Expiry setting</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={inviteStyles.invitePillRow}>
                  {[
                    { label: '7 days', value: 7 as number | null },
                    { label: '30 days', value: 30 },
                    { label: 'No expiry', value: null },
                  ].map((opt) => (
                    <TouchableOpacity
                      key={String(opt.value ?? 'forever')}
                      style={[inviteStyles.invitePill, inviteExpiresInDays === opt.value && inviteStyles.invitePillSelected]}
                      onPress={inviteFromHistory ? undefined : () => setInviteExpiresInDays(opt.value)}
                      activeOpacity={inviteFromHistory ? 1 : 0.7}
                    >
                      <Text
                        style={[
                          inviteStyles.invitePillText,
                          inviteExpiresInDays === opt.value && inviteStyles.invitePillTextSelected,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {!inviteFromHistory ? (
                  <TouchableOpacity
                    style={[inviteStyles.invitePrimaryBtn, (!invitePosterId || inviteLoading) && inviteStyles.invitePrimaryBtnDisabled]}
                    onPress={handleCreateInvite}
                    disabled={!invitePosterId || inviteLoading}
                    activeOpacity={0.8}
                  >
                    {inviteLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Ionicons name="link-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
                    )}
                    <Text style={inviteStyles.invitePrimaryBtnText}>{inviteLoading ? 'Generating...' : 'Generate invite link'}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
            {!inviteFromHistory && inviteError ? <Text style={inviteStyles.inviteErrorText}>{inviteError}</Text> : null}
            {inviteLink ? (
              <View style={[inviteStyles.inviteResultRow, { marginTop: 36, flexDirection: 'column', alignItems: 'stretch' }]}>
                <View style={inviteStyles.inviteQrLinkRow}>
                  <View style={inviteStyles.inviteResultBlock}>
                    <View style={inviteStyles.inviteQrBox}>
                      <QRCode
                        value={inviteLink}
                        size={112}
                        getRef={(c) => {
                          qrRef.current = c;
                        }}
                      />
                    </View>
                    {isDesktopWeb ? (
                      <TouchableOpacity
                        style={[inviteStyles.inviteSecondaryBtn, { marginTop: 8 }]}
                        onPress={handleDownloadInviteQr}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="download-outline" size={16} color="#6C5CE7" style={{ marginRight: 4 }} />
                        <Text style={inviteStyles.inviteSecondaryBtnText}>Download QR</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <View style={inviteStyles.inviteResultBlock}>
                    <View style={inviteStyles.inviteLinkBlockInner}>
                      <View style={inviteStyles.inviteLinkContentTop}>
                        <Text style={inviteStyles.inviteLinkLabel}>Invite link</Text>
                        <View style={inviteStyles.inviteLinkCodeBox}>
                          <Text style={inviteStyles.inviteLinkCodeText} numberOfLines={5}>
                            {inviteLink}
                          </Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        style={[inviteStyles.inviteSecondaryBtn, inviteStyles.inviteCopyBtn]}
                        onPress={handleCopyInviteLink}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="copy-outline" size={16} color="#6C5CE7" style={{ marginRight: 4 }} />
                        <Text style={inviteStyles.inviteSecondaryBtnText}>Copy link</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>
            ) : null}
          </View>
          <View style={inviteStyles.inviteRightColumn}>
            <Text style={inviteStyles.inviteSectionTitle}>Poster preview</Text>
            <View style={inviteStyles.previewCard}>
              <Text style={inviteStyles.previewTitle}>{selectedPoster?.name ?? 'Select a published poster'}</Text>
              <Text style={inviteStyles.previewDesc}>
                {selectedPoster?.description ||
                  'When a dealer accepts this open invite they enroll with your factory. No order is created.'}
              </Text>
              {selectedPoster ? (
                <Text style={[inviteStyles.previewDesc, { marginTop: 8 }]}>
                  {posterSkuNames(selectedPoster, inviteCatalogSkus) || 'No published SKUs on this poster yet.'}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      </CenterModal>

      <CenterModal
        visible={showInviteHistory}
        title="Open invite"
        onClose={() => setShowInviteHistory(false)}
        maxWidth={900}
        contentFillsHeight
      >
        <FactoryOpenInviteHistoryTable
          invites={inviteHistory}
          invitePosters={invitePosters}
          loading={inviteHistoryLoading}
          error={inviteHistoryError}
          updatingInviteId={updatingInviteId}
          deletingInviteId={deletingInviteId}
          onRowPress={handleOpenInviteFromHistory}
          onToggleActive={handleToggleInviteActive}
          onDelete={handleDeleteInvite}
          onCreateNewFromHistory={handleCreateNewFromHistory}
        />
      </CenterModal>

      <FactoryAddDealerModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        providerSpaceId={providerSpaceId}
        onSuccess={load}
      />

      {isDesktopWeb &&
        showGroupMenu &&
        groupPopoverRect &&
        typeof document !== 'undefined' &&
        document.body &&
        createPortal(
          <div
            id="factory-dealers-group-popover"
            style={{ ...WEB_POPOVER.container, left: groupPopoverRect.left, top: groupPopoverRect.top }}
          >
            <Text style={WEB_POPOVER.title}>Group</Text>
            <View>
              {(
                [
                  { key: 'none' as GroupByType, label: 'None', icon: 'list-outline' as const },
                  { key: 'byName' as GroupByType, label: 'By name', icon: 'albums-outline' as const },
                  { key: 'byStatus' as GroupByType, label: 'By status', icon: 'flag-outline' as const },
                ] as const
              ).map(({ key, label, icon }) => (
                <TouchableOpacity
                  key={key}
                  onPress={() => {
                    setGroupBy(key);
                    setShowGroupMenu(false);
                  }}
                  style={WEB_POPOVER.optionRow}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <Ionicons name={icon} size={18} color={groupBy === key ? '#6C5CE7' : '#636E72'} style={{ marginRight: 8 }} />
                    <Text
                      style={
                        groupBy === key
                          ? { ...WEB_POPOVER.optionText, ...WEB_POPOVER.optionTextSelected }
                          : WEB_POPOVER.optionText
                      }
                    >
                      {label}
                    </Text>
                  </View>
                  {groupBy === key ? <Ionicons name="checkmark" size={18} color="#6C5CE7" /> : null}
                </TouchableOpacity>
              ))}
            </View>
          </div>,
          document.body
        )}
      {isDesktopWeb &&
        showFilterMenu &&
        filterPopoverRect &&
        typeof document !== 'undefined' &&
        document.body &&
        createPortal(
          <div
            id="factory-dealers-filter-popover"
            style={{ ...WEB_POPOVER.container, ...WEB_POPOVER.containerWide, left: filterPopoverRect.left, top: filterPopoverRect.top }}
          >
            <View style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[WEB_POPOVER.title, { marginBottom: 0 }]}>Status</Text>
              {filterStatus !== 'all' ? (
                <TouchableOpacity onPress={() => setFilterStatus('all')} style={{ padding: 4 }}>
                  <Text style={{ fontSize: 13, color: '#6C5CE7' }}>Clear</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {(['all', 'new', 'to_follow_up', 'in_service', 'to_revisit', 'churned'] as FilterStatus[]).map((key) => (
                <TouchableOpacity
                  key={key}
                  onPress={() => {
                    setFilterStatus(key);
                    setShowFilterMenu(false);
                  }}
                  style={WEB_POPOVER.optionRow}
                >
                  <Text
                    style={
                      filterStatus === key
                        ? { ...WEB_POPOVER.optionText, ...WEB_POPOVER.optionTextSelected }
                        : WEB_POPOVER.optionText
                    }
                  >
                    {key === 'all' ? 'All' : DEALER_DISPLAY_STATUS_LABELS[key]}
                  </Text>
                  {filterStatus === key ? <Ionicons name="checkmark" size={18} color="#6C5CE7" /> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </div>,
          document.body
        )}
    </View>
  );
}

const inviteStyles = StyleSheet.create({
  inviteHeader: { marginBottom: 16, gap: 6 },
  inviteSubtitle: { fontSize: 12, color: '#636E72' },
  inviteBodyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 20 },
  inviteLeftColumn: { flex: 1, minWidth: 0 },
  inviteRightColumn: { width: 400, minWidth: 0, marginTop: 4, paddingLeft: 8 },
  inviteSectionTitle: { fontSize: 14, fontWeight: '600', color: '#2D3436', marginBottom: 8 },
  inviteSkuTable: {
    maxHeight: 236,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 10,
    backgroundColor: '#FFF',
    overflow: 'hidden',
  },
  inviteSkuList: { flex: 1 },
  inviteSkuListContent: { paddingVertical: 0 },
  inviteSkuHeaderRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#E9ECEF' },
  inviteSkuHeaderText: { fontSize: 11, fontWeight: '600', color: '#636E72' },
  inviteSkuRow: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0F2F5' },
  inviteSkuRowSelected: { backgroundColor: 'rgba(108, 92, 231, 0.06)' },
  inviteSkuName: { fontSize: 14, fontWeight: '500', color: '#2D3436' },
  inviteSkuNameSelected: { color: '#6C5CE7' },
  inviteHintText: { fontSize: 12, color: '#B2BEC3', padding: 12 },
  invitePillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  invitePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    backgroundColor: '#FFF',
  },
  invitePillSelected: { borderColor: '#6C5CE7', backgroundColor: 'rgba(108, 92, 231, 0.08)' },
  invitePillText: { fontSize: 13, color: '#636E72' },
  invitePillTextSelected: { color: '#6C5CE7', fontWeight: '600' },
  invitePrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: '#6C5CE7',
  },
  invitePrimaryBtnDisabled: { opacity: 0.5 },
  invitePrimaryBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  inviteErrorText: { fontSize: 13, color: '#E17055', marginTop: 8 },
  inviteResultRow: {
    marginTop: 16,
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    backgroundColor: '#FDFDFE',
  },
  inviteQrLinkRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%', gap: 16 },
  inviteResultBlock: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', minWidth: 0 },
  inviteQrBox: { width: 128, alignItems: 'center', justifyContent: 'center' },
  inviteLinkBlockInner: { width: 148, maxWidth: 148, alignItems: 'flex-start', overflow: 'hidden' },
  inviteLinkContentTop: { minHeight: 112, width: '100%', maxWidth: 148 },
  inviteLinkLabel: { fontSize: 11, color: '#95A5A6', marginBottom: 4 },
  inviteLinkCodeBox: { padding: 8, borderRadius: 8, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E1E4FF' },
  inviteLinkCodeText: { fontSize: 12, color: '#2D3436' },
  inviteCopyBtn: { marginTop: 8, alignSelf: 'center' },
  inviteSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#EAEAFF',
  },
  inviteSecondaryBtnText: { fontSize: 13, fontWeight: '600', color: '#6C5CE7' },
  previewCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E4F0',
    backgroundColor: '#FDFBFF',
    padding: 16,
    minHeight: 280,
  },
  previewTitle: { fontSize: 16, fontWeight: '700', color: '#2D3436', marginBottom: 8 },
  previewDesc: { fontSize: 13, color: '#636E72', lineHeight: 18 },
});
