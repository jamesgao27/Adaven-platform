import React, { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Platform,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { getAllReceiptLineItemsForList, updateReceiptItem } from '@/lib/database';
import { getCurrentUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getCategories } from '@/lib/categories';
import { getAttributions } from '@/lib/attributions';
import { sortScopeTagsForDisplay } from '@/lib/sort-scope-tags-for-display';
import type { ReceiptLineItemListRow, Category, Attribution } from '@/types';
import { showToast } from '@/lib/toast';
import { confirmThen } from '@/lib/alertWeb';
import WebChatFab, { WEB_CHAT_FAB_BOTTOM, WEB_CHAT_FAB_RIGHT, WEB_CHAT_FAB_SIZE } from '@/components/WebChatFab';
import DataTable, { WEB_POPOVER, type DataTableSection } from '@/components/DataTable';
import { getReceiptLineItemColumns } from '@/components/voucher-table-columns';
import { useWebViewportKind } from '../lib/web-viewport';

const UNCATEGORIZED = '__uncategorized__';
const NO_ATTRIBUTION = '__none__';

type GroupByType = 'none' | 'month' | 'category' | 'attribution' | 'payee' | 'isAsset';
type FilterAsset = 'all' | 'yes' | 'no';
type FilterSubMenu = 'main' | 'month' | 'category' | 'attribution' | 'asset';

function sectionTitleForKey(
  groupBy: GroupByType,
  key: string,
  sample: ReceiptLineItemListRow
): string {
  switch (groupBy) {
    case 'month':
      try {
        return format(parseISO(`${key}-01`), 'MMMM yyyy');
      } catch {
        return key;
      }
    case 'category':
      return key === UNCATEGORIZED ? 'Uncategorized' : sample.category?.name || 'Category';
    case 'attribution':
      return key === NO_ATTRIBUTION ? 'None' : sample.attribution?.name || 'Attribution';
    case 'payee':
      return key;
    case 'isAsset':
      return key === 'asset_yes' ? 'Asset' : 'Non-asset';
    default:
      return key;
  }
}

export default function ReceiptLineItemsScreen() {
  const { isDesktopWeb } = useWebViewportKind();
  const router = useRouter();
  const [rows, setRows] = useState<ReceiptLineItemListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const loadedOnce = useRef(false);

  const [groupBy, setGroupBy] = useState<GroupByType>('none');
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [groupPopoverRect, setGroupPopoverRect] = useState<{ left: number; top: number } | null>(null);

  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [filterSubMenu, setFilterSubMenu] = useState<FilterSubMenu>('main');
  const [filterPopoverRect, setFilterPopoverRect] = useState<{ left: number; top: number } | null>(null);

  const [filterAsset, setFilterAsset] = useState<FilterAsset>('all');
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const [selectedCategoryKeys, setSelectedCategoryKeys] = useState<Set<string>>(new Set());
  const [selectedAttributionKeys, setSelectedAttributionKeys] = useState<Set<string>>(new Set());

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<Category[]>([]);
  const [attributions, setAttributions] = useState<Attribution[]>([]);
  const [bulkWorking, setBulkWorking] = useState(false);
  /** 批量 Category / Attribution：自工具栏按钮向下拉出的选单（非全屏浮窗） */
  const [bulkMenu, setBulkMenu] = useState<null | 'category' | 'attribution'>(null);
  const [bulkMenuRect, setBulkMenuRect] = useState<{ left: number; top: number; minWidth: number } | null>(null);
  const [bulkMenuHoveredId, setBulkMenuHoveredId] = useState<string | null>(null);

  const formatDate = useCallback((dateString: string) => {
    try {
      return format(new Date(dateString), 'yyyy-MM-dd');
    } catch {
      return dateString || '—';
    }
  }, []);

  const onCategoryChange = useCallback(async (row: ReceiptLineItemListRow, categoryId: string) => {
    if (row.categoryId === categoryId) return;
    const cat = categories.find(c => c.id === categoryId);
    if (!cat) return;
    try {
      await updateReceiptItem(row.receiptId, row.id, 'categoryId', categoryId);
      setRows(prev => prev.map(r => (r.id === row.id ? { ...r, categoryId, category: cat } : r)));
    } catch {
      showToast('Failed to update', 'error');
    }
  }, [categories]);

  const onAttributionChange = useCallback(async (row: ReceiptLineItemListRow, attributionId: string | null) => {
    if ((row.attributionId ?? null) === (attributionId ?? null)) return;
    const att = attributionId ? attributions.find(a => a.id === attributionId) ?? null : null;
    try {
      await updateReceiptItem(row.receiptId, row.id, 'attributionId', attributionId);
      setRows(prev =>
        prev.map(r => (r.id === row.id ? { ...r, attributionId, attribution: att } : r))
      );
    } catch {
      showToast('Failed to update', 'error');
    }
  }, [attributions]);

  const onIsAssetCellPress = useCallback(async (row: ReceiptLineItemListRow) => {
    const next = !row.isAsset;
    try {
      await updateReceiptItem(row.receiptId, row.id, 'isAsset', next);
      setRows(prev => prev.map(r => (r.id === row.id ? { ...r, isAsset: next } : r)));
    } catch {
      showToast('Failed to update', 'error');
    }
  }, []);

  const columns = useMemo(
    () =>
      getReceiptLineItemColumns({
        formatDate,
        categories,
        attributions,
        onCategoryChange,
        onAttributionChange,
        onIsAssetCellPress,
      }),
    [formatDate, categories, attributions, onCategoryChange, onAttributionChange, onIsAssetCellPress]
  );

  const load = useCallback(async () => {
    try {
      if (!loadedOnce.current) setLoading(true);
      const data = await getAllReceiptLineItemsForList();
      setRows(data);
      loadedOnce.current = true;
    } catch {
      showToast('Failed to load line items', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Realtime：Web / 移动端行项列表均启用。
  useEffect(() => {
    let receiptsCh: ReturnType<typeof supabase.channel> | null = null;
    let itemsCh: ReturnType<typeof supabase.channel> | null = null;
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    const setup = async () => {
      try {
        const user = await getCurrentUser();
        const spaceId = user?.currentSpaceId || user?.spaceId;
        if (!spaceId) return;
        const debounced = () => {
          if (refreshTimeout) clearTimeout(refreshTimeout);
          refreshTimeout = setTimeout(() => load(), 300);
        };
        receiptsCh = supabase
          .channel(`receipt-items-screen-rcpt-${spaceId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'receipts', filter: `space_id=eq.${spaceId}` },
            debounced
          )
          .subscribe();
        itemsCh = supabase
          .channel(`receipt-items-screen-ri-${spaceId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'receipt_items' }, debounced)
          .subscribe();
      } catch (e) {
        console.warn('Receipt line items realtime setup failed', e);
      }
    };
    void setup();
    return () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      if (receiptsCh) void supabase.removeChannel(receiptsCh);
      if (itemsCh) void supabase.removeChannel(itemsCh);
    };
  }, [load]);

  useEffect(() => {
    getCategories('expense').then(setCategories).catch(() => {});
    getAttributions('expense').then(setAttributions).catch(() => {});
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const dimensionFiltered = useMemo(() => {
    return rows.filter(r => {
      if (filterAsset === 'yes' && !r.isAsset) return false;
      if (filterAsset === 'no' && r.isAsset) return false;
      if (selectedMonths.size > 0) {
        const mk = r.receiptDate.length >= 7 ? r.receiptDate.slice(0, 7) : '';
        if (!selectedMonths.has(mk)) return false;
      }
      if (selectedCategoryKeys.size > 0) {
        const k = r.categoryId || UNCATEGORIZED;
        if (!selectedCategoryKeys.has(k)) return false;
      }
      if (selectedAttributionKeys.size > 0) {
        const k = r.attributionId ?? NO_ATTRIBUTION;
        if (!selectedAttributionKeys.has(k)) return false;
      }
      return true;
    });
  }, [rows, filterAsset, selectedMonths, selectedCategoryKeys, selectedAttributionKeys]);

  const searched = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return dimensionFiltered;
    return dimensionFiltered.filter(
      r =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.payeeName || '').toLowerCase().includes(q) ||
        (r.category?.name || '').toLowerCase().includes(q) ||
        (r.attribution?.name || '').toLowerCase().includes(q) ||
        (r.isAsset ? 'yes' : 'no').includes(q)
    );
  }, [dimensionFiltered, searchQuery]);

  const sortedFlat = useMemo(() => {
    const col = sortKey ? columns.find(c => c.id === sortKey) : null;
    if (!col?.getSortValue) return searched;
    return [...searched].sort((a, b) => {
      const va = col.getSortValue!(a);
      const vb = col.getSortValue!(b);
      const cmp = va === vb ? 0 : va == null ? 1 : vb == null ? -1 : va < vb ? -1 : 1;
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [searched, sortKey, sortDirection, columns]);

  const tableSections = useMemo((): DataTableSection<ReceiptLineItemListRow>[] => {
    const col = sortKey ? columns.find(c => c.id === sortKey) : null;
    const sortInner = (list: ReceiptLineItemListRow[]) => {
      if (!col?.getSortValue) return list;
      return [...list].sort((a, b) => {
        const va = col.getSortValue!(a);
        const vb = col.getSortValue!(b);
        const cmp = va === vb ? 0 : va == null ? 1 : vb == null ? -1 : va < vb ? -1 : 1;
        return sortDirection === 'asc' ? cmp : -cmp;
      });
    };

    const map = new Map<string, ReceiptLineItemListRow[]>();
    for (const r of searched) {
      let k: string;
      switch (groupBy) {
        case 'month':
          k = r.receiptDate.length >= 7 ? r.receiptDate.slice(0, 7) : '0000-00';
          break;
        case 'category':
          k = r.categoryId || UNCATEGORIZED;
          break;
        case 'attribution':
          k = r.attributionId ?? NO_ATTRIBUTION;
          break;
        case 'payee':
          k = r.payeeName || '—';
          break;
        case 'isAsset':
          k = r.isAsset ? 'asset_yes' : 'asset_no';
          break;
        default:
          k = 'all';
      }
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }

    const keys = [...map.keys()];
    keys.sort((a, b) => {
      if (groupBy === 'month') return b.localeCompare(a);
      if (groupBy === 'isAsset') return a.localeCompare(b);
      return a.localeCompare(b);
    });

    return keys.map(key => {
      const raw = map.get(key)!;
      const data = sortInner(raw);
      const title = sectionTitleForKey(groupBy, key, data[0]);
      return {
        title,
        data,
        count: data.length,
        countLabel: 'items',
      };
    });
  }, [searched, groupBy, sortKey, sortDirection, columns]);

  const useSectionMode = groupBy !== 'none' && searched.length > 0;

  const filterBadgeCount =
    selectedMonths.size +
    selectedCategoryKeys.size +
    selectedAttributionKeys.size +
    (filterAsset !== 'all' ? 1 : 0);

  const monthOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach(r => {
      if (r.receiptDate.length >= 7) s.add(r.receiptDate.slice(0, 7));
    });
    return [...s].sort((a, b) => b.localeCompare(a));
  }, [rows]);

  const categoryFilterOptions = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach(r => {
      const id = r.categoryId || UNCATEGORIZED;
      const name = r.category?.name || (id === UNCATEGORIZED ? 'Uncategorized' : '—');
      m.set(id, name);
    });
    const forSort = [...m.entries()].map(([id, name]) => {
      const c = id !== UNCATEGORIZED ? categories.find(x => x.id === id) : undefined;
      return { id, name, usageCount: c?.usageCount, isDefault: c?.isDefault };
    });
    return sortScopeTagsForDisplay(forSort).map(r => [r.id, r.name] as [string, string]);
  }, [rows, categories]);

  const attributionFilterOptions = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach(r => {
      const id = r.attributionId ?? NO_ATTRIBUTION;
      const name = r.attribution?.name || (id === NO_ATTRIBUTION ? 'None' : '—');
      m.set(id, name);
    });
    const forSort = [...m.entries()].map(([id, name]) => {
      const a = id !== NO_ATTRIBUTION ? attributions.find(x => x.id === id) : undefined;
      return { id, name, usageCount: a?.usageCount, isDefault: a?.isDefault };
    });
    return sortScopeTagsForDisplay(forSort).map(r => [r.id, r.name] as [string, string]);
  }, [rows, attributions]);

  const categoriesForPickers = useMemo(
    () => sortScopeTagsForDisplay(categories),
    [categories],
  );
  const attributionsForPickers = useMemo(
    () => sortScopeTagsForDisplay(attributions),
    [attributions],
  );

  /** 选中行在「批量 Is asset」语义下是否已全部为资产：是则本次操作应为全部取消 */
  const bulkSelectedAllAsset = useMemo(() => {
    if (selectedIds.size === 0) return false;
    for (const id of selectedIds) {
      const row = rows.find(r => r.id === id);
      if (!row?.isAsset) return false;
    }
    return true;
  }, [selectedIds, rows]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || !bulkMenu) {
      setBulkMenuRect(null);
      return;
    }
    const measure = () => {
      const el = document.getElementById(`receipt-items-bulk-${bulkMenu}-btn`);
      if (el) {
        const r = el.getBoundingClientRect();
        setBulkMenuRect({ left: r.left, top: r.bottom + 4, minWidth: Math.max(r.width, 220) });
      } else setBulkMenuRect(null);
    };
    measure();
    let raf = 0;
    raf = requestAnimationFrame(measure);
    const t = typeof window !== 'undefined' ? window.setTimeout(measure, 50) : 0;
    return () => {
      cancelAnimationFrame(raf);
      if (t) window.clearTimeout(t);
    };
  }, [bulkMenu]);

  useEffect(() => {
    setBulkMenuHoveredId(null);
  }, [bulkMenu]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !bulkMenu) return;
    const onScroll = (e: Event) => {
      if (e.target instanceof Node) {
        const menu = document.getElementById('receipt-items-bulk-menu');
        if (menu?.contains(e.target)) return;
      }
      setBulkMenu(null);
    };
    const onResize = () => setBulkMenu(null);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [bulkMenu]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || !showGroupMenu) {
      setGroupPopoverRect(null);
      return;
    }
    const measure = () => {
      const el = document.getElementById('receipt-items-group-button');
      if (el) {
        const r = el.getBoundingClientRect();
        setGroupPopoverRect({ left: r.left, top: r.bottom + 6 });
      } else setGroupPopoverRect(null);
    };
    measure();
    const t = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(t);
      setGroupPopoverRect(null);
    };
  }, [showGroupMenu]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || !showFilterMenu) {
      setFilterPopoverRect(null);
      return;
    }
    const measure = () => {
      const el = document.getElementById('receipt-items-filter-button');
      if (el) {
        const r = el.getBoundingClientRect();
        setFilterPopoverRect({ left: r.left, top: r.bottom + 6 });
      } else setFilterPopoverRect(null);
    };
    measure();
    const t = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(t);
      setFilterPopoverRect(null);
    };
  }, [showFilterMenu]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: PointerEvent) => {
      const target = e.target as Node;
      const gBtn = document.getElementById('receipt-items-group-button');
      const gPop = document.getElementById('receipt-items-group-popover');
      const fBtn = document.getElementById('receipt-items-filter-button');
      const fPop = document.getElementById('receipt-items-filter-popover');
      const bPop = document.getElementById('receipt-items-bulk-menu');
      const bCat = document.getElementById('receipt-items-bulk-category-btn');
      const bAtt = document.getElementById('receipt-items-bulk-attribution-btn');
      if (showGroupMenu && gBtn && !gBtn.contains(target) && gPop && !gPop.contains(target)) {
        setShowGroupMenu(false);
      }
      if (showFilterMenu && fBtn && !fBtn.contains(target) && fPop && !fPop.contains(target)) {
        setShowFilterMenu(false);
        setFilterSubMenu('main');
      }
      if (
        bulkMenu &&
        bCat &&
        !bCat.contains(target) &&
        bAtt &&
        !bAtt.contains(target) &&
        bPop &&
        !bPop.contains(target)
      ) {
        setBulkMenu(null);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [showGroupMenu, showFilterMenu, bulkMenu]);

  const tableEmptyMessage = useMemo(() => {
    if (loading && rows.length === 0) return 'Loading...';
    if (rows.length === 0) return 'No line items yet';
    if (searched.length === 0) return 'No matching items';
    return 'No data';
  }, [loading, rows.length, searched.length]);

  const clearAllFilters = useCallback(() => {
    setSelectedMonths(new Set());
    setSelectedCategoryKeys(new Set());
    setSelectedAttributionKeys(new Set());
    setFilterAsset('all');
  }, []);

  const runBatch = useCallback(
    async (
      field: 'categoryId' | 'attributionId' | 'isAsset',
      value: string | boolean,
      itemIds: string[],
      opts?: { clearSelection?: boolean },
    ): Promise<boolean> => {
      if (itemIds.length === 0) return false;
      setBulkWorking(true);
      try {
        for (const itemId of itemIds) {
          const row = rows.find(r => r.id === itemId);
          if (!row?.receiptId) continue;
          await updateReceiptItem(row.receiptId, itemId, field, value);
        }
        showToast('Updated', 'success');
        if (opts?.clearSelection !== false) setSelectedIds(new Set());
        await load();
        return true;
      } catch {
        showToast('Batch update failed', 'error');
        return false;
      } finally {
        setBulkWorking(false);
      }
    },
    [rows, load],
  );

  const confirmBulkCategory = useCallback(
    (cat: Category) => {
      const n = selectedIds.size;
      const ids = [...selectedIds];
      if (!cat.id || n === 0) return;
      setBulkMenu(null);
      confirmThen(
        'Set category',
        `Apply category "${cat.name}" to ${n} line item(s)?`,
        () => runBatch('categoryId', cat.id, ids),
      );
    },
    [selectedIds, runBatch],
  );

  const confirmBulkAttribution = useCallback(
    (att: Attribution) => {
      const n = selectedIds.size;
      const ids = [...selectedIds];
      if (!att.id || n === 0) return;
      setBulkMenu(null);
      confirmThen(
        'Set attribution',
        `Apply attribution "${att.name}" to ${n} line item(s)?`,
        () => runBatch('attributionId', att.id, ids),
      );
    },
    [selectedIds, runBatch],
  );

  const confirmBulkIsAsset = useCallback(() => {
    const n = selectedIds.size;
    const ids = [...selectedIds];
    if (n === 0 || bulkWorking) return;
    const asAsset = !bulkSelectedAllAsset;
    confirmThen(
      asAsset ? 'Mark as asset' : 'Mark as non-asset',
      asAsset
        ? `Mark ${n} line item(s) as asset?`
        : `Mark ${n} line item(s) as non-asset?`,
      () => runBatch('isAsset', asAsset, ids, { clearSelection: false }),
    );
  }, [selectedIds, bulkWorking, bulkSelectedAllAsset, runBatch]);

  const hasSelection = selectedIds.size > 0;

  const groupOptions: { key: GroupByType; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { key: 'none', label: 'No group', icon: 'list-outline' },
    { key: 'month', label: 'Transaction month', icon: 'calendar-outline' },
    { key: 'category', label: 'Category', icon: 'pricetag-outline' },
    { key: 'attribution', label: 'Attribution', icon: 'git-branch-outline' },
    { key: 'payee', label: 'Payee', icon: 'storefront-outline' },
    { key: 'isAsset', label: 'Is asset', icon: 'cube-outline' },
  ];

  if (Platform.OS !== 'web') {
    return (
      <View style={styles.centered}>
        <Text style={styles.hint}>Line items table is available on web.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolbarSlot}>
        {hasSelection ? (
          <View style={styles.bulkBar}>
            <Text style={styles.bulkText}>{selectedIds.size} selected</Text>
            <View
              nativeID="receipt-items-bulk-category-btn"
              {...(isDesktopWeb ? ({ id: 'receipt-items-bulk-category-btn' } as Record<string, string>) : {})}
            >
              <TouchableOpacity
                style={[styles.bulkBtn, bulkWorking && { opacity: 0.6 }]}
                disabled={bulkWorking}
                onPress={() => setBulkMenu(m => (m === 'category' ? null : 'category'))}
              >
                <Ionicons name="pricetag-outline" size={18} color="#6C5CE7" />
                <Text style={styles.bulkBtnText}>Category</Text>
              </TouchableOpacity>
            </View>
            <View
              nativeID="receipt-items-bulk-attribution-btn"
              {...(isDesktopWeb ? ({ id: 'receipt-items-bulk-attribution-btn' } as Record<string, string>) : {})}
            >
              <TouchableOpacity
                style={[styles.bulkBtn, bulkWorking && { opacity: 0.6 }]}
                disabled={bulkWorking}
                onPress={() => setBulkMenu(m => (m === 'attribution' ? null : 'attribution'))}
              >
                <Ionicons name="git-branch-outline" size={18} color="#6C5CE7" />
                <Text style={styles.bulkBtnText}>Attribution</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[
                styles.bulkBtn,
                bulkWorking && { opacity: 0.6 },
                bulkSelectedAllAsset && styles.bulkBtnAltHint,
              ]}
              disabled={bulkWorking}
              onPress={confirmBulkIsAsset}
            >
              <Ionicons name="cube-outline" size={18} color="#6C5CE7" />
              <Text style={styles.bulkBtnText}>
                {bulkSelectedAllAsset ? 'Not asset' : 'Is asset'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bulkBtnClear} onPress={() => setSelectedIds(new Set())}>
              <Text style={styles.bulkBtnClearText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View nativeID="receipt-items-group-button">
                <TouchableOpacity style={styles.sortButton} onPress={() => setShowGroupMenu(true)}>
                  {groupBy === 'none' && <Ionicons name="list-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
                  {groupBy === 'month' && <Ionicons name="calendar-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
                  {groupBy === 'category' && <Ionicons name="pricetag-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
                  {groupBy === 'attribution' && <Ionicons name="git-branch-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
                  {groupBy === 'payee' && <Ionicons name="storefront-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
                  {groupBy === 'isAsset' && <Ionicons name="cube-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
                  <Text style={styles.sortText}>Group</Text>
                  <Ionicons name="chevron-down" size={16} color="#636E72" />
                </TouchableOpacity>
              </View>
              <View nativeID="receipt-items-filter-button">
                <TouchableOpacity
                  style={styles.filterButton}
                  onPress={() => {
                    setShowFilterMenu(true);
                    setFilterSubMenu('main');
                  }}
                >
                  <Text style={styles.filterText}>
                    Filter
                    {filterBadgeCount > 0 && <Text style={styles.filterBadge}> ({filterBadgeCount})</Text>}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color="#636E72" />
                </TouchableOpacity>
              </View>
              <View style={styles.searchContainer}>
                <Ionicons name="search" size={18} color="#636E72" style={styles.searchIcon} />
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
                    <Ionicons name="close-circle" size={20} color="#95A5A6" />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>
        )}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={loading && rows.length === 0 ? { flexGrow: 1 } : { flexGrow: 0 }}
      >
        {loading && rows.length === 0 ? (
          <View style={styles.emptyContainer}>
            <ActivityIndicator size="large" color="#6C5CE7" />
            <Text style={styles.emptyText}>Loading...</Text>
          </View>
        ) : (
          <DataTable<ReceiptLineItemListRow>
            columns={columns}
            data={useSectionMode ? undefined : sortedFlat}
            sections={useSectionMode ? tableSections : undefined}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(key, dir) => {
              setSortKey(key);
              setSortDirection(dir);
            }}
            keyExtractor={r => r.id}
            onRowPress={r => {
              if (r.receiptId) router.push(`/receipt-details/${r.receiptId}`);
            }}
            emptyMessage={tableEmptyMessage}
            storageKey="receipt-line-items-table"
            selectable
            selectableRevealOnHover
            selectedIds={Array.from(selectedIds)}
            onSelectedIdsChange={ids => setSelectedIds(new Set(ids))}
          />
        )}
      </ScrollView>

      {isDesktopWeb && showGroupMenu && groupPopoverRect && typeof document !== 'undefined' && document.body && createPortal(
        <div
          id="receipt-items-group-popover"
          style={{ ...WEB_POPOVER.container, left: groupPopoverRect.left, top: groupPopoverRect.top }}
        >
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#495057', marginBottom: 10 }}>Group by</Text>
          <View style={{ gap: 2 }}>
            {groupOptions.map(({ key, label, icon }) => (
              <TouchableOpacity
                key={key}
                onPress={() => {
                  setGroupBy(key);
                  setShowGroupMenu(false);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  backgroundColor: groupBy === key ? 'rgba(108, 92, 231, 0.1)' : 'transparent',
                  minHeight: 40,
                }}
              >
                <Ionicons name={icon} size={20} color={groupBy === key ? '#6C5CE7' : '#636E72'} style={{ marginRight: 10 }} />
                <Text style={{ flex: 1, fontSize: 13, color: groupBy === key ? '#6C5CE7' : '#2D3436', fontWeight: groupBy === key ? '600' : '500' }}>
                  {label}
                </Text>
                {groupBy === key && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
              </TouchableOpacity>
            ))}
          </View>
        </div>,
        document.body
      )}

      {isDesktopWeb && showFilterMenu && filterPopoverRect && typeof document !== 'undefined' && document.body && createPortal(
        <div
          id="receipt-items-filter-popover"
          style={{
            ...WEB_POPOVER.container,
            ...(filterSubMenu !== 'main' ? WEB_POPOVER.containerWide : {}),
            left: filterPopoverRect.left,
            top: filterPopoverRect.top,
          }}
        >
          {filterSubMenu === 'main' ? (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#495057' }}>Filter</Text>
                {filterBadgeCount > 0 && (
                  <TouchableOpacity onPress={clearAllFilters}>
                    <Text style={{ fontSize: 13, color: '#6C5CE7', fontWeight: '600' }}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={{ gap: 4 }}>
                <TouchableOpacity
                  style={styles.filterRow}
                  onPress={() => setFilterSubMenu('month')}
                >
                  <Ionicons name="calendar-outline" size={20} color="#636E72" />
                  <Text style={styles.filterRowText}>Transaction month</Text>
                  {selectedMonths.size > 0 && <Text style={styles.filterCountBadge}>{selectedMonths.size}</Text>}
                  <Ionicons name="chevron-forward" size={18} color="#95A5A6" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.filterRow} onPress={() => setFilterSubMenu('category')}>
                  <Ionicons name="pricetag-outline" size={20} color="#636E72" />
                  <Text style={styles.filterRowText}>Category</Text>
                  {selectedCategoryKeys.size > 0 && <Text style={styles.filterCountBadge}>{selectedCategoryKeys.size}</Text>}
                  <Ionicons name="chevron-forward" size={18} color="#95A5A6" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.filterRow} onPress={() => setFilterSubMenu('attribution')}>
                  <Ionicons name="git-branch-outline" size={20} color="#636E72" />
                  <Text style={styles.filterRowText}>Attribution</Text>
                  {selectedAttributionKeys.size > 0 && <Text style={styles.filterCountBadge}>{selectedAttributionKeys.size}</Text>}
                  <Ionicons name="chevron-forward" size={18} color="#95A5A6" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.filterRow} onPress={() => setFilterSubMenu('asset')}>
                  <Ionicons name="cube-outline" size={20} color="#636E72" />
                  <Text style={styles.filterRowText}>Is asset</Text>
                  <View style={{ flex: 1 }} />
                  {filterAsset !== 'all' && <Ionicons name="checkmark" size={18} color="#6C5CE7" />}
                  <Ionicons name="chevron-forward" size={18} color="#95A5A6" />
                </TouchableOpacity>
              </View>
            </>
          ) : filterSubMenu === 'month' ? (
            <>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }} onPress={() => setFilterSubMenu('main')}>
                <Ionicons name="chevron-back" size={20} color="#6C5CE7" />
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#495057', marginLeft: 4 }}>Transaction month</Text>
              </TouchableOpacity>
              <ScrollView style={{ maxHeight: 320 }}>
                {monthOptions.map(mk => {
                  const selected = selectedMonths.has(mk);
                  const label =
                    mk.length >= 7
                      ? format(parseISO(`${mk}-01`), 'MMMM yyyy')
                      : mk;
                  return (
                    <TouchableOpacity
                      key={mk}
                      style={[styles.popoverOptionRow, { backgroundColor: selected ? 'rgba(108, 92, 231, 0.1)' : 'transparent' }]}
                      onPress={() => {
                        setSelectedMonths(prev => {
                          const next = new Set(prev);
                          if (next.has(mk)) next.delete(mk);
                          else next.add(mk);
                          return next;
                        });
                      }}
                    >
                      <Text style={[styles.popoverOptionText, selected && styles.popoverOptionTextSelected]} numberOfLines={1}>
                        {label}
                      </Text>
                      {selected && <Ionicons name="checkmark" size={18} color="#6C5CE7" />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          ) : filterSubMenu === 'category' ? (
            <>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }} onPress={() => setFilterSubMenu('main')}>
                <Ionicons name="chevron-back" size={20} color="#6C5CE7" />
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#495057', marginLeft: 4 }}>Category</Text>
              </TouchableOpacity>
              <ScrollView style={{ maxHeight: 320 }}>
                {categoryFilterOptions.map(([id, name]) => {
                  const selected = selectedCategoryKeys.has(id);
                  return (
                    <TouchableOpacity
                      key={id}
                      style={[styles.popoverOptionRow, { backgroundColor: selected ? 'rgba(108, 92, 231, 0.1)' : 'transparent' }]}
                      onPress={() => {
                        setSelectedCategoryKeys(prev => {
                          const next = new Set(prev);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        });
                      }}
                    >
                      <Text style={[styles.popoverOptionText, selected && styles.popoverOptionTextSelected]} numberOfLines={1}>
                        {name}
                      </Text>
                      {selected && <Ionicons name="checkmark" size={18} color="#6C5CE7" />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          ) : filterSubMenu === 'attribution' ? (
            <>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }} onPress={() => setFilterSubMenu('main')}>
                <Ionicons name="chevron-back" size={20} color="#6C5CE7" />
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#495057', marginLeft: 4 }}>Attribution</Text>
              </TouchableOpacity>
              <ScrollView style={{ maxHeight: 320 }}>
                {attributionFilterOptions.map(([id, name]) => {
                  const selected = selectedAttributionKeys.has(id);
                  return (
                    <TouchableOpacity
                      key={id}
                      style={[styles.popoverOptionRow, { backgroundColor: selected ? 'rgba(108, 92, 231, 0.1)' : 'transparent' }]}
                      onPress={() => {
                        setSelectedAttributionKeys(prev => {
                          const next = new Set(prev);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        });
                      }}
                    >
                      <Text style={[styles.popoverOptionText, selected && styles.popoverOptionTextSelected]} numberOfLines={1}>
                        {name}
                      </Text>
                      {selected && <Ionicons name="checkmark" size={18} color="#6C5CE7" />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          ) : (
            <>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }} onPress={() => setFilterSubMenu('main')}>
                <Ionicons name="chevron-back" size={20} color="#6C5CE7" />
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#495057', marginLeft: 4 }}>Is asset</Text>
              </TouchableOpacity>
              {(['all', 'yes', 'no'] as const).map(opt => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.popoverOptionRow, { backgroundColor: filterAsset === opt ? 'rgba(108, 92, 231, 0.1)' : 'transparent' }]}
                  onPress={() => {
                    setFilterAsset(opt);
                    setFilterSubMenu('main');
                  }}
                >
                  <Text style={[styles.popoverOptionText, filterAsset === opt && styles.popoverOptionTextSelected]}>
                    {opt === 'all' ? 'All' : opt === 'yes' ? 'Yes' : 'No'}
                  </Text>
                  {filterAsset === opt && <Ionicons name="checkmark" size={18} color="#6C5CE7" />}
                </TouchableOpacity>
              ))}
            </>
          )}
        </div>,
        document.body
      )}

      {isDesktopWeb &&
        bulkMenu &&
        bulkMenuRect &&
        typeof document !== 'undefined' &&
        document.body &&
        createPortal(
          <div
            id="receipt-items-bulk-menu"
            role="listbox"
            aria-label={bulkMenu === 'category' ? 'Set category' : 'Set attribution'}
            style={{
              position: 'fixed',
              top: bulkMenuRect.top,
              left: bulkMenuRect.left,
              minWidth: bulkMenuRect.minWidth,
              maxHeight: 320,
              overflowY: 'auto',
              backgroundColor: 'rgba(255, 255, 255, 0.76)',
              backdropFilter: 'blur(18px) saturate(1.15)',
              WebkitBackdropFilter: 'blur(18px) saturate(1.15)',
              borderRadius: 8,
              boxShadow: '0 10px 36px rgba(0,0,0,0.14)',
              border: '1px solid rgba(222, 226, 230, 0.72)',
              zIndex: 100060,
              padding: 4,
            }}
            onMouseDown={e => e.preventDefault()}
            onMouseLeave={() => setBulkMenuHoveredId(null)}
          >
            {bulkMenu === 'category'
              ? categoriesForPickers.filter(c => c.id).map(cat => {
                  const isHovered = bulkMenuHoveredId === cat.id;
                  const dot = cat.color || '#BDC3C7';
                  return (
                    <div
                      key={cat.id}
                      role="option"
                      onClick={() => !bulkWorking && confirmBulkCategory(cat)}
                      onMouseEnter={() => setBulkMenuHoveredId(cat.id)}
                      onMouseLeave={() => setBulkMenuHoveredId(h => (h === cat.id ? null : h))}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 10px',
                        borderRadius: 6,
                        cursor: bulkWorking ? 'default' : 'pointer',
                        fontSize: 13,
                        fontFamily:
                          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                        color: '#2D3436',
                        backgroundColor: isHovered ? 'rgba(108, 92, 231, 0.28)' : 'transparent',
                        opacity: bulkWorking ? 0.55 : 1,
                        transition: 'background-color 0.12s ease',
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 5,
                          backgroundColor: dot,
                          flexShrink: 0,
                          boxShadow: isHovered ? '0 0 0 1px rgba(108, 92, 231, 0.45)' : undefined,
                        }}
                      />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cat.name}
                      </span>
                    </div>
                  );
                })
              : attributionsForPickers.filter(a => a.id).map(att => {
                  const isHovered = bulkMenuHoveredId === att.id;
                  const dot = att.color || '#BDC3C7';
                  return (
                    <div
                      key={att.id}
                      role="option"
                      onClick={() => !bulkWorking && confirmBulkAttribution(att)}
                      onMouseEnter={() => setBulkMenuHoveredId(att.id)}
                      onMouseLeave={() => setBulkMenuHoveredId(h => (h === att.id ? null : h))}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 10px',
                        borderRadius: 6,
                        cursor: bulkWorking ? 'default' : 'pointer',
                        fontSize: 13,
                        fontFamily:
                          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                        color: '#2D3436',
                        backgroundColor: isHovered ? 'rgba(108, 92, 231, 0.28)' : 'transparent',
                        opacity: bulkWorking ? 0.55 : 1,
                        transition: 'background-color 0.12s ease',
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 5,
                          backgroundColor: dot,
                          flexShrink: 0,
                          boxShadow: isHovered ? '0 0 0 1px rgba(108, 92, 231, 0.45)' : undefined,
                        }}
                      />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {att.name}
                      </span>
                    </div>
                  );
                })}
          </div>,
          document.body,
        )}

      <View style={[styles.fabContainer, styles.fabContainerWeb]}>
        <WebChatFab type="receipt" embedded />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ECEFF1',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#ECEFF1',
  },
  hint: {
    fontSize: 16,
    color: '#636E72',
    textAlign: 'center',
    marginBottom: 16,
  },
  backBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  backBtnText: {
    fontSize: 16,
    color: '#6C5CE7',
    fontWeight: '600',
  },
  toolbarSlot: {
    height: 52,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
    justifyContent: 'center',
  },
  header: {
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'transparent',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
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
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterText: {
    fontSize: 14,
    color: '#636E72',
    marginRight: 4,
    fontWeight: '500',
  },
  filterBadge: {
    color: '#6C5CE7',
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 8,
  },
  filterRowText: {
    flex: 1,
    fontSize: 14,
    color: '#2D3436',
    fontWeight: '500',
  },
  filterCountBadge: {
    fontSize: 12,
    color: '#6C5CE7',
    fontWeight: '700',
    marginRight: 4,
  },
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
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#2D3436',
    padding: 0,
  },
  searchClear: {
    marginLeft: 4,
  },
  bulkBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#F2EDFA',
  },
  bulkText: { fontSize: 14, color: '#2D3436', fontWeight: '500', marginRight: 8 },
  bulkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(108, 92, 231, 0.32)',
  },
  /** 选中行已全部为 asset、本次将为「全部取消」时的轻微区分 */
  bulkBtnAltHint: {
    borderWidth: 1.5,
    borderColor: 'rgba(108, 92, 231, 0.55)',
    backgroundColor: 'rgba(108, 92, 231, 0.08)',
  },
  bulkBtnText: { fontSize: 14, color: '#5B4DC7', fontWeight: '600' },
  bulkBtnClear: { paddingVertical: 8, paddingHorizontal: 12 },
  bulkBtnClearText: { fontSize: 14, color: '#636E72', fontWeight: '500' },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 100,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 16,
    color: '#636E72',
  },
  fabContainer: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    alignItems: 'flex-end',
  },
  fabContainerWeb: {
    right: WEB_CHAT_FAB_RIGHT,
    bottom: WEB_CHAT_FAB_BOTTOM,
    width: WEB_CHAT_FAB_SIZE,
    height: WEB_CHAT_FAB_SIZE,
  },
  popoverOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    minHeight: 40,
  },
  popoverOptionText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#2D3436',
    fontWeight: '500',
    flex: 1,
    minWidth: 0,
  },
  popoverOptionTextSelected: {
    color: '#6C5CE7',
    fontWeight: '600',
  },
});
