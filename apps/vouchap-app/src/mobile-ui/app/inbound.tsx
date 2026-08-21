import { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Modal,
  ScrollView,
  InteractionManager,
  Platform,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import { showAiInventory } from '@/lib/feature-flags';
import { getCurrentUser, getCurrentSpace } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getInboundForListFirstPaint, getAllInbound, deleteInbound, saveInbound } from '@/lib/inbound';
import { getCanonicalEntityId } from '@/lib/entities';
import { Inbound } from '@/types';
import { format } from 'date-fns';
import { VoucherStatus } from '@/types';
import { SwipeableRow } from './SwipeableRow';
import { uploadInboundImageTempWithSpace } from '@/lib/supabase';
import { processInboundInBackground } from '@/lib/inbound-processor';
import { voucherListStyles as styles } from '../styles/voucher-list-styles';
import { getLocalDateString } from '@/lib/date-utils';
import { showToast } from '@/lib/toast';
import { confirmThen, confirmDestructive } from '@/lib/alertWeb';
import DataTable, { WEB_POPOVER } from '@/components/DataTable';
import { getInboundColumns } from '@/components/voucher-table-columns';
import { useWebViewportKind } from '../lib/web-viewport';
import { preflightRecognitionOrAlert } from '@/lib/recognition-preflight-ui';
import { inputTypeConfirmBadgeIonicon } from '@/lib/input-type-ionicon';

type GroupByType = 'none' | 'month' | 'recordDate' | 'createdBy' | 'sender';

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
  data: Inbound[];
  originalData?: Inbound[];
}

export default function InboundScreen() {
  const { isDesktopWeb } = useWebViewportKind();
  const [list, setList] = useState<Inbound[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fullDataLoaded, setFullDataLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<GroupByType>('recordDate');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const [selectedRecordDates, setSelectedRecordDates] = useState<Set<string>>(new Set());
  const [selectedCreators, setSelectedCreators] = useState<Set<string>>(new Set());
  const [filterSubMenu, setFilterSubMenu] = useState<'main' | 'month' | 'recordDate' | 'creator'>('main');
  const [groupPopoverRect, setGroupPopoverRect] = useState<{ left: number; top: number } | null>(null);
  const [filterPopoverRect, setFilterPopoverRect] = useState<{ left: number; top: number } | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastInboundId, setLastInboundId] = useState<string | null>(null);
  const router = useRouter();
  const isExpoGo = Constants.appOwnership === 'expo';

  const runClientRecognitionPreflight = useCallback(async (): Promise<boolean> => {
    const space = await getCurrentSpace(true);
    if (space?.kind !== 'client' || !space.id) return true;
    return preflightRecognitionOrAlert(space.id, router);
  }, [router]);

  useEffect(() => {
    if (!showAiInventory) router.replace('/');
  }, []);

  const loadDetailsAsync = useCallback(() => {
    getAllInbound().then(fullList => {
      setList(fullList);
      setFullDataLoaded(true);
    }).catch(() => setFullDataLoaded(true));
  }, []);

  const load = useCallback(async (options?: { full?: boolean }) => {
    const full = options?.full ?? false;
    try {
      setFullDataLoaded(false);
      if (full) {
        const data = await getAllInbound();
        setList(data);
        setFullDataLoaded(true);
        setLoading(false);
        setRefreshing(false);
      } else {
        const data = await getInboundForListFirstPaint();
        setList(data);
        setFullDataLoaded(false);
        setLoading(false);
        setRefreshing(false);
        loadDetailsAsync();
      }
    } catch (e) {
      showToast('Failed to load inbound', 'error');
      console.error(e);
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadDetailsAsync]);

  useFocusEffect(
    useCallback(() => {
      if (list.length === 0) {
        const task = InteractionManager.runAfterInteractions(() => load());
        return () => task.cancel();
      }
    }, [load, list.length])
  );

  // Supabase Realtime：Web / 移动端列表均启用。
  useEffect(() => {
    let inboundChannel: ReturnType<typeof supabase.channel> | null = null;
    let inboundItemsChannel: ReturnType<typeof supabase.channel> | null = null;
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

    const setupRealtime = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) return;
        const spaceId = user.currentSpaceId || user.spaceId;
        if (!spaceId) return;

        const debouncedRefresh = () => {
          if (refreshTimeout) clearTimeout(refreshTimeout);
          refreshTimeout = setTimeout(() => load({ full: true }), 300);
        };

        inboundChannel = supabase
          .channel(`inbound-changes-${spaceId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'inbound', filter: `space_id=eq.${spaceId}` },
            () => debouncedRefresh()
          )
          .subscribe();

        inboundItemsChannel = supabase
          .channel(`inbound-items-changes-${spaceId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'inbound_items' }, () => debouncedRefresh())
          .subscribe();
      } catch (e) {
        console.warn('Inbound Realtime setup failed', e);
      }
    };
    setupRealtime();
    return () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      if (inboundChannel) supabase.removeChannel(inboundChannel);
      if (inboundItemsChannel) supabase.removeChannel(inboundItemsChannel);
    };
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    setSelectedIds(new Set());
    load({ full: true });
  };

  const handleAddInbound = async () => {
    try {
      const today = getLocalDateString();
      const id = await saveInbound({
        spaceId: '',
        date: today,
        status: 'pending',
        items: [],
      });
      load({ full: true });
      router.push(`/inbound-details/${id}?new=true`);
    } catch (e) {
      showToast('Failed to create inbound', 'error');
      console.error(e);
    }
  };

  const scanDocument = async () => {
    if (isExpoGo) {
      confirmThen(
        'Development Build Required',
        'Real-time edge detection and cropping requires a native development build. In Expo Go, please use the gallery picker option.',
        () => void pickImage(),
        { confirmText: 'Pick from Gallery', cancelText: 'Cancel' }
      );
      return;
    }

    const pre = await runClientRecognitionPreflight();
    if (!pre) return;

    try {
      // 动态导入 DocumentScanner（只在非 Expo Go 环境中导入）
      const module = await import('react-native-document-scanner-plugin');
      const DocumentScanner = module?.default;

      // 额外防御：模块导入但没有正确挂载时，直接提示使用开发构建
      if (!DocumentScanner || typeof DocumentScanner.scanDocument !== 'function') {
        throw new Error('DocumentScanner module not loaded correctly');
      }

      const { scannedImages } = await DocumentScanner.scanDocument({
        maxNumDocuments: 1,
        croppedImageQuality: 90,
        letUserAdjustCrop: false,  // 自动裁剪，无需手动调整
      } as any);

      if (scannedImages && scannedImages.length > 0) {
        // 自动裁剪后直接处理，实现 Snap 即拍即传
        processCapturedImage(scannedImages[0], false);
      }
    } catch (error) {
      console.error('Document scan error:', error);
      // 如果是模块未找到或原生模块未正确注册的错误，统一提示需要开发构建
      if (
        error instanceof Error &&
        (error.message?.includes('TurboModuleRegistry') ||
          error.message?.includes('Requiring unknown module') ||
          error.message?.includes('module not loaded correctly'))
      ) {
        confirmThen(
          'Development Build Required',
          'Document scanner requires a native development build. Please use a development build or use the gallery picker option.',
          () => void pickImage(),
          { confirmText: 'Pick from Gallery', cancelText: 'Cancel' }
        );
      } else {
        showToast('Failed to snap document. Please try again.', 'error');
      }
    }
  };

  const pickImage = async () => {
    const pre = await runClientRecognitionPreflight();
    if (!pre) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.9,
      });

      if (!result.canceled && result.assets[0]) {
        processCapturedImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Image picker error:', error);
      showToast('Failed to pick image.', 'error');
    }
  };

  const processCapturedImage = async (imageUri: string) => {
    setShowSuccessModal(true);
    setLastInboundId(null);
    (async () => {
      try {
        const tempFileName = `temp-${Date.now()}`;
        const user = await getCurrentUser();
        const spaceId = user?.currentSpaceId || user?.spaceId || '';
        const imageUrl = await uploadInboundImageTempWithSpace(imageUri, tempFileName, spaceId);
        const today = getLocalDateString();
        const inboundId = await saveInbound({
          spaceId: '',
          date: today,
          status: 'processing',
          items: [],
          imageUrl,
          inputType: 'image',
        });
        setLastInboundId(inboundId);
        load({ full: true });
        processInboundInBackground(imageUrl, inboundId, imageUri).then(() => load({ full: true })).catch(err => console.error('Background process failed:', err));
      } catch (error) {
        console.error('Processing error:', error);
        showToast('Failed to process inbound image.', 'error');
        setShowSuccessModal(false);
      }
    })();
  };

  const handleToggleSelect = (inboundId: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(inboundId)) newSet.delete(inboundId);
      else newSet.add(inboundId);
      return newSet;
    });
  };

  const handleDeleteSingle = async (inboundId: string) => {
    confirmDestructive(
      'Delete Inbound',
      'Are you sure you want to delete this inbound?',
      async () => {
        try {
          await deleteInbound(inboundId);
          setList(prev => prev.filter(r => r.id !== inboundId));
          setSelectedIds(prev => { const s = new Set(prev); s.delete(inboundId); return s; });
        } catch (error) {
          showToast('Failed to delete inbound', 'error');
          load({ full: true });
        }
      },
      { confirmLabel: 'Delete' }
    );
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    confirmDestructive(
      'Delete Inbound',
      `Delete ${selectedIds.size} inbound(s)?`,
      async () => {
        try {
          await Promise.all(Array.from(selectedIds).map(id => deleteInbound(id)));
          const idsToDelete = Array.from(selectedIds);
          setList(prev => prev.filter(r => r.id && !idsToDelete.includes(r.id)));
          setSelectedIds(new Set());
        } catch (error) {
          showToast('Failed to delete some inbound', 'error');
          load({ full: true });
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

  const groupByMonth = useCallback((data: Inbound[]): SectionData[] => {
    const grouped = new Map<string, Inbound[]>();
    data.forEach(inv => {
      try {
        const date = parseLocalDate(inv.date);
        const monthKey = `month-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!grouped.has(monthKey)) grouped.set(monthKey, []);
        grouped.get(monthKey)!.push(inv);
      } catch (_) {}
    });
    return Array.from(grouped.entries())
      .map(([monthKey, sectionData]) => ({
        title: format(parseLocalDate(sectionData[0].date), 'MMMM yyyy'),
        monthKey,
        data: sectionData.sort((a, b) => parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime()),
      }))
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }, []);

  const groupByRecordDate = useCallback((data: Inbound[]): SectionData[] => {
    const grouped = new Map<string, Inbound[]>();
    data.forEach(inv => {
      if (!inv.createdAt) return;
      const d = new Date(inv.createdAt);
      const dayKey = `record-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!grouped.has(dayKey)) grouped.set(dayKey, []);
      grouped.get(dayKey)!.push(inv);
    });
    return Array.from(grouped.entries())
      .map(([dayKey, sectionData]) => {
        const base = sectionData[0].createdAt ? new Date(sectionData[0].createdAt) : parseLocalDate(sectionData[0].date);
        const dateOnly = new Date(base.getFullYear(), base.getMonth(), base.getDate());
        return {
          title: format(dateOnly, 'MMM dd, yyyy'),
          monthKey: dayKey,
          data: sectionData.slice().sort((a, b) => {
            const at = a.createdAt ? new Date(a.createdAt).getTime() : parseLocalDate(a.date).getTime();
            const bt = b.createdAt ? new Date(b.createdAt).getTime() : parseLocalDate(b.date).getTime();
            return bt - at;
          }),
        };
      })
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }, []);

  const groupByCreatedBy = useCallback((data: Inbound[]): SectionData[] => {
    const grouped = new Map<string, Inbound[]>();
    data.forEach(inv => {
      const userKey = `user-${inv.createdBy || 'unknown'}`;
      if (!grouped.has(userKey)) grouped.set(userKey, []);
      grouped.get(userKey)!.push(inv);
    });
    return Array.from(grouped.entries())
      .map(([userKey, sectionData]) => {
        const createdBy = sectionData[0].createdBy;
        const title = createdBy
          ? (sectionData[0] as any).createdByUser?.name ?? (sectionData[0] as any).createdByUser?.email?.split('@')[0] ?? createdBy.slice(0, 8) + '…'
          : 'Unknown';
        return {
          title,
          monthKey: userKey,
          data: sectionData.slice().sort((a, b) => {
            const at = a.createdAt ? new Date(a.createdAt).getTime() : parseLocalDate(a.date).getTime();
            const bt = b.createdAt ? new Date(b.createdAt).getTime() : parseLocalDate(b.date).getTime();
            return bt - at;
          }),
        };
      })
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }, []);

  const groupBySender = useCallback((data: Inbound[]): SectionData[] => {
    const grouped = new Map<string, Inbound[]>();
    data.forEach(inv => {
      const senderName = (inv as any).entity?.name || inv.supplierName || '—';
      const senderKey = `sender-${getCanonicalEntityId(inv) || 'none'}`;
      if (!grouped.has(senderKey)) grouped.set(senderKey, []);
      grouped.get(senderKey)!.push(inv);
    });
    return Array.from(grouped.entries())
      .map(([senderKey, sectionData]) => {
        const senderName = (sectionData[0] as any).entity?.name || sectionData[0].supplierName || '—';
        return {
          title: senderName,
          monthKey: senderKey,
          data: sectionData.slice().sort((a, b) => {
            const at = a.createdAt ? new Date(a.createdAt).getTime() : parseLocalDate(a.date).getTime();
            const bt = b.createdAt ? new Date(b.createdAt).getTime() : parseLocalDate(b.date).getTime();
            return bt - at;
          }),
        };
      })
      .sort((a, b) => {
        if (a.title === '—') return 1;
        if (b.title === '—') return -1;
        return a.title.localeCompare(b.title);
      });
  }, []);

  const getGroupedList = useCallback((data: Inbound[]): SectionData[] => {
    if (groupBy === 'none') return [{ title: 'All', monthKey: 'all', data }];
    switch (groupBy) {
      case 'recordDate': return groupByRecordDate(data);
      case 'createdBy': return groupByCreatedBy(data);
      case 'sender': return groupBySender(data);
      case 'month':
      default: return groupByMonth(data);
    }
  }, [groupBy, groupByMonth, groupByRecordDate, groupByCreatedBy, groupBySender]);

  const filteredList = useMemo(() => {
    let filtered = list;
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
    if (selectedCreators.size > 0) {
      filtered = filtered.filter(inv => selectedCreators.has(inv.createdBy || 'unknown'));
    }
    return filtered;
  }, [list, selectedMonths, selectedRecordDates, selectedCreators]);

  const searchedList = useMemo(() => {
    if (!searchQuery.trim()) return filteredList;
    if (!fullDataLoaded) return filteredList; // 搜索 pending，等加载完成
    const q = searchQuery.trim().toLowerCase();
    return filteredList.filter(inv =>
      (inv.documentNo || '').toLowerCase().includes(q) ||
      (inv.supplierName || '').toLowerCase().includes(q)
    );
  }, [filteredList, searchQuery, fullDataLoaded]);

  const filterOptions = useMemo(() => {
    const months = new Set<string>();
    const recordDates = new Set<string>();
    const creators = new Map<string, string>();
    list.forEach(inv => {
      try {
        const d = parseLocalDate(inv.date);
        months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      } catch {}
      if (inv.createdAt) {
        const d = new Date(inv.createdAt);
        recordDates.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      }
      const id = inv.createdBy || 'unknown';
      if (!creators.has(id)) {
        const invAny = inv as any;
        const name = invAny.createdByUser?.name ?? invAny.createdByUser?.email?.split('@')[0] ?? (inv.createdBy ? `${inv.createdBy.slice(0, 8)}…` : 'Unknown');
        creators.set(id, name);
      }
    });
    return {
      months: Array.from(months).sort((a, b) => b.localeCompare(a)).map(k => {
        const [y, m] = k.split('-');
        return { key: k, label: format(new Date(parseInt(y), parseInt(m) - 1), 'MMMM yyyy') };
      }),
      recordDates: Array.from(recordDates).sort((a, b) => b.localeCompare(a)).map(k => {
        const [y, m, d] = k.split('-');
        return { key: k, label: format(new Date(parseInt(y), parseInt(m) - 1, parseInt(d)), 'MMM dd, yyyy') };
      }),
      creators: Array.from(creators.entries()).map(([id, name]) => ({ id, name })),
    };
  }, [list]);

  const sections = getGroupedList(searchedList);

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const inboundColumns = useMemo(() => getInboundColumns({ formatDate, formatTimeAgo, statusLabels, statusColors }), [formatDate, formatTimeAgo, statusLabels, statusColors]);

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
      const confirmed = dataForStats.filter((inv: Inbound) => inv.status === 'confirmed');
      const currencies = confirmed.map((r: Inbound) => r.currency || 'USD');
      const dominantCurrency = currencies.length > 0
        ? (currencies.sort((a: string, b: string) =>
            currencies.filter((v: string) => v === a).length - currencies.filter((v: string) => v === b).length
          ).pop() as string)
        : 'USD';
      const totalAmount = confirmed.reduce((sum: number, r: Inbound) => sum + (r.totalAmount ?? 0), 0);
      return {
        title: s.title,
        data: s.data,
        count: confirmed.length,
        countLabel: 'inbounds',
        totalAmount,
        currency: dominantCurrency,
        amountColor: '#6C5CE7',
      };
    });
    const col = sortKey ? inboundColumns.find(c => c.id === sortKey) : null;
    if (!col?.getSortValue) return base;
    return base.map(sec => ({ ...sec, data: sortRowsByColumn(sec.data, col, sortDirection) }));
  }, [sections, sortKey, sortDirection, inboundColumns, sortRowsByColumn]);

  const allSectionForTable = useMemo(() => {
    const dataForStats = sortedDataForTable;
    const confirmed = dataForStats.filter((inv: Inbound) => inv.status === 'confirmed');
    const currencies = confirmed.map((r: Inbound) => r.currency || 'USD');
    const dominantCurrency = currencies.length > 0
      ? (currencies.sort((a: string, b: string) =>
          currencies.filter((v: string) => v === a).length - currencies.filter((v: string) => v === b).length
        ).pop() as string)
      : 'USD';
    const totalAmount = confirmed.reduce((sum: number, r: Inbound) => sum + (r.totalAmount ?? 0), 0);
    return [{
      title: 'All',
      data: sortedDataForTable,
      count: confirmed.length,
      countLabel: 'inbounds',
      totalAmount,
      currency: dominantCurrency,
      amountColor: '#6C5CE7',
    }];
  }, [sortedDataForTable]);

  const sortedDataForTable = useMemo(() => {
    if (groupBy !== 'none') return searchedList;
    const col = sortKey ? inboundColumns.find(c => c.id === sortKey) : null;
    return sortRowsByColumn(searchedList, col, sortDirection);
  }, [groupBy, searchedList, sortKey, sortDirection, inboundColumns, sortRowsByColumn]);

  const tableEmptyMessage = useMemo(() => {
    const loadInProgress = loading || refreshing || !fullDataLoaded;
    if (loadInProgress && searchedList.length === 0) return refreshing ? '' : 'Loading...';
    if (list.length === 0) return 'No inbounds yet';
    if (searchedList.length === 0) return 'No search result';
    return 'No data';
  }, [loading, refreshing, fullDataLoaded, searchedList.length, list.length]);

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
        const el = document.getElementById('inbound-group-button');
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
        const el = document.getElementById('inbound-filter-button');
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
      const groupBtn = document.getElementById('inbound-group-button');
      const groupPopover = document.getElementById('inbound-group-popover');
      const filterBtn = document.getElementById('inbound-filter-button');
      const filterPopover = document.getElementById('inbound-filter-popover');
      if (showSortMenu && groupBtn && !groupBtn.contains(target) && groupPopover && !groupPopover.contains(target)) setShowSortMenu(false);
      if (showFilterMenu && filterBtn && !filterBtn.contains(target) && filterPopover && !filterPopover.contains(target)) {
        setShowFilterMenu(false);
        setFilterSubMenu('main');
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [showSortMenu, showFilterMenu]);

  if (!showAiInventory) return null;

  const hasSelection = selectedIds.size > 0;
  return (
    <View style={styles.container}>
      <View style={styles.toolbarSlot}>
        {hasSelection ? (
          <View style={styles.bulkBar}>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setSelectedIds(new Set())}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <View style={styles.selectedCountContainer}>
              <Text style={styles.selectedCountText}>{selectedIds.size} selected</Text>
            </View>
            <TouchableOpacity style={styles.deleteButton} onPress={handleBatchDelete}>
              <Ionicons name="trash-outline" size={20} color="#fff" />
              <Text style={styles.deleteButtonText}>Delete</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View {...(isDesktopWeb ? { nativeID: 'inbound-group-button' } : {})}>
                <TouchableOpacity style={styles.sortButton} onPress={() => setShowSortMenu(true)}>
                  {groupBy === 'none' && <Ionicons name="list-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
                  {groupBy === 'month' && <Ionicons name="calendar-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
                  {groupBy === 'recordDate' && <Ionicons name="time-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
                  {groupBy === 'createdBy' && <Ionicons name="person-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
                  {groupBy === 'sender' && <Ionicons name="storefront-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />}
                  <Text style={styles.sortText}>Group</Text>
                  <Ionicons name="chevron-down" size={16} color="#636E72" />
                </TouchableOpacity>
              </View>
              <View {...(isDesktopWeb ? { nativeID: 'inbound-filter-button' } : {})}>
                <TouchableOpacity style={styles.filterButton} onPress={() => { setShowFilterMenu(true); setFilterSubMenu('main'); }}>
                  <Text style={styles.filterText}>
                    Filter
                    {(selectedMonths.size + selectedRecordDates.size + selectedCreators.size) > 0 && (
                      <Text style={styles.filterBadge}> ({selectedMonths.size + selectedRecordDates.size + selectedCreators.size})</Text>
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
          contentContainerStyle={loading && list.length === 0 ? { flexGrow: 1 } : { flexGrow: 0 }}
        >
          {(loading && list.length === 0) ? (
            <View style={styles.emptyContainer}>
              <ActivityIndicator size="large" color="#6C5CE7" />
              <Text style={styles.emptyText}>Loading...</Text>
            </View>
          ) : (
            <DataTable<Inbound>
              columns={inboundColumns}
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
              onRowPress={r => { if (r.id) router.push(`/inbound-details/${r.id}`); }}
              emptyMessage={tableEmptyMessage}
              storageKey="inbound-table"
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
        keyExtractor={(item: Inbound) => item.id || Math.random().toString()}
        renderItem={({ item }) => {
          const isSelected = item.id ? selectedIds.has(item.id) : false;
          const isSelectionMode = selectedIds.size > 0;
          return (
            <SwipeableRow onDelete={() => item.id && handleDeleteSingle(item.id)} disabled={isSelectionMode}>
              <TouchableOpacity
                style={[styles.receiptItem, isSelected && styles.receiptItemSelected]}
                onPress={() => {
                  if (isSelectionMode) {
                    if (item.id) handleToggleSelect(item.id);
                  } else {
                    router.push(`/inbound-details/${item.id}`);
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
                      {(item as any).entity?.name || item.supplierName || item.documentNo || '—'}
                    </Text>
                    {item.status === 'confirmed' ? (
                      <View style={styles.confirmedStatusContainer}>
                        <View style={styles.confirmedBadge}>
                          <Ionicons name={inputTypeConfirmBadgeIonicon(item.inputType)} size={12} color="#fff" />
                        </View>
                      </View>
                    ) : (
                      <View style={[styles.statusBadge, { backgroundColor: statusColors[item.status] }]}>
                        <Text style={styles.statusText}>{statusLabels[item.status]}</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.secondRow}>
                    {item.totalAmount != null && (
                      <AmountText amount={Number(item.totalAmount)} currency={item.currency} style={styles.amount} />
                    )}
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
          const confirmed = dataForStats.filter((inv: Inbound) => inv.status === 'confirmed');
          const dominantCurrency = confirmed.length
            ? (confirmed.map((r: Inbound) => r.currency || 'USD').sort((a: string, b: string) =>
                confirmed.filter((v: Inbound) => (v.currency || 'USD') === a).length -
                confirmed.filter((v: Inbound) => (v.currency || 'USD') === b).length
              ).pop())
            : 'USD';
          const totalAmount = confirmed.reduce((sum: number, r: Inbound) => sum + (r.totalAmount ?? 0), 0);
          return (
            <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection(section.monthKey)} activeOpacity={0.7}>
              <View style={styles.sectionHeaderContent}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <View style={styles.sectionHeaderRight}>
                  <Text style={styles.sectionCount}>{confirmed.length} inbounds</Text>
                  {totalAmount > 0 && (
                    <AmountText amount={totalAmount} currency={dominantCurrency} style={styles.sectionAmount} />
                  )}
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
            if (refreshing) return <View style={styles.emptyContainer} />;
            return (
              <View style={styles.emptyContainer}>
                <ActivityIndicator size="large" color="#6C5CE7" />
                <Text style={styles.emptyText}>Loading...</Text>
              </View>
            );
          }
          if (list.length === 0) {
            return (
              <View style={styles.emptyContainer}>
                <Ionicons name="arrow-down-circle-outline" size={64} color="#BDC3C7" />
                <Text style={styles.emptyText}>No inbound yet</Text>
                <Text style={styles.emptySubtext}>Open the chat bubble to add an inbound</Text>
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

      <Modal animationType="fade" transparent visible={showSuccessModal} onRequestClose={() => setShowSuccessModal(false)}>
        <View style={styles.successModalOverlay}>
          <View style={styles.successModalContent}>
            <View style={styles.successIconContainer}>
              <Ionicons name="checkmark-circle" size={64} color="#00B894" />
            </View>
            <Text style={styles.successTitle}>已提交</Text>
            <Text style={styles.successSubtitle}>入库单正在识别中</Text>
            <View style={styles.successButtons}>
              <TouchableOpacity style={styles.successButton} onPress={() => { setShowSuccessModal(false); scanDocument(); }}>
                <Ionicons name="camera-outline" size={24} color="#6C5CE7" />
                <Text style={styles.successButtonText}>再拍一张</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.successButton, !lastInboundId && { opacity: 0.5 }]}
                disabled={!lastInboundId}
                onPress={() => {
                  setShowSuccessModal(false);
                  if (lastInboundId) router.push(`/inbound-details/${lastInboundId}`);
                }}
              >
                {lastInboundId ? <Ionicons name="eye-outline" size={24} color="#6C5CE7" /> : <ActivityIndicator size="small" color="#6C5CE7" />}
                <Text style={styles.successButtonText}>{lastInboundId ? '查看详情' : '上传中...'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.successButton} onPress={() => setShowSuccessModal(false)}>
                <Ionicons name="checkmark-outline" size={24} color="#6C5CE7" />
                <Text style={styles.successButtonText}>完成</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
              {(['none', 'month', 'recordDate', 'sender', 'createdBy'] as const).map((key) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.pickerOption, groupBy === key && styles.pickerOptionSelected]}
                  onPress={() => { setGroupBy(key); setShowSortMenu(false); }}
                >
                  {key === 'none' && <Ionicons name="list-outline" size={20} color={groupBy === key ? '#6C5CE7' : '#636E72'} style={{ marginRight: 12 }} />}
                  {key === 'month' && <Ionicons name="calendar-outline" size={20} color={groupBy === key ? '#6C5CE7' : '#636E72'} style={{ marginRight: 12 }} />}
                  {key === 'recordDate' && <Ionicons name="time-outline" size={20} color={groupBy === key ? '#6C5CE7' : '#636E72'} style={{ marginRight: 12 }} />}
                  {key === 'sender' && <Ionicons name="storefront-outline" size={20} color={groupBy === key ? '#6C5CE7' : '#636E72'} style={{ marginRight: 12 }} />}
                  {key === 'createdBy' && <Ionicons name="person-outline" size={20} color={groupBy === key ? '#6C5CE7' : '#636E72'} style={{ marginRight: 12 }} />}
                  <Text style={[styles.pickerOptionText, groupBy === key && styles.pickerOptionTextSelected, { flex: 1 }]}>
                    {key === 'none' && 'No group'}
                    {key === 'month' && 'Transaction Month'}
                    {key === 'recordDate' && 'Record Date'}
                    {key === 'sender' && 'Sender'}
                    {key === 'createdBy' && 'Recorder'}
                  </Text>
                  {groupBy === key && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
      )}

      {!isDesktopWeb && (
      <Modal visible={showFilterMenu} transparent animationType="slide" onRequestClose={() => { setShowFilterMenu(false); setFilterSubMenu('main'); }}>
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => { setShowFilterMenu(false); setFilterSubMenu('main'); }}>
          <View style={styles.pickerBottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              {filterSubMenu !== 'main' ? (
                <>
                  <TouchableOpacity onPress={() => setFilterSubMenu('main')} style={styles.pickerBackButton}>
                    <Ionicons name="chevron-back" size={20} color="#6C5CE7" />
                  </TouchableOpacity>
                  <Text style={styles.pickerTitle}>
                    {filterSubMenu === 'month' && 'Select Transaction Months'}
                    {filterSubMenu === 'recordDate' && 'Select Record Dates'}
                    {filterSubMenu === 'creator' && 'Select Recorders'}
                  </Text>
                  <TouchableOpacity onPress={() => setFilterSubMenu('main')} style={styles.pickerCloseButton}>
                    <Text style={styles.pickerCloseText}>Done</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.pickerTitle}>Filter</Text>
                  <View style={styles.pickerHeaderRight}>
                    {(selectedMonths.size > 0 || selectedRecordDates.size > 0 || selectedCreators.size > 0) && (
                      <TouchableOpacity onPress={() => { setSelectedMonths(new Set()); setSelectedRecordDates(new Set()); setSelectedCreators(new Set()); }} style={styles.clearFilterButton}>
                        <Text style={styles.clearFilterText}>Clear</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => { setShowFilterMenu(false); setFilterSubMenu('main'); }} style={styles.pickerCloseButton}>
                      <Text style={styles.pickerCloseText}>Done</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
            <ScrollView style={styles.pickerScrollView} showsVerticalScrollIndicator={false}>
              {filterSubMenu === 'main' && (
                <>
                  <TouchableOpacity style={styles.filterMainOption} onPress={() => setFilterSubMenu('month')}>
                    <View style={styles.filterMainOptionLeft}>
                      <Ionicons name="calendar-outline" size={20} color="#636E72" />
                      <Text style={styles.filterMainOptionText}>Transaction Month</Text>
                    </View>
                    <View style={styles.filterMainOptionRight}>
                      {selectedMonths.size > 0 && <Text style={styles.filterCountBadge}>{selectedMonths.size}</Text>}
                      <Ionicons name="chevron-forward" size={20} color="#95A5A6" />
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.filterMainOption} onPress={() => setFilterSubMenu('recordDate')}>
                    <View style={styles.filterMainOptionLeft}>
                      <Ionicons name="time-outline" size={20} color="#636E72" />
                      <Text style={styles.filterMainOptionText}>Record Date</Text>
                    </View>
                    <View style={styles.filterMainOptionRight}>
                      {selectedRecordDates.size > 0 && <Text style={styles.filterCountBadge}>{selectedRecordDates.size}</Text>}
                      <Ionicons name="chevron-forward" size={20} color="#95A5A6" />
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.filterMainOption} onPress={() => setFilterSubMenu('creator')}>
                    <View style={styles.filterMainOptionLeft}>
                      <Ionicons name="person-outline" size={20} color="#636E72" />
                      <Text style={styles.filterMainOptionText}>Recorder</Text>
                    </View>
                    <View style={styles.filterMainOptionRight}>
                      {selectedCreators.size > 0 && <Text style={styles.filterCountBadge}>{selectedCreators.size}</Text>}
                      <Ionicons name="chevron-forward" size={20} color="#95A5A6" />
                    </View>
                  </TouchableOpacity>
                </>
              )}
              {filterSubMenu === 'month' && filterOptions.months.map((m) => {
                const isSelected = selectedMonths.has(m.key);
                return (
                  <TouchableOpacity key={m.key} style={[styles.pickerOption, isSelected && styles.pickerOptionSelected]} onPress={() => setSelectedMonths(prev => { const s = new Set(prev); if (s.has(m.key)) s.delete(m.key); else s.add(m.key); return s; })}>
                    <View style={styles.filterOptionLeft}>
                      <View style={[styles.filterCheckbox, isSelected && styles.filterCheckboxSelected]}>
                        {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                      </View>
                      <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected]}>{m.label}</Text>
                    </View>
                    {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                  </TouchableOpacity>
                );
              })}
              {filterSubMenu === 'recordDate' && filterOptions.recordDates.map((d) => {
                const isSelected = selectedRecordDates.has(d.key);
                return (
                  <TouchableOpacity key={d.key} style={[styles.pickerOption, isSelected && styles.pickerOptionSelected]} onPress={() => setSelectedRecordDates(prev => { const s = new Set(prev); if (s.has(d.key)) s.delete(d.key); else s.add(d.key); return s; })}>
                    <View style={styles.filterOptionLeft}>
                      <View style={[styles.filterCheckbox, isSelected && styles.filterCheckboxSelected]}>
                        {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                      </View>
                      <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected]}>{d.label}</Text>
                    </View>
                    {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                  </TouchableOpacity>
                );
              })}
              {filterSubMenu === 'creator' && filterOptions.creators.map((c) => {
                const isSelected = selectedCreators.has(c.id);
                return (
                  <TouchableOpacity key={c.id} style={[styles.pickerOption, isSelected && styles.pickerOptionSelected]} onPress={() => setSelectedCreators(prev => { const s = new Set(prev); if (s.has(c.id)) s.delete(c.id); else s.add(c.id); return s; })}>
                    <View style={styles.filterOptionLeft}>
                      <View style={[styles.filterCheckbox, isSelected && styles.filterCheckboxSelected]}>
                        {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                      </View>
                      <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected]}>{c.name}</Text>
                    </View>
                    {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
      )}

      {isDesktopWeb && showSortMenu && groupPopoverRect && typeof document !== 'undefined' && document.body && createPortal(
        <div id="inbound-group-popover" style={{ ...WEB_POPOVER.container, left: groupPopoverRect.left, top: groupPopoverRect.top }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#495057', marginBottom: 10 }}>Group By</Text>
          <View style={{ gap: 2 }}>
            {[
              { key: 'none' as const, label: 'No group', icon: 'list-outline' as const },
              { key: 'month' as const, label: 'Transaction Month', icon: 'calendar-outline' as const },
              { key: 'recordDate' as const, label: 'Record Date', icon: 'time-outline' as const },
              { key: 'sender' as const, label: 'Sender', icon: 'storefront-outline' as const },
              { key: 'createdBy' as const, label: 'Recorder', icon: 'person-outline' as const },
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

      {isDesktopWeb && showFilterMenu && filterPopoverRect && typeof document !== 'undefined' && document.body && createPortal(
        <div id="inbound-filter-popover" style={{ ...WEB_POPOVER.container, ...WEB_POPOVER.containerWide, left: filterPopoverRect.left, top: filterPopoverRect.top }}>
          <View style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {filterSubMenu !== 'main' ? (
              <>
                <TouchableOpacity onPress={() => setFilterSubMenu('main')} style={{ padding: 4 }}><Ionicons name="chevron-back" size={20} color="#6C5CE7" /></TouchableOpacity>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#495057' }}>
                  {filterSubMenu === 'month' && 'Transaction Month'}
                  {filterSubMenu === 'recordDate' && 'Record Date'}
                  {filterSubMenu === 'creator' && 'Recorder'}
                </Text>
              </>
            ) : (
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#495057' }}>Filter</Text>
            )}
            {(selectedMonths.size > 0 || selectedRecordDates.size > 0 || selectedCreators.size > 0) && (
              <TouchableOpacity onPress={() => { setSelectedMonths(new Set()); setSelectedRecordDates(new Set()); setSelectedCreators(new Set()); }} style={{ padding: 4 }}>
                <Text style={{ fontSize: 13, color: '#6C5CE7' }}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
          {filterSubMenu === 'main' && (
            <>
              <TouchableOpacity style={[styles.filterMainOption, { marginBottom: 6, minHeight: 40, lineHeight: 20 }]} onPress={() => setFilterSubMenu('month')}>
                <View style={styles.filterMainOptionLeft}>
                  <Ionicons name="calendar-outline" size={20} color="#636E72" />
                  <Text style={[styles.filterMainOptionText, { fontSize: 13, lineHeight: 20 }]}>Transaction Month</Text>
                </View>
                <View style={styles.filterMainOptionRight}>
                  {selectedMonths.size > 0 && <Text style={[styles.filterCountBadge, { fontSize: 12 }]}>{selectedMonths.size}</Text>}
                  <Ionicons name="chevron-forward" size={20} color="#95A5A6" />
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.filterMainOption, { marginBottom: 6, minHeight: 40, lineHeight: 20 }]} onPress={() => setFilterSubMenu('recordDate')}>
                <View style={styles.filterMainOptionLeft}>
                  <Ionicons name="time-outline" size={20} color="#636E72" />
                  <Text style={[styles.filterMainOptionText, { fontSize: 13, lineHeight: 20 }]}>Record Date</Text>
                </View>
                <View style={styles.filterMainOptionRight}>
                  {selectedRecordDates.size > 0 && <Text style={[styles.filterCountBadge, { fontSize: 12 }]}>{selectedRecordDates.size}</Text>}
                  <Ionicons name="chevron-forward" size={20} color="#95A5A6" />
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.filterMainOption, { marginBottom: 6, minHeight: 40, lineHeight: 20 }]} onPress={() => setFilterSubMenu('creator')}>
                <View style={styles.filterMainOptionLeft}>
                  <Ionicons name="person-outline" size={20} color="#636E72" />
                  <Text style={[styles.filterMainOptionText, { fontSize: 13, lineHeight: 20 }]}>Recorder</Text>
                </View>
                <View style={styles.filterMainOptionRight}>
                  {selectedCreators.size > 0 && <Text style={[styles.filterCountBadge, { fontSize: 12 }]}>{selectedCreators.size}</Text>}
                  <Ionicons name="chevron-forward" size={20} color="#95A5A6" />
                </View>
              </TouchableOpacity>
            </>
          )}
          {filterSubMenu === 'month' && filterOptions.months.map((m) => {
            const isSelected = selectedMonths.has(m.key);
            return (
              <TouchableOpacity key={m.key} style={[styles.pickerOption, isSelected && styles.pickerOptionSelected, { minHeight: 40, lineHeight: 20 }]} onPress={() => setSelectedMonths(prev => { const s = new Set(prev); if (s.has(m.key)) s.delete(m.key); else s.add(m.key); return s; })}>
                <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected, { fontSize: 13, lineHeight: 20 }]}>{m.label}</Text>
                {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
              </TouchableOpacity>
            );
          })}
          {filterSubMenu === 'recordDate' && filterOptions.recordDates.map((d) => {
            const isSelected = selectedRecordDates.has(d.key);
            return (
              <TouchableOpacity key={d.key} style={[styles.pickerOption, isSelected && styles.pickerOptionSelected, { minHeight: 40, lineHeight: 20 }]} onPress={() => setSelectedRecordDates(prev => { const s = new Set(prev); if (s.has(d.key)) s.delete(d.key); else s.add(d.key); return s; })}>
                <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected, { fontSize: 13, lineHeight: 20 }]}>{d.label}</Text>
                {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
              </TouchableOpacity>
            );
          })}
          {filterSubMenu === 'creator' && filterOptions.creators.map((c) => {
            const isSelected = selectedCreators.has(c.id);
            return (
              <TouchableOpacity key={c.id} style={[styles.pickerOption, isSelected && styles.pickerOptionSelected, { minHeight: 40, lineHeight: 20 }]} onPress={() => setSelectedCreators(prev => { const s = new Set(prev); if (s.has(c.id)) s.delete(c.id); else s.add(c.id); return s; })}>
                <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected, { fontSize: 13, lineHeight: 20 }]}>{c.name}</Text>
                {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
              </TouchableOpacity>
            );
          })}
        </div>,
        document.body
      )}
    </View>
  );
}

