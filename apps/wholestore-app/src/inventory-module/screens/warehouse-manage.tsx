import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Modal,
  Platform,
  Animated,
  KeyboardAvoidingView,
  Keyboard,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import {
  getWarehouses,
  getLocationsByWarehouse,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
  createLocation,
  updateLocation,
  deleteLocation,
  mergeWarehouses,
  unmergeWarehouse,
  getWarehousesForMergeHistory,
  getWarehouseUsageCounts,
  type WarehousesMergeHistoryData,
  type WarehouseUsageCounts,
} from '@/lib/warehouse';
import { Warehouse, Location } from '@/types';
import { GradientText } from '@/lib/GradientText';
import { actionButtonStyles } from '@/lib/action-button-styles';
import { confirmDestructive } from '@/lib/alertWeb';

export default function WarehouseManageScreen() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locationsByWh, setLocationsByWh] = useState<Record<string, Location[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [whModal, setWhModal] = useState<'add' | 'edit' | null>(null);
  const [locModal, setLocModal] = useState<{ whId: string } | null>(null);
  const [whId, setWhId] = useState<string | null>(null);
  const [whName, setWhName] = useState('');
  const [whCode, setWhCode] = useState('');
  const [whAddress, setWhAddress] = useState('');
  const [locName, setLocName] = useState('');
  const [locCode, setLocCode] = useState('');
  const [locEditId, setLocEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedWarehouseIds, setSelectedWarehouseIds] = useState<Set<string>>(new Set());
  const [mergeHistoryData, setMergeHistoryData] = useState<WarehousesMergeHistoryData | null>(null);
  const [usageCounts, setUsageCounts] = useState<WarehouseUsageCounts | null>(null);
  const [expandedRootIds, setExpandedRootIds] = useState<Set<string>>(new Set());
  const [showQuickCleanModal, setShowQuickCleanModal] = useState(false);
  const [showMergeTargetModal, setShowMergeTargetModal] = useState(false);
  const [mergeTargetModalAccounts, setMergeTargetModalAccounts] = useState<Warehouse[] | null>(null);
  const [mergeTargetSelectedId, setMergeTargetSelectedId] = useState<string | null>(null);
  const [showDeleteSelectedModal, setShowDeleteSelectedModal] = useState(false);
  const [deleteSelectedModalAccounts, setDeleteSelectedModalAccounts] = useState<Warehouse[] | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newWhName, setNewWhName] = useState('');
  const [newWhCode, setNewWhCode] = useState('');
  const [newWhAddress, setNewWhAddress] = useState('');
  const [showAddLocFormForWhId, setShowAddLocFormForWhId] = useState<string | null>(null);
  const [newLocName, setNewLocName] = useState('');
  const [newLocCode, setNewLocCode] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView>(null);
  const newWhNameInputRef = useRef<TextInput>(null);
  const newLocNameInputRef = useRef<TextInput>(null);
  const scrollContentRef = useRef<View>(null);
  const addFormCardRef = useRef<View>(null);
  const HEADER_HEIGHT_PX = 88;

  const showToast = (message: string, duration: number = 1500) => {
    setToastMessage(message);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(duration),
      Animated.timing(toastOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setToastMessage(null));
  };

  const load = async () => {
    try {
      const list = await getWarehouses();
      const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
      setWarehouses(sorted);
      const map: Record<string, Location[]> = {};
      for (const w of sorted) {
        map[w.id] = await getLocationsByWarehouse(w.id);
      }
      setLocationsByWh(map);
    } catch (e) {
      console.error('Load warehouse error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, []));

  useEffect(() => {
    if (showAddForm) {
      const t = setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
        newWhNameInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(t);
    }
  }, [showAddForm]);

  useEffect(() => {
    if (showAddLocFormForWhId) {
      const t = setTimeout(() => newLocNameInputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [showAddLocFormForWhId]);

  useEffect(() => {
    if (!showAddForm) return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subShow = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      setTimeout(() => {
        addFormCardRef.current?.measureLayout(
          scrollContentRef.current as any,
          (_x: number, y: number) => {
            scrollViewRef.current?.scrollTo({
              y: Math.max(0, y - HEADER_HEIGHT_PX),
              animated: true,
            });
          }
        );
      }, 150);
    });
    const subHide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [showAddForm]);

  const openAddWh = () => {
    setShowAddForm(true);
    setNewWhName('');
    setNewWhCode('');
    setNewWhAddress('');
  };

  const handleAddWarehouse = async () => {
    if (!newWhName.trim()) {
      showToast('Please enter warehouse name');
      return;
    }
    setSaving(true);
    try {
      await createWarehouse({ name: newWhName.trim(), code: newWhCode.trim() || undefined, address: newWhAddress.trim() || undefined });
      setShowAddForm(false);
      setNewWhName('');
      setNewWhCode('');
      setNewWhAddress('');
      load();
      showToast('Warehouse created');
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to create');
    } finally {
      setSaving(false);
    }
  };

  const openEditWh = (w: Warehouse) => {
    setWhId(w.id);
    setWhName(w.name);
    setWhCode(w.code || '');
    setWhAddress(w.address || '');
    setWhModal('edit');
  };

  const saveWh = async () => {
    if (!whName.trim()) return;
    setSaving(true);
    try {
      if (whId) {
        await updateWarehouse(whId, { name: whName.trim(), code: whCode.trim() || undefined, address: whAddress.trim() || undefined });
      } else {
        await createWarehouse({ name: whName.trim(), code: whCode.trim() || undefined, address: whAddress.trim() || undefined });
      }
      setWhModal(null);
      load();
      showToast(whId ? 'Warehouse updated' : 'Warehouse created');
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const removeWh = (w: Warehouse) => {
    confirmDestructive('Delete warehouse', `Delete "${w.name}"? Its locations will be removed.`, async () => {
      try {
        await deleteWarehouse(w.id);
        load();
        showToast('Warehouse deleted');
      } catch (e: any) {
        showToast(e?.message ?? 'Failed to delete');
      }
    }, { confirmLabel: 'Delete' });
  };

  const openAddLoc = (warehouseId: string) => {
    setShowAddLocFormForWhId(warehouseId);
    setNewLocName('');
    setNewLocCode('');
  };

  const openEditLoc = (warehouseId: string, loc: Location) => {
    setLocModal({ whId: warehouseId });
    setLocEditId(loc.id);
    setLocName(loc.name);
    setLocCode(loc.code || '');
  };

  const saveLoc = async () => {
    if (!locModal?.whId || !locName.trim()) return;
    setSaving(true);
    try {
      await updateLocation(locEditId!, { name: locName.trim(), code: locCode.trim() || undefined });
      setLocModal(null);
      load();
      showToast('Location updated');
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddLocation = async () => {
    if (!showAddLocFormForWhId || !newLocName.trim()) return;
    setSaving(true);
    try {
      await createLocation({ warehouseId: showAddLocFormForWhId, name: newLocName.trim(), code: newLocCode.trim() || undefined });
      setShowAddLocFormForWhId(null);
      setNewLocName('');
      setNewLocCode('');
      load();
      showToast('Location created');
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const removeLoc = (loc: Location) => {
    confirmDestructive('Delete location', `Delete "${loc.name}"?`, async () => {
      try {
        await deleteLocation(loc.id);
        load();
        showToast('Location deleted');
      } catch (e: any) {
        showToast(e?.message ?? 'Failed to delete');
      }
    }, { confirmLabel: 'Delete' });
  };

  const toggleWarehouseSelection = (warehouseId: string) => {
    const next = new Set(selectedWarehouseIds);
    if (next.has(warehouseId)) next.delete(warehouseId);
    else next.add(warehouseId);
    setSelectedWarehouseIds(next);
  };

  const handleStartMerge = async () => {
    setMergeMode(true);
    setSelectedWarehouseIds(new Set());
    setWhModal(null);
    setLocModal(null);
    setShowAddLocFormForWhId(null);
    setExpandedRootIds(new Set());
    try {
      const [historyData, counts] = await Promise.all([
        getWarehousesForMergeHistory(),
        getWarehouseUsageCounts(),
      ]);
      setMergeHistoryData(historyData);
      setUsageCounts(counts);
    } catch (e: any) {
      console.error('Error loading merge data:', e);
      showToast(e?.message ?? 'Failed to load merge data');
    }
  };

  const handleCancelMerge = () => {
    setMergeMode(false);
    setSelectedWarehouseIds(new Set());
    setMergeHistoryData(null);
    setUsageCounts(null);
    setExpandedRootIds(new Set());
  };

  const directUsage = (id: string) => usageCounts?.usageCountByWarehouseId[id] ?? 0;
  const totalCount = (root: Warehouse, children: Warehouse[]) =>
    directUsage(root.id) + children.reduce((s, c) => s + directUsage(c.id), 0);
  const directCount = (id: string) => directUsage(id);

  /** 与非 merge 一致：按直接用量降序、名称升序（无 usageCounts 时按名称） */
  const sortedMergeDisplayRoots = (() => {
    const arr = mergeHistoryData?.roots ?? warehouses;
    return [...arr].sort((a, b) => {
      const ua = directUsage(a.id);
      const ub = directUsage(b.id);
      if (ub !== ua) return ub - ua;
      return a.name.localeCompare(b.name);
    });
  })();

  const cleanableRoots = (() => {
    if (!mergeHistoryData || !usageCounts) return [];
    return mergeHistoryData.roots.filter((root) => {
      const children = mergeHistoryData.childrenByRootId.get(root.id) ?? [];
      const hasUsage = directUsage(root.id) > 0;
      const hasChildUsage = children.some((c) => directUsage(c.id) > 0);
      const hasChildren = children.length > 0;
      return !hasUsage && !hasChildUsage && !hasChildren;
    });
  })();

  const handleCleanEmpty = () => {
    if (cleanableRoots.length === 0) {
      showToast('No empty warehouses to clean.');
      return;
    }
    setShowQuickCleanModal(true);
  };

  const doQuickCleanConfirm = async () => {
    if (cleanableRoots.length === 0) return;
    setShowQuickCleanModal(false);
    try {
      for (const root of cleanableRoots) {
        await deleteWarehouse(root.id);
      }
      await load();
      const [historyData, counts] = await Promise.all([
        getWarehousesForMergeHistory(),
        getWarehouseUsageCounts(),
      ]);
      setMergeHistoryData(historyData);
      setUsageCounts(counts);
      showToast(`Cleaned ${cleanableRoots.length} empty warehouse(s).`);
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to clean');
    }
  };

  const setMergeTargetSelection = (warehouseId: string) => setMergeTargetSelectedId(warehouseId);
  const confirmMergeTarget = () => {
    if (!mergeTargetSelectedId) return;
    const sourceIds = Array.from(selectedWarehouseIds).filter((id) => id !== mergeTargetSelectedId);
    setShowMergeTargetModal(false);
    setMergeTargetModalAccounts(null);
    setMergeTargetSelectedId(null);
    performMerge(sourceIds, mergeTargetSelectedId);
  };

  const handleConfirmMerge = () => {
    if (selectedWarehouseIds.size < 2) {
      showToast('Please select at least 2 warehouses to merge');
      return;
    }
    const allInMerge = mergeHistoryData
      ? [...mergeHistoryData.roots, ...Array.from(mergeHistoryData.childrenByRootId.values()).flat()]
      : [];
    const selected = allInMerge.filter((w) => selectedWarehouseIds.has(w.id));
    setMergeTargetModalAccounts(selected);
    setMergeTargetSelectedId(null);
    setShowMergeTargetModal(true);
  };

  const performMerge = async (sourceWarehouseIds: string[], targetWarehouseId: string) => {
    try {
      await mergeWarehouses(sourceWarehouseIds, targetWarehouseId);
      await load();
      const [historyData, counts] = await Promise.all([
        getWarehousesForMergeHistory(),
        getWarehouseUsageCounts(),
      ]);
      setMergeHistoryData(historyData);
      setUsageCounts(counts);
      setSelectedWarehouseIds(new Set());
      setExpandedRootIds(new Set());
      showToast('Warehouses merged successfully');
    } catch (error: any) {
      console.error('Error merging warehouses:', error);
      showToast(error.message || 'Failed to merge warehouses');
    }
  };

  const handleUnmerge = async (childId: string) => {
    try {
      await unmergeWarehouse(childId);
      await load();
      const [historyData, counts] = await Promise.all([
        getWarehousesForMergeHistory(),
        getWarehouseUsageCounts(),
      ]);
      setMergeHistoryData(historyData);
      setUsageCounts(counts);
      setSelectedWarehouseIds((prev) => {
        const next = new Set(prev);
        next.delete(childId);
        return next;
      });
      showToast('Unmerged');
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to unmerge');
    }
  };

  const handleDeleteSelected = () => {
    if (selectedWarehouseIds.size === 0) return;
    const allInMerge = mergeHistoryData
      ? [...mergeHistoryData.roots, ...Array.from(mergeHistoryData.childrenByRootId.values()).flat()]
      : [];
    const selected = allInMerge.filter((w) => selectedWarehouseIds.has(w.id));
    setDeleteSelectedModalAccounts(selected);
    setShowDeleteSelectedModal(true);
  };

  const doDeleteSelectedConfirm = async () => {
    const selected = deleteSelectedModalAccounts;
    setShowDeleteSelectedModal(false);
    setDeleteSelectedModalAccounts(null);
    if (!selected || selected.length === 0) return;
    try {
      for (const w of selected) {
        await deleteWarehouse(w.id);
      }
      await load();
      const [historyData, counts] = await Promise.all([
        getWarehousesForMergeHistory(),
        getWarehouseUsageCounts(),
      ]);
      setMergeHistoryData(historyData);
      setUsageCounts(counts);
      setSelectedWarehouseIds(new Set());
      showToast(`Deleted ${selected.length} warehouse(s).`);
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to delete');
    }
  };

  const toggleExpand = (rootId: string) => {
    setExpandedRootIds((prev) => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId);
      else next.add(rootId);
      return next;
    });
  };

  if (loading && warehouses.length === 0 && !mergeMode) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6C5CE7" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      {toastMessage && (
        <Animated.View style={[styles.toastWrapper, { opacity: toastOpacity }]} pointerEvents="none">
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toastMessage}</Text>
          </View>
        </Animated.View>
      )}

      {/* Quick Clean */}
      <Modal visible={showQuickCleanModal} transparent animationType="fade" onRequestClose={() => setShowQuickCleanModal(false)}>
        <TouchableOpacity style={styles.actionModalOverlay} activeOpacity={1} onPress={() => setShowQuickCleanModal(false)}>
          <View style={styles.actionModalContentContainer} onStartShouldSetResponder={() => true}>
            <View style={styles.actionModalContent}>
              <View style={styles.actionModalHeader}>
                <View style={styles.actionModalHeaderIconWrap}>
                  <Ionicons name="trash-outline" size={40} color="#E74C3C" />
                </View>
                <Text style={styles.actionModalTitle}>Delete {cleanableRoots.length} empty warehouse(s)</Text>
                <Text style={styles.actionModalSubtitleLight}>(no linked data, not merged)</Text>
              </View>
              <ScrollView style={styles.actionModalList} contentContainerStyle={styles.actionModalListContent} nestedScrollEnabled showsVerticalScrollIndicator>
                {cleanableRoots.map((r) => (
                  <View key={r.id} style={styles.actionModalRow}>
                    <Text style={styles.actionModalRowText} numberOfLines={1}>{r.name}{r.code ? ` (${r.code})` : ''}</Text>
                  </View>
                ))}
              </ScrollView>
              <View style={styles.actionModalButtons}>
                <TouchableOpacity style={[styles.actionModalButton, styles.actionModalButtonSecondary]} onPress={() => setShowQuickCleanModal(false)} activeOpacity={0.8}>
                  <Text style={styles.actionModalButtonSecondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionModalButton, styles.actionModalButtonDanger]} onPress={doQuickCleanConfirm} activeOpacity={0.8}>
                  <Text style={styles.actionModalButtonDangerText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Merge: choose which warehouse to keep */}
      <Modal visible={showMergeTargetModal} transparent animationType="fade" onRequestClose={() => { setShowMergeTargetModal(false); setMergeTargetModalAccounts(null); setMergeTargetSelectedId(null); }}>
        <TouchableOpacity style={styles.actionModalOverlay} activeOpacity={1} onPress={() => { setShowMergeTargetModal(false); setMergeTargetModalAccounts(null); setMergeTargetSelectedId(null); }}>
          <View style={styles.actionModalContentContainer} onStartShouldSetResponder={() => true}>
            <View style={styles.actionModalContent}>
              <View style={styles.actionModalHeader}>
                <View style={styles.actionModalHeaderIconWrap}>
                  <Ionicons name="git-merge-outline" size={40} color="#6C5CE7" />
                </View>
                <Text style={styles.actionModalTitle}>Choose which warehouse to keep,</Text>
                <Text style={styles.actionModalSubtitle}>Others will be merged into it.</Text>
              </View>
              <ScrollView style={styles.actionModalList} nestedScrollEnabled>
                {(mergeTargetModalAccounts ?? []).map((w) => (
                  <TouchableOpacity
                    key={w.id}
                    style={[styles.actionModalRowTappable, mergeTargetSelectedId === w.id && styles.actionModalRowSelected]}
                    onPress={() => setMergeTargetSelection(w.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.actionModalRowText} numberOfLines={1}>{w.name}{w.code ? ` (${w.code})` : ''}</Text>
                    {mergeTargetSelectedId === w.id ? (
                      <Ionicons name="checkmark-circle" size={22} color="#6C5CE7" />
                    ) : (
                      <Ionicons name="ellipse-outline" size={22} color="#BDC3C7" />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={styles.actionModalButtons}>
                <TouchableOpacity style={[styles.actionModalButton, styles.actionModalButtonSecondary]} onPress={() => { setShowMergeTargetModal(false); setMergeTargetModalAccounts(null); setMergeTargetSelectedId(null); }} activeOpacity={0.8}>
                  <Text style={styles.actionModalButtonSecondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionModalButton, styles.actionModalButtonPrimary]} onPress={confirmMergeTarget} disabled={!mergeTargetSelectedId} activeOpacity={0.8}>
                  <Text style={styles.actionModalButtonPrimaryText}>Merge</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Delete selected */}
      <Modal visible={showDeleteSelectedModal} transparent animationType="fade" onRequestClose={() => { setShowDeleteSelectedModal(false); setDeleteSelectedModalAccounts(null); }}>
        <TouchableOpacity style={styles.actionModalOverlay} activeOpacity={1} onPress={() => { setShowDeleteSelectedModal(false); setDeleteSelectedModalAccounts(null); }}>
          <View style={styles.actionModalContentContainer} onStartShouldSetResponder={() => true}>
            <View style={styles.actionModalContent}>
              <View style={styles.actionModalHeader}>
                <View style={styles.actionModalHeaderIconWrap}>
                  <Ionicons name="trash-outline" size={40} color="#E74C3C" />
                </View>
                <Text style={styles.actionModalSubtitle}>
                  Delete {deleteSelectedModalAccounts?.length ?? 0} selected warehouse(s)?
                </Text>
              </View>
              <ScrollView style={styles.actionModalList} nestedScrollEnabled>
                {(deleteSelectedModalAccounts ?? []).map((w) => (
                  <View key={w.id} style={styles.actionModalRow}>
                    <Text style={styles.actionModalRowText} numberOfLines={1}>{w.name}{w.code ? ` (${w.code})` : ''}</Text>
                  </View>
                ))}
              </ScrollView>
              <View style={styles.actionModalButtons}>
                <TouchableOpacity style={[styles.actionModalButton, styles.actionModalButtonSecondary]} onPress={() => { setShowDeleteSelectedModal(false); setDeleteSelectedModalAccounts(null); }} activeOpacity={0.8}>
                  <Text style={styles.actionModalButtonSecondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionModalButton, styles.actionModalButtonDanger]} onPress={doDeleteSelectedConfirm} activeOpacity={0.8}>
                  <Text style={styles.actionModalButtonDangerText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Header */}
      {mergeMode ? (
        <View style={styles.headerMerge}>
          <View style={styles.headerMergeTextBlock}>
            <GradientText
              text="Select two or more, then choose which to keep, others will be merged into it."
              style={styles.mergeHeaderTextInHeader}
              containerStyle={styles.mergeHeaderGradientContainer}
            />
          </View>
          <View style={styles.headerTableRow}>
            <View style={styles.checkboxContainer} />
            <View style={styles.headerTableRowNameCell}>
              <Text style={styles.tableHeaderNameLeft}>Warehouse</Text>
              <Text style={styles.headerSelectedCount}>
                ({selectedWarehouseIds.size}/{mergeHistoryData ? mergeHistoryData.roots.length : warehouses.length})
              </Text>
            </View>
            <View style={styles.countsCell}>
              <Text style={styles.tableHeaderCount}>Records</Text>
            </View>
            <View style={styles.expandPlaceholderSmall} />
          </View>
        </View>
      ) : (
        <View style={styles.header}>
          <View style={styles.headerTitleContainer}>
            <GradientText
              text="Warehouses and locations for inventory, Expand to add and manage storage spots."
              style={styles.headerTitle}
              containerStyle={styles.gradientTextContainer}
            />
          </View>
        </View>
      )}

      {mergeMode ? (
        <ScrollView style={styles.scrollView} contentContainerStyle={[styles.content, styles.contentTop, styles.scrollContentWithBottomBar]}>
          <View style={styles.whList}>
            {sortedMergeDisplayRoots.map((root) => {
              const children = mergeHistoryData?.childrenByRootId?.get(root.id) ?? [];
              const expanded = expandedRootIds.has(root.id);
              const hasChildren = children.length > 0;
              return (
                <View key={root.id} style={styles.warehouseCard}>
                  <View style={[styles.mergeRowRoot, selectedWarehouseIds.has(root.id) && styles.whRowSelected]}>
                    <TouchableOpacity style={styles.mergeRowSelectionArea} onPress={() => toggleWarehouseSelection(root.id)} activeOpacity={0.7}>
                      <View style={styles.checkboxContainer}>
                        {selectedWarehouseIds.has(root.id) ? <Ionicons name="checkbox" size={24} color="#6C5CE7" /> : <Ionicons name="checkbox-outline" size={24} color="#BDC3C7" />}
                      </View>
                      <Text style={styles.warehouseName} numberOfLines={1}>{root.name}{root.code ? ` (${root.code})` : ''}</Text>
                      <View style={styles.countsCell}>
                        <Text style={styles.countText}>{usageCounts ? (expanded ? directCount(root.id) : totalCount(root, children)) : '0'}</Text>
                      </View>
                    </TouchableOpacity>
                    {hasChildren ? (
                      <TouchableOpacity style={styles.expandButtonSmall} onPress={() => toggleExpand(root.id)} hitSlop={{ left: 0, right: 48, top: 24, bottom: 24 }} activeOpacity={0.7}>
                        <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={14} color="#6C5CE7" />
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.expandPlaceholderSmall} />
                    )}
                  </View>
                  {expanded && children.map((child) => (
                    <View key={child.id} style={[styles.childRow, selectedWarehouseIds.has(child.id) && styles.whRowSelected]}>
                      <TouchableOpacity style={styles.mergeRowSelectionArea} onPress={() => toggleWarehouseSelection(child.id)} activeOpacity={0.7}>
                        <View style={styles.checkboxContainer}>
                          {selectedWarehouseIds.has(child.id) ? <Ionicons name="checkbox" size={24} color="#6C5CE7" /> : <Ionicons name="checkbox-outline" size={24} color="#BDC3C7" />}
                        </View>
                        <Text style={styles.childName} numberOfLines={1}>{child.name}{child.code ? ` (${child.code})` : ''}</Text>
                        <View style={styles.countsCell}>
                          <Text style={styles.countText}>{usageCounts ? directCount(child.id) : '0'}</Text>
                        </View>
                      </TouchableOpacity>
                      {mergeHistoryData && (
                        <TouchableOpacity style={styles.childRowUnmergeButton} onPress={() => handleUnmerge(child.id)} hitSlop={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                          <Ionicons name="exit-outline" size={14} color="#6C5CE7" />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              );
            })}
          </View>
        </ScrollView>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={[styles.content, styles.contentTop, styles.scrollContentWithBottomBar, showAddForm && keyboardHeight > 0 && { paddingBottom: 88 + keyboardHeight + 6 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} colors={['#6C5CE7']} />}
          keyboardShouldPersistTaps="handled"
        >
          <View ref={scrollContentRef} style={styles.whList}>
            {warehouses.map((w) => (
              <View key={w.id} style={styles.warehouseCard}>
                <TouchableOpacity
                  style={styles.warehouseRow}
                  onPress={() => {
                    if (expandedId === w.id) {
                      setExpandedId(null);
                      setShowAddLocFormForWhId((id) => (id === w.id ? null : id));
                    } else {
                      setExpandedId(w.id);
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name={expandedId === w.id ? 'chevron-down' : 'chevron-forward'} size={20} color="#95A5A6" />
                  <Text style={styles.warehouseName}>{w.name}</Text>
                  {w.code ? <Text style={styles.warehouseCode}>{w.code}</Text> : null}
                  <TouchableOpacity onPress={() => openEditWh(w)} style={styles.iconBtn}>
                    <Ionicons name="create-outline" size={18} color="#6C5CE7" />
                  </TouchableOpacity>
                </TouchableOpacity>

                {expandedId === w.id && (
                  <View style={styles.locations}>
                    <TouchableOpacity style={styles.addLocRow} onPress={() => openAddLoc(w.id)} disabled={showAddLocFormForWhId === w.id}>
                      <Ionicons name="add" size={18} color="#6C5CE7" />
                      <Text style={styles.addLocText}>Add location</Text>
                    </TouchableOpacity>
                    {(locationsByWh[w.id] || []).map((loc) => (
                      <View key={loc.id} style={styles.locRow}>
                        <Text style={styles.locName}>{loc.name}</Text>
                        {loc.code ? <Text style={styles.locCode}>{loc.code}</Text> : null}
                        <TouchableOpacity onPress={() => openEditLoc(w.id, loc)} style={styles.iconBtn}>
                          <Ionicons name="create-outline" size={16} color="#6C5CE7" />
                        </TouchableOpacity>
                      </View>
                    ))}
                    {showAddLocFormForWhId === w.id && (
                      <View style={styles.locFormCard}>
                        <View style={styles.locEditRow}>
                          <TextInput
                            ref={newLocNameInputRef}
                            style={styles.input}
                            value={newLocName}
                            onChangeText={setNewLocName}
                            placeholder="Location name *"
                            placeholderTextColor="#95A5A6"
                          />
                          <TextInput
                            style={styles.input}
                            value={newLocCode}
                            onChangeText={setNewLocCode}
                            placeholder="Code (optional)"
                            placeholderTextColor="#95A5A6"
                          />
                          <View style={actionButtonStyles.editRowButtons}>
                            <TouchableOpacity style={actionButtonStyles.editCancelButton} onPress={() => { setShowAddLocFormForWhId(null); setNewLocName(''); setNewLocCode(''); }} disabled={saving}>
                              <Text style={actionButtonStyles.editCancelButtonText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={actionButtonStyles.editConfirmButton} onPress={handleAddLocation} disabled={saving || !newLocName.trim()}>
                              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={actionButtonStyles.editConfirmButtonText}>Confirm</Text>}
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    )}
                  </View>
                )}
              </View>
            ))}
            {showAddForm && (
              <View ref={addFormCardRef} style={styles.formCard}>
                <View style={styles.editRow}>
                  <TextInput
                    ref={newWhNameInputRef}
                    style={styles.input}
                    value={newWhName}
                    onChangeText={setNewWhName}
                    placeholder="Warehouse name *"
                    placeholderTextColor="#95A5A6"
                  />
                  <TextInput style={styles.input} value={newWhCode} onChangeText={setNewWhCode} placeholder="Code (optional)" placeholderTextColor="#95A5A6" />
                  <TextInput style={[styles.input, styles.inputArea]} value={newWhAddress} onChangeText={setNewWhAddress} placeholder="Address (optional)" placeholderTextColor="#95A5A6" multiline />
                  <View style={actionButtonStyles.editRowButtons}>
                    <TouchableOpacity style={actionButtonStyles.editCancelButton} onPress={() => { setShowAddForm(false); setNewWhName(''); setNewWhCode(''); setNewWhAddress(''); }} disabled={saving}>
                      <Text style={actionButtonStyles.editCancelButtonText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={actionButtonStyles.editConfirmButton} onPress={handleAddWarehouse} disabled={saving || !newWhName.trim()}>
                      {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={actionButtonStyles.editConfirmButtonText}>Confirm</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          </View>
        </ScrollView>
        </KeyboardAvoidingView>
      )}

      {!showAddForm && !mergeMode && (
        <View style={[actionButtonStyles.bar, actionButtonStyles.barMergeMode]}>
          <TouchableOpacity style={actionButtonStyles.barButtonSecondaryFlex} onPress={openAddWh}>
            <Ionicons name="add-circle" size={20} color="#6C5CE7" style={actionButtonStyles.barIconFix} />
            <Text style={actionButtonStyles.barButtonSecondaryText}>Add</Text>
          </TouchableOpacity>
          <TouchableOpacity style={actionButtonStyles.barButtonPrimaryFlex} onPress={handleStartMerge}>
            <Ionicons name="git-merge-outline" size={20} color="#fff" style={actionButtonStyles.barIconFix} />
            <Text style={actionButtonStyles.barButtonPrimaryText}>Merge & Clean</Text>
          </TouchableOpacity>
        </View>
      )}

      {mergeMode && (
        <View style={[actionButtonStyles.bar, actionButtonStyles.barMergeMode]}>
          {selectedWarehouseIds.size === 0 && (
            <>
              <TouchableOpacity style={actionButtonStyles.barButtonSecondaryFlex} onPress={handleCancelMerge}>
                <Text style={actionButtonStyles.barButtonSecondaryText} numberOfLines={1}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={actionButtonStyles.barButtonDangerFlex} onPress={handleCleanEmpty}>
                <Ionicons name="trash-outline" size={18} color="#E74C3C" style={actionButtonStyles.barIconFix} />
                <Text style={actionButtonStyles.barButtonDangerText} numberOfLines={1}>Quick Clean</Text>
              </TouchableOpacity>
            </>
          )}
          {selectedWarehouseIds.size === 1 && (
            <>
              <TouchableOpacity style={actionButtonStyles.barButtonSecondaryFlex} onPress={handleCancelMerge}>
                <Text style={actionButtonStyles.barButtonSecondaryText} numberOfLines={1}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={actionButtonStyles.barButtonDangerFlex} onPress={handleDeleteSelected}>
                <Ionicons name="trash-outline" size={18} color="#E74C3C" style={actionButtonStyles.barIconFix} />
                <Text style={actionButtonStyles.barButtonDangerText} numberOfLines={1}>Delete</Text>
              </TouchableOpacity>
            </>
          )}
          {selectedWarehouseIds.size >= 2 && (
            <>
              <TouchableOpacity style={actionButtonStyles.barButtonSecondaryFlex} onPress={handleCancelMerge}>
                <Text style={actionButtonStyles.barButtonSecondaryText} numberOfLines={1}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={actionButtonStyles.barButtonPrimaryFlex} onPress={handleConfirmMerge}>
                <Ionicons name="git-merge-outline" size={18} color="#fff" style={actionButtonStyles.barIconFix} />
                <Text style={actionButtonStyles.barButtonPrimaryText} numberOfLines={1}>Merge</Text>
              </TouchableOpacity>
              <TouchableOpacity style={actionButtonStyles.barButtonDangerFlex} onPress={handleDeleteSelected}>
                <Ionicons name="trash-outline" size={18} color="#E74C3C" style={actionButtonStyles.barIconFix} />
                <Text style={actionButtonStyles.barButtonDangerText} numberOfLines={1}>Delete</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      <Modal visible={whModal !== null} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>{whModal === 'add' ? 'Add warehouse' : 'Edit warehouse'}</Text>
            <TextInput style={styles.input} placeholder="Warehouse name *" placeholderTextColor="#95A5A6" value={whName} onChangeText={setWhName} />
            <TextInput style={styles.input} placeholder="Code (optional)" placeholderTextColor="#95A5A6" value={whCode} onChangeText={setWhCode} />
            <TextInput style={[styles.input, styles.inputArea]} placeholder="Address (optional)" placeholderTextColor="#95A5A6" value={whAddress} onChangeText={setWhAddress} multiline />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalBtn, styles.cancelBtn]} onPress={() => setWhModal(null)} disabled={saving}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.saveBtn]} onPress={saveWh} disabled={saving || !whName.trim()}>
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={locModal !== null} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Edit location</Text>
            <TextInput style={styles.input} placeholder="Location name *" placeholderTextColor="#95A5A6" value={locName} onChangeText={setLocName} />
            <TextInput style={styles.input} placeholder="Code (optional)" placeholderTextColor="#95A5A6" value={locCode} onChangeText={setLocCode} />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalBtn, styles.cancelBtn]} onPress={() => setLocModal(null)} disabled={saving}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.saveBtn]} onPress={saveLoc} disabled={saving || !locName.trim()}>
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  toastWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  toast: {
    alignSelf: 'center',
    backgroundColor: 'rgba(45, 52, 54, 0.9)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  toastText: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  content: { padding: 16, paddingRight: 12 },
  contentTop: { paddingTop: 6 },
  formCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#E9ECEF' },
  editRow: { flexDirection: 'column' as const, gap: 8 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 60,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  headerTitleContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  headerTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  gradientTextContainer: { alignItems: 'center', justifyContent: 'center' },
  headerMerge: {
    flexDirection: 'column',
    paddingTop: 13,
    paddingBottom: 0,
    minHeight: 88,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  headerMergeTextBlock: { alignItems: 'flex-start', alignSelf: 'stretch', paddingBottom: 4, paddingLeft: 64, paddingRight: 16, paddingTop: 0, minHeight: 56 },
  mergeHeaderTextInHeader: { fontSize: 17, fontWeight: '600', textAlign: 'left' },
  mergeHeaderGradientContainer: { alignItems: 'flex-start', alignSelf: 'stretch', width: '100%' },
  headerTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 6,
    paddingRight: 12,
    paddingTop: 0,
    paddingBottom: 0,
    minHeight: 24,
    borderTopWidth: 1,
    borderTopColor: '#E9ECEF',
  },
  headerTableRowNameCell: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start' },
  tableHeaderNameLeft: { fontSize: 13, fontWeight: '600', color: '#636E72' },
  headerSelectedCount: { fontSize: 13, fontWeight: '600', color: '#636E72', marginLeft: 4 },
  tableHeaderCount: { minWidth: 72, fontSize: 13, fontWeight: '600', color: '#636E72', textAlign: 'right' },
  checkboxContainer: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  expandPlaceholderSmall: { width: 20 },
  expandButtonSmall: { width: 20, alignItems: 'center', justifyContent: 'center', padding: 2 },
  scrollView: { flex: 1 },
  scrollContentWithBottomBar: { paddingBottom: 88 },
  whList: { gap: 6 },
  warehouseCard: { backgroundColor: '#fff', borderRadius: 8, padding: 10, paddingRight: 4, minHeight: 40, ...(Platform.OS === 'web' ? { overflow: 'visible' as const } : { overflow: 'hidden' }) },
  mergeRowRoot: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 40 },
  mergeRowSelectionArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  countsCell: { alignItems: 'center', justifyContent: 'flex-end', minWidth: 72 },
  countText: { fontSize: 13, color: '#636E72', textAlign: 'right' },
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 8,
    paddingVertical: 6,
    minHeight: 40,
    borderTopWidth: 1,
    borderTopColor: '#E9ECEF',
  },
  childName: { flex: 1, fontSize: 14, color: '#636E72' },
  childRowUnmergeButton: { width: 20, padding: 2, justifyContent: 'center', alignItems: 'center' },
  whRowSelected: { backgroundColor: '#E8F4FD', borderRadius: 8, padding: 4 },
  warehouseRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  warehouseName: { flex: 1, fontSize: 16, fontWeight: '600', color: '#2D3436' },
  warehouseCode: { fontSize: 14, color: '#636E72' },
  iconBtn: { padding: 4 },
  locations: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12, borderTopWidth: 1, borderTopColor: '#E9ECEF' },
  addLocRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, minHeight: 40 },
  addLocText: { fontSize: 14, fontWeight: '500', color: '#6C5CE7' },
  locRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingLeft: 8, gap: 8, minHeight: 40 },
  locName: { flex: 1, fontSize: 15, color: '#2D3436' },
  locCode: { fontSize: 13, color: '#95A5A6' },
  locFormCard: { backgroundColor: '#F8F9FA', borderRadius: 8, padding: 10, marginTop: 8, marginBottom: 8, borderWidth: 1, borderColor: '#E9ECEF' },
  locEditRow: { flexDirection: 'column' as const, gap: 8 },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 8,
    flexDirection: 'row',
    gap: 12,
  },
  bottomBarMergeMode: { justifyContent: 'space-between', alignItems: 'stretch' },
  bottomBarCleanWrapper: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bottomBarMergeActions: { flexDirection: 'row', gap: 12, flex: 1, justifyContent: 'flex-end' },
  bottomBarCleanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    paddingHorizontal: 32,
    minWidth: 220,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E67E22',
  },
  bottomBarCleanButtonText: { fontSize: 16, fontWeight: '600', color: '#E67E22' },
  bottomBarAddButton: {
    flex: 1,
    backgroundColor: '#6C5CE7',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...(Platform.OS === 'android' ? { elevation: 0, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' } : { elevation: 4 }),
  },
  bottomBarAddButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  bottomBarMergeButton: {
    flex: 1,
    backgroundColor: '#6C5CE7',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...(Platform.OS === 'android' ? { elevation: 0, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' } : { elevation: 4 }),
  },
  bottomBarMergeButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  bottomBarCancelButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    ...(Platform.OS === 'android' ? { elevation: 0, borderWidth: 1, borderColor: 'rgba(0,0,0,0.14)' } : { elevation: 3 }),
  },
  bottomBarCancelButtonText: { fontSize: 16, color: '#636E72', fontWeight: '600' },
  bottomBarConfirmButton: {
    flex: 1,
    backgroundColor: '#6C5CE7',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'android' ? { elevation: 0, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' } : { elevation: 4 }),
  },
  bottomBarConfirmButtonText: { fontSize: 16, color: '#fff', fontWeight: '600' },
  bottomBarDeleteButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E74C3C',
  },
  bottomBarDeleteButtonText: { fontSize: 16, color: '#E74C3C', fontWeight: '600' },
  actionModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  actionModalContentContainer: { width: '100%', maxWidth: 400, maxHeight: '80%', alignItems: 'center' },
  actionModalContent: { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '100%', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8 },
  actionModalHeader: { alignItems: 'center', alignSelf: 'stretch', marginBottom: 20, paddingTop: 4 },
  actionModalHeaderIconWrap: { marginBottom: 8 },
  actionModalTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A2E', marginTop: 8, marginBottom: 4, textAlign: 'center' },
  actionModalSubtitle: { fontSize: 16, fontWeight: '700', color: '#1A1A2E', textAlign: 'center', lineHeight: 22, paddingHorizontal: 8 },
  actionModalSubtitleLight: { fontSize: 14, fontWeight: '400', color: '#636E72', textAlign: 'center', marginTop: 4 },
  actionModalList: { width: '100%', minHeight: 120, maxHeight: 352, marginTop: 8, marginBottom: 20 },
  actionModalListContent: { paddingBottom: 8 },
  actionModalRow: { paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#E9ECEF' },
  actionModalRowTappable: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#E9ECEF' },
  actionModalRowSelected: { backgroundColor: '#E8F4FD', borderLeftWidth: 3, borderLeftColor: '#6C5CE7' },
  actionModalRowText: { fontSize: 16, color: '#2D3436', flex: 1 },
  actionModalButtons: { flexDirection: 'row', width: '100%', gap: 12, justifyContent: 'flex-end' },
  actionModalButton: { paddingVertical: 14, paddingHorizontal: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  actionModalButtonSecondary: { backgroundColor: '#F8F9FA', borderWidth: 1, borderColor: '#E9ECEF' },
  actionModalButtonSecondaryText: { fontSize: 16, fontWeight: '600', color: '#636E72' },
  actionModalButtonPrimary: { backgroundColor: '#6C5CE7' },
  actionModalButtonPrimaryText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  actionModalButtonWarning: { backgroundColor: '#FFF5F0', borderWidth: 1, borderColor: '#E67E22' },
  actionModalButtonWarningText: { fontSize: 16, fontWeight: '600', color: '#E67E22' },
  actionModalButtonDanger: { backgroundColor: '#FFF5F5', borderWidth: 1, borderColor: '#E74C3C' },
  actionModalButtonDangerText: { fontSize: 16, fontWeight: '600', color: '#E74C3C' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalBox: { backgroundColor: '#fff', borderRadius: 16, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '600', color: '#2D3436', marginBottom: 20 },
  input: { backgroundColor: '#F8F9FA', borderRadius: 10, padding: 14, fontSize: 16, color: '#2D3436', marginBottom: 12, borderWidth: 1, borderColor: '#E9ECEF' },
  inputArea: { minHeight: 60 },
  modalButtons: { flexDirection: 'row', marginTop: 8, gap: 12 },
  modalBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
  cancelBtn: { backgroundColor: '#E9ECEF' },
  cancelBtnText: { fontSize: 16, fontWeight: '600', color: '#636E72' },
  saveBtn: { backgroundColor: '#6C5CE7' },
  saveBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
