import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Modal,
  ScrollView,
  Animated,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getCurrentUser, getCurrentSpace } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getInvoicesForListFirstPaint, getAllInvoicesWithItems, deleteInvoice, saveInvoice } from '@/lib/invoices';
import { getCanonicalEntityId } from '@/lib/entities';
import { Invoice } from '@/types';
import { format } from 'date-fns';
import { getExchangeRates, sumAmountsInCurrency } from '@/lib/exchange-rates';
import { VoucherStatus } from '@/types';
import { SwipeableRow } from './SwipeableRow';
import { getLocalDateString } from '@/lib/date-utils';
import { showToast } from '@/lib/toast';
import { confirmDestructive } from '@/lib/alertWeb';
import WebChatFab, { WEB_CHAT_FAB_BOTTOM, WEB_CHAT_FAB_RIGHT, WEB_CHAT_FAB_SIZE } from '@/components/WebChatFab';
import DataTable, { WEB_POPOVER } from '@/components/DataTable';
import { getInvoiceColumns } from '@/components/voucher-table-columns';
import { isMobileWebWidth } from '../lib/web-viewport';
import { preflightRecognitionOrAlert } from '@/lib/recognition-preflight-ui';
import { inputTypeConfirmBadgeIonicon } from '@/lib/input-type-ionicon';

type GroupByType = 'none' | 'month' | 'recordDate' | 'paymentAccount' | 'createdBy' | 'customer';

const statusColors: Record<VoucherStatus, string> = {
  pending: '#FF9500',
  processing: '#9B59B6',
  confirmed: '#00B894',
  needs_retake: '#E74C3C',
  duplicate: '#95A5A6',
};

const statusLabels: Record<VoucherStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  confirmed: 'Confirmed',
  needs_retake: 'Needs Retake',
  duplicate: 'Duplicate',
};

const getCurrencySymbol = (currency?: string): string => {
  const symbols: Record<string, string> = {
    USD: '$', CAD: 'C$', CNY: '¥', RMB: '¥', JPY: 'J¥', EUR: '€', GBP: '£', AUD: 'A$',
    HKD: 'HK$', TWD: 'NT$', KRW: '₩', SGD: 'S$', MXN: 'MX$', INR: '₹',
    THB: '฿', VND: '₫', PHP: '₱', MYR: 'RM', IDR: 'Rp',
  };
  return symbols[currency || 'USD'] || (currency ? `${currency} ` : '$');
};

const AmountText = ({ amount, currency, style }: { amount?: number | null; currency?: string; style?: any }) => {
  const symbol = getCurrencySymbol(currency);
  const baseSize = style?.fontSize || 16;
  const n = typeof amount === 'number' && Number.isFinite(amount) ? amount : Number(amount);
  const display = Number.isFinite(n) ? n : 0;
  return (
    <Text style={style}>
      <Text style={{ color: '#A0A0A0', fontSize: baseSize - 2 }}>{symbol}</Text>
      <Text style={{ fontWeight: '600' }}>{display.toFixed(2)}</Text>
    </Text>
  );
};

interface SectionData {
  title: string;
  monthKey: string;
  data: Invoice[];
  originalData?: Invoice[];
}

export default function InvoicesScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && !isMobileWebWidth(windowWidth);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fullDataLoaded, setFullDataLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<GroupByType>(isDesktopWeb ? 'month' : 'recordDate');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [groupPopoverRect, setGroupPopoverRect] = useState<{ left: number; top: number } | null>(null);
  const [filterPopoverRect, setFilterPopoverRect] = useState<{ left: number; top: number } | null>(null);
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const [selectedRecordDates, setSelectedRecordDates] = useState<Set<string>>(new Set());
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [selectedCreators, setSelectedCreators] = useState<Set<string>>(new Set());
  const [filterSubMenu, setFilterSubMenu] = useState<'main' | 'month' | 'recordDate' | 'account' | 'creator'>('main');
  const [exchangeRates, setExchangeRates] = useState<{ [key: string]: number } | null>(null);
  const [showFabActions, setShowFabActions] = useState(false);
  const fabAnimation = useRef(new Animated.Value(0)).current;
  const router = useRouter();

  const runClientRecognitionPreflight = useCallback(async (): Promise<boolean> => {
    const space = await getCurrentSpace(true);
    if (space?.kind !== 'client' || !space.id) return true;
    return preflightRecognitionOrAlert(space.id, router);
  }, [router]);

  /** 异步后加载：汇率、merge 解析 + 明细 items（getAllInvoicesWithItems 已含 merge），不阻塞首屏 */
  const loadDetailsAsync = useCallback(() => {
    getExchangeRates().then(rates => setExchangeRates(rates)).catch(() => {});
    getAllInvoicesWithItems().then(fullData => {
      setInvoices(fullData);
      setFullDataLoaded(true);
    }).catch(() => setFullDataLoaded(true));
  }, []);

  const loadInvoices = useCallback(async (options?: { full?: boolean }) => {
    const full = options?.full ?? false;
    try {
      setFullDataLoaded(false);
      if (full) {
        // 刷新：一次加载完整数据，避免中间态
        const data = await getAllInvoicesWithItems();
        setInvoices(data);
        setFullDataLoaded(true);
        setLoading(false);
        setRefreshing(false);
        getExchangeRates().then(rates => setExchangeRates(rates)).catch(() => {});
      } else {
        const data = await getInvoicesForListFirstPaint();
        setInvoices(data);
        setFullDataLoaded(false);
        setLoading(false);
        setRefreshing(false);
        loadDetailsAsync();
      }
    } catch (error) {
      showToast('Failed to load income', 'error');
      console.error(error);
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadDetailsAsync]);

  // 仅首次进入时加载，返回列表时保留当前结果；下拉刷新时由 onRefresh 处理
  useFocusEffect(useCallback(() => {
    if (invoices.length === 0) loadInvoices();
  }, [loadInvoices, invoices.length]));

  // Supabase Realtime：Web / 移动端列表均启用。
  useEffect(() => {
    let invoicesChannel: ReturnType<typeof supabase.channel> | null = null;
    let invoiceItemsChannel: ReturnType<typeof supabase.channel> | null = null;
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

    const setupRealtime = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) return;
        const spaceId = user.currentSpaceId || user.spaceId;
        if (!spaceId) return;

        const debouncedRefresh = () => {
          if (refreshTimeout) clearTimeout(refreshTimeout);
          refreshTimeout = setTimeout(() => loadInvoices({ full: true }), 300);
        };

        invoicesChannel = supabase
          .channel(`invoices-changes-${spaceId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'invoices', filter: `space_id=eq.${spaceId}` },
            () => debouncedRefresh()
          )
          .subscribe();

        invoiceItemsChannel = supabase
          .channel(`invoice-items-changes-${spaceId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'invoice_items' }, () => debouncedRefresh())
          .subscribe();
      } catch (e) {
        console.warn('Invoices Realtime setup failed', e);
      }
    };
    setupRealtime();
    return () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      if (invoicesChannel) supabase.removeChannel(invoicesChannel);
      if (invoiceItemsChannel) supabase.removeChannel(invoiceItemsChannel);
    };
  }, [loadInvoices]);

  const onRefresh = () => {
    setRefreshing(true);
    setSelectedIds(new Set());
    loadInvoices({ full: true });
  };

  const handleAddInvoice = async () => {
    try {
      const today = getLocalDateString();
      const id = await saveInvoice({
        spaceId: '',
        customerName: '',
        totalAmount: 0,
        date: today,
        status: 'pending',
        items: [],
      });
      loadInvoices();
      router.push(`/invoice-details/${id}?new=true`);
    } catch (e) {
      showToast('Failed to create income', 'error');
      console.error(e);
    }
  };

  const handleCameraPress = () => {
    if (!showFabActions) {
      setShowFabActions(true);
      fabAnimation.setValue(0);
      Animated.timing(fabAnimation, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    } else {
      Animated.timing(fabAnimation, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setShowFabActions(false));
    }
  };

  const handleChatFromFab = () => {
    void (async () => {
      setShowFabActions(false);
      const pre = await runClientRecognitionPreflight();
      if (!pre) return;
      router.push('/chat-to-log?type=invoice');
    })();
  };

  const handleScanFromFab = () => {
    setShowFabActions(false);
    handleAddInvoice();
  };

  const handleToggleSelect = (invoiceId: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(invoiceId)) newSet.delete(invoiceId);
      else newSet.add(invoiceId);
      return newSet;
    });
  };

  const handleDeleteSingle = async (invoiceId: string) => {
    confirmDestructive(
      'Delete Income',
      'Are you sure you want to delete this income?',
      async () => {
        try {
          await deleteInvoice(invoiceId);
          setInvoices(prev => prev.filter(r => r.id !== invoiceId));
          setSelectedIds(prev => { const s = new Set(prev); s.delete(invoiceId); return s; });
        } catch (error) {
          showToast('Failed to delete income', 'error');
          loadInvoices();
        }
      },
      { confirmLabel: 'Delete' }
    );
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    confirmDestructive(
      'Delete Income',
      `Delete ${selectedIds.size} income entry/entries?`,
      async () => {
        try {
          await Promise.all(Array.from(selectedIds).map(id => deleteInvoice(id)));
          const idsToDelete = Array.from(selectedIds);
          setInvoices(prev => prev.filter(r => r.id && !idsToDelete.includes(r.id)));
          setSelectedIds(new Set());
        } catch (error) {
          showToast('Failed to delete some income', 'error');
          loadInvoices();
        }
      },
      { confirmLabel: 'Delete' }
    );
  };

  const parseLocalDate = (dateString: string): Date => {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  const formatDate = (dateString: string) => {
    try {
      return format(parseLocalDate(dateString), 'MMM dd, yyyy');
    } catch {
      return dateString;
    }
  };

  const formatTimeAgo = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const diffMs = new Date().getTime() - date.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours < 1) {
        const diffMins = Math.floor(diffMs / (1000 * 60));
        return `${diffMins} minutes ago`;
      }
      if (diffHours < 24) return `${diffHours} hours ago`;
      const dateOnly = dateString.includes('T') ? dateString.split('T')[0] : dateString;
      return formatDate(dateOnly);
    } catch {
      return dateString;
    }
  };

  const groupByMonth = useCallback((list: Invoice[]): SectionData[] => {
    const grouped = new Map<string, Invoice[]>();
    list.forEach(inv => {
      try {
        const date = parseLocalDate(inv.date);
        const monthKey = `month-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!grouped.has(monthKey)) grouped.set(monthKey, []);
        grouped.get(monthKey)!.push(inv);
      } catch (_) {}
    });
    return Array.from(grouped.entries())
      .map(([monthKey, data]) => ({
        title: format(parseLocalDate(data[0].date), 'MMMM yyyy'),
        monthKey,
        data: data.sort((a, b) => parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime()),
      }))
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }, []);

  const groupByRecordDate = useCallback((list: Invoice[]): SectionData[] => {
    const grouped = new Map<string, Invoice[]>();
    list.forEach(inv => {
      if (!inv.createdAt) return;
      const d = new Date(inv.createdAt);
      const dayKey = `record-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!grouped.has(dayKey)) grouped.set(dayKey, []);
      grouped.get(dayKey)!.push(inv);
    });
    return Array.from(grouped.entries())
      .map(([dayKey, data]) => {
        const base = data[0].createdAt ? new Date(data[0].createdAt) : parseLocalDate(data[0].date);
        const dateOnly = new Date(base.getFullYear(), base.getMonth(), base.getDate());
        return {
          title: format(dateOnly, 'MMM dd, yyyy'),
          monthKey: dayKey,
          data: data.slice().sort((a, b) => {
            const at = a.createdAt ? new Date(a.createdAt).getTime() : parseLocalDate(a.date).getTime();
            const bt = b.createdAt ? new Date(b.createdAt).getTime() : parseLocalDate(b.date).getTime();
            return bt - at;
          }),
        };
      })
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }, []);

  const groupByAccount = useCallback((list: Invoice[]): SectionData[] => {
    const grouped = new Map<string, Invoice[]>();
    list.forEach(inv => {
      const name = inv.account?.name || 'Not Set';
      const key = `account-${inv.account?.id || 'none'}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(inv);
    });
    return Array.from(grouped.entries())
      .map(([key, data]) => ({
        title: data[0].account?.name || 'Not Set',
        monthKey: key,
        data: data.sort((a, b) => parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime()),
      }))
      .sort((a, b) => (a.title === 'Not Set' ? 1 : b.title === 'Not Set' ? -1 : a.title.localeCompare(b.title)));
  }, []);

  const groupByCreatedBy = useCallback((list: Invoice[]): SectionData[] => {
    const grouped = new Map<string, Invoice[]>();
    list.forEach(inv => {
      const name = inv.createdByUser?.name || inv.createdByUser?.email?.split('@')[0] || 'Unknown';
      const key = `user-${inv.createdBy || 'unknown'}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(inv);
    });
    return Array.from(grouped.entries())
      .map(([key, data]) => ({
        title: data[0].createdByUser?.name || data[0].createdByUser?.email?.split('@')[0] || 'Unknown',
        monthKey: key,
        data: data.sort((a, b) => parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime()),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, []);

  const groupByCustomer = useCallback((list: Invoice[]): SectionData[] => {
    const grouped = new Map<string, Invoice[]>();
    list.forEach(inv => {
      const payerName = inv.entity?.name || inv.customerName || '—';
      const payerKey = `customer-${getCanonicalEntityId(inv) || 'none'}`;
      if (!grouped.has(payerKey)) grouped.set(payerKey, []);
      grouped.get(payerKey)!.push(inv);
    });
    return Array.from(grouped.entries())
      .map(([payerKey, data]) => {
        const payerName = data[0].entity?.name || data[0].customerName || '—';
        return {
          title: payerName,
          monthKey: payerKey,
          data: data.sort((a, b) => parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime()),
        };
      })
      .sort((a, b) => {
        if (a.title === '—') return 1;
        if (b.title === '—') return -1;
        return a.title.localeCompare(b.title);
      });
  }, []);

  const getGroupedInvoices = useCallback((list: Invoice[]): SectionData[] => {
    if (groupBy === 'none') return [{ title: 'All', monthKey: 'all', data: list }];
    switch (groupBy) {
      case 'recordDate': return groupByRecordDate(list);
      case 'paymentAccount': return groupByAccount(list);
      case 'createdBy': return groupByCreatedBy(list);
      case 'customer': return groupByCustomer(list);
      case 'month':
      default: return groupByMonth(list);
    }
  }, [groupBy, groupByMonth, groupByRecordDate, groupByAccount, groupByCreatedBy, groupByCustomer]);

  const filteredInvoices = useMemo(() => {
    let filtered = invoices;
    if (selectedMonths.size > 0) {
      filtered = filtered.filter(inv => {
        try {
          const d = parseLocalDate(inv.date);
          const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          return selectedMonths.has(k);
        } catch { return false; }
      });
    }
    if (selectedRecordDates.size > 0) {
      filtered = filtered.filter(inv => {
        if (!inv.createdAt) return false;
        const d = new Date(inv.createdAt);
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return selectedRecordDates.has(k);
      });
    }
    if (selectedAccounts.size > 0) {
      filtered = filtered.filter(inv => selectedAccounts.has(inv.account?.id || 'none'));
    }
    if (selectedCreators.size > 0) {
      filtered = filtered.filter(inv => selectedCreators.has(inv.createdBy || 'unknown'));
    }
    return filtered;
  }, [invoices, selectedMonths, selectedRecordDates, selectedAccounts, selectedCreators]);

  const searchedInvoices = useMemo(() => {
    if (!searchQuery.trim()) return filteredInvoices;
    if (!fullDataLoaded) return filteredInvoices; // 搜索 pending，等加载完成
    const q = searchQuery.trim().toLowerCase();
    return filteredInvoices.filter(inv => {
      const payerNameMatch = (inv.entity?.name || inv.customerName || '').toLowerCase().includes(q);
      const accountNameMatch = inv.account?.name?.toLowerCase().includes(q) || false;
      const amountMatch = inv.totalAmount?.toString().includes(q) || false;
      const itemsMatch = inv.items?.length ? inv.items.some(item => item.name?.toLowerCase().includes(q)) : false;
      return payerNameMatch || accountNameMatch || amountMatch || itemsMatch;
    });
  }, [filteredInvoices, searchQuery, fullDataLoaded]);

  const filterOptions = useMemo(() => {
    const months = new Set<string>();
    const recordDates = new Set<string>();
    const accounts = new Map<string, string>();
    const creators = new Map<string, string>();
    invoices.forEach(inv => {
      try {
        const d = parseLocalDate(inv.date);
        months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      } catch {}
      if (inv.createdAt) {
        const d = new Date(inv.createdAt);
        recordDates.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      }
      accounts.set(inv.account?.id || 'none', inv.account?.name || 'Not Set');
      if (inv.createdBy) {
        const name = inv.createdByUser?.name || inv.createdByUser?.email?.split('@')[0] || 'Unknown';
        creators.set(inv.createdBy, name);
      } else creators.set('unknown', 'Unknown');
    });
    const sortedMonths = Array.from(months).sort((a, b) => b.localeCompare(a));
    const sortedRecordDates = Array.from(recordDates).sort((a, b) => b.localeCompare(a));
    return {
      months: sortedMonths.map(k => {
        const [y, m] = k.split('-');
        return { key: k, label: format(new Date(parseInt(y), parseInt(m) - 1), 'MMMM yyyy') };
      }),
      recordDates: sortedRecordDates.map(k => {
        const [y, m, d] = k.split('-');
        return { key: k, label: format(new Date(parseInt(y), parseInt(m) - 1, parseInt(d)), 'MMM dd, yyyy') };
      }),
      accounts: Array.from(accounts.entries()).map(([id, name]) => ({ id, name })),
      creators: Array.from(creators.entries()).map(([id, name]) => ({ id, name })),
    };
  }, [invoices]);

  const sections = getGroupedInvoices(searchedInvoices);

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const invoiceColumns = useMemo(() => getInvoiceColumns({ formatDate, formatTimeAgo, statusLabels, statusColors }), [formatDate, formatTimeAgo, statusLabels, statusColors]);

  const sortRowsByColumn = useCallback(<T,>(rows: T[], col: { getSortValue?: (row: T) => string | number | Date | null | undefined } | undefined, dir: 'asc' | 'desc'): T[] => {
    if (!col?.getSortValue) return rows;
    return [...rows].sort((a, b) => {
      const va = col.getSortValue!(a);
      const vb = col.getSortValue!(b);
      const cmp = va === vb ? 0 : (va == null ? 1 : vb == null ? -1 : va < vb ? -1 : 1);
      return dir === 'asc' ? cmp : -cmp;
    });
  }, []);

  const tableSections = useMemo(() => {
    const base = sections.map(s => {
      const dataForStats = s.data;
      const confirmed = dataForStats.filter((inv: Invoice) => inv.status === 'confirmed');
      const currencies = confirmed.map((r: Invoice) => r.currency || 'USD');
      const dominantCurrency = currencies.length > 0
        ? (currencies.sort((a: string, b: string) =>
            currencies.filter((v: string) => v === a).length - currencies.filter((v: string) => v === b).length
          ).pop() as string)
        : 'USD';
      const totalAmount = exchangeRates
        ? sumAmountsInCurrency(
            confirmed.map((r: Invoice) => ({ amount: r.totalAmount, currency: r.currency || 'USD' })),
            dominantCurrency || 'USD',
            exchangeRates
          )
        : 0;
      return {
        title: s.title,
        data: s.data,
        count: confirmed.length,
        countLabel: 'income',
        totalAmount,
        currency: dominantCurrency,
        amountColor: '#D35400',
      };
    });
    const col = sortKey ? invoiceColumns.find(c => c.id === sortKey) : null;
    if (!col?.getSortValue) return base;
    return base.map(sec => ({ ...sec, data: sortRowsByColumn(sec.data, col, sortDirection) }));
  }, [sections, exchangeRates, sortKey, sortDirection, invoiceColumns, sortRowsByColumn]);

  const sortedDataForTable = useMemo(() => {
    if (groupBy !== 'none') return searchedInvoices;
    const col = sortKey ? invoiceColumns.find(c => c.id === sortKey) : null;
    return sortRowsByColumn(searchedInvoices, col, sortDirection);
  }, [groupBy, searchedInvoices, sortKey, sortDirection, invoiceColumns, sortRowsByColumn]);

  const allSectionForTable = useMemo(() => {
    const dataForStats = sortedDataForTable;
    const confirmed = dataForStats.filter((inv: Invoice) => inv.status === 'confirmed');
    const currencies = confirmed.map((r: Invoice) => r.currency || 'USD');
    const dominantCurrency = currencies.length > 0
      ? (currencies.sort((a: string, b: string) =>
          currencies.filter((v: string) => v === a).length - currencies.filter((v: string) => v === b).length
        ).pop() as string)
      : 'USD';
    const totalAmount = exchangeRates
      ? sumAmountsInCurrency(
          confirmed.map((r: Invoice) => ({ amount: r.totalAmount, currency: r.currency || 'USD' })),
          dominantCurrency || 'USD',
          exchangeRates
        )
      : 0;
    return [{
      title: 'All',
      data: sortedDataForTable,
      count: confirmed.length,
      countLabel: 'income',
      totalAmount,
      currency: dominantCurrency,
      amountColor: '#D35400',
    }];
  }, [sortedDataForTable, exchangeRates]);

  const tableEmptyMessage = useMemo(() => {
    const isEmpty = sections.length === 0 || (refreshing && searchQuery.trim());
    const loadInProgress = loading || refreshing || !fullDataLoaded;
    if (loadInProgress && searchedInvoices.length === 0) return refreshing ? '' : 'Loading...';
    if (invoices.length === 0) return 'No income yet';
    if (searchedInvoices.length === 0) return 'No search result';
    return 'No data';
  }, [sections.length, refreshing, searchQuery, searchedInvoices.length, invoices.length, loading, fullDataLoaded]);

  const toggleSection = (monthKey: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  };

  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    if (showSortMenu) {
      const measure = () => {
        const el = document.getElementById('invoices-group-button');
        if (el) {
          const r = el.getBoundingClientRect();
          setGroupPopoverRect({ left: r.left, top: r.bottom + 6 });
        } else setGroupPopoverRect(null);
      };
      measure();
      const t = requestAnimationFrame(measure);
      return () => { cancelAnimationFrame(t); setGroupPopoverRect(null); };
    }
    setGroupPopoverRect(null);
  }, [showSortMenu]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    if (showFilterMenu) {
      const measure = () => {
        const el = document.getElementById('invoices-filter-button');
        if (el) {
          const r = el.getBoundingClientRect();
          setFilterPopoverRect({ left: r.left, top: r.bottom + 6 });
        } else setFilterPopoverRect(null);
      };
      measure();
      const t = requestAnimationFrame(measure);
      return () => { cancelAnimationFrame(t); setFilterPopoverRect(null); };
    }
    setFilterPopoverRect(null);
  }, [showFilterMenu]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: PointerEvent) => {
      const target = e.target as Node;
      const groupBtn = document.getElementById('invoices-group-button');
      const groupPopover = document.getElementById('invoices-group-popover');
      const filterBtn = document.getElementById('invoices-filter-button');
      const filterPopover = document.getElementById('invoices-filter-popover');
      if (showSortMenu && groupBtn && !groupBtn.contains(target) && groupPopover && !groupPopover.contains(target)) setShowSortMenu(false);
      if (showFilterMenu && filterBtn && !filterBtn.contains(target) && filterPopover && !filterPopover.contains(target)) {
        setShowFilterMenu(false);
        setFilterSubMenu('main');
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [showSortMenu, showFilterMenu]);

  const hasSelection = selectedIds.size > 0;
  return (
    <View style={styles.container}>
      <View style={styles.toolbarSlot}>
        {hasSelection ? (
          <View style={styles.bulkBar}>
            <Text style={styles.bulkText}>{selectedIds.size} selected</Text>
            <TouchableOpacity style={[styles.bulkBtn, styles.bulkBtnDanger]} onPress={handleBatchDelete}>
              <Ionicons name="trash-outline" size={18} color="#fff" />
              <Text style={styles.bulkBtnText}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bulkBtnClear} onPress={() => setSelectedIds(new Set())}>
              <Text style={styles.bulkBtnClearText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View {...(isDesktopWeb ? { nativeID: 'invoices-group-button' } : {})}>
                <TouchableOpacity style={styles.sortButton} onPress={() => setShowSortMenu(true)}>
                  {groupBy === 'none' && <Ionicons name="list-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
                  {groupBy === 'month' && <Ionicons name="calendar-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
                  {groupBy === 'recordDate' && <Ionicons name="time-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
                  {groupBy === 'paymentAccount' && <Ionicons name="wallet-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
                  {groupBy === 'createdBy' && <Ionicons name="person-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
                  {groupBy === 'customer' && <Ionicons name="people-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
                  <Text style={styles.sortText}>Group</Text>
                  <Ionicons name="chevron-down" size={16} color="#636E72" />
                </TouchableOpacity>
              </View>
              <View {...(isDesktopWeb ? { nativeID: 'invoices-filter-button' } : {})}>
                <TouchableOpacity style={styles.filterButton} onPress={() => { setShowFilterMenu(true); setFilterSubMenu('main'); }}>
                  <Text style={styles.filterText}>
                    Filter
                    {(selectedMonths.size + selectedRecordDates.size + selectedAccounts.size + selectedCreators.size) > 0 && (
                      <Text style={styles.filterBadge}> ({selectedMonths.size + selectedRecordDates.size + selectedAccounts.size + selectedCreators.size})</Text>
                    )}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color="#636E72" />
                </TouchableOpacity>
              </View>
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
        )}
      </View>

      {isDesktopWeb ? (
        <ScrollView
          style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={loading && invoices.length === 0 ? { flexGrow: 1 } : { flexGrow: 0 }}
        >
          {(loading && invoices.length === 0) ? (
            <View style={styles.emptyContainer}>
              <ActivityIndicator size="large" color="#6C5CE7" />
              <Text style={styles.emptyText}>Loading...</Text>
            </View>
          ) : (
            <DataTable<Invoice>
              columns={invoiceColumns}
              data={undefined}
              sections={
                refreshing && searchQuery.trim()
                  ? undefined
                  : (groupBy === 'none' ? allSectionForTable : tableSections)
              }
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={(key, dir) => { setSortKey(key); setSortDirection(dir); }}
              keyExtractor={r => r.id || Math.random().toString()}
              onRowPress={r => { if (r.id) router.push(`/invoice-details/${r.id}`); }}
              emptyMessage={tableEmptyMessage}
              storageKey="invoices-table"
              selectable
              selectableRevealOnHover
              selectedIds={Array.from(selectedIds)}
              onSelectedIdsChange={(ids) => setSelectedIds(new Set(ids))}
            />
          )}
        </ScrollView>
      ) : (
      <SectionList
        sections={refreshing && searchQuery.trim() ? [] : sections.map(s => ({
          ...s,
          data: collapsedSections.has(s.monthKey) ? [] : s.data,
          originalData: s.data,
        }))}
        keyExtractor={(item: Invoice) => item.id || Math.random().toString()}
        renderItem={({ item }) => {
          const isSelected = item.id ? selectedIds.has(item.id) : false;
          const isSelectionMode = selectedIds.size > 0;
          return (
            <SwipeableRow onDelete={() => item.id && handleDeleteSingle(item.id)} disabled={isSelectionMode}>
              <TouchableOpacity
                style={[styles.invoiceItem, isSelected && styles.receiptItemSelected]}
                onPress={() => {
                  if (isSelectionMode) {
                    if (item.id) handleToggleSelect(item.id);
                  } else {
                    router.push(`/invoice-details/${item.id}`);
                  }
                }}
                onLongPress={() => { if (item.id && !isSelectionMode) handleToggleSelect(item.id); }}
                activeOpacity={0.7}
              >
                {isSelectionMode && (
                  <View style={styles.checkboxContainer}>
                    <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                      {isSelected && <Ionicons name="checkmark" size={16} color="#fff" />}
                    </View>
                  </View>
                )}
                <View style={styles.receiptContent}>
                  <View style={styles.firstRow}>
                    <Text style={styles.storeName} numberOfLines={1}>
                      {item.entity?.name || item.customerName || '—'}
                    </Text>
                    {item.status === 'confirmed' ? (
                      <View style={styles.confirmedStatusContainer}>
                        <View style={styles.confirmedBadge}>
                          <Ionicons name={inputTypeConfirmBadgeIonicon(item.inputType)} size={13} color="#fff" />
                        </View>
                        {item.createdByUser && (
                          <Text style={styles.confirmedByText}>
                            by {item.createdByUser.name || item.createdByUser.email?.split('@')[0] || 'Unknown'}
                          </Text>
                        )}
                      </View>
                    ) : (
                      <View style={[styles.statusBadge, { backgroundColor: statusColors[item.status] }]}>
                        <Text style={styles.statusText}>{statusLabels[item.status]}</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.secondRow}>
                    <AmountText amount={item.totalAmount} currency={item.currency} style={styles.amount} />
                    <Text style={styles.date}>{formatDate(item.date)}</Text>
                    <Text style={styles.createdDate}>
                      {item.createdAt ? formatTimeAgo(item.createdAt) : formatDate(item.date)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            </SwipeableRow>
          );
        }}
        renderSectionHeader={({ section }) => {
          const isCollapsed = collapsedSections.has(section.monthKey);
          const dataForStats = section.originalData || section.data;
          const confirmed = dataForStats.filter((inv: Invoice) => inv.status === 'confirmed');
          const dominantCurrency = confirmed.length ? (confirmed.map((r: Invoice) => r.currency || 'USD').sort((a: string, b: string) =>
            confirmed.filter((v: Invoice) => (v.currency || 'USD') === a).length - confirmed.filter((v: Invoice) => (v.currency || 'USD') === b).length
          ).pop()) : 'USD';
          const totalAmount = exchangeRates
            ? sumAmountsInCurrency(
                confirmed.map((r: Invoice) => ({ amount: r.totalAmount, currency: r.currency || 'USD' })),
                dominantCurrency || 'USD',
                exchangeRates
              )
            : 0;
          return (
            <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection(section.monthKey)} activeOpacity={0.7}>
              <View style={styles.sectionHeaderContent}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <View style={styles.sectionHeaderRight}>
                  <Text style={styles.sectionCount}>{confirmed.length} income</Text>
                  <AmountText amount={totalAmount} currency={dominantCurrency} style={styles.sectionAmount} />
                  <Ionicons name={isCollapsed ? 'chevron-forward' : 'chevron-down'} size={20} color="#636E72" />
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={(() => {
          const isEmpty = sections.length === 0 || (refreshing && searchQuery.trim());
          const loadInProgress = loading || refreshing || !fullDataLoaded;
          if (loadInProgress && isEmpty) {
            if (refreshing) return <View style={styles.emptyContainer} />; // RefreshControl 已有 spinner
            return (
              <View style={styles.emptyContainer}>
                <ActivityIndicator size="large" color="#6C5CE7" />
                <Text style={styles.emptyText}>Loading...</Text>
              </View>
            );
          }
          if (invoices.length === 0) {
            return (
              <View style={styles.emptyContainer}>
                <Ionicons name="document-text-outline" size={64} color="#BDC3C7" />
                <Text style={styles.emptyText}>No income yet</Text>
                <Text style={styles.emptySubtext}>Tap + to add income</Text>
              </View>
            );
          }
          return (
            <View style={styles.emptyContainer}>
              <Ionicons name="search-outline" size={64} color="#BDC3C7" />
              <Text style={styles.emptyText}>No search result</Text>
            </View>
          );
        })()}
        contentContainerStyle={sections.length === 0 ? styles.emptyList : styles.listContent}
        stickySectionHeadersEnabled={false}
      />
      )}

      {isDesktopWeb ? (
        <View style={[styles.fabContainer, styles.fabContainerWeb]}>
          <WebChatFab type="invoice" embedded />
        </View>
      ) : Platform.OS === 'web' ? (
        /* 窄窗 Web：无二层菜单，+ 直接进入 Chat to log（Income） */
        <View style={styles.fabContainer}>
          <TouchableOpacity
            style={styles.fabMain}
            onPress={handleChatFromFab}
            activeOpacity={0.8}
            accessibilityLabel="Open chat to log for income"
          >
            <Ionicons name="add" size={32} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.fabContainer}>
          {showFabActions && (
            <View style={styles.fabActionsContainer}>
              <Animated.View style={{ opacity: fabAnimation }}>
                <TouchableOpacity style={styles.fabAction} onPress={handleChatFromFab} activeOpacity={0.8}>
                  <Ionicons name="chatbubble-outline" size={28} color="#6C5CE7" />
                </TouchableOpacity>
              </Animated.View>
              <Animated.View style={{ marginTop: 8, opacity: fabAnimation }}>
                <TouchableOpacity style={styles.fabAction} onPress={handleScanFromFab} activeOpacity={0.8}>
                  <Ionicons name="camera" size={28} color="#6C5CE7" />
                </TouchableOpacity>
              </Animated.View>
            </View>
          )}
          {!showFabActions && (
            <TouchableOpacity style={styles.fabMain} onPress={handleCameraPress} activeOpacity={0.8}>
              <Ionicons name="add" size={32} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Group By: 移动端 Modal，Web 浮窗 */}
      {!isDesktopWeb && (
      <Modal visible={showSortMenu} transparent animationType="slide" onRequestClose={() => setShowSortMenu(false)}>
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setShowSortMenu(false)}>
          <View style={styles.pickerBottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Group By</Text>
              <TouchableOpacity onPress={() => setShowSortMenu(false)} style={styles.pickerCloseButton}>
                <Text style={styles.pickerCloseText}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView} showsVerticalScrollIndicator={false}>
              {/* 不分组 + 统一顺序：交易月份、账户、客户、记录者、记录日期 */}
              {(['none', 'month', 'paymentAccount', 'customer', 'createdBy', 'recordDate'] as const).map((key) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.pickerOption, groupBy === key && styles.pickerOptionSelected]}
                  onPress={() => { setGroupBy(key); setShowSortMenu(false); }}
                >
                  {key === 'none' && <Ionicons name="list-outline" size={20} color={groupBy === key ? '#6C5CE7' : '#636E72'} style={{ marginRight: 12 }} />}
                  {key === 'month' && <Ionicons name="calendar-outline" size={20} color={groupBy === key ? '#6C5CE7' : '#636E72'} style={{ marginRight: 12 }} />}
                  {key === 'paymentAccount' && <Ionicons name="wallet-outline" size={20} color={groupBy === key ? '#6C5CE7' : '#636E72'} style={{ marginRight: 12 }} />}
                  {key === 'customer' && <Ionicons name="people-outline" size={20} color={groupBy === key ? '#6C5CE7' : '#636E72'} style={{ marginRight: 12 }} />}
                  {key === 'createdBy' && <Ionicons name="person-outline" size={20} color={groupBy === key ? '#6C5CE7' : '#636E72'} style={{ marginRight: 12 }} />}
                  {key === 'recordDate' && <Ionicons name="time-outline" size={20} color={groupBy === key ? '#6C5CE7' : '#636E72'} style={{ marginRight: 12 }} />}
                  <Text style={[styles.pickerOptionText, groupBy === key && styles.pickerOptionTextSelected, { flex: 1 }]}>
                    {key === 'none' && 'No group'}
                    {key === 'month' && 'Transaction Month'}
                    {key === 'paymentAccount' && 'Account'}
                    {key === 'customer' && 'Payer'}
                    {key === 'createdBy' && 'Recorder'}
                    {key === 'recordDate' && 'Record Date'}
                  </Text>
                  {groupBy === key && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
      )}

      {isDesktopWeb && showSortMenu && groupPopoverRect && typeof document !== 'undefined' && document.body && createPortal(
        <div id="invoices-group-popover" style={{ ...WEB_POPOVER.container, left: groupPopoverRect.left, top: groupPopoverRect.top }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#495057', marginBottom: 10 }}>Group By</Text>
          <View style={{ gap: 2 }}>
            {[
              { key: 'none' as const, label: 'No group', icon: 'list-outline' as const },
              { key: 'month' as const, label: 'Transaction Month', icon: 'calendar-outline' as const },
              { key: 'paymentAccount' as const, label: 'Account', icon: 'wallet-outline' as const },
              { key: 'customer' as const, label: 'Payer', icon: 'people-outline' as const },
              { key: 'createdBy' as const, label: 'Recorder', icon: 'person-outline' as const },
              { key: 'recordDate' as const, label: 'Record Date', icon: 'time-outline' as const },
            ].map(({ key, label, icon }) => (
              <TouchableOpacity
                key={key}
                onPress={() => { setGroupBy(key); setShowSortMenu(false); }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingTop: 10,
                  paddingBottom: 10,
                  paddingLeft: 12,
                  paddingRight: 12,
                  borderRadius: 8,
                  backgroundColor: groupBy === key ? 'rgba(108, 92, 231, 0.1)' : 'transparent',
                  minHeight: 40,
                  lineHeight: 20,
                }}
              >
                <Ionicons name={icon} size={20} color={groupBy === key ? '#6C5CE7' : '#636E72'} style={{ marginRight: 10 }} />
                <Text style={{ flex: 1, fontSize: 13, color: groupBy === key ? '#6C5CE7' : '#2D3436', fontWeight: groupBy === key ? '600' : '500', lineHeight: 20 }}>{label}</Text>
                {groupBy === key && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
              </TouchableOpacity>
            ))}
          </View>
        </div>,
        document.body
      )}

      {/* Filter: 移动端 Modal，Web 浮窗 */}
      {!isDesktopWeb && (
      <Modal visible={showFilterMenu} transparent animationType="slide" onRequestClose={() => { setShowFilterMenu(false); setFilterSubMenu('main'); }}>
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => { setShowFilterMenu(false); setFilterSubMenu('main'); }}>
          <View style={styles.pickerBottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              {filterSubMenu !== 'main' ? (
                <TouchableOpacity onPress={() => setFilterSubMenu('main')} style={styles.pickerBackButton}>
                  <Ionicons name="chevron-back" size={20} color="#6C5CE7" />
                </TouchableOpacity>
              ) : null}
              <Text style={styles.pickerTitle}>
                {filterSubMenu === 'main' ? 'Filter' : filterSubMenu === 'month' ? 'Transaction Months' : filterSubMenu === 'recordDate' ? 'Record Dates' : filterSubMenu === 'account' ? 'Accounts' : 'Recorders'}
              </Text>
              {(filterSubMenu === 'main' && (selectedMonths.size > 0 || selectedRecordDates.size > 0 || selectedAccounts.size > 0 || selectedCreators.size > 0)) && (
                <TouchableOpacity onPress={() => { setSelectedMonths(new Set()); setSelectedRecordDates(new Set()); setSelectedAccounts(new Set()); setSelectedCreators(new Set()); }} style={styles.clearFilterButton}>
                  <Text style={styles.clearFilterText}>Clear</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => { setShowFilterMenu(false); setFilterSubMenu('main'); }} style={styles.pickerCloseButton}>
                <Text style={styles.pickerCloseText}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView} showsVerticalScrollIndicator={false}>
              {filterSubMenu === 'main' && (
                <>
                  <TouchableOpacity style={styles.filterMainOption} onPress={() => setFilterSubMenu('month')}>
                    <Text style={styles.filterMainOptionText}>Transaction Month</Text>
                    {selectedMonths.size > 0 && <Text style={styles.filterCountBadge}>{selectedMonths.size}</Text>}
                    <Ionicons name="chevron-forward" size={20} color="#95A5A6" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.filterMainOption} onPress={() => setFilterSubMenu('account')}>
                    <Text style={styles.filterMainOptionText}>Account</Text>
                    {selectedAccounts.size > 0 && <Text style={styles.filterCountBadge}>{selectedAccounts.size}</Text>}
                    <Ionicons name="chevron-forward" size={20} color="#95A5A6" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.filterMainOption} onPress={() => setFilterSubMenu('creator')}>
                    <Text style={styles.filterMainOptionText}>Recorder</Text>
                    {selectedCreators.size > 0 && <Text style={styles.filterCountBadge}>{selectedCreators.size}</Text>}
                    <Ionicons name="chevron-forward" size={20} color="#95A5A6" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.filterMainOption} onPress={() => setFilterSubMenu('recordDate')}>
                    <Text style={styles.filterMainOptionText}>Record Date</Text>
                    {selectedRecordDates.size > 0 && <Text style={styles.filterCountBadge}>{selectedRecordDates.size}</Text>}
                    <Ionicons name="chevron-forward" size={20} color="#95A5A6" />
                  </TouchableOpacity>
                </>
              )}
              {filterSubMenu === 'month' && filterOptions.months.map((m) => {
                const isSelected = selectedMonths.has(m.key);
                return (
                  <TouchableOpacity key={m.key} style={[styles.pickerOption, isSelected && styles.pickerOptionSelected]} onPress={() => setSelectedMonths(prev => { const s = new Set(prev); if (s.has(m.key)) s.delete(m.key); else s.add(m.key); return s; })}>
                    <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected]}>{m.label}</Text>
                    {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                  </TouchableOpacity>
                );
              })}
              {filterSubMenu === 'recordDate' && filterOptions.recordDates.map((d) => {
                const isSelected = selectedRecordDates.has(d.key);
                return (
                  <TouchableOpacity key={d.key} style={[styles.pickerOption, isSelected && styles.pickerOptionSelected]} onPress={() => setSelectedRecordDates(prev => { const s = new Set(prev); if (s.has(d.key)) s.delete(d.key); else s.add(d.key); return s; })}>
                    <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected]}>{d.label}</Text>
                    {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                  </TouchableOpacity>
                );
              })}
              {filterSubMenu === 'account' && filterOptions.accounts.map((a) => {
                const isSelected = selectedAccounts.has(a.id);
                return (
                  <TouchableOpacity key={a.id} style={[styles.pickerOption, isSelected && styles.pickerOptionSelected]} onPress={() => setSelectedAccounts(prev => { const s = new Set(prev); if (s.has(a.id)) s.delete(a.id); else s.add(a.id); return s; })}>
                    <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected]}>{a.name}</Text>
                    {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                  </TouchableOpacity>
                );
              })}
              {filterSubMenu === 'creator' && filterOptions.creators.map((c) => {
                const isSelected = selectedCreators.has(c.id);
                return (
                  <TouchableOpacity key={c.id} style={[styles.pickerOption, isSelected && styles.pickerOptionSelected]} onPress={() => setSelectedCreators(prev => { const s = new Set(prev); if (s.has(c.id)) s.delete(c.id); else s.add(c.id); return s; })}>
                    <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected]}>{c.name}</Text>
                    {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
      )}

      {isDesktopWeb && showFilterMenu && filterPopoverRect && typeof document !== 'undefined' && document.body && createPortal(
        <div id="invoices-filter-popover" style={{ ...WEB_POPOVER.container, ...WEB_POPOVER.containerWide, left: filterPopoverRect.left, top: filterPopoverRect.top }}>
          <View style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {filterSubMenu !== 'main' ? (
              <>
                <TouchableOpacity onPress={() => setFilterSubMenu('main')} style={{ padding: 4 }}><Ionicons name="chevron-back" size={20} color="#6C5CE7" /></TouchableOpacity>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#495057' }}>
                  {filterSubMenu === 'month' && 'Transaction Month'}
                  {filterSubMenu === 'recordDate' && 'Record Date'}
                  {filterSubMenu === 'account' && 'Account'}
                  {filterSubMenu === 'creator' && 'Recorder'}
                </Text>
                <TouchableOpacity onPress={() => { setShowFilterMenu(false); setFilterSubMenu('main'); }} style={{ padding: 4 }}><Text style={{ fontSize: 13, color: '#6C5CE7' }}>Done</Text></TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#495057' }}>Filter</Text>
                {(selectedMonths.size > 0 || selectedRecordDates.size > 0 || selectedAccounts.size > 0 || selectedCreators.size > 0) && (
                  <TouchableOpacity onPress={() => { setSelectedMonths(new Set()); setSelectedRecordDates(new Set()); setSelectedAccounts(new Set()); setSelectedCreators(new Set()); }} style={{ padding: 4 }}><Text style={{ fontSize: 13, color: '#6C5CE7' }}>Clear</Text></TouchableOpacity>
                )}
              </>
            )}
          </View>
          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
            {filterSubMenu === 'main' && (
              <>
                <TouchableOpacity style={[styles.filterMainOption, { marginBottom: 4, minHeight: 40, lineHeight: 20 }]} onPress={() => setFilterSubMenu('month')}><Text style={[styles.filterMainOptionText, { fontSize: 13, lineHeight: 20 }]}>Transaction Month</Text>{selectedMonths.size > 0 && <Text style={[styles.filterCountBadge, { fontSize: 12 }]}>{selectedMonths.size}</Text>}<Ionicons name="chevron-forward" size={20} color="#95A5A6" /></TouchableOpacity>
                <TouchableOpacity style={[styles.filterMainOption, { marginBottom: 4, minHeight: 40, lineHeight: 20 }]} onPress={() => setFilterSubMenu('account')}><Text style={[styles.filterMainOptionText, { fontSize: 13, lineHeight: 20 }]}>Account</Text>{selectedAccounts.size > 0 && <Text style={[styles.filterCountBadge, { fontSize: 12 }]}>{selectedAccounts.size}</Text>}<Ionicons name="chevron-forward" size={20} color="#95A5A6" /></TouchableOpacity>
                <TouchableOpacity style={[styles.filterMainOption, { marginBottom: 4, minHeight: 40, lineHeight: 20 }]} onPress={() => setFilterSubMenu('creator')}><Text style={[styles.filterMainOptionText, { fontSize: 13, lineHeight: 20 }]}>Recorder</Text>{selectedCreators.size > 0 && <Text style={[styles.filterCountBadge, { fontSize: 12 }]}>{selectedCreators.size}</Text>}<Ionicons name="chevron-forward" size={20} color="#95A5A6" /></TouchableOpacity>
                <TouchableOpacity style={[styles.filterMainOption, { minHeight: 40, lineHeight: 20 }]} onPress={() => setFilterSubMenu('recordDate')}><Text style={[styles.filterMainOptionText, { fontSize: 13, lineHeight: 20 }]}>Record Date</Text>{selectedRecordDates.size > 0 && <Text style={[styles.filterCountBadge, { fontSize: 12 }]}>{selectedRecordDates.size}</Text>}<Ionicons name="chevron-forward" size={20} color="#95A5A6" /></TouchableOpacity>
              </>
            )}
            {filterSubMenu === 'month' && filterOptions.months.map((m: { key: string; label: string }) => {
              const isSelected = selectedMonths.has(m.key);
              return (
                <TouchableOpacity key={m.key} style={[styles.pickerOption, isSelected && styles.pickerOptionSelected, { minHeight: 40, lineHeight: 20 }]} onPress={() => setSelectedMonths(prev => { const s = new Set(prev); if (s.has(m.key)) s.delete(m.key); else s.add(m.key); return s; })}>
                  <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected, { fontSize: 13, lineHeight: 20 }]}>{m.label}</Text>
                  {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                </TouchableOpacity>
              );
            })}
            {filterSubMenu === 'recordDate' && filterOptions.recordDates.map((d: { key: string; label: string }) => {
              const isSelected = selectedRecordDates.has(d.key);
              return (
                <TouchableOpacity key={d.key} style={[styles.pickerOption, isSelected && styles.pickerOptionSelected, { minHeight: 40, lineHeight: 20 }]} onPress={() => setSelectedRecordDates(prev => { const s = new Set(prev); if (s.has(d.key)) s.delete(d.key); else s.add(d.key); return s; })}>
                  <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected, { fontSize: 13, lineHeight: 20 }]}>{d.label}</Text>
                  {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                </TouchableOpacity>
              );
            })}
            {filterSubMenu === 'account' && filterOptions.accounts.map((a: { id: string; name: string }) => {
              const isSelected = selectedAccounts.has(a.id);
              return (
                <TouchableOpacity key={a.id} style={[styles.pickerOption, isSelected && styles.pickerOptionSelected, { minHeight: 40, lineHeight: 20 }]} onPress={() => setSelectedAccounts(prev => { const s = new Set(prev); if (s.has(a.id)) s.delete(a.id); else s.add(a.id); return s; })}>
                  <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected, { fontSize: 13, lineHeight: 20 }]}>{a.name}</Text>
                  {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                </TouchableOpacity>
              );
            })}
            {filterSubMenu === 'creator' && filterOptions.creators.map((c: { id: string; name: string }) => {
              const isSelected = selectedCreators.has(c.id);
              return (
                <TouchableOpacity key={c.id} style={[styles.pickerOption, isSelected && styles.pickerOptionSelected, { minHeight: 40, lineHeight: 20 }]} onPress={() => setSelectedCreators(prev => { const s = new Set(prev); if (s.has(c.id)) s.delete(c.id); else s.add(c.id); return s; })}>
                  <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected, { fontSize: 13, lineHeight: 20 }]}>{c.name}</Text>
                  {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </div>,
        document.body
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ECEFF1' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#ECEFF1' },
  toolbarSlot: { height: 52, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E9ECEF', justifyContent: 'center' },
  header: { height: 52, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: 'transparent' },
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
  bulkBtnText: { fontSize: 14, color: '#fff', fontWeight: '600' },
  bulkBtnClear: { paddingVertical: 8, paddingHorizontal: 12 },
  bulkBtnClearText: { fontSize: 14, color: '#636E72', fontWeight: '500' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cancelButton: { paddingHorizontal: 12, paddingVertical: 8 },
  cancelButtonText: { fontSize: 14, color: '#6C5CE7', fontWeight: '500' },
  selectedCountContainer: { flex: 1, alignItems: 'center' },
  selectedCountText: { fontSize: 14, color: '#636E72', fontWeight: '500' },
  deleteButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  deleteButtonText: { fontSize: 14, color: '#E74C3C', fontWeight: '600' },
  filterButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  filterText: { fontSize: 14, color: '#636E72', marginRight: 4, fontWeight: '500' },
  sortButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  sortText: { fontSize: 14, color: '#636E72', marginRight: 4, fontWeight: '500' },
  searchContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F9FA', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#E9ECEF' },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#2D3436', padding: 0 },
  searchClear: { marginLeft: 4 },
  invoiceItem: { backgroundColor: '#fff', paddingVertical: 10, paddingHorizontal: 12, paddingLeft: 24, borderBottomWidth: 1, borderBottomColor: '#E9ECEF', flexDirection: 'row', alignItems: 'center' },
  receiptItemSelected: { backgroundColor: '#E8F4FD' },
  checkboxContainer: { marginRight: 12 },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#BDC3C7', justifyContent: 'center', alignItems: 'center' },
  checkboxSelected: { backgroundColor: '#6C5CE7', borderColor: '#6C5CE7' },
  receiptContent: { flex: 1 },
  firstRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  storeName: { flex: 1, fontSize: 16, fontWeight: '600', color: '#2D3436', marginRight: 12 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  statusText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  confirmedStatusContainer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  confirmedBadge: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#00B894', justifyContent: 'center', alignItems: 'center' },
  confirmedByText: { fontSize: 12, color: '#636E72', fontWeight: '500' },
  secondRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  amount: { fontSize: 16, fontWeight: '600', color: '#D35400' },
  date: { fontSize: 14, color: '#636E72' },
  createdDate: { fontSize: 14, color: '#636E72', marginLeft: 'auto' },
  fabContainer: { position: 'absolute', right: 20, bottom: 20, alignItems: 'flex-end' },
  fabContainerWeb: {
    right: WEB_CHAT_FAB_RIGHT,
    bottom: WEB_CHAT_FAB_BOTTOM,
    width: WEB_CHAT_FAB_SIZE,
    height: WEB_CHAT_FAB_SIZE,
  },
  fabActionsContainer: { alignItems: 'flex-end' },
  fabMain: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#6C5CE7', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 6, elevation: 6 },
  fabAction: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 4, elevation: 4 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 100 },
  emptyList: { flexGrow: 1 },
  sectionHeader: { backgroundColor: '#E9ECEF', paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#DEE2E6' },
  sectionHeaderContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#2D3436' },
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionCount: { fontSize: 14, color: '#636E72' },
  sectionAmount: { fontSize: 14, fontWeight: '600', color: '#D35400' },
  listContent: { paddingHorizontal: 4, paddingTop: 0, paddingBottom: 100 },
  emptyText: { fontSize: 18, color: '#636E72', marginTop: 16, fontWeight: '600' },
  emptySubtext: { fontSize: 14, color: '#95A5A6', marginTop: 8 },
  filterBadge: { fontSize: 14, color: '#6C5CE7', fontWeight: '600' },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  pickerBottomSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 12, paddingBottom: 32, paddingHorizontal: 20, maxHeight: '70%' },
  pickerHandle: { width: 40, height: 4, backgroundColor: '#BDC3C7', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  pickerTitle: { fontSize: 18, fontWeight: '600', color: '#2D3436', flex: 1 },
  pickerCloseButton: { paddingHorizontal: 12, paddingVertical: 6 },
  pickerCloseText: { fontSize: 16, color: '#6C5CE7', fontWeight: '600' },
  pickerScrollView: { maxHeight: 400 },
  pickerOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, marginBottom: 8, backgroundColor: '#F8F9FA', minHeight: 48, gap: 12 },
  pickerOptionSelected: { backgroundColor: '#E8F4FD' },
  pickerOptionText: { flex: 1, fontSize: 16, color: '#2D3436', fontWeight: '500' },
  pickerOptionTextSelected: { color: '#6C5CE7', fontWeight: '600' },
  pickerBackButton: { paddingHorizontal: 12, paddingVertical: 6 },
  clearFilterButton: { paddingHorizontal: 12, paddingVertical: 6 },
  clearFilterText: { fontSize: 14, color: '#E74C3C', fontWeight: '500' },
  filterMainOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, paddingHorizontal: 16, borderRadius: 8, marginBottom: 8, backgroundColor: '#F8F9FA', minHeight: 56 },
  filterMainOptionText: { fontSize: 16, color: '#2D3436', fontWeight: '500', flex: 1 },
  filterCountBadge: { fontSize: 14, color: '#6C5CE7', fontWeight: '600', backgroundColor: '#E8F4FD', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, minWidth: 24, textAlign: 'center' },
});
