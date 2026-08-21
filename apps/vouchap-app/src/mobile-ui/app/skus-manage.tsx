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
  getSkus,
  createSku,
  updateSku,
  deleteSku,
  mergeSkus,
  unmergeSku,
  getSkusForMergeHistory,
  getSkuUsageCounts,
  type SkusMergeHistoryData,
  type SkuUsageCounts,
} from '@/lib/skus';
import { Sku } from '@/types';
import { GradientText } from '@/lib/GradientText';
import { actionButtonStyles } from '@/lib/action-button-styles';
import { showToast } from '@/lib/toast';
import { confirmDestructive } from '@/lib/alertWeb';

export default function SkusManageScreen() {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [saving, setSaving] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedSkuIds, setSelectedSkuIds] = useState<Set<string>>(new Set());
  const [mergeHistoryData, setMergeHistoryData] = useState<SkusMergeHistoryData | null>(null);
  const [usageCounts, setUsageCounts] = useState<SkuUsageCounts | null>(null);
  const [expandedRootIds, setExpandedRootIds] = useState<Set<string>>(new Set());
  const [showQuickCleanModal, setShowQuickCleanModal] = useState(false);
  const [showMergeTargetModal, setShowMergeTargetModal] = useState(false);
  const [mergeTargetModalAccounts, setMergeTargetModalAccounts] = useState<Sku[] | null>(null);
  const [mergeTargetSelectedId, setMergeTargetSelectedId] = useState<string | null>(null);
  const [showDeleteSelectedModal, setShowDeleteSelectedModal] = useState(false);
  const [deleteSelectedModalAccounts, setDeleteSelectedModalAccounts] = useState<Sku[] | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newUnit, setNewUnit] = useState('pcs');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);
  const newNameInputRef = useRef<TextInput>(null);
  const scrollContentRef = useRef<View>(null);
  const addFormCardRef = useRef<View>(null);
  const HEADER_HEIGHT_PX = 88;

  const load = async () => {
    try {
      const data = await getSkus();
      setSkus([...data].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      console.error('Load skus error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [])
  );

  useEffect(() => {
    if (showAddForm) {
      const t = setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
        newNameInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(t);
    }
  }, [showAddForm]);

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

  const openAdd = () => {
    setShowAddForm(true);
    setNewName('');
    setNewCode('');
    setNewUnit('pcs');
  };

  const handleAddSku = async () => {
    if (!newName.trim()) {
      showToast('Please enter name');
      return;
    }
    setSaving(true);
    try {
      await createSku({ name: newName.trim(), code: newCode.trim() || undefined, unit: newUnit.trim() || 'pcs' });
      setShowAddForm(false);
      setNewName('');
      setNewCode('');
      setNewUnit('pcs');
      load();
      showToast('SKU created');
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to create');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (sku: Sku) => {
    setEditingId(sku.id);
    setName(sku.name);
    setCode(sku.code || '');
    setUnit(sku.unit || 'pcs');
    setModalVisible(true);
  };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateSku(editingId, { name: name.trim(), code: code.trim() || undefined, unit: unit.trim() || 'pcs' });
      } else {
        await createSku({ name: name.trim(), code: code.trim() || undefined, unit: unit.trim() || 'pcs' });
      }
      setModalVisible(false);
      load();
      showToast(editingId ? 'SKU updated' : 'SKU created');
    } catch (e) {
      console.error('Save sku error:', e);
      showToast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = (sku: Sku) => {
    confirmDestructive('Delete SKU', `Delete "${sku.name}"?`, async () => {
      try {
        await deleteSku(sku.id);
        load();
        showToast('SKU deleted');
      } catch (e) {
        showToast((e as Error).message);
      }
    }, { confirmLabel: 'Delete' });
  };

  const toggleSkuSelection = (skuId: string) => {
    const next = new Set(selectedSkuIds);
    if (next.has(skuId)) next.delete(skuId);
    else next.add(skuId);
    setSelectedSkuIds(next);
  };

  const handleStartMerge = async () => {
    setModalVisible(false);
    setMergeMode(true);
    setSelectedSkuIds(new Set());
    setExpandedRootIds(new Set());
    try {
      const [historyData, counts] = await Promise.all([
        getSkusForMergeHistory(),
        getSkuUsageCounts(),
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
    setSelectedSkuIds(new Set());
    setMergeHistoryData(null);
    setUsageCounts(null);
    setExpandedRootIds(new Set());
  };

  const directUsage = (id: string) => usageCounts?.usageCountBySkuId[id] ?? 0;
  const totalCount = (root: Sku, children: Sku[]) =>
    directUsage(root.id) + children.reduce((s, c) => s + directUsage(c.id), 0);
  const directCount = (id: string) => directUsage(id);

  /** 与非 merge 一致：按直接用量降序、名称升序（无 usageCounts 时按名称） */
  const sortedMergeDisplayRoots = (() => {
    const arr = mergeHistoryData?.roots ?? skus;
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
      showToast('No empty SKUs to clean.');
      return;
    }
    setShowQuickCleanModal(true);
  };

  const doQuickCleanConfirm = async () => {
    if (cleanableRoots.length === 0) return;
    setShowQuickCleanModal(false);
    try {
      for (const root of cleanableRoots) {
        await deleteSku(root.id);
      }
      await load();
      const [historyData, counts] = await Promise.all([
        getSkusForMergeHistory(),
        getSkuUsageCounts(),
      ]);
      setMergeHistoryData(historyData);
      setUsageCounts(counts);
      showToast(`Cleaned ${cleanableRoots.length} empty SKU(s).`);
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to clean');
    }
  };

  const setMergeTargetSelection = (skuId: string) => setMergeTargetSelectedId(skuId);
  const confirmMergeTarget = () => {
    if (!mergeTargetSelectedId) return;
    const sourceIds = Array.from(selectedSkuIds).filter((id) => id !== mergeTargetSelectedId);
    setShowMergeTargetModal(false);
    setMergeTargetModalAccounts(null);
    setMergeTargetSelectedId(null);
    performMerge(sourceIds, mergeTargetSelectedId);
  };

  const handleConfirmMerge = () => {
    if (selectedSkuIds.size < 2) {
      showToast('Please select at least 2 SKUs to merge');
      return;
    }
    const allInMerge = mergeHistoryData
      ? [...mergeHistoryData.roots, ...Array.from(mergeHistoryData.childrenByRootId.values()).flat()]
      : [];
    const selected = allInMerge.filter((s) => selectedSkuIds.has(s.id));
    setMergeTargetModalAccounts(selected);
    setMergeTargetSelectedId(null);
    setShowMergeTargetModal(true);
  };

  const performMerge = async (sourceSkuIds: string[], targetSkuId: string) => {
    try {
      await mergeSkus(sourceSkuIds, targetSkuId);
      await load();
      const [historyData, counts] = await Promise.all([
        getSkusForMergeHistory(),
        getSkuUsageCounts(),
      ]);
      setMergeHistoryData(historyData);
      setUsageCounts(counts);
      setSelectedSkuIds(new Set());
      setExpandedRootIds(new Set());
      showToast('SKUs merged successfully');
    } catch (error: any) {
      console.error('Error merging SKUs:', error);
      showToast(error.message || 'Failed to merge SKUs');
    }
  };

  const handleUnmerge = async (childId: string) => {
    try {
      await unmergeSku(childId);
      await load();
      const [historyData, counts] = await Promise.all([
        getSkusForMergeHistory(),
        getSkuUsageCounts(),
      ]);
      setMergeHistoryData(historyData);
      setUsageCounts(counts);
      setSelectedSkuIds((prev) => {
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
    if (selectedSkuIds.size === 0) return;
    const allInMerge = mergeHistoryData
      ? [...mergeHistoryData.roots, ...Array.from(mergeHistoryData.childrenByRootId.values()).flat()]
      : [];
    const selected = allInMerge.filter((s) => selectedSkuIds.has(s.id));
    setDeleteSelectedModalAccounts(selected);
    setShowDeleteSelectedModal(true);
  };

  const doDeleteSelectedConfirm = async () => {
    const selected = deleteSelectedModalAccounts;
    setShowDeleteSelectedModal(false);
    setDeleteSelectedModalAccounts(null);
    if (!selected || selected.length === 0) return;
    try {
      for (const s of selected) {
        await deleteSku(s.id);
      }
      await load();
      const [historyData, counts] = await Promise.all([
        getSkusForMergeHistory(),
        getSkuUsageCounts(),
      ]);
      setMergeHistoryData(historyData);
      setUsageCounts(counts);
      setSelectedSkuIds(new Set());
      showToast(`Deleted ${selected.length} SKU(s).`);
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

  if (loading && skus.length === 0 && !mergeMode) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6C5CE7" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      {/* Quick Clean */}
      <Modal visible={showQuickCleanModal} transparent animationType="fade" onRequestClose={() => setShowQuickCleanModal(false)}>
        <TouchableOpacity style={styles.actionModalOverlay} activeOpacity={1} onPress={() => setShowQuickCleanModal(false)}>
          <View style={styles.actionModalContentContainer} onStartShouldSetResponder={() => true}>
            <View style={styles.actionModalContent}>
              <View style={styles.actionModalHeader}>
                <View style={styles.actionModalHeaderIconWrap}>
                  <Ionicons name="trash-outline" size={40} color="#E74C3C" />
                </View>
                <Text style={styles.actionModalTitle}>Delete {cleanableRoots.length} empty SKU(s)</Text>
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

      {/* Merge: choose which SKU to keep */}
      <Modal visible={showMergeTargetModal} transparent animationType="fade" onRequestClose={() => { setShowMergeTargetModal(false); setMergeTargetModalAccounts(null); setMergeTargetSelectedId(null); }}>
        <TouchableOpacity style={styles.actionModalOverlay} activeOpacity={1} onPress={() => { setShowMergeTargetModal(false); setMergeTargetModalAccounts(null); setMergeTargetSelectedId(null); }}>
          <View style={styles.actionModalContentContainer} onStartShouldSetResponder={() => true}>
            <View style={styles.actionModalContent}>
              <View style={styles.actionModalHeader}>
                <View style={styles.actionModalHeaderIconWrap}>
                  <Ionicons name="git-merge-outline" size={40} color="#6C5CE7" />
                </View>
                <Text style={styles.actionModalTitle}>Choose which SKU to keep,</Text>
                <Text style={styles.actionModalSubtitle}>Others will be merged into it.</Text>
              </View>
              <ScrollView style={styles.actionModalList} nestedScrollEnabled>
                {(mergeTargetModalAccounts ?? []).map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.actionModalRowTappable, mergeTargetSelectedId === s.id && styles.actionModalRowSelected]}
                    onPress={() => setMergeTargetSelection(s.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.actionModalRowText} numberOfLines={1}>{s.name}{s.code ? ` (${s.code})` : ''}</Text>
                    {mergeTargetSelectedId === s.id ? (
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
                  Delete {deleteSelectedModalAccounts?.length ?? 0} selected SKU(s)?
                </Text>
              </View>
              <ScrollView style={styles.actionModalList} nestedScrollEnabled>
                {(deleteSelectedModalAccounts ?? []).map((s) => (
                  <View key={s.id} style={styles.actionModalRow}>
                    <Text style={styles.actionModalRowText} numberOfLines={1}>{s.name}{s.code ? ` (${s.code})` : ''}</Text>
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
              <Text style={styles.tableHeaderNameLeft}>SKU</Text>
              <Text style={styles.headerSelectedCount}>
                ({selectedSkuIds.size}/{mergeHistoryData ? mergeHistoryData.roots.length : skus.length})
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
              text="Product items for inbound and outbound, Support merge and quick clean."
              style={styles.headerTitle}
              containerStyle={styles.gradientTextContainer}
            />
          </View>
        </View>
      )}

      {mergeMode ? (
        <ScrollView style={styles.scrollView} contentContainerStyle={[styles.scrollContent, styles.scrollContentTop, styles.scrollContentWithBottomBar]}>
          <View style={styles.skusList}>
            {sortedMergeDisplayRoots.map((root, index) => {
              const children = mergeHistoryData?.childrenByRootId?.get(root.id) ?? [];
              const expanded = expandedRootIds.has(root.id);
              const hasChildren = children.length > 0;
              const rowBg = index % 2 === 0 ? '#FFFFFF' : '#F8F9FA';
              return (
                <View key={root.id} style={[styles.skuCard, { backgroundColor: rowBg }]}>
                  <View style={[styles.mergeRowRoot, selectedSkuIds.has(root.id) && styles.skuRowSelected]}>
                    <TouchableOpacity style={styles.mergeRowSelectionArea} onPress={() => toggleSkuSelection(root.id)} activeOpacity={0.7}>
                      <View style={styles.checkboxContainer}>
                        {selectedSkuIds.has(root.id) ? <Ionicons name="checkbox" size={24} color="#6C5CE7" /> : <Ionicons name="checkbox-outline" size={24} color="#BDC3C7" />}
                      </View>
                      <View style={styles.rowContent}>
                        <Text style={styles.skuName} numberOfLines={1}>{root.name}</Text>
                        <View style={styles.rowMeta}>
                          <View style={styles.rowMetaLeft}>{root.code ? <View style={styles.tagCodeWrap}><Text style={styles.tagCodePrefix}>#</Text><View style={styles.tagPill}><Text style={styles.tagCode} numberOfLines={1} ellipsizeMode="tail">{root.code}</Text></View></View> : null}</View>
                          <View style={styles.unitCell}><View style={styles.tagPill}><Text style={styles.tagUnit}>{root.unit}</Text></View></View>
                        </View>
                      </View>
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
                    <View key={child.id} style={[styles.childRow, selectedSkuIds.has(child.id) && styles.skuRowSelected]}>
                      <TouchableOpacity style={styles.mergeRowSelectionArea} onPress={() => toggleSkuSelection(child.id)} activeOpacity={0.7}>
                        <View style={styles.checkboxContainer}>
                          {selectedSkuIds.has(child.id) ? <Ionicons name="checkbox" size={24} color="#6C5CE7" /> : <Ionicons name="checkbox-outline" size={24} color="#BDC3C7" />}
                        </View>
                        <View style={styles.rowContent}>
                          <Text style={styles.childName} numberOfLines={1}>{child.name}</Text>
                          <View style={styles.rowMeta}>
                            <View style={styles.rowMetaLeft}>{child.code ? <View style={styles.tagCodeWrap}><Text style={styles.tagCodePrefix}>#</Text><View style={styles.tagPill}><Text style={styles.tagCode} numberOfLines={1} ellipsizeMode="tail">{child.code}</Text></View></View> : null}</View>
                            <View style={styles.unitCell}><View style={styles.tagPill}><Text style={styles.tagUnit}>{child.unit}</Text></View></View>
                          </View>
                        </View>
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
          contentContainerStyle={[styles.scrollContent, styles.scrollContentTop, styles.scrollContentWithBottomBar, showAddForm && keyboardHeight > 0 && { paddingBottom: 88 + keyboardHeight + 6 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} colors={['#6C5CE7']} />}
          keyboardShouldPersistTaps="handled"
        >
          <View ref={scrollContentRef} style={styles.skusList}>
            {skus.length === 0 && !showAddForm ? (
              <View style={styles.empty}>
                <Ionicons name="cube-outline" size={48} color="#BDC3C7" />
                <Text style={styles.emptyText}>No SKU yet</Text>
                <Text style={styles.emptyHint}>Link in inbound/outbound</Text>
              </View>
            ) : (
              skus.map((item, index) => {
                const rowBg = index % 2 === 0 ? '#FFFFFF' : '#F8F9FA';
                return (
              <View key={item.id} style={[styles.skuCard, { backgroundColor: rowBg }]}>
                  <TouchableOpacity style={styles.row} onPress={() => openEdit(item)} activeOpacity={0.7}>
                    <View style={styles.skuIndicator}>
                      <Ionicons name="cube-outline" size={16} color="#6C5CE7" />
                      {'isAiRecognized' in item && item.isAiRecognized && (
                        <View style={styles.aiBadgeInIcon}>
                          <Text style={styles.aiBadgeTextInIcon}>AI</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.rowContent}>
                      <Text style={styles.skuName} numberOfLines={1} ellipsizeMode="tail">{item.name}</Text>
                      <View style={styles.rowMeta}>
                        <View style={styles.rowMetaLeft}>{item.code ? <View style={styles.tagCodeWrap}><Text style={styles.tagCodePrefix}>#</Text><View style={styles.tagPill}><Text style={styles.tagCode} numberOfLines={1} ellipsizeMode="tail">{item.code}</Text></View></View> : null}</View>
                        <View style={styles.unitCell}><View style={styles.tagPill}><Text style={styles.tagUnit}>{item.unit}</Text></View></View>
                      </View>
                    </View>
                    <View style={styles.countsCellPlaceholder} />
                    <View style={styles.trailingSlot}>
                      <Ionicons name="create-outline" size={18} color="#6C5CE7" />
                    </View>
                  </TouchableOpacity>
                </View>
                );
              })
            )}
            {showAddForm && (
              <View ref={addFormCardRef} style={styles.formCard}>
                <View style={styles.editRow}>
                  <TextInput
                    ref={newNameInputRef}
                    style={styles.input}
                    value={newName}
                    onChangeText={setNewName}
                    placeholder="Name *"
                    placeholderTextColor="#95A5A6"
                  />
                  <TextInput style={styles.input} value={newCode} onChangeText={setNewCode} placeholder="Code (optional)" placeholderTextColor="#95A5A6" />
                  <TextInput style={styles.input} value={newUnit} onChangeText={setNewUnit} placeholder="Unit" placeholderTextColor="#95A5A6" />
                  <View style={actionButtonStyles.editRowButtons}>
                    <TouchableOpacity style={actionButtonStyles.editCancelButton} onPress={() => { setShowAddForm(false); setNewName(''); setNewCode(''); setNewUnit('pcs'); }} disabled={saving}>
                      <Text style={actionButtonStyles.editCancelButtonText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={actionButtonStyles.editConfirmButton} onPress={handleAddSku} disabled={saving || !newName.trim()}>
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
          <TouchableOpacity style={actionButtonStyles.barButtonSecondaryFlex} onPress={openAdd}>
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
          {selectedSkuIds.size === 0 && (
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
          {selectedSkuIds.size === 1 && (
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
          {selectedSkuIds.size >= 2 && (
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

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>{editingId ? 'Edit SKU' : 'Add SKU'}</Text>
            <TextInput style={styles.input} placeholder="Name *" placeholderTextColor="#95A5A6" value={name} onChangeText={setName} />
            <TextInput style={styles.input} placeholder="Code (optional)" placeholderTextColor="#95A5A6" value={code} onChangeText={setCode} />
            <TextInput style={styles.input} placeholder="Unit" placeholderTextColor="#95A5A6" value={unit} onChangeText={setUnit} />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalBtn, styles.cancelBtn]} onPress={() => setModalVisible(false)} disabled={saving}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.saveBtn]} onPress={save} disabled={saving || !name.trim()}>
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
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { padding: 48, alignItems: 'center' },
  emptyText: { fontSize: 16, color: '#636E72', marginTop: 12 },
  emptyHint: { fontSize: 14, color: '#95A5A6', marginTop: 4 },
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
  trailingSlot: { width: 20, alignItems: 'center', justifyContent: 'center' },
  expandButtonSmall: { width: 20, alignItems: 'center', justifyContent: 'center', padding: 2 },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16, paddingRight: 12 },
  scrollContentTop: { paddingTop: 6 },
  scrollContentWithBottomBar: { paddingBottom: 88 },
  skusList: { gap: 6 },
  formCard: { backgroundColor: '#fff', borderRadius: 8, padding: 10, marginTop: 8, marginBottom: 12 },
  editRow: { flexDirection: 'column' as const, gap: 8 },
  skuCard: { backgroundColor: '#fff', borderRadius: 8, padding: 10, paddingRight: 4, minHeight: 48, ...(Platform.OS === 'web' && { overflow: 'visible' as const }) },
  mergeRowRoot: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 48 },
  mergeRowSelectionArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2 },
  countsCell: { alignItems: 'center', justifyContent: 'flex-end', minWidth: 72 },
  countsCellPlaceholder: { minWidth: 72 },
  countText: { fontSize: 13, color: '#636E72', textAlign: 'right' },
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 8,
    paddingVertical: 6,
    minHeight: 48,
    borderTopWidth: 1,
    borderTopColor: '#E9ECEF',
  },
  childName: { flex: 1, fontSize: 14, color: '#636E72' },
  childRowUnmergeButton: { width: 20, padding: 2, justifyContent: 'center', alignItems: 'center' },
  skuRowSelected: { backgroundColor: '#E8F4FD', borderRadius: 8, padding: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 48 },
  skuIndicator: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    position: 'relative' as const,
  },
  aiBadgeInIcon: {
    position: 'absolute' as const,
    right: 0,
    bottom: 0,
    backgroundColor: '#E8F4FD',
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 3,
    minWidth: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiBadgeTextInIcon: { fontSize: 8, fontWeight: '600' as const, color: '#6C5CE7' },
  rowContent: { flex: 1, minWidth: 0 },
  rowMeta: { flexDirection: 'row' as const, alignItems: 'center', marginTop: 4, marginLeft: 6, gap: 6 },
  rowMetaLeft: { flex: 1, minWidth: 0 },
  unitCell: { minWidth: 48, alignItems: 'flex-end', justifyContent: 'center' },
  tagPill: { backgroundColor: '#E8F4FD', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start', maxWidth: '100%' },
  tagCodeWrap: { flexDirection: 'row' as const, alignItems: 'center', gap: 4, flex: 1, minWidth: 0 },
  tagCodePrefix: { fontSize: 12, color: '#636E72' },
  tagCode: { fontSize: 12, color: '#6C5CE7' },
  tagUnit: { fontSize: 12, color: '#6C5CE7' },
  skuName: { fontSize: 16, fontWeight: '600' as const, color: '#2D3436' },
  skuCode: { fontSize: 14, color: '#636E72' },
  childCode: { fontSize: 14, color: '#636E72' },
  skuUnit: { fontSize: 14, color: '#95A5A6' },
  iconBtn: { padding: 8 },
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
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
  fab: { position: 'absolute', right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: '#6C5CE7', justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalBox: { backgroundColor: '#fff', borderRadius: 16, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '600', color: '#2D3436', marginBottom: 20 },
  input: { backgroundColor: '#F8F9FA', borderRadius: 10, padding: 14, fontSize: 16, color: '#2D3436', marginBottom: 12, borderWidth: 1, borderColor: '#E9ECEF' },
  modalButtons: { flexDirection: 'row', marginTop: 8, gap: 12 },
  modalBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
  cancelBtn: { backgroundColor: '#E9ECEF' },
  cancelBtnText: { fontSize: 16, fontWeight: '600', color: '#636E72' },
  saveBtn: { backgroundColor: '#6C5CE7' },
  saveBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
