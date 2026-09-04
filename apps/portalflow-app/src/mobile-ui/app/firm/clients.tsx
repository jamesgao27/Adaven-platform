/**
 * Firm - Client: associated clients. Web: DataTable (columns, search, filter, group, sort). Mobile: card list.
 */
import { useEffect, useState, useMemo, useCallback, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SectionList,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
  Pressable,
  Platform,
  RefreshControl,
} from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { getCurrentSpace, getUserSpaces } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import {
  getFirmClientsListBundle,
  deleteFirmClients,
  deleteFirmPendingClients,
  getFirmSkus,
} from '@/lib/firm';
import FirmAddClientModal from '@/components/FirmAddClientModal';
import type { FirmClientWithDetails, FirmSku } from '@/lib/firm';
import { CLIENT_DISPLAY_STATUS_LABELS } from '@/types';
import DataTable, { type DataTableColumn, WEB_POPOVER } from '@/components/DataTable';
import QRCode from 'react-native-qrcode-svg';
import {
  buildFirmClientInviteUrl,
  createFirmClientInviteToken,
  getFirmClientInviteHistory,
  setFirmClientInviteActive,
  deleteFirmClientInviteToken,
  type FirmClientInviteToken,
} from '@/lib/firm-clients';
import { showToast } from '@/lib/toast';
import { showConfirmDestructiveDialog } from '@/lib/confirmDialog';
import CenterModal from '@/components/CenterModal';
import SkuPreview from '@/components/SkuPreview';
import ScrollViewWithScrollHint from '@/components/ScrollViewWithScrollHint';
import FirmOpenInviteHistoryTable from './clients/FirmOpenInviteHistoryTable';
import { useWebViewportKind } from '../../lib/web-viewport';

function formatServiceStart(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    // Match canonical format: Mar 15, 2026
    return format(d, 'MMM dd, yyyy');
  } catch {
    return '—';
  }
}

function formatLastFollowUp(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return format(d, 'MMM dd, yyyy');
  } catch {
    return '—';
  }
}

const DISPLAY_STATUS_COLOR: Record<string, string> = {
  new: '#0984E3',
  to_follow_up: '#F39C12',
  in_service: '#00B894',
  to_revisit: '#6C5CE7',
  churned: '#B2BEC3',
};

function matchQuery(q: string, client: FirmClientWithDetails): boolean {
  const lower = q.trim().toLowerCase();
  if (!lower) return true;
  const name = (client.name || '').toLowerCase();
  const contact = (client.contactName || '').toLowerCase();
  const email = (client.contactEmail || '').toLowerCase();
  const status = (client.displayStatus ?? '').toLowerCase();
  const assignee = (client.assigneeName ?? client.assigneeEmail ?? '').toLowerCase();
  return name.includes(lower) || contact.includes(lower) || email.includes(lower) || status.includes(lower) || assignee.includes(lower);
}

type GroupByType = 'none' | 'byName' | 'byStatus';
type FilterStatus = 'all' | 'new' | 'to_follow_up' | 'in_service' | 'to_revisit' | 'churned';

function getClientColumns(): DataTableColumn<FirmClientWithDetails>[] {
  return [
    {
      id: 'name',
      label: 'Client',
      minWidth: 140,
      getValue: (r) => <ClientNameCell name={r.name ?? ''} isPendingClaim={r.isPendingClaim} />,
      getSortValue: (r) => (r.name || '').toLowerCase(),
    },
    {
      id: 'contact',
      label: 'Contact',
      minWidth: 120,
      getValue: (r) => <Text style={cellText} numberOfLines={1} ellipsizeMode="tail">{r.contactName ?? '—'}</Text>,
      getSortValue: (r) => (r.contactName ?? '').toLowerCase(),
    },
    {
      id: 'contactEmail',
      label: 'Contact email',
      minWidth: 180,
      getValue: (r) => <Text style={cellText} numberOfLines={1} ellipsizeMode="tail">{r.contactEmail ?? '—'}</Text>,
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
        const label = CLIENT_DISPLAY_STATUS_LABELS[raw as keyof typeof CLIENT_DISPLAY_STATUS_LABELS] ?? raw ?? '—';
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
      getSortValue: (r) => (r.labels?.[0] ?? r.displayStatus ?? ''),
    },
    {
      id: 'assignee',
      label: 'Assignee',
      minWidth: 100,
      getValue: (r) => <Text style={cellText} numberOfLines={1} ellipsizeMode="tail">{r.assigneeName ?? r.assigneeEmail ?? '—'}</Text>,
      getSortValue: (r) => (r.assigneeName ?? r.assigneeEmail ?? '').toLowerCase(),
    },
    {
      id: 'lastFollowUpAt',
      label: 'Last follow-up',
      minWidth: 110,
      getValue: (r) => (
        <Text style={cellText} numberOfLines={1} ellipsizeMode="tail">
          {formatLastFollowUp(r.lastFollowUpAt ?? null)}
        </Text>
      ),
      getSortValue: (r) => r.lastFollowUpAt ?? '',
    },
    {
      id: 'serviceStartAt',
      label: 'Service start',
      minWidth: 110,
      getValue: (r) => (
        <Text style={cellText} numberOfLines={1} ellipsizeMode="tail">
          {formatServiceStart(r.serviceStartAt)}
        </Text>
      ),
      getSortValue: (r) => r.serviceStartAt ?? '',
    },
  ];
}

const cellText = { fontSize: 14, color: '#2D3436' };

/** Color dot for client type: green = confirmed client, amber = pending invitee */
const CLIENT_TYPE_DOT = {
  client: '#27AE60',
  pendingInvitee: '#F39C12',
} as const;

function ClientNameCell({ name, isPendingClaim }: { name: string; isPendingClaim?: boolean }) {
  const color = isPendingClaim ? CLIENT_TYPE_DOT.pendingInvitee : CLIENT_TYPE_DOT.client;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginRight: 6, flexShrink: 0 }} />
      <Text style={[cellText, { flex: 1, minWidth: 0 }]} numberOfLines={1} ellipsizeMode="tail">
        {name || '—'}
      </Text>
    </View>
  );
}

export default function FirmClientsScreen() {
  const { isDesktopWeb } = useWebViewportKind();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [firmSpaceId, setFirmSpaceId] = useState<string | null>(null);
  const [firmSpaceName, setFirmSpaceName] = useState<string>('');
  const [clients, setClients] = useState<FirmClientWithDetails[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupBy, setGroupBy] = useState<GroupByType>('none');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [orderCountByClient, setOrderCountByClient] = useState<Record<string, number>>({});
  const [orderCountByPendingClient, setOrderCountByPendingClient] = useState<Record<string, number>>({});
  const [groupPopoverRect, setGroupPopoverRect] = useState<{ left: number; top: number } | null>(null);
  const [filterPopoverRect, setFilterPopoverRect] = useState<{ left: number; top: number } | null>(null);
  const [sortKey, setSortKey] = useState<string | null>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [inviteSkus, setInviteSkus] = useState<FirmSku[]>([]);
  const [inviteSkuId, setInviteSkuId] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteExpiresInDays, setInviteExpiresInDays] = useState<number | null>(7);
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [showInviteHistory, setShowInviteHistory] = useState(false);
  const [inviteHistory, setInviteHistory] = useState<FirmClientInviteToken[]>([]);
  const [inviteHistoryLoading, setInviteHistoryLoading] = useState(false);
  const [inviteHistoryError, setInviteHistoryError] = useState<string | null>(null);
  const [updatingInviteId, setUpdatingInviteId] = useState<string | null>(null);
  const [deletingInviteId, setDeletingInviteId] = useState<string | null>(null);
  const [inviteFromHistory, setInviteFromHistory] = useState(false);
  const [isFirmAdmin, setIsFirmAdmin] = useState(false);
  const qrRef = useRef<any | null>(null);
  const [showAddClientModal, setShowAddClientModal] = useState(false);

  const clientColumns = useMemo(() => getClientColumns(), []);

  // Web: 根据分组按钮位置计算浮窗位置（同 receipts 列表页规范）
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    if (showGroupMenu) {
      const measure = () => {
        const el = document.getElementById('firm-clients-group-button');
        if (el) {
          const r = el.getBoundingClientRect();
          setGroupPopoverRect({ left: r.left, top: r.bottom + 6 });
        } else {
          setGroupPopoverRect(null);
        }
      };
      measure();
      const t = requestAnimationFrame(measure);
      return () => {
        cancelAnimationFrame(t);
        setGroupPopoverRect(null);
      };
    }
    setGroupPopoverRect(null);
  }, [showGroupMenu]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    if (showFilterMenu) {
      const measure = () => {
        const el = document.getElementById('firm-clients-filter-button');
        if (el) {
          const r = el.getBoundingClientRect();
          setFilterPopoverRect({ left: r.left, top: r.bottom + 6 });
        } else {
          setFilterPopoverRect(null);
        }
      };
      measure();
      const t = requestAnimationFrame(measure);
      return () => {
        cancelAnimationFrame(t);
        setFilterPopoverRect(null);
      };
    }
    setFilterPopoverRect(null);
  }, [showFilterMenu]);

  // Web: 点击浮窗外关闭（仅分组下拉；邀请使用 CenterModal 自带遮罩）
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: PointerEvent) => {
      const target = e.target as Node;
      const groupBtn = document.getElementById('firm-clients-group-button');
      const groupPopover = document.getElementById('firm-clients-group-popover');
      const filterBtn = document.getElementById('firm-clients-filter-button');
      const filterPopover = document.getElementById('firm-clients-filter-popover');
      if (
        showGroupMenu &&
        groupBtn &&
        !groupBtn.contains(target) &&
        groupPopover &&
        !groupPopover.contains(target)
      ) {
        setShowGroupMenu(false);
      }
      if (
        showFilterMenu &&
        filterBtn &&
        !filterBtn.contains(target) &&
        filterPopover &&
        !filterPopover.contains(target)
      ) {
        setShowFilterMenu(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [showGroupMenu, showFilterMenu]);

  const loadData = useCallback(async (forceRefresh = false) => {
    const space = await getCurrentSpace(forceRefresh);
    if (!space?.id || space.kind !== 'provider') {
      router.replace('/');
      return;
    }
    setFirmSpaceId(space.id);
    setFirmSpaceName(space.name ?? '');
    const { clients: list, orderCountByClient, orderCountByPendingClient } = await getFirmClientsListBundle(space.id);
    setClients(list);
    setOrderCountByClient(orderCountByClient);
    setOrderCountByPendingClient(orderCountByPendingClient);
  }, [router]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadData(true);
      setLoading(false);
    })();
  }, [loadData]);

  useEffect(() => {
    if (!firmSpaceId) return;
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefresh = () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => loadData(true), 300);
    };
    const chClients = supabase
      .channel(`firm-clients-${firmSpaceId}`)
      .on('postgres_changes', { event: '*', schema: 'firm', table: 'clients', filter: `firm_space_id=eq.${firmSpaceId}` }, debouncedRefresh)
      .subscribe();
    const chOrders = supabase
      .channel(`firm-orders-clients-${firmSpaceId}`)
      .on('postgres_changes', { event: '*', schema: 'firm', table: 'orders', filter: `firm_space_id=eq.${firmSpaceId}` }, debouncedRefresh)
      .subscribe();
    return () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      supabase.removeChannel(chClients);
      supabase.removeChannel(chOrders);
    };
  }, [firmSpaceId, loadData]);

  useEffect(() => {
    if (!firmSpaceId) return;
    getUserSpaces().then((spaces) => {
      const m = spaces.find((us) => us.spaceId === firmSpaceId);
      setIsFirmAdmin(m?.isAdmin === true);
    });
  }, [firmSpaceId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  }, [loadData]);

  const filteredClients = useMemo(() => {
    if (filterStatus === 'all') return clients;
    return clients.filter((c) => (c.displayStatus ?? '') === filterStatus);
  }, [clients, filterStatus]);

  const searchedClients = useMemo(
    () => filteredClients.filter((c) => matchQuery(searchQuery, c)),
    [filteredClients, searchQuery]
  );

  const sortRowsByColumn = useCallback(
    <T,>(rows: T[], col: { getSortValue?: (row: T) => string | number | Date | null | undefined } | undefined, dir: 'asc' | 'desc'): T[] => {
      if (!col?.getSortValue) return rows;
      return [...rows].sort((a, b) => {
        const va = col.getSortValue!(a);
        const vb = col.getSortValue!(b);
        const cmp = va === vb ? 0 : (va == null ? 1 : vb == null ? -1 : va < vb ? -1 : 1);
        return dir === 'asc' ? cmp : -cmp;
      });
    },
    []
  );

  const groupedSections = useMemo(() => {
    if (groupBy === 'none') return [{ title: 'All', monthKey: 'all', data: searchedClients }];
    if (groupBy === 'byName') {
      const byLetter: Record<string, FirmClientWithDetails[]> = {};
      searchedClients.forEach((c) => {
        const first = (c.name || '').trim().charAt(0).toUpperCase();
        const key = /[A-Z]/.test(first) ? first : '#';
        if (!byLetter[key]) byLetter[key] = [];
        byLetter[key].push(c);
      });
      const keys = Object.keys(byLetter).sort((a, b) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)));
      return keys.map((k) => ({ title: k, monthKey: k, data: byLetter[k] }));
    }
    if (groupBy === 'byStatus') {
      const order = ['new', 'to_follow_up', 'in_service', 'to_revisit', 'churned'];
      const byStatus: Record<string, FirmClientWithDetails[]> = {};
      searchedClients.forEach((c) => {
        const key = c.displayStatus ?? 'new';
        if (!byStatus[key]) byStatus[key] = [];
        byStatus[key].push(c);
      });
      return order.filter((k) => (byStatus[k]?.length ?? 0) > 0).map((k) => ({
        title: CLIENT_DISPLAY_STATUS_LABELS[k as keyof typeof CLIENT_DISPLAY_STATUS_LABELS] ?? k,
        monthKey: k,
        data: byStatus[k] ?? [],
      }));
    }
    return [{ title: 'All', monthKey: 'all', data: searchedClients }];
  }, [groupBy, searchedClients]);

  const tableSections = useMemo(() => {
    const col = sortKey ? clientColumns.find((c) => c.id === sortKey) : undefined;
    return groupedSections.map((sec) => ({
      title: sec.title,
      data: sortRowsByColumn(sec.data, col, sortDirection),
      count: sec.data.length,
      countLabel: 'clients',
    }));
  }, [groupedSections, sortKey, sortDirection, clientColumns, sortRowsByColumn]);

  const sortedDataForTable = useMemo(() => {
    const col = sortKey ? clientColumns.find((c) => c.id === sortKey) : undefined;
    return sortRowsByColumn(searchedClients, col, sortDirection);
  }, [searchedClients, sortKey, sortDirection, clientColumns, sortRowsByColumn]);

  const tableEmptyMessage = useMemo(() => {
    if (loading && clients.length === 0) return 'Loading...';
    if (clients.length === 0) return 'No clients yet. Add associations in Supabase or later in this module.';
    if (searchedClients.length === 0) return `No results for "${searchQuery}"`;
    return 'No data';
  }, [loading, clients.length, searchedClients.length, searchQuery]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedClientIds.length === 0) return;
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${selectedClientIds.length} selected client(s)?`)) return;
    const clientIds = selectedClientIds.filter((id) => {
      const row = clients.find((c) => c.id === id);
      return row && !row.isPendingClaim && !String(id).startsWith('orphan-');
    });
    const inviteeIds = selectedClientIds.filter((id) => {
      const row = clients.find((c) => c.id === id);
      return row && row.isPendingClaim === true;
    });
    setBulkDeleting(true);
    const [clientErr, inviteeErr] = await Promise.all([
      clientIds.length ? deleteFirmClients(clientIds) : Promise.resolve({ error: null }),
      inviteeIds.length ? deleteFirmPendingClients(inviteeIds) : Promise.resolve({ error: null }),
    ]);
    setBulkDeleting(false);
    if (clientErr?.error || inviteeErr?.error) {
      if (typeof window !== 'undefined') window.alert([clientErr?.error?.message, inviteeErr?.error?.message].filter(Boolean).join('\n') || 'Delete failed');
      return;
    }
    setSelectedClientIds([]);
    await loadData(true);
  }, [selectedClientIds, clients, loadData]);

  const handleCopyInviteLink = useCallback(async () => {
    if (!inviteLink) return;
    if (typeof window !== 'undefined' && (navigator as any)?.clipboard) {
      try {
        await (navigator as any).clipboard.writeText(inviteLink);
      } catch {
        // ignore clipboard errors
      }
    }
  }, [inviteLink]);

  const handleDownloadInviteQr = useCallback(() => {
    if (!inviteLink || !qrRef.current) return;
    // 目前仅在 Web 提供下载，移动端建议截图保存
    if (Platform.OS !== 'web') {
      if (typeof window !== 'undefined') {
        window.alert('Download the QR code on desktop, or take a screenshot on mobile.');
      }
      return;
    }
    try {
      qrRef.current.toDataURL((data: string) => {
        const a = document.createElement('a');
        a.href = `data:image/png;base64,${data}`;
        a.download = 'portalflow-client-invite-qr.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
    } catch {
      // ignore
    }
  }, [inviteLink]);

  const handleToggleInviteActive = useCallback(
    async (row: FirmClientInviteToken) => {
      const newActive = !row.isActive;
      setUpdatingInviteId(row.id);
      setInviteHistoryError(null);
      // 乐观更新本地状态
      setInviteHistory((prev) =>
        prev.map((it) => (it.id === row.id ? { ...it, isActive: newActive } : it))
      );
      const { error } = await setFirmClientInviteActive(row.id, newActive);
      setUpdatingInviteId(null);
      if (error) {
        // 还原状态并提示错误
        setInviteHistory((prev) =>
          prev.map((it) => (it.id === row.id ? { ...it, isActive: row.isActive } : it))
        );
        setInviteHistoryError(error.message);
      }
    },
    []
  );

  const handleOpenInviteFromHistory = useCallback(
    (row: FirmClientInviteToken) => {
      if (!row) return;
      const url = buildFirmClientInviteUrl(row.token, firmSpaceName);
      setInviteLink(url);
      setInviteSkuId(row.skuId);
      setInviteExpiresInDays(
        row.expiresAt ? 7 : null
      );
      setShowInviteHistory(false);
      setInviteFromHistory(true);
      setShowInvitePanel(true);
    },
    [firmSpaceName]
  );

  const handleCreateNewFromHistory = useCallback(async () => {
    setShowInviteHistory(false);
    setInviteFromHistory(false);
    setInviteError(null);
    setInviteLink(null);
    setInviteExpiresInDays(7);
    setShowInvitePanel(true);
    if (firmSpaceId && inviteSkus.length === 0) {
      const all = await getFirmSkus(firmSpaceId);
      const skus = all.filter(
        (s) => (s.templateStatus != null ? s.templateStatus !== 'draft' : (s.isPublished === true || !!s.taxCountry || !!s.taxScenario))
      );
      setInviteSkus(skus);
      if (skus.length > 0) setInviteSkuId(skus[0].id);
    }
  }, [firmSpaceId, inviteSkus.length]);

  const handleDeleteInvite = useCallback((row: FirmClientInviteToken) => {
    showConfirmDestructiveDialog(
      'Delete invite',
      'Delete this invite? The link will stop working.',
      async () => {
        setDeletingInviteId(row.id);
        setInviteHistoryError(null);
        const { error } = await deleteFirmClientInviteToken(row.id);
        setDeletingInviteId(null);
        if (error) {
          setInviteHistoryError(error.message);
          return;
        }
        setInviteHistory((prev) => prev.filter((it) => it.id !== row.id));
      },
      { confirmLabel: 'Delete' },
    );
  }, []);

  const handleToggleInvitePanel = useCallback(async () => {
    if (showInvitePanel) {
      setShowInvitePanel(false);
      setInviteFromHistory(false);
      return;
    }
    setShowInvitePanel(true);
    setInviteFromHistory(false);
    setInviteError(null);
    setInviteLink(null);
    setInviteExpiresInDays(7);
    if (!firmSpaceId) return;
    if (inviteSkus.length === 0) {
      const all = await getFirmSkus(firmSpaceId);
      const skus = all.filter(
        (s) => (s.templateStatus != null ? s.templateStatus !== 'draft' : (s.isPublished === true || !!s.taxCountry || !!s.taxScenario))
      );
      setInviteSkus(skus);
      if (skus.length > 0) {
        setInviteSkuId((prev) => prev ?? skus[0].id);
      }
    }
  }, [showInvitePanel, firmSpaceId, inviteSkus.length]);

  const handleOpenInviteHistory = useCallback(async () => {
    if (!firmSpaceId) return;
    setShowInviteHistory(true);
    setInviteHistoryLoading(true);
    setInviteHistoryError(null);

    const [historyRes, allSkus] = await Promise.all([
      getFirmClientInviteHistory(firmSpaceId),
      inviteSkus.length === 0 ? getFirmSkus(firmSpaceId) : Promise.resolve(null),
    ]);

    setInviteHistoryLoading(false);

    if (historyRes.error) {
      setInviteHistoryError(historyRes.error.message);
    } else {
      setInviteHistory(historyRes.invites);
    }

    if (allSkus && Array.isArray(allSkus)) {
      const skus = allSkus.filter(
        (s) => (s.templateStatus != null ? s.templateStatus !== 'draft' : (s.isPublished === true || !!s.taxCountry || !!s.taxScenario))
      );
      setInviteSkus(skus);
    }
  }, [firmSpaceId, inviteSkus.length]);

  const handleCreateInvite = useCallback(async () => {
    if (!firmSpaceId || !inviteSkuId) return;
    setInviteLoading(true);
    setInviteError(null);
    const { token, url, error } = await createFirmClientInviteToken(
      firmSpaceId,
      inviteSkuId,
      inviteExpiresInDays ?? undefined
    );
    setInviteLoading(false);
    if (error || !token) {
      setInviteError(error?.message || 'Failed to create invite. Please try again.');
      return;
    }
    // API 返回的 url 已含 firm 名称（createFirmClientInviteToken 内查 space 名称写入）
    const linkUrl = url || buildFirmClientInviteUrl(token, firmSpaceName);
    setInviteLink(linkUrl);
    if (typeof window !== 'undefined' && (navigator as any)?.clipboard) {
      try {
        await (navigator as any).clipboard.writeText(linkUrl);
      } catch {
        // ignore clipboard errors
      }
    }
  }, [firmSpaceId, inviteSkuId, inviteExpiresInDays, firmSpaceName]);

  // Mobile: receipt-style list (Group, Filter, Search + firstRow/secondRow)
  const clientSections = useMemo(() => {
    const col = sortKey ? clientColumns.find((c) => c.id === sortKey) : undefined;
    return groupedSections.map((sec) => ({
      title: sec.title,
      monthKey: (sec as { monthKey?: string }).monthKey ?? sec.title,
      data: sortRowsByColumn(sec.data, col, sortDirection),
    }));
  }, [groupedSections, sortKey, sortDirection, clientColumns, sortRowsByColumn]);

  const handleCloseInvitePanel = useCallback(() => {
    setShowInvitePanel(false);
    if (inviteFromHistory) {
      setShowInviteHistory(true);
      setInviteFromHistory(false);
    }
  }, [inviteFromHistory]);

  const handleOpenAddClientModal = useCallback(() => {
    setShowAddClientModal(true);
  }, []);
  const handleCloseAddClientModal = useCallback(() => {
    setShowAddClientModal(false);
  }, []);

  const renderMobileList = () => (
    <View style={styles.container}>
      <View
        style={[
          styles.toolbarSlot,
          (showGroupMenu || showFilterMenu) && styles.toolbarSlotDropdownOpen,
        ]}
      >
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <TouchableOpacity
              style={styles.sortButton}
              onPress={() => setShowGroupMenu(!showGroupMenu)}
            >
              {groupBy === 'none' && (
                <Ionicons
                  name="list-outline"
                  size={18}
                  color="#6C5CE7"
                  style={{ marginRight: 4 }}
                />
              )}
              {groupBy === 'byName' && (
                <Ionicons
                  name="albums-outline"
                  size={18}
                  color="#6C5CE7"
                  style={{ marginRight: 4 }}
                />
              )}
              {groupBy === 'byStatus' && (
                <Ionicons
                  name="flag-outline"
                  size={18}
                  color="#6C5CE7"
                  style={{ marginRight: 4 }}
                />
              )}
              <Text style={styles.sortText}>Group</Text>
              <Ionicons name="chevron-down" size={16} color="#636E72" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.filterButton}
              onPress={() => setShowFilterMenu(!showFilterMenu)}
            >
              <Text style={styles.filterText}>
                Filter
                {filterStatus !== 'all' && (
                  <Text style={styles.filterBadge}> (1)</Text>
                )}
              </Text>
              <Ionicons name="chevron-down" size={16} color="#636E72" />
            </TouchableOpacity>
            <View style={styles.searchContainer}>
              <Ionicons
                name="search"
                size={18}
                color="#636E72"
                style={styles.searchIcon}
              />
              <TextInput
                style={styles.searchInput}
                placeholder="Search"
                placeholderTextColor="#95A5A6"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.trim() ? (
                <TouchableOpacity
                  onPress={() => setSearchQuery('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.searchClear}
                >
                  <Ionicons
                    name="close-circle"
                    size={20}
                    color="#95A5A6"
                  />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
        {showGroupMenu && (
          <View style={styles.groupDropdown}>
            <TouchableOpacity style={[styles.groupOption, groupBy === 'none' && styles.groupOptionSelected]} onPress={() => { setGroupBy('none'); setShowGroupMenu(false); }}>
              <Text style={[styles.groupOptionText, groupBy === 'none' && styles.groupOptionTextSelected]}>None</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.groupOption, groupBy === 'byName' && styles.groupOptionSelected]} onPress={() => { setGroupBy('byName'); setShowGroupMenu(false); }}>
              <Text style={[styles.groupOptionText, groupBy === 'byName' && styles.groupOptionTextSelected]}>By name</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.groupOption, groupBy === 'byStatus' && styles.groupOptionSelected]} onPress={() => { setGroupBy('byStatus'); setShowGroupMenu(false); }}>
              <Text style={[styles.groupOptionText, groupBy === 'byStatus' && styles.groupOptionTextSelected]}>By status</Text>
            </TouchableOpacity>
          </View>
        )}
        {showFilterMenu && (
          <View style={styles.groupDropdown}>
            {(['all', 'new', 'to_follow_up', 'in_service', 'to_revisit', 'churned'] as FilterStatus[]).map((key) => (
              <TouchableOpacity key={key} style={[styles.groupOption, filterStatus === key && styles.groupOptionSelected]} onPress={() => { setFilterStatus(key); setShowFilterMenu(false); }}>
                <Text style={[styles.groupOptionText, filterStatus === key && styles.groupOptionTextSelected]}>{key === 'all' ? 'All' : CLIENT_DISPLAY_STATUS_LABELS[key as keyof typeof CLIENT_DISPLAY_STATUS_LABELS]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
      {loading && clients.length === 0 ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color="#6C5CE7" />
          <Text style={styles.emptyText}>Loading...</Text>
        </View>
      ) : (
        <>
        <SectionList
          sections={clientSections}
          keyExtractor={(c) => c.id}
          renderItem={({ item: c }) => {
            const orderCount = c.isPendingClaim
              ? (orderCountByPendingClient[c.id] ?? 0)
              : (orderCountByClient[c.id] ?? 0);
            const firstTag = c.labels?.[0];
            const statusLabel =
              firstTag ??
              (CLIENT_DISPLAY_STATUS_LABELS[c.displayStatus ?? ''] ??
                c.displayStatus ??
                '—');
            const statusColor = firstTag
              ? '#6C5CE7'
              : (DISPLAY_STATUS_COLOR[c.displayStatus ?? ''] ?? '#636E72');
            const isPending = c.isPendingClaim === true || !c.clientSpaceId;
            const detailPath = isPending ? `invitee-${c.id}` : c.clientSpaceId;
            const assignee = c.assigneeName || 'Unassigned';
            const contact =
              c.contactName && c.contactName !== c.name
                ? c.contactName
                : c.contactName || '';

            return (
              <TouchableOpacity
                style={[styles.receiptItem, isPending && styles.receiptItemPending]}
                onPress={() => router.push(`/firm/client/${detailPath}`)}
                activeOpacity={0.7}
              >
                <View style={styles.receiptContent}>
                  {/* 第一行：客户名称 + 状态标签（保持不动） */}
                  <View style={styles.firstRow}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        flex: 1,
                      }}
                    >
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: c.isPendingClaim
                            ? CLIENT_TYPE_DOT.pendingInvitee
                            : CLIENT_TYPE_DOT.client,
                          marginRight: 6,
                        }}
                      />
                      <Text style={styles.storeName} numberOfLines={1}>
                        {c.name || '—'}
                      </Text>
                    </View>
                    <View
                      style={[styles.statusBadge, { backgroundColor: statusColor }]}
                    >
                      <Text style={styles.statusText}>{statusLabel}</Text>
                    </View>
                  </View>

                  {/* 第二行：contact name + order count + assignee + last follow-up */}
                  <View style={styles.secondRow}>
                    <Text style={styles.contactText} numberOfLines={1}>
                      {contact || 'No contact'}
                    </Text>
                    <Text style={styles.orderCountText}>{orderCount} orders</Text>
                    {/* 中间留出弹性空白，将 assignee 与 date 一起推到右侧 */}
                    <View style={{ flex: 1 }} />
                    <Text style={styles.assigneeText} numberOfLines={1}>
                      {assignee}
                    </Text>
                    <Text style={styles.followUpDate}>
                      {formatLastFollowUp(c.lastFollowUpAt ?? null)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
          renderSectionHeader={({ section }) => {
            if (section.monthKey === 'all' || section.data.length === 0) return null;
            return (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <View style={styles.sectionHeaderRight}>
                  <Text style={styles.sectionCount}>{section.data.length} clients</Text>
                </View>
              </View>
            );
          }}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={clientSections.every((s) => s.data.length === 0) ? styles.emptyList : styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>{tableEmptyMessage}</Text>
            </View>
          }
        />
        {/* Mobile: 底部双按钮，样式对齐 receipt 详情的 Cancel / Confirm */}
        <View style={styles.mobileBottomBar}>
          {/* 次按钮：Open invite → 跳转独立页面 */}
          <TouchableOpacity
            style={styles.mobileBottomSecondaryButton}
            onPress={() => router.push('/firm/clients/open-invite')}
            activeOpacity={0.7}
          >
            <Ionicons name="qr-code-outline" size={20} color="#636E72" />
            <Text style={styles.mobileBottomSecondaryText}>Open invite</Text>
          </TouchableOpacity>
          {/* 主按钮：Add client → 跳转独立页面 */}
          <TouchableOpacity
            style={styles.mobileBottomPrimaryButton}
            onPress={() => router.push('/firm/clients/add')}
            activeOpacity={0.7}
          >
            <Ionicons name="person-add-outline" size={20} color="#6C5CE7" />
            <Text style={styles.mobileBottomPrimaryText}>Add client</Text>
          </TouchableOpacity>
        </View>
        </>
      )}
    </View>
  );

  // 移动端：仅渲染列表页本身（表单改用独立页面承载）
  if (Platform.OS !== 'web') {
    return <View style={{ flex: 1 }}>{renderMobileList()}</View>;
  }

  // Web：DataTable + Invite / Add client 浮窗（保持原行为）
  const hasSelection = selectedClientIds.length > 0;
  return (
    <View style={styles.webContainer}>
      <View
        style={[
          styles.toolbarSlot,
          (showGroupMenu || showFilterMenu) && styles.toolbarSlotDropdownOpen,
        ]}
      >
        {hasSelection ? (
          <View style={styles.bulkBar}>
            <Text style={styles.bulkText}>{selectedClientIds.length} selected</Text>
            <TouchableOpacity
              style={[styles.bulkBtn, styles.bulkBtnDanger, bulkDeleting && styles.bulkBtnDisabled]}
              onPress={handleBulkDelete}
              disabled={bulkDeleting}
              activeOpacity={0.7}
            >
              {bulkDeleting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="trash-outline" size={18} color="#fff" />
              )}
              <Text style={styles.bulkBtnText}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.bulkBtnClear}
              onPress={() => setSelectedClientIds([])}
              activeOpacity={0.7}
            >
              <Text style={styles.bulkBtnClearText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <TouchableOpacity
                style={[styles.inviteButton, { marginRight: 8 }]}
                onPress={handleOpenAddClientModal}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="person-add-outline"
                  size={18}
                  color="#6C5CE7"
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.inviteButtonText}>Add client</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.inviteHistoryButton}
                onPress={handleOpenInviteHistory}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="qr-code-outline"
                  size={18}
                  color="#636E72"
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.inviteHistoryButtonText}>Open invite</Text>
              </TouchableOpacity>
              <View
                style={styles.groupWrap}
                {...(isDesktopWeb
                  ? { nativeID: 'firm-clients-group-button' }
                  : {})}
              >
                <TouchableOpacity
                  style={styles.sortButton}
                  onPress={() => {
                    setShowFilterMenu(false);
                    setShowGroupMenu(true);
                  }}
                  activeOpacity={0.7}
                >
                  {groupBy === 'none' && (
                    <Ionicons
                      name="list-outline"
                      size={18}
                      color="#6C5CE7"
                      style={{ marginRight: 4 }}
                    />
                  )}
                  {groupBy === 'byName' && (
                    <Ionicons
                      name="albums-outline"
                      size={18}
                      color="#6C5CE7"
                      style={{ marginRight: 4 }}
                    />
                  )}
                  {groupBy === 'byStatus' && (
                    <Ionicons
                      name="flag-outline"
                      size={18}
                      color="#6C5CE7"
                      style={{ marginRight: 4 }}
                    />
                  )}
                  <Text style={styles.sortText}>Group</Text>
                  <Ionicons name="chevron-down" size={16} color="#636E72" />
                </TouchableOpacity>
                {showGroupMenu && Platform.OS !== 'web' && (
                  <View style={styles.groupDropdown}>
                    <TouchableOpacity
                      style={[
                        styles.groupOption,
                        groupBy === 'none' && styles.groupOptionSelected,
                      ]}
                      onPress={() => {
                        setGroupBy('none');
                        setShowGroupMenu(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.groupOptionText,
                          groupBy === 'none' && styles.groupOptionTextSelected,
                        ]}
                      >
                        None
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.groupOption,
                        groupBy === 'byName' && styles.groupOptionSelected,
                      ]}
                      onPress={() => {
                        setGroupBy('byName');
                        setShowGroupMenu(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.groupOptionText,
                          groupBy === 'byName' && styles.groupOptionTextSelected,
                        ]}
                      >
                        By name
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
              <View
                style={styles.groupWrap}
                {...(isDesktopWeb ? { nativeID: 'firm-clients-filter-button' } : {})}
              >
                <TouchableOpacity
                  style={styles.filterButton}
                  onPress={() => {
                    setShowGroupMenu(false);
                    setShowFilterMenu(true);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="filter-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />
                  <Text style={styles.filterText}>
                    Filter
                    {filterStatus !== 'all' && (
                      <Text style={styles.filterBadge}> (1)</Text>
                    )}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color="#636E72" />
                </TouchableOpacity>
              </View>
              <View style={styles.searchContainer}>
                <Ionicons
                  name="search"
                  size={18}
                  color="#636E72"
                  style={styles.searchIcon}
                />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search"
                  placeholderTextColor="#95A5A6"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {searchQuery.trim() ? (
                  <TouchableOpacity
                    onPress={() => setSearchQuery('')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.searchClear}
                  >
                    <Ionicons
                      name="close-circle"
                      size={20}
                      color="#95A5A6"
                    />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>
        )}
      </View>

      {(loading && clients.length === 0) ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color="#6C5CE7" />
          <Text style={styles.emptyText}>Loading...</Text>
        </View>
      ) : isDesktopWeb ? (
        <ScrollView
          style={styles.tableScroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={loading && clients.length === 0 ? { flexGrow: 1 } : { flexGrow: 0 }}
        >
          <DataTable<FirmClientWithDetails>
            columns={clientColumns}
            data={groupBy === 'none' ? sortedDataForTable : undefined}
            sections={groupBy !== 'none' ? tableSections : undefined}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(key, dir) => { setSortKey(key); setSortDirection(dir); }}
            onRowPress={(row) => {
              const detailPath = row.isPendingClaim === true || !row.clientSpaceId ? `invitee-${row.id}` : row.clientSpaceId;
              router.push(`/firm/client/${detailPath}`);
            }}
            keyExtractor={(r) => r.id}
            emptyMessage={tableEmptyMessage}
            storageKey="firm-clients-table"
            selectable
            selectableRevealOnHover
            selectedIds={selectedClientIds}
            onSelectedIdsChange={setSelectedClientIds}
          />
        </ScrollView>
      ) : null}

      <CenterModal
        visible={showInvitePanel}
        title="Invite new clients"
        onClose={handleCloseInvitePanel}
        maxWidth={900}
        cardHeight={720}
      >
        <View style={styles.inviteHeader}>
          <Text style={styles.inviteSubtitle}>
            Step 1: choose a Service Template for this engagement.{'\n'}Step 2: configure invite expiry and share the link / QR.
          </Text>
        </View>
        <View style={styles.inviteBodyRow}>
          <View style={styles.inviteLeftColumn}>
            <Text style={styles.inviteSectionTitle}>Step 1 · Select Service Template</Text>
            <View style={styles.inviteSkuTable}>
              <View style={styles.inviteSkuHeaderRow}>
                <Text style={[styles.inviteSkuHeaderText, { flex: 1.6 }]}>Service Template</Text>
              </View>
              <ScrollViewWithScrollHint
                wrapperStyle={styles.inviteSkuListWrapper}
                style={styles.inviteSkuList}
                contentContainerStyle={styles.inviteSkuListContent}
              >
                {inviteSkus.map((sku, index) => (
                  <TouchableOpacity
                    key={sku.id}
                    style={[
                      styles.inviteSkuRow,
                      inviteSkuId === sku.id && styles.inviteSkuRowSelected,
                      index === inviteSkus.length - 1 && { borderBottomWidth: 0 },
                    ]}
                    onPress={inviteFromHistory ? undefined : () => setInviteSkuId(sku.id)}
                    activeOpacity={inviteFromHistory ? 1 : 0.7}
                  >
                    <View style={styles.inviteSkuRowMain}>
                      <View style={{ flex: 1.6, paddingRight: 8 }}>
                        <Text
                          style={[
                            styles.inviteSkuName,
                            inviteSkuId === sku.id && styles.inviteSkuNameSelected,
                          ]}
                          numberOfLines={1}
                        >
                          {sku.name}
                        </Text>
                      </View>
                      {/* Mobile: 预览按钮跳转到独立 SKU 预览页；Web 仍用右侧 Panel 预览 */}
                      {Platform.OS !== 'web' && (
                        <TouchableOpacity
                          style={styles.inviteSkuPreviewPill}
                          onPress={() =>
                            router.push({
                              pathname: '/auth/setup-sku-preview',
                              params: { skuId: sku.id },
                            } as any)
                          }
                          activeOpacity={0.7}
                        >
                          <Ionicons name="eye-outline" size={14} color="#6C5CE7" />
                          <Text style={styles.inviteSkuPreviewText}>Preview</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
                {inviteSkus.length === 0 && (
                  <Text style={styles.inviteHintText}>Please configure Service Catalog in the Firm module first.</Text>
                )}
              </ScrollViewWithScrollHint>
            </View>
            <View style={{ marginTop: 36 }}>
              <Text style={styles.inviteSectionTitle}>Step 2 · Expiry setting</Text>
              <View style={styles.inviteSettingsRow}>
                <View style={styles.inviteSettingsLeft}>
                  <View style={styles.inviteConfigRow}>
                    {/* label removed; title above already explains expiry setting */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={styles.invitePillRow}>
                        {[
                          { label: '7 days', value: 7 },
                          { label: '30 days', value: 30 },
                          { label: 'No expiry', value: null },
                        ].map((opt) => (
                          <TouchableOpacity
                            key={String(opt.value ?? 'forever')}
                            style={[
                              styles.invitePill,
                              inviteExpiresInDays === opt.value && styles.invitePillSelected,
                            ]}
                            onPress={
                              inviteFromHistory
                                ? undefined
                                : () => setInviteExpiresInDays(opt.value)
                            }
                            activeOpacity={inviteFromHistory ? 1 : 0.7}
                          >
                            <Text
                              style={[
                                styles.invitePillText,
                                inviteExpiresInDays === opt.value && styles.invitePillTextSelected,
                              ]}
                            >
                              {opt.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      {!inviteFromHistory && (
                        <TouchableOpacity
                          style={[
                            styles.invitePrimaryBtn,
                            (!inviteSkuId || inviteLoading) && styles.invitePrimaryBtnDisabled,
                          ]}
                          onPress={handleCreateInvite}
                          disabled={!inviteSkuId || inviteLoading}
                          activeOpacity={0.8}
                        >
                          {inviteLoading ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Ionicons
                              name="link-outline"
                              size={18}
                              color="#fff"
                              style={{ marginRight: 8 }}
                            />
                          )}
                          <Text style={styles.invitePrimaryBtnText}>
                            {inviteLoading ? 'Generating...' : 'Generate invite link'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                  {!inviteFromHistory && inviteError && (
                    <Text style={styles.inviteErrorText}>{inviteError}</Text>
                  )}
                  {inviteLink && (
                    <View style={[styles.inviteResultRow, { marginTop: 36, flexDirection: 'column', alignItems: 'stretch' }]}>
                      <View style={styles.inviteQrLinkRow}>
                        <View style={styles.inviteResultBlock}>
                          <View style={styles.inviteQrBox}>
                            <QRCode
                              value={inviteLink}
                              size={112}
                              getRef={(c) => {
                                qrRef.current = c;
                              }}
                            />
                          </View>
                          {isDesktopWeb && (
                            <TouchableOpacity
                              style={[styles.inviteSecondaryBtn, { marginTop: 8 }]}
                              onPress={handleDownloadInviteQr}
                              activeOpacity={0.7}
                            >
                              <Ionicons name="download-outline" size={16} color="#6C5CE7" style={{ marginRight: 4 }} />
                              <Text style={styles.inviteSecondaryBtnText}>Download QR</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                        <View style={styles.inviteResultBlock}>
                          <View style={styles.inviteLinkBlockInner}>
                            <View style={styles.inviteLinkContentTop}>
                              <Text style={styles.inviteLinkLabel}>Invite link</Text>
                              <View style={styles.inviteLinkCodeBox}>
                                <Text
                                  style={styles.inviteLinkCodeText}
                                  numberOfLines={5}
                                  ellipsizeMode="tail"
                                >
                                  {inviteLink}
                                </Text>
                              </View>
                            </View>
                            <TouchableOpacity
                              style={[styles.inviteSecondaryBtn, styles.inviteCopyBtn]}
                              onPress={handleCopyInviteLink}
                              activeOpacity={0.7}
                            >
                            <Ionicons name="copy-outline" size={16} color="#6C5CE7" style={{ marginRight: 4 }} />
                            <Text style={styles.inviteSecondaryBtnText}>Copy link</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </View>
          <View style={styles.inviteRightColumn}>
            <Text style={styles.inviteSectionTitle}>Service preview</Text>
            <SkuPreview sku={inviteSkus.find((s) => s.id === inviteSkuId) ?? null} />
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
        <FirmOpenInviteHistoryTable
          invites={inviteHistory}
          inviteSkus={inviteSkus}
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
      <FirmAddClientModal
        visible={showAddClientModal}
        onClose={handleCloseAddClientModal}
        firmSpaceId={firmSpaceId}
        inviteSkusFromParent={inviteSkus}
        variant="manual"
        initialSkuSelection="first"
        onSuccess={async () => {
          await loadData(true);
        }}
      />
      {isDesktopWeb &&
        showGroupMenu &&
        groupPopoverRect &&
        typeof document !== 'undefined' &&
        document.body &&
        createPortal(
          <div
            id="firm-clients-group-popover"
            style={{ ...WEB_POPOVER.container, left: groupPopoverRect.left, top: groupPopoverRect.top }}
          >
            <Text style={WEB_POPOVER.title}>Group</Text>
            <View>
              {[
                { key: 'none' as GroupByType, label: 'None', icon: 'list-outline' as const },
                { key: 'byName' as GroupByType, label: 'By name', icon: 'albums-outline' as const },
                { key: 'byStatus' as GroupByType, label: 'By status', icon: 'flag-outline' as const },
              ].map(({ key, label, icon }) => (
                <TouchableOpacity
                  key={key}
                  onPress={() => {
                    setGroupBy(key);
                    setShowGroupMenu(false);
                  }}
                  style={WEB_POPOVER.optionRow}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <Ionicons
                      name={icon}
                      size={18}
                      color={groupBy === key ? '#6C5CE7' : '#636E72'}
                      style={{ marginRight: 8 }}
                    />
                    <Text
                      style={
                        groupBy === key
                          ? { ...WEB_POPOVER.optionText, ...WEB_POPOVER.optionTextSelected }
                          : WEB_POPOVER.optionText
                      }
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                  </View>
                  {groupBy === key ? (
                    <Ionicons name="checkmark" size={18} color="#6C5CE7" />
                  ) : null}
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
            id="firm-clients-filter-popover"
            style={{
              ...WEB_POPOVER.container,
              ...WEB_POPOVER.containerWide,
              left: filterPopoverRect.left,
              top: filterPopoverRect.top,
            }}
          >
            <View style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[WEB_POPOVER.title, { marginBottom: 0 }]}>Status</Text>
              {filterStatus !== 'all' && (
                <TouchableOpacity onPress={() => setFilterStatus('all')} style={{ padding: 4 }}>
                  <Text style={{ fontSize: 13, color: '#6C5CE7' }}>Clear</Text>
                </TouchableOpacity>
              )}
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
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={
                        filterStatus === key
                          ? { ...WEB_POPOVER.optionText, ...WEB_POPOVER.optionTextSelected }
                          : WEB_POPOVER.optionText
                      }
                      numberOfLines={1}
                    >
                      {key === 'all' ? 'All' : CLIENT_DISPLAY_STATUS_LABELS[key as keyof typeof CLIENT_DISPLAY_STATUS_LABELS]}
                    </Text>
                  </View>
                  {filterStatus === key ? (
                    <Ionicons name="checkmark" size={18} color="#6C5CE7" />
                  ) : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </div>,
          document.body
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Match Expenses (receipts) page: container + header + headerRow + sortButton + searchContainer
  webContainer: { flex: 1, backgroundColor: '#ECEFF1' },
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  content: { padding: 20, paddingBottom: 40 },
  toolbarSlot: {
    height: 52,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
    justifyContent: 'center',
    overflow: 'visible' as const,
  },
  toolbarSlotDropdownOpen: {
    zIndex: 100000,
    elevation: 100000,
  },
  header: {
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    overflow: 'visible' as const,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    overflow: 'visible' as const,
  },
  groupWrap: { position: 'relative' as const, overflow: 'visible' as const },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sortText: {
    fontSize: 14,
    color: '#636E72',
    marginRight: 4,
    fontWeight: '500',
  },
  groupDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 4,
    backgroundColor: '#FFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    paddingVertical: 8,
    minWidth: 140,
    zIndex: 99999,
    elevation: 99999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  groupOption: { paddingVertical: 10, paddingHorizontal: 14 },
  groupOptionSelected: { backgroundColor: 'rgba(108, 92, 231, 0.1)' },
  groupOptionText: { fontSize: 14, color: '#2D3436' },
  groupOptionTextSelected: { color: '#6C5CE7', fontWeight: '600' },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#2D3436', padding: 0 },
  searchClear: { marginLeft: 4 },
  mobileInviteActions: {
    // deprecated: firm mobile actions moved to bottom bar
  },
  filterButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  filterText: { fontSize: 14, color: '#636E72', marginRight: 4, fontWeight: '500' },
  filterBadge: { fontSize: 14, color: '#6C5CE7', fontWeight: '600' },
  receiptItem: {
    backgroundColor: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 12,
    paddingLeft: 24,
    borderBottomWidth: 0,
    borderBottomColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  receiptItemPending: {
    backgroundColor: '#F8F9FA',
    opacity: 0.95,
  },
  receiptContent: { flex: 1 },
  firstRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  storeName: { flex: 1, fontSize: 16, fontWeight: '600', color: '#2D3436', marginRight: 12 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  statusText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  confirmedByText: { fontSize: 12, color: '#636E72', fontWeight: '500' },
  secondRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  contactText: {
    fontSize: 13,
    color: '#34495E',
    // 约限制为 12 个字符宽度，避免挤占后续字段
    minWidth: 108,
    marginLeft: 16,
  },
  assigneeText: {
    fontSize: 12,
    color: '#636E72',
    maxWidth: 108,
    textAlign: 'right',
  },
  orderCountText: {
    fontSize: 12,
    color: '#6C5CE7',
    fontWeight: '500',
  },
  date: { fontSize: 14, color: '#636E72' },
  followUpDate: {
    fontSize: 11,
    color: '#636E72',
    // 与 assignee name 之间留较小但清晰的间距
    marginLeft: 4,
  },
  mobileBottomBar: {
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
  // 主按钮：Add client（尺寸与阴影完全对齐 receipt 详情 Confirm 按钮）
  mobileBottomPrimaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // 浅紫底色，视觉上与 Web 端 header 的 Add client 接近
    backgroundColor: '#EAEAFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    ...(Platform.OS === 'android'
      ? { elevation: 0, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' }
      : { elevation: 4 }),
  },
  mobileBottomPrimaryText: {
    marginLeft: 8,
    fontSize: 16,
    color: '#6C5CE7',
    fontWeight: '600',
  },
  // 次按钮：Open invite（尺寸与阴影完全对齐 receipt 详情 Cancel 按钮）
  mobileBottomSecondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.11,
    shadowRadius: 10,
    ...(Platform.OS === 'android'
      ? { elevation: 0, borderWidth: 1, borderColor: 'rgba(0,0,0,0.14)' }
      : { elevation: 3 }),
  },
  mobileBottomSecondaryText: {
    marginLeft: 8,
    fontSize: 16,
    color: '#636E72',
    fontWeight: '600',
  },
  listContent: { paddingHorizontal: 4, paddingTop: 0, paddingBottom: 100 },
  emptyList: { flexGrow: 1 },
  sectionHeader: {
    backgroundColor: '#E9ECEF',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#DEE2E6',
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#2D3436' },
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionCount: { fontSize: 14, color: '#636E72' },
  bulkBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#E8E0F7',
  },
  bulkText: { fontSize: 14, color: '#2D3436', fontWeight: '500', marginRight: 8 },
  bulkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#6C5CE7',
    borderRadius: 8,
  },
  bulkBtnDanger: { backgroundColor: '#E74C3C' },
  bulkBtnDisabled: { opacity: 0.6 },
  bulkBtnText: { fontSize: 14, color: '#fff', fontWeight: '600' },
  bulkBtnClear: { paddingVertical: 8, paddingHorizontal: 12 },
  bulkBtnClearText: { fontSize: 14, color: '#636E72', fontWeight: '500' },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  tableScroll: { flex: 1 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 48 },
  loader: { marginTop: 40 },
  empty: { marginTop: 24 },
  emptyText: { fontSize: 14, color: '#95A5A6' },
  list: { gap: 12, paddingHorizontal: 20 },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#2D3436', marginBottom: 12 },
  cardRow: { flexDirection: 'row', marginBottom: 6 },
  label: { fontSize: 13, color: '#636E72', width: 110 },
  value: { flex: 1, fontSize: 14, color: '#2D3436' },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#EAEAFF',
  },
  inviteButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6C5CE7',
  },
  inviteHistoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F1F3F5',
  },
  inviteHistoryButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#636E72',
  },
  inviteSkuPreviewPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#F3F4FF',
  },
  inviteSkuPreviewText: {
    marginLeft: 4,
    fontSize: 11,
    fontWeight: '500',
    color: '#6C5CE7',
  },
  inviteHeader: {
    marginBottom: 16,
    gap: 6,
  },
  inviteTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2D3436',
  },
  inviteSubtitle: {
    fontSize: 12,
    color: '#636E72',
  },
  inviteBodyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 20,
  },
  inviteLeftColumn: {
    flex: 1,
    minWidth: 0,
  },
  inviteRightColumn: {
    width: 400,
    minWidth: 0,
    marginTop: 4,
    paddingLeft: 8,
  },
  inviteSettingsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
    gap: 24,
  },
  inviteSettingsLeft: {
    flex: 1.4,
  },
  inviteSettingsRight: {
    flex: 1,
  },
  inviteSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 8,
  },
  inviteSkuTable: {
    maxHeight: 236,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 10,
    backgroundColor: '#FFF',
    overflow: 'hidden',
  },
  inviteSkuListWrapper: {
    flex: 1,
  },
  inviteSkuList: {
    flex: 1,
  },
  inviteSkuListContent: {
    paddingVertical: 0,
  },
  inviteSkuHeaderRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#E9ECEF',
  },
  inviteSkuHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#636E72',
  },
  inviteSkuRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F2F5',
  },
  inviteSkuRowSelected: {
    backgroundColor: 'rgba(108, 92, 231, 0.06)',
  },
  inviteSkuRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  inviteSkuName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#2D3436',
    flexShrink: 1,
    marginRight: 8,
  },
  inviteSkuNameSelected: {
    color: '#6C5CE7',
  },
  inviteSkuCode: {
    fontSize: 12,
    color: '#636E72',
  },
  inviteSkuDesc: {
    fontSize: 12,
    color: '#7F8C8D',
  },
  inviteConfigRow: {
    marginBottom: 12,
  },
  inviteConfigLabel: {
    fontSize: 13,
    color: '#636E72',
    marginBottom: 6,
  },
  invitePillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  invitePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    backgroundColor: '#FFF',
  },
  invitePillSelected: {
    borderColor: '#6C5CE7',
    backgroundColor: 'rgba(108, 92, 231, 0.08)',
  },
  invitePillText: {
    fontSize: 13,
    color: '#636E72',
  },
  invitePillTextSelected: {
    color: '#6C5CE7',
    fontWeight: '600',
  },
  inviteResultRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 12,
    alignItems: 'stretch',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    backgroundColor: '#FDFDFE',
  },
  inviteResultLeft: {
    flex: 1,
  },
  inviteQrColumn: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
  },
  inviteQrBox: {
    width: 128,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteHintText: {
    fontSize: 12,
    color: '#B2BEC3',
  },
  inviteActionsRow: {
    marginTop: 12,
  },
  invitePrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: '#6C5CE7',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
  },
  invitePrimaryBtnDisabled: {
    opacity: 0.5,
  },
  invitePrimaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  inviteLinkBox: {
    marginTop: 8,
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E1E4FF',
  },
  inviteLinkLabel: {
    fontSize: 11,
    color: '#95A5A6',
    marginBottom: 4,
  },
  inviteLinkValue: {
    fontSize: 12,
    color: '#2D3436',
  },
  inviteLinkButtonsRow: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 8,
  },
  inviteQrRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inviteQrLinkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    width: '100%',
    gap: 16,
  },
  inviteResultBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    minWidth: 0,
  },
  inviteLinkBlockInner: {
    width: 148,
    maxWidth: 148,
    alignItems: 'flex-start',
    overflow: 'hidden',
  },
  inviteLinkContentTop: {
    minHeight: 112,
    width: '100%',
    maxWidth: 148,
  },
  inviteCopyBtn: {
    marginTop: 8,
    alignSelf: 'center',
  },
  inviteLinkColumn: {
    flex: 1,
    minWidth: 0,
    maxWidth: 144,
  },
  inviteLinkCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  inviteLinkCodeBox: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E1E4FF',
    backgroundColor: '#F7F8FF',
    alignSelf: 'stretch',
    maxWidth: 148,
    maxHeight: 94,
    overflow: 'hidden',
  },
  inviteLinkCodeText: {
    fontSize: 11,
    color: '#2D3436',
    fontFamily: Platform.select({ web: 'monospace', default: 'System' }),
    maxWidth: '100%',
    flexWrap: 'wrap',
    ...(Platform.OS === 'web'
      ? {
          display: '-webkit-box' as const,
          WebkitLineClamp: 6,
          WebkitBoxOrient: 'vertical' as const,
          overflow: 'hidden',
        }
      : {}),
  },
  inviteResultButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  inviteSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#EAEAFF',
  },
  inviteSecondaryBtnText: {
    fontSize: 11,
    color: '#6C5CE7',
    fontWeight: '500',
  },
  inviteQrPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D1D8E0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F6FA',
  },
  inviteQrPlaceholderText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#A4B0BE',
  },
  inviteErrorText: {
    marginTop: 6,
    fontSize: 12,
    color: '#E17055',
  },
  inviteHistoryContainer: {
    flex: 1,
    minHeight: 200,
    flexDirection: 'column',
  },
  inviteHistoryBodyWrap: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'column',
  },
  inviteHistoryScroll: {
    flex: 1,
  },
  inviteHistoryScrollContent: {
    flexGrow: 1,
  },
  inviteHistoryTable: {
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 10,
    backgroundColor: '#FFF',
    overflow: 'hidden',
  },
  inviteHistoryTableOuter: {
    flex: 1,
    minHeight: 0,
  },
  inviteHistoryTableBodyScroll: {
    flex: 1,
    minHeight: 0,
  },
  inviteHistoryTableBodyContent: {
    paddingBottom: 8,
  },
  inviteHistoryColAction: {
    width: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  inviteHistoryDeleteBtn: {
    padding: 6,
  },
  inviteHistoryEmptyWrap: {
    paddingVertical: 24,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  inviteHistoryFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: 16,
    paddingBottom: 8,
  },
  inviteHistoryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inviteHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inviteHistoryCellText: {
    fontSize: 12,
    color: '#2D3436',
    marginRight: 4,
  },
  inviteHistoryStatusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  inviteHistoryStatusActive: {
    color: '#00B894',
  },
  inviteHistoryStatusInactive: {
    color: '#E17055',
  },
  inviteHistoryActivePill: {
    width: 80,
    minHeight: 26,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#00B894',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  inviteHistoryActivePillInactive: {
    backgroundColor: '#E17055',
  },
  inviteHistoryActiveSpinner: {
    width: 14,
    height: 14,
    marginLeft: 4,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  inviteHistoryActiveText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
  inviteHistoryColService: {
    flex: 1.6,
    minWidth: 0,
    paddingRight: 6,
    marginRight: 10,
  },
  inviteHistoryColExpiry: {
    flex: 1,
    minWidth: 0,
    paddingRight: 6,
    marginRight: 10,
  },
  inviteHistoryColActive: {
    width: 80,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
    marginRight: 10,
  },
  inviteHistoryColJoined: {
    width: 68,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 6,
    marginRight: 14,
  },
  inviteHistoryColInitiator: {
    flex: 1.3,
    minWidth: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingLeft: 6,
    paddingRight: 6,
    marginRight: 10,
  },
  inviteHistoryColCreated: {
    width: 112,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingLeft: 4,
    marginRight: 4,
  },
  inviteHistoryCellTextRight: {
    textAlign: 'right',
  },
});
