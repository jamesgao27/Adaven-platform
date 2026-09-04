/**
 * Firm - Engagements: table (客户、服务项年度+SKU、创建时间、来源、进展状态、负责人、更新时间).
 * Web: DataTable with group, filter, search, multi-select, batch (e.g. cancel). Mobile: card list.
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
  Modal,
  Pressable,
  Platform,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { getCurrentSpace } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import {
  getFirmClientsWithDetails,
  getFirmOrdersWithDetails,
  getFirmSkus,
  createFirmOrder,
  updateOrderStatus,
  getFirmSpaceMembers,
  updateFirmOrderManager,
  type FirmClientWithDetails,
  type FirmSpaceMember,
  type FirmOrderWithDetails,
} from '@/lib/firm';
import DataTable, { type DataTableColumn, WEB_POPOVER } from '@/components/DataTable';
import EngagementClassificationFilterChips from '@/components/EngagementClassificationFilterChips';
import { getTaxSeasonColor, getTaxSeasonBgColor } from '@/lib/tax-season-colors';
import CenterModal from '../../components/CenterModal';
import SkuPreview from '../../components/SkuPreview';
import type { FirmSku } from '@/types';
import { createPendingOrderForInvitee } from '@/lib/firm-clients';
import { preflightFirmEngagementCreateOrAlert } from '@/lib/firm-engagement-preflight-ui';
import { showToast } from '@/lib/toast';
import {
  CLASSIFICATION_DIMENSIONS,
  type ClassificationDimension,
  type ClassificationDimFilter,
  collectClassificationOptionsForDim,
  classificationFilterConstraintCount,
  customClassificationGroupKey,
  emptyClassificationDimFilters,
  getTaxSeasonYearForClassification,
  orderMatchesClassificationDimFilters,
} from '@/lib/firm-classification-dimensions';
import { useWebViewportKind } from '../../lib/web-viewport';

const STATUS_LABEL: Record<string, string> = {
  onboarding: 'Onboarding',
  processing: 'Processing',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_COLOR: Record<string, string> = {
  onboarding: '#E67E22',
  processing: '#29B6F6',
  completed: '#00B894',
  cancelled: '#B2BEC3',
};

// Mobile 列表状态标签配色：与 client 侧 / 详情页保持“浅底色 + 深字色”规范
const STATUS_BG_SOFT: Record<string, string> = {
  onboarding: '#FFF3E0',
  processing: '#E1F5FE',
  completed: '#E3FCEF',
  cancelled: '#F0F2F5',
};
const STATUS_FG_SOFT: Record<string, string> = {
  onboarding: '#E67E22',
  processing: '#0288D1',
  completed: '#00875A',
  cancelled: '#636E72',
};

/** Client type dot: green = claimed (order has clientSpaceId), amber = pending firm.clients row (order.client_id, no space yet). */
const CLIENT_TYPE_DOT = { client: '#27AE60', pendingInvitee: '#F39C12' };
function isOrderPendingClaim(o: { clientSpaceId?: string | null; clientId?: string | null }): boolean {
  return !o.clientSpaceId && !!o.clientId;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return format(d, 'MMM dd, yyyy');
  } catch {
    return '—';
  }
}

function formatTimeAgo(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return `${diffMins} minutes ago`;
    }
    if (diffHours < 24) return `${diffHours} hours ago`;
    const dateOnly = dateString.includes('T') ? dateString.split('T')[0] : dateString;
    return formatDate(dateOnly);
  } catch {
    return '—';
  }
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return format(d, 'MMM dd, yyyy HH:mm');
  } catch {
    return '—';
  }
}

function getCategoryTags(row: FirmOrderWithDetails): string[] {
  const tags: string[] = [];
  const dateForYear = row.dueAt || row.createdAt || null;
  const explicitYear = row.taxSeasonYear != null ? row.taxSeasonYear : null;
  if (explicitYear != null) {
    tags.push(String(explicitYear));
  } else if (dateForYear) {
    try {
      const y = new Date(dateForYear).getFullYear();
      if (!Number.isNaN(y)) tags.push(String(y));
    } catch {
      // ignore
    }
  }
  if (row.taxCountry) tags.push(row.taxCountry);
  if (row.taxScenario) tags.push(row.taxScenario);
  if (Array.isArray(row.tags)) {
    for (const t of row.tags) {
      if (t && typeof t === 'string') tags.push(t);
    }
  }
  return tags;
}

function formatCategory(row: FirmOrderWithDetails): string {
  const parts = getCategoryTags(row);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** 服务项名称 */
function serviceItemLabel(row: FirmOrderWithDetails): string {
  return row.skuName || '—';
}

/** Same as column / pill: infer tax season year for display */
function getTaxSeasonYear(row: FirmOrderWithDetails): number | null {
  return getTaxSeasonYearForClassification(row);
}

function matchQuery(q: string, row: FirmOrderWithDetails): boolean {
  const lower = q.trim().toLowerCase();
  if (!lower) return true;
  const client = (row.clientName || '').toLowerCase();
  const sku = (row.skuName || '').toLowerCase();
  const source = (row.source || '').toLowerCase();
  const status = (row.status || '').toLowerCase();
  const assignee = (row.assigneeName || '').toLowerCase();
  const category = formatCategory(row).toLowerCase();
  return (
    client.includes(lower) ||
    sku.includes(lower) ||
    source.includes(lower) ||
    status.includes(lower) ||
    assignee.includes(lower) ||
    category.includes(lower)
  );
}

type GroupByType =
  | 'none'
  | 'byClient'
  | 'byStatus'
  | 'bySeason'
  | 'byCountry'
  | 'byScenario'
  | 'byCustom';
type FilterStatus = 'all' | 'onboarding' | 'processing' | 'completed' | 'cancelled';
type EngagementFilterSubMenu = 'main' | 'status' | 'classification';

const cellText = { fontSize: 14, color: '#2D3436' };

function getOrderColumns(): DataTableColumn<FirmOrderWithDetails>[] {
  return [
    {
      id: 'clientName',
      label: 'Client',
      minWidth: 140,
      getValue: (r) => {
        const isInvitee = isOrderPendingClaim(r);
        const dotColor = isInvitee ? CLIENT_TYPE_DOT.pendingInvitee : CLIENT_TYPE_DOT.client;
        return (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor, flexShrink: 0 }} />
            <Text style={[cellText, { flex: 1, minWidth: 0 }]} numberOfLines={1} ellipsizeMode="tail">
              {r.clientName || '—'}
            </Text>
          </View>
        );
      },
      getSortValue: (r) => (r.clientName || '').toLowerCase(),
    },
    {
      id: 'serviceItem',
      label: 'Service',
      minWidth: 160,
      getValue: (r) => (
        <Text style={cellText} numberOfLines={1} ellipsizeMode="tail">
          {serviceItemLabel(r)}
        </Text>
      ),
      getSortValue: (r) => serviceItemLabel(r).toLowerCase(),
    },
    {
      id: 'category',
      label: 'Classification',
      minWidth: 200,
      getValue: (r) => {
        const txt = formatCategory(r);
        return (
          <Text
            style={[cellText, txt === '—' ? { color: '#95A5A6' } : undefined]}
            numberOfLines={1}
            ellipsizeMode="tail"
            {...(Platform.OS === 'web' && txt !== '—' ? ({ title: txt } as Record<string, string>) : {})}
          >
            {txt}
          </Text>
        );
      },
      getSortValue: (r) => formatCategory(r).toLowerCase(),
    },
    {
      id: 'status',
      label: 'Status',
      minWidth: 100,
      getValue: (r) => {
        const raw = r.status ?? '';
        const label = STATUS_LABEL[raw] ?? raw ?? '—';
        const color = STATUS_COLOR[raw] ?? '#636E72';
        return (
          <View style={{ flexDirection: 'row', alignSelf: 'flex-start' }}>
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 12,
                backgroundColor: color,
              }}
            >
              <Text
                style={{ fontSize: 12, fontWeight: '600', color: '#fff' }}
                numberOfLines={1}
              >
                {label}
              </Text>
            </View>
          </View>
        );
      },
      getSortValue: (r) => r.status ?? '',
    },
    {
      id: 'updatedAt',
      label: 'Updated',
      minWidth: 120,
      getValue: (r) => {
        const txt = formatDateTime(r.updatedAt);
        return (
          <Text
            style={cellText}
            numberOfLines={1}
            ellipsizeMode="tail"
            {...(Platform.OS === 'web' && txt !== '—' ? ({ title: txt } as Record<string, string>) : {})}
          >
            {txt}
          </Text>
        );
      },
      getSortValue: (r) => r.updatedAt ?? '',
    },
    {
      id: 'assigneeName',
      label: 'Manager',
      minWidth: 100,
      getValue: (r) => (
        <Text style={cellText} numberOfLines={1} ellipsizeMode="tail">
          {r.assigneeName ?? '—'}
        </Text>
      ),
      getSortValue: (r) => (r.assigneeName ?? '').toLowerCase(),
    },
    {
      id: 'createdAt',
      label: 'Created date',
      minWidth: 110,
      getValue: (r) => (
        <Text style={cellText} numberOfLines={1} ellipsizeMode="tail">
          {formatDate(r.createdAt)}
        </Text>
      ),
      getSortValue: (r) => r.createdAt ?? '',
    },
    {
      id: 'source',
      label: 'Source',
      minWidth: 90,
      visible: false,
      getValue: (r) => (
        <Text style={cellText} numberOfLines={1} ellipsizeMode="tail">
          {r.source || '—'}
        </Text>
      ),
      getSortValue: (r) => (r.source || '').toLowerCase(),
    },
  ];
}

export default function FirmEngagementsScreen() {
  const { isDesktopWeb } = useWebViewportKind();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [orders, setOrders] = useState<FirmOrderWithDetails[]>([]);
  const [clientRows, setClientRows] = useState<FirmClientWithDetails[]>([]);
  const [skuList, setSkuList] = useState<FirmSku[]>([]);
  const [newEngagementModalVisible, setNewEngagementModalVisible] = useState(false);
  const [creatingEngagement, setCreatingEngagement] = useState(false);
  const [selectedClientKey, setSelectedClientKey] = useState<string | null>(null);
  const [selectedSkuId, setSelectedSkuId] = useState<string | null>(null);
  const [clientNameInput, setClientNameInput] = useState('');
  const [contactNameInput, setContactNameInput] = useState('');
  const [contactEmailInput, setContactEmailInput] = useState('');
  const [activeClientField, setActiveClientField] = useState<'clientName' | 'contactName' | 'contactEmail'>('clientName');
  const [showClientMenu, setShowClientMenu] = useState(false);
  const [clientDropdownRect, setClientDropdownRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const clientNameRef = useRef<View>(null);
  const contactNameRef = useRef<View>(null);
  const contactEmailRef = useRef<View>(null);
  const [showSkuMenu, setShowSkuMenu] = useState(false);
  const [skuDropdownRect, setSkuDropdownRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const skuSelectRef = useRef<View>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupBy, setGroupBy] = useState<GroupByType>('none');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [filterSubMenu, setFilterSubMenu] = useState<EngagementFilterSubMenu>('main');
  const [classFilterByDim, setClassFilterByDim] = useState(() => emptyClassificationDimFilters());
  const classOptionsRef = useRef<Record<ClassificationDimension, string[]>>({
    season: [],
    country: [],
    scenario: [],
    custom: [],
  });
  const [sortKey, setSortKey] = useState<string | null>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [bulkCancelling, setBulkCancelling] = useState(false);
  const [showAssignManagerPicker, setShowAssignManagerPicker] = useState(false);
  const [assignMembers, setAssignMembers] = useState<FirmSpaceMember[]>([]);
  const [assignSelectedMemberId, setAssignSelectedMemberId] = useState<string | null>(null);
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);
  const [groupPopoverRect, setGroupPopoverRect] = useState<{ left: number; top: number } | null>(null);
  const [filterPopoverRect, setFilterPopoverRect] = useState<{ left: number; top: number } | null>(null);

  const orderColumns = useMemo(() => getOrderColumns(), []);

  // Web: 计算分组 / 筛选浮窗位置（对齐 receipts 列表实现）
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    if (showGroupMenu) {
      const measure = () => {
        const el = document.getElementById('firm-engagements-group-button');
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
        const el = document.getElementById('firm-engagements-filter-button');
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

  // Web: 点击外部关闭（同时考虑按钮与浮窗）
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: PointerEvent) => {
      const target = e.target as Node;
      const groupBtn = document.getElementById('firm-engagements-group-button');
      const groupPopover = document.getElementById('firm-engagements-group-popover');
      const filterBtn = document.getElementById('firm-engagements-filter-button');
      const filterPopover = document.getElementById('firm-engagements-filter-popover');

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
        setFilterSubMenu('main');
      }

      // Create engagement dropdowns: close when clicking outside anchors + menus
      const clientMenu = document.getElementById('create-engagement-client-menu');
      const skuMenu = document.getElementById('create-engagement-sku-menu');
      const anchors = [
        document.getElementById('create-engagement-clientName-anchor'),
        document.getElementById('create-engagement-contactName-anchor'),
        document.getElementById('create-engagement-contactEmail-anchor'),
        document.getElementById('create-engagement-sku-anchor'),
      ].filter(Boolean) as HTMLElement[];
      const clickedInAnchors = anchors.some((a) => a.contains(target));

      if (showClientMenu && clientMenu && !clientMenu.contains(target) && !clickedInAnchors) {
        setShowClientMenu(false);
        setClientDropdownRect(null);
      }
      if (showSkuMenu && skuMenu && !skuMenu.contains(target) && !clickedInAnchors) {
        setShowSkuMenu(false);
        setSkuDropdownRect(null);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [showGroupMenu, showFilterMenu, showClientMenu, showSkuMenu]);

  const [firmSpaceId, setFirmSpaceId] = useState<string | null>(null);
  const loadData = useCallback(async (forceRefresh = false) => {
    const space = await getCurrentSpace(forceRefresh);
    if (!space?.id || space.kind !== 'provider') {
      router.replace('/');
      return;
    }
    setFirmSpaceId(space.id);
    const list = await getFirmOrdersWithDetails(space.id);
    setOrders(list);
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
    const ch = supabase
      .channel(`firm-engagements-orders-${firmSpaceId}`)
      .on('postgres_changes', { event: '*', schema: 'firm', table: 'orders', filter: `firm_space_id=eq.${firmSpaceId}` }, debouncedRefresh)
      .subscribe();
    return () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      supabase.removeChannel(ch);
    };
  }, [firmSpaceId, loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  }, [loadData]);

  const selectableSkus = useMemo(
    () =>
      skuList.filter((s) =>
        s.templateStatus != null
          ? s.templateStatus !== 'draft'
          : s.isPublished === true || !!s.taxCountry || !!s.taxScenario
      ),
    [skuList]
  );

  const clientKey = useCallback((c: FirmClientWithDetails) => {
    return c.isPendingClaim ? `invitee-${c.id}` : `space-${c.clientSpaceId}`;
  }, []);

  const selectedClient = useMemo(() => {
    if (!selectedClientKey) return null;
    return clientRows.find((c) => clientKey(c) === selectedClientKey) ?? null;
  }, [clientRows, selectedClientKey, clientKey]);

  useEffect(() => {
    if (!selectedClient) {
      setClientNameInput('');
      setContactNameInput('');
      setContactEmailInput('');
      return;
    }
    setClientNameInput(selectedClient.name || '');
    setContactNameInput(selectedClient.contactName || '');
    setContactEmailInput(selectedClient.contactEmail || '');
  }, [selectedClient]);

  const handleOpenNewEngagementModal = useCallback(async () => {
    const space = await getCurrentSpace();
    if (!space?.id || space.kind !== 'provider') return;
    setFirmSpaceId(space.id);

    // 每次打开都重置上次选择/输入状态
    setActiveClientField('clientName');
    setClientNameInput('');
    setContactNameInput('');
    setContactEmailInput('');
    setShowClientMenu(false);
    setClientDropdownRect(null);
    setShowSkuMenu(false);
    setSkuDropdownRect(null);

    // 不自动选中 client；前三项由用户在列表中选择或输入过滤后选择（每次打开已清空输入）
    if (clientRows.length === 0) {
      const rows = await getFirmClientsWithDetails(space.id);
      setClientRows(rows);
    }
    setSelectedClientKey(null);
    if (skuList.length === 0) {
      const skus = await getFirmSkus(space.id);
      setSkuList(skus);
      const firstSku = (skus || []).find((s) =>
        s.templateStatus != null
          ? s.templateStatus !== 'draft'
          : s.isPublished === true || !!s.taxCountry || !!s.taxScenario
      );
      setSelectedSkuId(firstSku?.id ?? null);
    } else {
      const firstSku = selectableSkus[0] ?? null;
      setSelectedSkuId(firstSku?.id ?? null);
    }

    setNewEngagementModalVisible(true);
  }, [clientRows.length, skuList.length, selectableSkus]);

  const handleCreateEngagement = useCallback(async (): Promise<string | null> => {
    if (!firmSpaceId) return null;
    if (!selectedClient || !selectedSkuId) return null;
    setCreatingEngagement(true);
    const pre = await preflightFirmEngagementCreateOrAlert(firmSpaceId, router);
    if (!pre) {
      setCreatingEngagement(false);
      return null;
    }
    let createdId: string | null = null;
    let error: Error | null = null;

    if (selectedClient.isPendingClaim) {
      const res = await createPendingOrderForInvitee(firmSpaceId, {
        clientName: selectedClient.name || '',
        contactName: selectedClient.contactName ?? '',
        contactEmail: selectedClient.contactEmail ?? '',
        skuId: selectedSkuId,
      });
      error = res.error;
      if (!error) createdId = res.result?.orderId ?? null;
    } else {
      const res = await createFirmOrder(firmSpaceId, selectedClient.clientSpaceId, selectedSkuId, null);
      error = res?.error ?? null;
      if (!error) createdId = res?.id ?? null;
    }

    setCreatingEngagement(false);
    if (error) {
      showToast(error.message ?? 'Failed to create engagement.', 'error');
      return null;
    }
    return createdId;
  }, [firmSpaceId, selectedClient, selectedSkuId, router]);

  const confirmCreateAndClose = useCallback(async () => {
    const orderId = await handleCreateEngagement();
    if (orderId) {
      setNewEngagementModalVisible(false);
      router.push(`/firm/engagement/${orderId}`);
    }
  }, [handleCreateEngagement, router]);

  const openClientMenu = useCallback((field: 'clientName' | 'contactName' | 'contactEmail') => {
    setActiveClientField(field);
    if (showClientMenu) {
      setShowClientMenu(false);
      return;
    }
    const ref =
      field === 'clientName' ? clientNameRef : field === 'contactName' ? contactNameRef : contactEmailRef;
    ref.current?.measureInWindow((x, y, w, h) => {
      setClientDropdownRect({ x, y, width: w, height: h });
      setShowClientMenu(true);
    });
  }, [showClientMenu]);

  const onClientFieldChange = useCallback((field: 'clientName' | 'contactName' | 'contactEmail', v: string) => {
    setActiveClientField(field);
    if (field === 'clientName') setClientNameInput(v);
    if (field === 'contactName') setContactNameInput(v);
    if (field === 'contactEmail') setContactEmailInput(v);
    const ref =
      field === 'clientName' ? clientNameRef : field === 'contactName' ? contactNameRef : contactEmailRef;
    ref.current?.measureInWindow((x, y, w, h) => {
      setClientDropdownRect({ x, y, width: w, height: h });
      setShowClientMenu(true);
    });
  }, []);

  const clientQuery = useMemo(() => {
    return activeClientField === 'clientName'
      ? clientNameInput
      : activeClientField === 'contactName'
        ? contactNameInput
        : contactEmailInput;
  }, [activeClientField, clientNameInput, contactNameInput, contactEmailInput]);

  const filteredClientsForMenu = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    const list = clientRows.slice();
    const getPrimary = (c: FirmClientWithDetails) =>
      activeClientField === 'clientName'
        ? (c.name || '')
        : activeClientField === 'contactName'
          ? (c.contactName || '')
          : (c.contactEmail || '');
    list.sort((a, b) => getPrimary(a).localeCompare(getPrimary(b)));
    if (tokens.length === 0) return list;
    return list.filter((c) => {
      const hay = `${c.name || ''} ${c.contactName || ''} ${c.contactEmail || ''}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [clientRows, clientQuery, activeClientField]);

  const openSkuMenu = useCallback(() => {
    if (selectableSkus.length === 0) return;
    if (showSkuMenu) {
      setShowSkuMenu(false);
      return;
    }
    skuSelectRef.current?.measureInWindow((x, y, w, h) => {
      setSkuDropdownRect({ x, y, width: w, height: h });
      setShowSkuMenu(true);
    });
  }, [selectableSkus.length, showSkuMenu]);

  const filteredByStatus = useMemo(() => {
    if (filterStatus === 'all') return orders;
    return orders.filter((o) => o.status === filterStatus);
  }, [orders, filterStatus]);

  const classificationOptionsByDim = useMemo(() => {
    const out: Record<ClassificationDimension, string[]> = {
      season: [],
      country: [],
      scenario: [],
      custom: [],
    };
    for (const d of CLASSIFICATION_DIMENSIONS) {
      out[d] = collectClassificationOptionsForDim(filteredByStatus, d);
    }
    return out;
  }, [filteredByStatus]);

  useEffect(() => {
    classOptionsRef.current = classificationOptionsByDim;
  }, [classificationOptionsByDim]);

  const filteredByClassification = useMemo(
    () =>
      filteredByStatus.filter((o) =>
        orderMatchesClassificationDimFilters(o, classFilterByDim, classificationOptionsByDim)
      ),
    [filteredByStatus, classFilterByDim, classificationOptionsByDim]
  );

  const classificationConstraintCount = useMemo(
    () => classificationFilterConstraintCount(classFilterByDim, classificationOptionsByDim),
    [classFilterByDim, classificationOptionsByDim]
  );

  const engagementActiveFilterCount = useMemo(() => {
    let n = 0;
    if (filterStatus !== 'all') n += 1;
    n += classificationConstraintCount;
    return n;
  }, [filterStatus, classificationConstraintCount]);

  const toggleClassificationDimValue = useCallback((d: ClassificationDimension, value: string) => {
    const allVals = classOptionsRef.current[d];
    if (allVals.length === 0) return;
    setClassFilterByDim((prev) => {
      const cur = prev[d];
      if (cur.mode === 'all') {
        return { ...prev, [d]: { mode: 'include', values: new Set([value]) } };
      }
      const set = new Set(cur.values);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      const nextList = allVals.filter((x) => set.has(x));
      if (nextList.length === 0) {
        return { ...prev, [d]: { mode: 'all' } };
      }
      if (nextList.length === allVals.length) {
        return { ...prev, [d]: { mode: 'all' } };
      }
      return { ...prev, [d]: { mode: 'include', values: new Set(nextList) } };
    });
  }, []);

  const selectClassificationDimAll = useCallback((d: ClassificationDimension) => {
    const allVals = classOptionsRef.current[d];
    if (allVals.length === 0) return;
    setClassFilterByDim((prev) => {
      const cur = prev[d];
      if (cur.mode === 'all') {
        return { ...prev, [d]: { mode: 'include', values: new Set(allVals) } };
      }
      return { ...prev, [d]: { mode: 'all' } };
    });
  }, []);

  const searchedOrders = useMemo(
    () => filteredByClassification.filter((o) => matchQuery(searchQuery, o)),
    [filteredByClassification, searchQuery]
  );

  const sortRowsByColumn = useCallback(
    <T,>(
      rows: T[],
      col:
        | { getSortValue?: (row: T) => string | number | Date | null | undefined }
        | undefined,
      dir: 'asc' | 'desc'
    ): T[] => {
      if (!col?.getSortValue) return rows;
      return [...rows].sort((a, b) => {
        const va = col.getSortValue!(a);
        const vb = col.getSortValue!(b);
        const cmp =
          va === vb ? 0 : va == null ? 1 : vb == null ? -1 : va < vb ? -1 : 1;
        return dir === 'asc' ? cmp : -cmp;
      });
    },
    []
  );

  const groupedSections = useMemo(() => {
    if (groupBy === 'none') return [{ title: 'All', data: searchedOrders }];
    if (groupBy === 'byClient') {
      const byClient: Record<string, FirmOrderWithDetails[]> = {};
      searchedOrders.forEach((o) => {
        const key = o.clientName || o.clientSpaceId;
        if (!byClient[key]) byClient[key] = [];
        byClient[key].push(o);
      });
      const keys = Object.keys(byClient).sort((a, b) => a.localeCompare(b));
      return keys.map((k) => ({ title: k, data: byClient[k] }));
    }
    if (groupBy === 'byStatus') {
      const byStatus: Record<string, FirmOrderWithDetails[]> = {};
      searchedOrders.forEach((o) => {
        const key = o.status || 'unknown';
        if (!byStatus[key]) byStatus[key] = [];
        byStatus[key].push(o);
      });
      const order = ['onboarding', 'processing', 'completed', 'cancelled'];
      const keys = order.filter((k) => (byStatus[k]?.length ?? 0) > 0);
      return keys.map((k) => ({
        title: STATUS_LABEL[k] ?? k,
        data: byStatus[k] ?? [],
      }));
    }
    if (groupBy === 'bySeason') {
      const byKey: Record<string, FirmOrderWithDetails[]> = {};
      searchedOrders.forEach((o) => {
        const y = getTaxSeasonYearForClassification(o);
        const k = y != null ? String(y) : 'Unclassified';
        if (!byKey[k]) byKey[k] = [];
        byKey[k].push(o);
      });
      const keys = Object.keys(byKey).sort((a, b) => {
        if (a === 'Unclassified') return 1;
        if (b === 'Unclassified') return -1;
        return b.localeCompare(a, undefined, { numeric: true });
      });
      return keys.map((k) => ({ title: k, data: byKey[k] }));
    }
    if (groupBy === 'byCountry') {
      const byKey: Record<string, FirmOrderWithDetails[]> = {};
      searchedOrders.forEach((o) => {
        const k = o.taxCountry?.trim() || 'Unclassified';
        if (!byKey[k]) byKey[k] = [];
        byKey[k].push(o);
      });
      const keys = Object.keys(byKey).sort((a, b) => a.localeCompare(b));
      return keys.map((k) => ({ title: k, data: byKey[k] }));
    }
    if (groupBy === 'byScenario') {
      const byKey: Record<string, FirmOrderWithDetails[]> = {};
      searchedOrders.forEach((o) => {
        const k = o.taxScenario?.trim() || 'Unclassified';
        if (!byKey[k]) byKey[k] = [];
        byKey[k].push(o);
      });
      const keys = Object.keys(byKey).sort((a, b) => a.localeCompare(b));
      return keys.map((k) => ({ title: k, data: byKey[k] }));
    }
    if (groupBy === 'byCustom') {
      const byKey: Record<string, FirmOrderWithDetails[]> = {};
      searchedOrders.forEach((o) => {
        const k = customClassificationGroupKey(o);
        if (!byKey[k]) byKey[k] = [];
        byKey[k].push(o);
      });
      const keys = Object.keys(byKey).sort((a, b) => a.localeCompare(b));
      return keys.map((k) => ({ title: k, data: byKey[k] }));
    }
    return [{ title: 'All', data: searchedOrders }];
  }, [groupBy, searchedOrders]);

  const col = sortKey ? orderColumns.find((c) => c.id === sortKey) : undefined;
  const tableSections = useMemo(
    () =>
      groupedSections.map((sec) => ({
        title: sec.title,
        data: sortRowsByColumn(sec.data, col, sortDirection),
        count: sec.data.length,
        countLabel: 'engagements',
      })),
    [groupedSections, sortKey, sortDirection, orderColumns, sortRowsByColumn]
  );

  const sortedDataForTable = useMemo(
    () => sortRowsByColumn(searchedOrders, col, sortDirection),
    [searchedOrders, sortKey, sortDirection, orderColumns, sortRowsByColumn]
  );

  const tableEmptyMessage = useMemo(() => {
    if (loading && orders.length === 0) return 'Loading...';
    if (orders.length === 0)
      return 'No engagements yet. Create from Service Catalog for clients.';
    if (searchedOrders.length === 0) {
      if (searchQuery.trim()) return `No results for "${searchQuery}"`;
      if (classificationFilterConstraintCount(classFilterByDim, classificationOptionsByDim) > 0)
        return 'No engagements match the selected classification filters.';
      if (filterStatus !== 'all')
        return `No engagements match status "${STATUS_LABEL[filterStatus] ?? filterStatus}".`;
      return 'No data';
    }
    return 'No data';
  }, [
    loading,
    orders.length,
    searchedOrders.length,
    searchQuery,
    filterStatus,
    classFilterByDim,
    classificationOptionsByDim,
  ]);

  const handleBulkCancel = useCallback(async () => {
    if (selectedOrderIds.length === 0) return;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `Cancel ${selectedOrderIds.length} selected engagement(s)? Status will be set to Cancelled.`
      )
    )
      return;
    setBulkCancelling(true);
    let err: Error | null = null;
    for (const id of selectedOrderIds) {
      const res = await updateOrderStatus(id, 'cancelled');
      if (res.error) err = res.error;
    }
    setBulkCancelling(false);
    if (err && typeof window !== 'undefined') window.alert(err.message);
    else {
      setSelectedOrderIds([]);
      await loadData(true);
    }
  }, [selectedOrderIds, loadData]);

  const handleOpenAssignManagerPicker = useCallback(async () => {
    if (!firmSpaceId || selectedOrderIds.length === 0) return;
    setShowAssignManagerPicker(true);
    setAssignLoading(true);
    setAssignSelectedMemberId(null);
    const members = await getFirmSpaceMembers(firmSpaceId);
    setAssignMembers(members);
    setAssignLoading(false);
  }, [firmSpaceId, selectedOrderIds.length]);

  const handleAssignManagerDone = useCallback(async () => {
    if (!firmSpaceId || !assignSelectedMemberId || selectedOrderIds.length === 0) return;
    setAssignSaving(true);
    let error: Error | null = null;
    for (const orderId of selectedOrderIds) {
      const res = await updateFirmOrderManager(firmSpaceId, orderId, assignSelectedMemberId);
      if (res.error) {
        error = res.error;
        break;
      }
    }
    setAssignSaving(false);
    setShowAssignManagerPicker(false);
    if (error) {
      if (typeof window !== 'undefined') window.alert(error.message);
      return;
    }
    setSelectedOrderIds([]);
    await loadData(true);
  }, [firmSpaceId, assignSelectedMemberId, selectedOrderIds, loadData]);

  // Mobile: receipt-style list (Group, Filter, Search + firstRow/secondRow)
  const engagementSections = useMemo(() => {
    const col = sortKey ? orderColumns.find((c) => c.id === sortKey) : undefined;
    return groupedSections.map((sec) => ({
      title: sec.title,
      monthKey: sec.title,
      data: sortRowsByColumn(sec.data, col, sortDirection),
    }));
  }, [groupedSections, sortKey, sortDirection, orderColumns, sortRowsByColumn]);

  const renderMobileList = () => (
    <View style={styles.container}>
      <View style={styles.toolbarSlot}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <TouchableOpacity
              style={styles.sortButton}
              onPress={() => {
                setShowFilterMenu(false);
                setShowGroupMenu(!showGroupMenu);
              }}
            >
              {groupBy === 'none' && <Ionicons name="list-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
              {groupBy === 'byClient' && <Ionicons name="people-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
              {groupBy === 'byStatus' && <Ionicons name="flag-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
              {groupBy === 'bySeason' && <Ionicons name="calendar-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
              {groupBy === 'byCountry' && <Ionicons name="earth-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
              {groupBy === 'byScenario' && <Ionicons name="reader-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
              {groupBy === 'byCustom' && <Ionicons name="pricetags-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
              <Text style={styles.sortText}>Group</Text>
              <Ionicons name="chevron-down" size={16} color="#636E72" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.filterButton}
              onPress={() => {
                setShowGroupMenu(false);
                setShowFilterMenu(!showFilterMenu);
              }}
            >
              <Text style={styles.filterText}>
                Filter
                {engagementActiveFilterCount > 0 && (
                  <Text style={styles.filterBadge}> ({engagementActiveFilterCount})</Text>
                )}
              </Text>
              <Ionicons name="chevron-down" size={16} color="#636E72" />
            </TouchableOpacity>
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={18} color="#636E72" style={styles.searchIcon} />
              <TextInput style={styles.searchInput} placeholder="Search" placeholderTextColor="#95A5A6" value={searchQuery} onChangeText={setSearchQuery} />
              {searchQuery.trim() ? (
                <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.searchClear}>
                  <Ionicons name="close-circle" size={20} color="#95A5A6" />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
        {showGroupMenu && (
          <View style={[styles.groupDropdown, styles.engagementGroupDropdownScroll]}>
            <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.engagementGroupMenuScroll}>
              {(
                [
                  ['none', 'None'],
                  ['byClient', 'By client'],
                  ['byStatus', 'By status'],
                  ['bySeason', 'By tax season'],
                  ['byCountry', 'By jurisdiction'],
                  ['byScenario', 'By tax scenario'],
                  ['byCustom', 'By custom label'],
                ] as const
              ).map(([key, label]) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.filterPopoverRow, groupBy === key && styles.filterPopoverRowSelected]}
                  onPress={() => {
                    setGroupBy(key);
                    setShowGroupMenu(false);
                  }}
                >
                  <Text style={[styles.filterPopoverRowText, groupBy === key && styles.filterPopoverRowTextSelected]} numberOfLines={1}>
                    {label}
                  </Text>
                  {groupBy === key ? <Ionicons name="checkmark" size={18} color="#6C5CE7" /> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
        {showFilterMenu && (
          <View style={[styles.groupDropdown, styles.engagementFilterDropdown]}>
            <ScrollView nestedScrollEnabled style={styles.engagementFilterScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.engagementFilterSectionLabel}>Status</Text>
              {(['all', 'onboarding', 'processing', 'completed', 'cancelled'] as FilterStatus[]).map((key) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.filterPopoverRow, filterStatus === key && styles.filterPopoverRowSelected]}
                  onPress={() => {
                    setFilterStatus(key);
                  }}
                >
                  <Text style={[styles.filterPopoverRowText, filterStatus === key && styles.filterPopoverRowTextSelected]} numberOfLines={1}>
                    {key === 'all' ? 'All' : STATUS_LABEL[key] ?? key}
                  </Text>
                  {filterStatus === key ? <Ionicons name="checkmark" size={18} color="#6C5CE7" /> : null}
                </TouchableOpacity>
              ))}
              <Text style={[styles.engagementFilterSectionLabel, { marginTop: 10 }]}>Classification</Text>
              <EngagementClassificationFilterChips
                optionsByDim={classificationOptionsByDim}
                classFilterByDim={classFilterByDim}
                onToggleValue={toggleClassificationDimValue}
                onSelectAll={selectClassificationDimAll}
                chipStyles={{
                  dimGroupsWrap: styles.dimGroupsWrap,
                  dimBlock: styles.dimBlock,
                  dimTitleRow: styles.dimTitleRow,
                  dimTitle: styles.dimTitle,
                  dimEmpty: styles.dimEmpty,
                  scopeChipsWrap: styles.scopeChipsWrap,
                  metaTag: styles.scopeChipMeta,
                  scopeLabelChip: styles.scopeLabelChip,
                  scopeLabelChipMin: styles.scopeLabelChipMin,
                  scopeLabelChipText: styles.scopeLabelChipText,
                }}
              />
              {classificationFilterConstraintCount(classFilterByDim, classificationOptionsByDim) > 0 && (
                <TouchableOpacity
                  style={styles.engagementFilterClearTags}
                  onPress={() => setClassFilterByDim(emptyClassificationDimFilters())}
                >
                  <Text style={styles.engagementFilterClearTagsText}>Reset classification filters</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.engagementFilterDoneRow} onPress={() => { setShowFilterMenu(false); }}>
                <Text style={styles.engagementFilterDoneText}>Done</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        )}
      </View>
      {loading && orders.length === 0 ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color="#6C5CE7" />
          <Text style={styles.emptyText}>Loading...</Text>
        </View>
      ) : (
        <>
        <SectionList
          sections={engagementSections}
          keyExtractor={(o) => o.id}
          renderItem={({ item: o }) => {
            const taxYear = getTaxSeasonYear(o);
            const statusBg = STATUS_COLOR[o.status] ?? '#636E72';
            const statusLabel = STATUS_LABEL[o.status] ?? o.status;
            return (
              <TouchableOpacity
                style={[styles.receiptItem, o.status === 'cancelled' && styles.receiptItemMuted]}
                onPress={() => router.push(`/firm/engagement/${o.id}`)}
                activeOpacity={0.7}
              >
                <View style={styles.receiptContent}>
                  {/* 第一行：税季标签 + 项目/服务名称（左对齐） */}
                  <View style={styles.firstRow}>
                    {taxYear != null && (
                      <View
                        style={[
                          styles.taxSeasonPill,
                          { backgroundColor: getTaxSeasonBgColor(taxYear) },
                        ]}
                      >
                        <Text
                          style={[
                            styles.taxSeasonText,
                            { color: getTaxSeasonColor(taxYear) },
                          ]}
                        >
                          {taxYear}
                        </Text>
                      </View>
                    )}
                    <Text style={styles.storeName} numberOfLines={1}>
                      {serviceItemLabel(o)}
                    </Text>
                  </View>
                  {/* 第二行：客户状态圆点 + 客户名（左），状态标签（右） */}
                  <View style={styles.secondRow}>
                    <View style={styles.clientWrap}>
                      <View
                        style={[
                          styles.clientDot,
                          {
                            backgroundColor: isOrderPendingClaim(o)
                              ? CLIENT_TYPE_DOT.pendingInvitee
                              : CLIENT_TYPE_DOT.client,
                          },
                        ]}
                      />
                      <Text style={styles.clientName} numberOfLines={1}>
                        {o.clientName ?? '—'}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: STATUS_COLOR[o.status] ?? '#636E72' },
                      ]}
                    >
                      <Text style={[styles.statusText, { color: '#FFFFFF' }]}>
                        {statusLabel}
                      </Text>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
          renderSectionHeader={({ section }) => {
            if (section.data.length === 0 || section.title === 'All') return null;
            return (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <View style={styles.sectionHeaderRight}>
                  <Text style={styles.sectionCount}>{section.data.length} engagements</Text>
                </View>
              </View>
            );
          }}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={engagementSections.every((s) => s.data.length === 0) ? styles.emptyList : styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>{tableEmptyMessage}</Text>
            </View>
          }
        />
        <View style={styles.mobileBottomBar}>
          <TouchableOpacity
            style={styles.mobileBottomPrimaryButton}
            onPress={handleOpenNewEngagementModal}
            activeOpacity={0.7}
          >
            <Ionicons name="add-circle-outline" size={20} color="#6C5CE7" />
            <Text style={styles.mobileBottomPrimaryText}>Add engagement</Text>
          </TouchableOpacity>
        </View>
        </>
      )}
    </View>
  );

  if (Platform.OS !== 'web') {
    return (
      <View style={{ flex: 1 }}>
        {renderMobileList()}

        <CenterModal
          visible={newEngagementModalVisible}
          title="Create new engagement"
          onClose={() => {
            setNewEngagementModalVisible(false);
            setShowClientMenu(false);
            setClientDropdownRect(null);
            setShowSkuMenu(false);
            setSkuDropdownRect(null);
          }}
          maxWidth={840}
          cardHeight={660}
        >
          <View style={{ flexDirection: 'row', gap: 16, height: '100%' }}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingRight: 4 }} showsVerticalScrollIndicator={false}>
              <Text style={{ color: '#636E72', marginBottom: 12 }}>
                Create a new service engagement. Select a client from your accessible client list. Client fields are linked.
              </Text>

              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 13, color: '#636E72', marginBottom: 6 }}>Client name</Text>
                <TouchableOpacity
                  style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: '#F5F6FA', borderWidth: 1, borderColor: '#EAECEF' }}
                  activeOpacity={0.7}
                  onPress={() => openClientMenu('clientName')}
                >
                  <Text style={{ fontSize: 14, color: '#2D3436' }} numberOfLines={1}>
                    {selectedClient?.name || '—'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 13, color: '#636E72', marginBottom: 6 }}>Contact name</Text>
                <TouchableOpacity
                  style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: '#F5F6FA', borderWidth: 1, borderColor: '#EAECEF' }}
                  activeOpacity={0.7}
                  onPress={() => openClientMenu('contactName')}
                >
                  <Text style={{ fontSize: 14, color: '#2D3436' }} numberOfLines={1}>
                    {selectedClient?.contactName || '—'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 13, color: '#636E72', marginBottom: 6 }}>Contact email</Text>
                <TouchableOpacity
                  style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: '#F5F6FA', borderWidth: 1, borderColor: '#EAECEF' }}
                  activeOpacity={0.7}
                  onPress={() => openClientMenu('contactEmail')}
                >
                  <Text style={{ fontSize: 14, color: '#2D3436' }} numberOfLines={1}>
                    {selectedClient?.contactEmail || '—'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 13, color: '#636E72', marginBottom: 6 }}>Service template</Text>
                {selectableSkus.length === 0 ? (
                  <View
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      borderRadius: 10,
                      backgroundColor: '#F1F3F5',
                      borderWidth: 1,
                      borderColor: '#EAECEF',
                    }}
                  >
                    <Text style={{ fontSize: 14, color: '#95A5A6' }} numberOfLines={1}>
                      Please configure Service Catalog first.
                    </Text>
                  </View>
                ) : (
                  <View ref={skuSelectRef} collapsable={false}>
                    <TouchableOpacity
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        borderRadius: 10,
                        backgroundColor: '#F5F6FA',
                        borderWidth: 1,
                        borderColor: '#EAECEF',
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                      }}
                      activeOpacity={0.7}
                      onPress={openSkuMenu}
                    >
                      <Text style={{ fontSize: 14, color: '#2D3436', flex: 1 }} numberOfLines={1}>
                        {selectedSkuId ? (selectableSkus.find((s) => s.id === selectedSkuId)?.name ?? 'Select a service template') : 'Select a service template'}
                      </Text>
                      <Ionicons name={showSkuMenu ? 'chevron-up' : 'chevron-down'} size={18} color="#636E72" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <TouchableOpacity
                  style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#F1F3F5' }}
                  activeOpacity={0.7}
                  onPress={() => setNewEngagementModalVisible(false)}
                >
                  <Text style={{ fontWeight: '600', color: '#2D3436' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 10,
                    backgroundColor: !selectedClient || !selectedSkuId || creatingEngagement ? '#B2BEC3' : '#6C5CE7',
                  }}
                  activeOpacity={0.7}
                  disabled={!selectedClient || !selectedSkuId || creatingEngagement}
                  onPress={confirmCreateAndClose}
                >
                  {creatingEngagement ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={{ fontWeight: '600', color: '#fff' }}>Create engagement</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>

            <View style={{ flex: 1, borderLeftWidth: 1, borderLeftColor: '#F1F3F5', paddingLeft: 16 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#2D3436', marginBottom: 10 }}>Service preview</Text>
              <SkuPreview sku={skuList.find((s) => s.id === selectedSkuId) ?? null} />
            </View>
          </View>
        </CenterModal>

      <Modal
        visible={showClientMenu && clientDropdownRect !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setShowClientMenu(false)}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowClientMenu(false)} />
        {clientDropdownRect && (
          <View
            style={{
              position: 'absolute',
              left: clientDropdownRect.x,
              top: clientDropdownRect.y + clientDropdownRect.height + 4,
              width: Math.min(clientDropdownRect.width, 420),
              maxHeight: 280,
              backgroundColor: '#fff',
              borderRadius: 10,
              borderWidth: 1,
              borderColor: '#EAECEF',
              shadowColor: '#000',
              shadowOpacity: 0.12,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 10,
            }}
          >
            <ScrollView contentContainerStyle={{ paddingVertical: 6 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {filteredClientsForMenu.map((c) => {
                const key = clientKey(c);
                const selected = selectedClientKey === key;
                const primary =
                  activeClientField === 'clientName'
                    ? (c.name || '—')
                    : activeClientField === 'contactName'
                      ? (c.contactName || '—')
                      : (c.contactEmail || '—');
                const right1 = activeClientField === 'clientName' ? (c.contactName || '—') : (c.name || '—');
                const right2 = activeClientField === 'contactEmail' ? (c.contactName || '—') : (c.contactEmail || '—');
                return (
                  <TouchableOpacity
                    key={key}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      backgroundColor: selected ? '#EAEAFF' : 'transparent',
                    }}
                    activeOpacity={0.7}
                    onPress={() => {
                      setSelectedClientKey(key);
                      setShowClientMenu(false);
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: selected ? '#6C5CE7' : '#2D3436' }} numberOfLines={1}>
                        {primary}
                      </Text>
                      <Text style={{ fontSize: 12, color: '#95A5A6', maxWidth: 160, textAlign: 'right' }} numberOfLines={1}>
                        {right1}
                      </Text>
                      <Text style={{ fontSize: 12, color: '#B2BEC3', maxWidth: 180, textAlign: 'right' }} numberOfLines={1}>
                        {right2}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
      </Modal>

        {/* Service template: keep same dropdown design as client detail modal */}
        <Modal visible={showSkuMenu && skuDropdownRect !== null} transparent animationType="fade" onRequestClose={() => setShowSkuMenu(false)}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowSkuMenu(false)} />
          {skuDropdownRect && (
            <View
              style={[
                {
                  backgroundColor: '#fff',
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: '#EAECEF',
                  shadowColor: '#000',
                  shadowOpacity: 0.12,
                  shadowRadius: 12,
                  shadowOffset: { width: 0, height: 6 },
                  elevation: 10,
                },
                {
                  position: 'absolute',
                  left: skuDropdownRect.x,
                  top: skuDropdownRect.y + skuDropdownRect.height + 4,
                  width: skuDropdownRect.width,
                  maxHeight: 280,
                },
              ]}
            >
              <ScrollView contentContainerStyle={{ paddingVertical: 6 }} nestedScrollEnabled>
                {selectableSkus.map((sku) => (
                  <TouchableOpacity
                    key={sku.id}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      backgroundColor: selectedSkuId === sku.id ? '#EAEAFF' : 'transparent',
                    }}
                    onPress={() => {
                      setSelectedSkuId(sku.id);
                      setShowSkuMenu(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: selectedSkuId === sku.id ? '700' : '600',
                        color: selectedSkuId === sku.id ? '#6C5CE7' : '#2D3436',
                      }}
                      numberOfLines={1}
                    >
                      {sku.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </Modal>
      </View>
    );
  }

  const hasSelection = selectedOrderIds.length > 0;
  return (
    <View style={styles.webContainer}>
      <View style={styles.toolbarSlot}>
        {hasSelection ? (
          <View style={styles.bulkBar}>
            <Text style={styles.bulkText}>
              {selectedOrderIds.length} selected
            </Text>
            <TouchableOpacity
              style={[styles.bulkBtn, styles.bulkBtnDanger, bulkCancelling && styles.bulkBtnDisabled]}
              onPress={handleBulkCancel}
              disabled={bulkCancelling}
              activeOpacity={0.7}
            >
              {bulkCancelling ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="close-circle-outline" size={18} color="#fff" />
              )}
              <Text style={styles.bulkBtnText}>Cancel engagements</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.bulkBtnSecondary}
              onPress={handleOpenAssignManagerPicker}
              activeOpacity={0.7}
            >
              <Ionicons name="person-outline" size={18} color="#6C5CE7" />
              <Text style={styles.bulkBtnSecondaryText}>Assign manager</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.bulkBtnClear}
              onPress={() => setSelectedOrderIds([])}
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
                onPress={handleOpenNewEngagementModal}
                activeOpacity={0.7}
              >
                <Ionicons name="add-circle-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />
                <Text style={styles.inviteButtonText}>Add engagement</Text>
              </TouchableOpacity>
              <View
                style={styles.groupWrap}
                {...(isDesktopWeb ? { nativeID: 'firm-engagements-group-button' } : {})}
              >
                <TouchableOpacity
                  style={styles.sortButton}
                  onPress={() => {
                    setShowFilterMenu(false);
                    setFilterSubMenu('main');
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
                  {groupBy === 'byClient' && (
                    <Ionicons
                      name="people-outline"
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
                  {groupBy === 'bySeason' && (
                    <Ionicons name="calendar-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />
                  )}
                  {groupBy === 'byCountry' && (
                    <Ionicons name="earth-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />
                  )}
                  {groupBy === 'byScenario' && (
                    <Ionicons name="reader-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />
                  )}
                  {groupBy === 'byCustom' && (
                    <Ionicons name="pricetags-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />
                  )}
                  <Text style={styles.sortText}>Group</Text>
                  <Ionicons name="chevron-down" size={16} color="#636E72" />
                </TouchableOpacity>
              </View>
              <View
                style={styles.groupWrap}
                {...(isDesktopWeb ? { nativeID: 'firm-engagements-filter-button' } : {})}
              >
                <TouchableOpacity
                  style={styles.sortButton}
                  onPress={() => {
                    setShowGroupMenu(false);
                    setFilterSubMenu('main');
                    setShowFilterMenu(true);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="filter-outline"
                    size={18}
                    color="#6C5CE7"
                    style={{ marginRight: 4 }}
                  />
                  <Text style={styles.sortText}>Filter</Text>
                  {engagementActiveFilterCount > 0 && (
                    <Text style={styles.filterBadge}> ({engagementActiveFilterCount})</Text>
                  )}
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
                    <Ionicons name="close-circle" size={20} color="#95A5A6" />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>
        )}
      </View>

      <CenterModal
        visible={newEngagementModalVisible}
        title="Create new engagement"
        onClose={() => {
          setNewEngagementModalVisible(false);
          setShowClientMenu(false);
          setClientDropdownRect(null);
          setShowSkuMenu(false);
          setSkuDropdownRect(null);
        }}
        maxWidth={840}
        cardHeight={660}
      >
        <View style={{ flexDirection: 'row', gap: 16, height: '100%' }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingRight: 4 }} showsVerticalScrollIndicator={false}>
            <Text style={{ color: '#636E72', marginBottom: 12 }}>
              Create a new service engagement. Select a client from your accessible client list. Client fields are linked.
            </Text>

            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 13, color: '#636E72', marginBottom: 6 }}>Client name</Text>
              <View
                ref={clientNameRef}
                collapsable={false}
                style={{ flexDirection: 'row', alignItems: 'center' }}
                {...(isDesktopWeb ? { nativeID: 'create-engagement-clientName-anchor' } : {})}
              >
                <TextInput
                  style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: '#F5F6FA', borderWidth: 1, borderColor: activeClientField === 'clientName' && showClientMenu ? '#6C5CE7' : '#EAECEF', paddingRight: 36, fontSize: 14, color: '#2D3436' }}
                  value={clientNameInput}
                  placeholder="Select a client"
                  placeholderTextColor="#95A5A6"
                  onChangeText={(v) => onClientFieldChange('clientName', v)}
                  onFocus={() => openClientMenu('clientName')}
                />
                <TouchableOpacity
                  style={{ position: 'absolute', right: 10, height: 40, width: 24, alignItems: 'center', justifyContent: 'center' }}
                  onPress={() => openClientMenu('clientName')}
                  activeOpacity={0.7}
                >
                  <Ionicons name={showClientMenu && activeClientField === 'clientName' ? 'chevron-up' : 'chevron-down'} size={18} color="#636E72" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 13, color: '#636E72', marginBottom: 6 }}>Contact name</Text>
              <View
                ref={contactNameRef}
                collapsable={false}
                style={{ flexDirection: 'row', alignItems: 'center' }}
                {...(isDesktopWeb ? { nativeID: 'create-engagement-contactName-anchor' } : {})}
              >
                <TextInput
                  style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: '#F5F6FA', borderWidth: 1, borderColor: activeClientField === 'contactName' && showClientMenu ? '#6C5CE7' : '#EAECEF', paddingRight: 36, fontSize: 14, color: '#2D3436' }}
                  value={contactNameInput}
                  placeholder="Select a contact"
                  placeholderTextColor="#95A5A6"
                  onChangeText={(v) => onClientFieldChange('contactName', v)}
                  onFocus={() => openClientMenu('contactName')}
                />
                <TouchableOpacity
                  style={{ position: 'absolute', right: 10, height: 40, width: 24, alignItems: 'center', justifyContent: 'center' }}
                  onPress={() => openClientMenu('contactName')}
                  activeOpacity={0.7}
                >
                  <Ionicons name={showClientMenu && activeClientField === 'contactName' ? 'chevron-up' : 'chevron-down'} size={18} color="#636E72" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 13, color: '#636E72', marginBottom: 6 }}>Contact email</Text>
              <View
                ref={contactEmailRef}
                collapsable={false}
                style={{ flexDirection: 'row', alignItems: 'center' }}
                {...(isDesktopWeb ? { nativeID: 'create-engagement-contactEmail-anchor' } : {})}
              >
                <TextInput
                  style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: '#F5F6FA', borderWidth: 1, borderColor: activeClientField === 'contactEmail' && showClientMenu ? '#6C5CE7' : '#EAECEF', paddingRight: 36, fontSize: 14, color: '#2D3436' }}
                  value={contactEmailInput}
                  placeholder="Select an email"
                  placeholderTextColor="#95A5A6"
                  onChangeText={(v) => onClientFieldChange('contactEmail', v)}
                  onFocus={() => openClientMenu('contactEmail')}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={{ position: 'absolute', right: 10, height: 40, width: 24, alignItems: 'center', justifyContent: 'center' }}
                  onPress={() => openClientMenu('contactEmail')}
                  activeOpacity={0.7}
                >
                  <Ionicons name={showClientMenu && activeClientField === 'contactEmail' ? 'chevron-up' : 'chevron-down'} size={18} color="#636E72" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 13, color: '#636E72', marginBottom: 6 }}>Service template</Text>
            {selectableSkus.length === 0 ? (
              <View
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 10,
                  backgroundColor: '#F1F3F5',
                  borderWidth: 1,
                  borderColor: '#EAECEF',
                }}
              >
                <Text style={{ fontSize: 14, color: '#95A5A6' }} numberOfLines={1}>
                  Please configure Service Catalog first.
                </Text>
              </View>
            ) : (
              <View
                ref={skuSelectRef}
                collapsable={false}
                {...(isDesktopWeb ? { nativeID: 'create-engagement-sku-anchor' } : {})}
              >
                <TouchableOpacity
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: 10,
                    backgroundColor: '#F5F6FA',
                    borderWidth: 1,
                    borderColor: '#EAECEF',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                  activeOpacity={0.7}
                  onPress={openSkuMenu}
                >
                  <Text style={{ fontSize: 14, color: '#2D3436', flex: 1 }} numberOfLines={1}>
                    {selectedSkuId ? (selectableSkus.find((s) => s.id === selectedSkuId)?.name ?? 'Select a service template') : 'Select a service template'}
                  </Text>
                  <Ionicons name={showSkuMenu ? 'chevron-up' : 'chevron-down'} size={18} color="#636E72" />
                </TouchableOpacity>
              </View>
            )}
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <TouchableOpacity
                style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#F1F3F5' }}
                activeOpacity={0.7}
                onPress={() => setNewEngagementModalVisible(false)}
              >
                <Text style={{ fontWeight: '600', color: '#2D3436' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 10,
                  backgroundColor: !selectedClient || !selectedSkuId || creatingEngagement ? '#B2BEC3' : '#6C5CE7',
                }}
                activeOpacity={0.7}
                disabled={!selectedClient || !selectedSkuId || creatingEngagement}
                onPress={confirmCreateAndClose}
              >
                {creatingEngagement ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ fontWeight: '600', color: '#fff' }}>Create engagement</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>

          <View style={{ flex: 1, borderLeftWidth: 1, borderLeftColor: '#F1F3F5', paddingLeft: 16 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#2D3436', marginBottom: 10 }}>Service preview</Text>
            <SkuPreview sku={skuList.find((s) => s.id === selectedSkuId) ?? null} />
          </View>
        </View>
      </CenterModal>

      {/* Dropdown overlays: web uses portal (so inputs remain editable); mobile uses Modal */}
      {isDesktopWeb &&
        showClientMenu &&
        clientDropdownRect &&
        typeof document !== 'undefined' &&
        document.body &&
        createPortal(
          <div
            id="create-engagement-client-menu"
            style={{
              position: 'absolute',
              left: clientDropdownRect.x,
              top: clientDropdownRect.y + clientDropdownRect.height + 4,
              width: Math.min(clientDropdownRect.width, 420),
              maxHeight: 280,
              overflow: 'auto',
              backgroundColor: '#fff',
              borderRadius: 10,
              border: '1px solid #EAECEF',
              boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
              zIndex: 999999,
            }}
          >
            <View style={{ paddingVertical: 6 }}>
              {filteredClientsForMenu.map((c) => {
                const key = clientKey(c);
                const selected = selectedClientKey === key;
                const primary =
                  activeClientField === 'clientName'
                    ? (c.name || '—')
                    : activeClientField === 'contactName'
                      ? (c.contactName || '—')
                      : (c.contactEmail || '—');
                const right1 = activeClientField === 'clientName' ? (c.contactName || '—') : (c.name || '—');
                const right2 = activeClientField === 'contactEmail' ? (c.contactName || '—') : (c.contactEmail || '—');
                return (
                  <TouchableOpacity
                    key={key}
                    style={{ paddingVertical: 10, paddingHorizontal: 12, backgroundColor: selected ? '#EAEAFF' : 'transparent' }}
                    activeOpacity={0.7}
                    onPress={() => {
                      setSelectedClientKey(key);
                      setShowClientMenu(false);
                      setClientDropdownRect(null);
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: selected ? '#6C5CE7' : '#2D3436' }} numberOfLines={1}>
                        {primary}
                      </Text>
                      <Text style={{ fontSize: 12, color: '#95A5A6', maxWidth: 160, textAlign: 'right' }} numberOfLines={1}>
                        {right1}
                      </Text>
                      <Text style={{ fontSize: 12, color: '#B2BEC3', maxWidth: 180, textAlign: 'right' }} numberOfLines={1}>
                        {right2}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </div>,
          document.body
        )}

      {isDesktopWeb &&
        showSkuMenu &&
        skuDropdownRect &&
        typeof document !== 'undefined' &&
        document.body &&
        createPortal(
          <div
            id="create-engagement-sku-menu"
            style={{
              position: 'absolute',
              left: skuDropdownRect.x,
              top: skuDropdownRect.y + skuDropdownRect.height + 4,
              width: skuDropdownRect.width,
              maxHeight: 280,
              overflow: 'auto',
              backgroundColor: '#fff',
              borderRadius: 10,
              border: '1px solid #EAECEF',
              boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
              zIndex: 999999,
            }}
          >
            <View style={{ paddingVertical: 6 }}>
              {selectableSkus.map((sku) => (
                <TouchableOpacity
                  key={sku.id}
                  style={{ paddingVertical: 10, paddingHorizontal: 12, backgroundColor: selectedSkuId === sku.id ? '#EAEAFF' : 'transparent' }}
                  onPress={() => {
                    setSelectedSkuId(sku.id);
                    setShowSkuMenu(false);
                    setSkuDropdownRect(null);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 14, fontWeight: selectedSkuId === sku.id ? '700' : '600', color: selectedSkuId === sku.id ? '#6C5CE7' : '#2D3436' }} numberOfLines={1}>
                    {sku.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </div>,
          document.body
        )}

      {Platform.OS !== 'web' ? (
        <>
          <Modal
            visible={showClientMenu && clientDropdownRect !== null}
            transparent
            animationType="fade"
            onRequestClose={() => setShowClientMenu(false)}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowClientMenu(false)} />
            {clientDropdownRect && (
              <View
                style={{
                  position: 'absolute',
                  left: clientDropdownRect.x,
                  top: clientDropdownRect.y + clientDropdownRect.height + 4,
                  width: Math.min(clientDropdownRect.width, 420),
                  maxHeight: 280,
                  backgroundColor: '#fff',
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: '#EAECEF',
                  shadowColor: '#000',
                  shadowOpacity: 0.12,
                  shadowRadius: 12,
                  shadowOffset: { width: 0, height: 6 },
                  elevation: 10,
                }}
              >
                <ScrollView contentContainerStyle={{ paddingVertical: 6 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {filteredClientsForMenu.map((c) => {
                    const key = clientKey(c);
                    const selected = selectedClientKey === key;
                    const primary =
                      activeClientField === 'clientName'
                        ? (c.name || '—')
                        : activeClientField === 'contactName'
                          ? (c.contactName || '—')
                          : (c.contactEmail || '—');
                    const right1 = activeClientField === 'clientName' ? (c.contactName || '—') : (c.name || '—');
                    const right2 = activeClientField === 'contactEmail' ? (c.contactName || '—') : (c.contactEmail || '—');
                    return (
                      <TouchableOpacity
                        key={key}
                        style={{ paddingVertical: 10, paddingHorizontal: 12, backgroundColor: selected ? '#EAEAFF' : 'transparent' }}
                        activeOpacity={0.7}
                        onPress={() => {
                          setSelectedClientKey(key);
                          setShowClientMenu(false);
                          setClientDropdownRect(null);
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: selected ? '#6C5CE7' : '#2D3436' }} numberOfLines={1}>
                            {primary}
                          </Text>
                          <Text style={{ fontSize: 12, color: '#95A5A6', maxWidth: 160, textAlign: 'right' }} numberOfLines={1}>
                            {right1}
                          </Text>
                          <Text style={{ fontSize: 12, color: '#B2BEC3', maxWidth: 180, textAlign: 'right' }} numberOfLines={1}>
                            {right2}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}
          </Modal>

          <Modal
            visible={showSkuMenu && skuDropdownRect !== null}
            transparent
            animationType="fade"
            onRequestClose={() => setShowSkuMenu(false)}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowSkuMenu(false)} />
            {skuDropdownRect && (
              <View
                style={{
                  position: 'absolute',
                  left: skuDropdownRect.x,
                  top: skuDropdownRect.y + skuDropdownRect.height + 4,
                  width: skuDropdownRect.width,
                  maxHeight: 280,
                  backgroundColor: '#fff',
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: '#EAECEF',
                  shadowColor: '#000',
                  shadowOpacity: 0.12,
                  shadowRadius: 12,
                  shadowOffset: { width: 0, height: 6 },
                  elevation: 10,
                }}
              >
                <ScrollView contentContainerStyle={{ paddingVertical: 6 }} nestedScrollEnabled>
                  {selectableSkus.map((sku) => (
                    <TouchableOpacity
                      key={sku.id}
                      style={{ paddingVertical: 10, paddingHorizontal: 12, backgroundColor: selectedSkuId === sku.id ? '#EAEAFF' : 'transparent' }}
                      onPress={() => {
                        setSelectedSkuId(sku.id);
                        setShowSkuMenu(false);
                        setSkuDropdownRect(null);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={{ fontSize: 14, fontWeight: selectedSkuId === sku.id ? '700' : '600', color: selectedSkuId === sku.id ? '#6C5CE7' : '#2D3436' }} numberOfLines={1}>
                        {sku.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </Modal>
        </>
      ) : null}

      {/* Client menu is now anchored under the active input (showClientMenu) */}

      {(loading && orders.length === 0) ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color="#6C5CE7" />
          <Text style={styles.emptyText}>Loading...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.tableScroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={
            loading && orders.length === 0 ? { flexGrow: 1 } : { flexGrow: 0 }
          }
        >
          <DataTable<FirmOrderWithDetails>
            columns={orderColumns}
            data={groupBy === 'none' ? sortedDataForTable : undefined}
            sections={groupBy !== 'none' ? tableSections : undefined}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(key, dir) => {
              setSortKey(key);
              setSortDirection(dir);
            }}
            onRowPress={(row) => router.push(`/firm/engagement/${row.id}`)}
            keyExtractor={(r) => r.id}
            emptyMessage={tableEmptyMessage}
            storageKey="firm-engagements-table"
            selectable
            selectableRevealOnHover
            selectedIds={selectedOrderIds}
            onSelectedIdsChange={setSelectedOrderIds}
            getRowClassName={(row) => (row.status === 'cancelled' ? 'data-table-row-muted' : '')}
          />
        </ScrollView>
      )}
      {isDesktopWeb &&
        showGroupMenu &&
        groupPopoverRect &&
        typeof document !== 'undefined' &&
        document.body &&
        createPortal(
          <div
            id="firm-engagements-group-popover"
            style={{
              ...WEB_POPOVER.container,
              ...WEB_POPOVER.containerWide,
              left: groupPopoverRect.left,
              top: groupPopoverRect.top,
            }}
          >
            <Text style={WEB_POPOVER.title}>Group</Text>
            <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
              {(
                [
                  { key: 'none' as GroupByType, label: 'No group', icon: 'list-outline' as const },
                  { key: 'byClient' as GroupByType, label: 'By client', icon: 'people-outline' as const },
                  { key: 'byStatus' as GroupByType, label: 'By status', icon: 'flag-outline' as const },
                  { key: 'bySeason' as GroupByType, label: 'By tax season', icon: 'calendar-outline' as const },
                  { key: 'byCountry' as GroupByType, label: 'By jurisdiction', icon: 'earth-outline' as const },
                  { key: 'byScenario' as GroupByType, label: 'By tax scenario', icon: 'reader-outline' as const },
                  { key: 'byCustom' as GroupByType, label: 'By custom label', icon: 'pricetags-outline' as const },
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, gap: 8 }}>
                    <Ionicons name={icon} size={18} color={groupBy === key ? '#6C5CE7' : '#636E72'} />
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
                  {groupBy === key ? <Ionicons name="checkmark" size={18} color="#6C5CE7" /> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
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
            id="firm-engagements-filter-popover"
            style={{
              ...WEB_POPOVER.container,
              ...WEB_POPOVER.containerWide,
              left: filterPopoverRect.left,
              top: filterPopoverRect.top,
            }}
          >
            <View style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              {filterSubMenu !== 'main' ? (
                <>
                  <TouchableOpacity
                    onPress={() => setFilterSubMenu('main')}
                    style={{ padding: 4 }}
                  >
                    <Ionicons name="chevron-back" size={20} color="#6C5CE7" />
                  </TouchableOpacity>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#495057' }}>
                    {filterSubMenu === 'status' ? 'Status' : 'Classification'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setShowFilterMenu(false);
                      setFilterSubMenu('main');
                    }}
                    style={{ padding: 4 }}
                  >
                    <Text style={{ fontSize: 13, color: '#6C5CE7' }}>Done</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#495057' }}>Filter</Text>
                  {engagementActiveFilterCount > 0 && (
                    <TouchableOpacity
                      onPress={() => {
                        setFilterStatus('all');
                        setClassFilterByDim(emptyClassificationDimFilters());
                      }}
                      style={{ padding: 4 }}
                    >
                      <Text style={{ fontSize: 13, color: '#6C5CE7' }}>Clear</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              {filterSubMenu === 'main' ? (
                <>
                  <TouchableOpacity style={WEB_POPOVER.optionRow} onPress={() => setFilterSubMenu('status')}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, gap: 8 }}>
                      <Ionicons name="flag-outline" size={18} color="#636E72" />
                      <Text style={WEB_POPOVER.optionText} numberOfLines={1}>
                        Status
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {filterStatus !== 'all' ? (
                        <Text style={styles.filterCountBadgeCompact}>1</Text>
                      ) : null}
                      <Ionicons name="chevron-forward" size={18} color="#95A5A6" />
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity style={WEB_POPOVER.optionRow} onPress={() => setFilterSubMenu('classification')}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, gap: 8 }}>
                      <Ionicons name="pricetags-outline" size={18} color="#636E72" />
                      <Text style={WEB_POPOVER.optionText} numberOfLines={1}>
                        Classification
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {classificationConstraintCount > 0 ? (
                        <Text style={styles.filterCountBadgeCompact}>{classificationConstraintCount}</Text>
                      ) : null}
                      <Ionicons name="chevron-forward" size={18} color="#95A5A6" />
                    </View>
                  </TouchableOpacity>
                </>
              ) : filterSubMenu === 'status' ? (
                <>
                  {(
                    [
                      ['all', 'All'],
                      ['onboarding', 'Onboarding'],
                      ['processing', 'Processing'],
                      ['completed', 'Completed'],
                      ['cancelled', 'Cancelled'],
                    ] as const
                  ).map(([value, label]) => (
                    <TouchableOpacity
                      key={value}
                      onPress={() => setFilterStatus(value as FilterStatus)}
                      style={WEB_POPOVER.optionRow}
                    >
                      <Text
                        style={
                          filterStatus === value
                            ? { ...WEB_POPOVER.optionText, ...WEB_POPOVER.optionTextSelected }
                            : WEB_POPOVER.optionText
                        }
                        numberOfLines={1}
                      >
                        {label}
                      </Text>
                      {filterStatus === value ? (
                        <Ionicons name="checkmark" size={18} color="#6C5CE7" />
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </>
              ) : (
                <>
                  <EngagementClassificationFilterChips
                    optionsByDim={classificationOptionsByDim}
                    classFilterByDim={classFilterByDim}
                    onToggleValue={toggleClassificationDimValue}
                    onSelectAll={selectClassificationDimAll}
                    chipStyles={{
                      dimGroupsWrap: styles.dimGroupsWrap,
                      dimBlock: styles.dimBlock,
                      dimTitleRow: styles.dimTitleRow,
                      dimTitle: styles.dimTitle,
                      dimEmpty: styles.dimEmpty,
                      scopeChipsWrap: styles.scopeChipsWrap,
                      metaTag: styles.scopeChipMeta,
                      scopeLabelChip: styles.scopeLabelChip,
                      scopeLabelChipMin: styles.scopeLabelChipMin,
                      scopeLabelChipText: styles.scopeLabelChipText,
                    }}
                  />
                  {classificationConstraintCount > 0 && (
                    <TouchableOpacity
                      onPress={() => setClassFilterByDim(emptyClassificationDimFilters())}
                      style={{ paddingVertical: 10, alignItems: 'flex-start' }}
                    >
                      <Text style={{ fontSize: 13, color: '#6C5CE7', fontWeight: '600' }}>
                        Reset classification filters
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </ScrollView>
          </div>,
          document.body
        )}

      <Modal visible={showAssignManagerPicker} transparent animationType="fade" onRequestClose={() => !assignSaving && setShowAssignManagerPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => !assignSaving && setShowAssignManagerPicker(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Assign manager</Text>
            <Text style={styles.modalSubtitle}>Selected engagements: {selectedOrderIds.length}</Text>
            {assignLoading ? (
              <View style={styles.modalLoadingWrap}>
                <ActivityIndicator size="small" color="#6C5CE7" />
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 320 }}>
                {assignMembers.map((m) => {
                  const selected = assignSelectedMemberId === m.id;
                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={[styles.assignRow, selected && styles.assignRowSelected]}
                      onPress={() => setAssignSelectedMemberId(m.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.assignRowText, selected && styles.assignRowTextSelected]}>
                        {m.name || m.email || m.id}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => !assignSaving && setShowAssignManagerPicker(false)}
                disabled={assignSaving}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, (!assignSelectedMemberId || assignSaving) && styles.bulkBtnDisabled]}
                onPress={handleAssignManagerDone}
                disabled={!assignSelectedMemberId || assignSaving}
              >
                {assignSaving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.modalConfirmText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  webContainer: { flex: 1, backgroundColor: '#ECEFF1' },
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { padding: 20, paddingBottom: 40 },
  toolbarSlot: {
    height: 52,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
    justifyContent: 'center',
    overflow: 'visible' as const,
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
  receiptItemMuted: { opacity: 0.6 },
  receiptContent: { flex: 1 },
  firstRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginBottom: 4,
    gap: 8,
  },
  storeName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
    marginRight: 0,
  },
  taxSeasonPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#F3F4FF',
  },
  taxSeasonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2D3436',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  confirmedByText: { fontSize: 12, color: '#636E72', fontWeight: '500' },
  secondRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 8,
  },
  clientWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  clientDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
    marginLeft: 8,
  },
  clientName: {
    flex: 1,
    fontSize: 14,
    color: '#95A5A6',
  },
  listContent: { paddingHorizontal: 4, paddingTop: 0, paddingBottom: 100 },
  emptyList: { flexGrow: 1 },
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
  },
  mobileBottomPrimaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
  bulkText: {
    fontSize: 14,
    color: '#2D3436',
    fontWeight: '500',
    marginRight: 8,
  },
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
  bulkBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#F3EEFF',
    borderRadius: 8,
  },
  bulkBtnSecondaryText: { fontSize: 14, color: '#6C5CE7', fontWeight: '600' },
  bulkBtnClear: { paddingVertical: 8, paddingHorizontal: 12 },
  bulkBtnClearText: { fontSize: 14, color: '#636E72', fontWeight: '500' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    padding: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#2D3436' },
  modalSubtitle: { fontSize: 13, color: '#636E72', marginTop: 4, marginBottom: 10 },
  modalLoadingWrap: { paddingVertical: 18, alignItems: 'center' },
  assignRow: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  assignRowSelected: { backgroundColor: '#F3EEFF' },
  assignRowText: { fontSize: 14, color: '#2D3436' },
  assignRowTextSelected: { color: '#6C5CE7', fontWeight: '600' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  modalCancelBtn: { paddingHorizontal: 14, paddingVertical: 8 },
  modalCancelText: { fontSize: 14, color: '#636E72', fontWeight: '500' },
  modalConfirmBtn: {
    backgroundColor: '#6C5CE7',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 84,
    alignItems: 'center',
  },
  modalConfirmText: { fontSize: 14, color: '#fff', fontWeight: '600' },
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
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
  },
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
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 12,
  },
  cardRow: { flexDirection: 'row', marginBottom: 6 },
  label: { fontSize: 13, color: '#636E72', width: 110 },
  value: { flex: 1, fontSize: 14, color: '#2D3436' },
  engagementFilterDropdown: {
    paddingVertical: 0,
    minWidth: 260,
    maxHeight: 420,
  },
  engagementFilterScroll: { maxHeight: 400 },
  engagementFilterSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#95A5A6',
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 4,
    textTransform: 'uppercase',
  },
  engagementFilterHint: { fontSize: 13, color: '#95A5A6', paddingHorizontal: 14, paddingVertical: 8 },
  engagementFilterClearTags: { paddingVertical: 12, paddingHorizontal: 14, marginTop: 4 },
  engagementFilterClearTagsText: { fontSize: 14, color: '#6C5CE7', fontWeight: '600' },
  engagementFilterDoneRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: '#E9ECEF',
    marginTop: 4,
    alignItems: 'center',
  },
  engagementFilterDoneText: { fontSize: 14, color: '#6C5CE7', fontWeight: '600' },
  engagementGroupDropdownScroll: {
    maxHeight: 360,
    paddingVertical: 0,
    minWidth: 220,
  },
  engagementGroupMenuScroll: { maxHeight: 340 },
  /** Mobile filter / group: single-line rows matching WEB_POPOVER.optionRow */
  filterPopoverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minHeight: 40,
  },
  filterPopoverRowSelected: { backgroundColor: 'rgba(108, 92, 231, 0.08)' },
  filterPopoverRowText: { fontSize: 14, color: '#2D3436', fontWeight: '500', flex: 1 },
  filterPopoverRowTextSelected: { color: '#6C5CE7', fontWeight: '600' },
  filterCountBadgeCompact: {
    fontSize: 12,
    color: '#6C5CE7',
    fontWeight: '600',
    backgroundColor: '#E8F4FD',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  /** Permission scope–style classification chips (firm/permissions.tsx) */
  dimGroupsWrap: { gap: 12, paddingHorizontal: 4, paddingBottom: 8 },
  dimBlock: { gap: 6 },
  dimTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dimTitle: { fontSize: 13, fontWeight: '600', color: '#2D3436' },
  dimEmpty: { fontSize: 12, color: '#95A5A6', fontStyle: 'italic' },
  scopeChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scopeChipMeta: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: '100%',
    alignSelf: 'flex-start',
    minHeight: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scopeLabelChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    minHeight: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scopeLabelChipMin: { minWidth: 74 },
  scopeLabelChipText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    minWidth: 35,
    ...Platform.select({
      android: { textAlignVertical: 'center' as const, includeFontPadding: false },
      default: {},
    }),
  },
});
