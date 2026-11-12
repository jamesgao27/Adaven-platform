import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
  Animated,
  KeyboardAvoidingView,
  Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { actionButtonStyles } from '@/lib/action-button-styles';
import { confirmDestructive } from '@/lib/alertWeb';
import {
  getAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  mergeAccount,
  unmergeAccount,
  getAccountsForMergeHistory,
  getAccountUsageCounts,
  type AccountsMergeHistoryData,
  type AccountUsageCounts,
} from '@/lib/accounts';
import { Account } from '@/types';
import { GradientText } from '@/lib/GradientText';

export default function AccountsManageScreen() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [mergeHistoryData, setMergeHistoryData] = useState<AccountsMergeHistoryData | null>(null);
  const [usageCounts, setUsageCounts] = useState<AccountUsageCounts | null>(null);
  const [expandedRootIds, setExpandedRootIds] = useState<Set<string>>(new Set());
  const editNameInputRef = useRef<TextInput>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const newNameInputRef = useRef<TextInput>(null);
  const scrollContentRef = useRef<View>(null);
  const addFormCardRef = useRef<View>(null);
  const HEADER_HEIGHT_PX = 88;
  const KEYBOARD_SCROLL_OFFSET_PX = 304; // 账户页：略大一点，少滚一点，新建卡片更靠近键盘
  const [showDuplicateNameModal, setShowDuplicateNameModal] = useState(false);
  const [duplicateNameModalPayload, setDuplicateNameModalPayload] = useState<{
    duplicateName: string;
    targetId: string;
    editingId: string;
  } | null>(null);
  const [showQuickCleanModal, setShowQuickCleanModal] = useState(false);
  const [showMergeTargetModal, setShowMergeTargetModal] = useState(false);
  const [mergeTargetModalAccounts, setMergeTargetModalAccounts] = useState<Account[] | null>(null);
  const [mergeTargetSelectedId, setMergeTargetSelectedId] = useState<string | null>(null);
  const [showDeleteSelectedModal, setShowDeleteSelectedModal] = useState(false);
  const [deleteSelectedModalAccounts, setDeleteSelectedModalAccounts] = useState<Account[] | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const showToast = (message: string, duration: number = 1500) => {
    setToastMessage(message);
    Animated.sequence([
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.delay(duration),
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setToastMessage(null);
    });
  };

  useEffect(() => {
    loadAccounts();
  }, []);

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
              y: Math.max(0, y - KEYBOARD_SCROLL_OFFSET_PX),
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

  const loadAccounts = async () => {
    try {
      setLoading(true);
      const data = await getAccounts();
      setAccounts(data);
    } catch (error) {
      console.error('Error loading accounts:', error);
      showToast('Failed to load accounts');
    } finally {
      setLoading(false);
    }
  };

  const handleAddAccount = async () => {
    if (!newName.trim()) {
      showToast('Please enter account name');
      return;
    }

    try {
      const newAccount = await createAccount(newName.trim(), false);
      // 乐观更新：直接添加到列表中，不需要重新加载所有账户
      setAccounts(prev => [...prev, newAccount]);
      setNewName('');
      setShowAddForm(false);
      showToast('Account created');
    } catch (error: any) {
      console.error('Error creating account:', error);
      showToast(error.message || 'Failed to create account');
      // 如果失败，重新加载以确保数据一致
      loadAccounts();
    }
  };

  const handleUpdateAccount = async (accountId: string) => {
    if (!editName.trim()) {
      showToast('Please enter account name');
      return;
    }

    try {
      await updateAccount(accountId, {
        name: editName.trim(),
      });
      // 乐观更新：直接更新列表中的账户，不需要重新加载所有账户
      setAccounts(prev => prev.map(acc => 
        acc.id === accountId 
          ? { ...acc, name: editName.trim() }
          : acc
      ));
      setEditingId(null);
      setEditName('');
      // 移除成功提示对话框
    } catch (error: any) {
      if (error?.code === 'ACCOUNT_NAME_EXISTS') {
        setDuplicateNameModalPayload({
          duplicateName: (error?.duplicateName ?? editName) || '',
          targetId: error?.targetId ?? '',
          editingId: accountId,
        });
        setShowDuplicateNameModal(true);
        return;
      }
      console.error('Error updating account:', error);
      showToast(error.message || 'Failed to update account');
      loadAccounts();
    }
  };

  const handleDuplicateNameCloseOnly = () => {
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
  };

  /** Keep editing: close modal, stay in edit mode and focus name input + keyboard. */
  const handleDuplicateNameKeepEditing = () => {
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
    setTimeout(() => editNameInputRef.current?.focus(), 300);
  };

  /** Do not modify: close modal and cancel editing. */
  const handleDuplicateNameDontChange = () => {
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
    setEditingId(null);
    setEditName('');
  };

  const handleDuplicateNameMerge = async () => {
    const payload = duplicateNameModalPayload;
    if (!payload?.targetId || !payload?.editingId) return;
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
    try {
      await mergeAccount([payload.editingId], payload.targetId);
      setEditingId(null);
      setEditName('');
      loadAccounts();
    } catch (e: any) {
      showToast(e?.message ?? 'Merge failed');
      loadAccounts();
    }
  };

  const handleDeleteAccount = async (account: Account) => {
    confirmDestructive(
      'Delete Account',
      `Are you sure you want to delete "${account.name}"?`,
      async () => {
        try {
          await deleteAccount(account.id);
          setAccounts(prev => prev.filter(acc => acc.id !== account.id));
          showToast('Account deleted');
        } catch (error: any) {
          console.error('Error deleting account:', error);
          showToast(error.message || 'Failed to delete account');
          loadAccounts();
        }
      },
      { confirmLabel: 'Delete' }
    );
  };

  const startEdit = (account: Account) => {
    setEditingId(account.id);
    setEditName(account.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const toggleAccountSelection = (accountId: string) => {
    const newSelected = new Set(selectedAccountIds);
    if (newSelected.has(accountId)) {
      newSelected.delete(accountId);
    } else {
      newSelected.add(accountId);
    }
    setSelectedAccountIds(newSelected);
  };

  const handleStartMerge = async () => {
    setMergeMode(true);
    setSelectedAccountIds(new Set());
    setEditingId(null);
    setShowAddForm(false);
    setExpandedRootIds(new Set());
    try {
      const [historyData, counts] = await Promise.all([
        getAccountsForMergeHistory(),
        getAccountUsageCounts(),
      ]);
      setMergeHistoryData(historyData);
      setUsageCounts(counts);
    } catch (e: any) {
      console.error('Error loading merge history:', e);
      showToast(e?.message ?? 'Failed to load merge data');
    }
  };

  const handleCancelMerge = () => {
    setMergeMode(false);
    setSelectedAccountIds(new Set());
    setMergeHistoryData(null);
    setUsageCounts(null);
    setExpandedRootIds(new Set());
  };

  const handleConfirmMerge = () => {
    if (selectedAccountIds.size < 2) {
      showToast('Please select at least 2 accounts to merge');
      return;
    }
    const allAccountsInMergeMode = mergeHistoryData
      ? [
          ...mergeHistoryData.roots,
          ...Array.from(mergeHistoryData.childrenByRootId.values()).flat(),
        ]
      : accounts;
    const selectedAccounts = allAccountsInMergeMode.filter((acc) =>
      selectedAccountIds.has(acc.id)
    );
    setMergeTargetModalAccounts(selectedAccounts);
    setMergeTargetSelectedId(null);
    setShowMergeTargetModal(true);
  };

  const setMergeTargetSelection = (accountId: string) => {
    setMergeTargetSelectedId(accountId);
  };

  const confirmMergeTarget = () => {
    if (!mergeTargetSelectedId) return;
    const sourceIds = Array.from(selectedAccountIds).filter((id) => id !== mergeTargetSelectedId);
    setShowMergeTargetModal(false);
    setMergeTargetModalAccounts(null);
    setMergeTargetSelectedId(null);
    performMerge(sourceIds, mergeTargetSelectedId);
  };

  const handleUnmerge = async (childId: string) => {
    try {
      await unmergeAccount(childId);
      await loadAccounts();
      const [historyData, counts] = await Promise.all([
        getAccountsForMergeHistory(),
        getAccountUsageCounts(),
      ]);
      setMergeHistoryData(historyData);
      setUsageCounts(counts);
      setSelectedAccountIds((prev) => {
        const next = new Set(prev);
        next.delete(childId);
        return next;
      });
      showToast('Unmerged');
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to unmerge');
    }
  };

  const performMerge = async (sourceAccountIds: string[], targetAccountId: string) => {
    try {
      await mergeAccount(sourceAccountIds, targetAccountId);
      await loadAccounts();
      const [historyData, counts] = await Promise.all([
        getAccountsForMergeHistory(),
        getAccountUsageCounts(),
      ]);
      setMergeHistoryData(historyData);
      setUsageCounts(counts);
      setSelectedAccountIds(new Set());
      setExpandedRootIds(new Set());
      showToast('Accounts merged successfully');
    } catch (error: any) {
      console.error('Error merging accounts:', error);
      showToast(error.message || 'Failed to merge accounts');
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

  const directReceipts = (id: string) => usageCounts?.receiptCountByAccountId[id] ?? 0;
  const directInvoices = (id: string) => usageCounts?.invoiceCountByAccountId[id] ?? 0;

  /** 可清理的账户：根账户、无关联数据、无子账户（未被合并且没有合并进自己的） */
  const cleanableRoots = (() => {
    if (!mergeHistoryData || !usageCounts) return [];
    return mergeHistoryData.roots.filter((root) => {
      const children = mergeHistoryData.childrenByRootId.get(root.id) ?? [];
      const hasUsage = directReceipts(root.id) + directInvoices(root.id) > 0;
      const hasChildUsage = children.some(
        (c) => directReceipts(c.id) + directInvoices(c.id) > 0
      );
      const hasChildren = children.length > 0;
      return !hasUsage && !hasChildUsage && !hasChildren;
    });
  })();

  const handleCleanEmpty = () => {
    if (cleanableRoots.length === 0) {
      showToast('No empty accounts to clean.');
      return;
    }
    setShowQuickCleanModal(true);
  };

  const doQuickCleanConfirm = async () => {
    if (cleanableRoots.length === 0) return;
    setShowQuickCleanModal(false);
    try {
      for (const root of cleanableRoots) {
        await deleteAccount(root.id);
      }
      await loadAccounts();
      const [historyData, counts] = await Promise.all([
        getAccountsForMergeHistory(),
        getAccountUsageCounts(),
      ]);
      setMergeHistoryData(historyData);
      setUsageCounts(counts);
      showToast(`Cleaned ${cleanableRoots.length} empty account(s).`);
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to clean');
    }
  };

  const handleDeleteSelected = () => {
    if (selectedAccountIds.size === 0) return;
    const allInMerge = mergeHistoryData
      ? [
          ...mergeHistoryData.roots,
          ...Array.from(mergeHistoryData.childrenByRootId.values()).flat(),
        ]
      : [];
    const selected = allInMerge.filter((a) => selectedAccountIds.has(a.id));
    setDeleteSelectedModalAccounts(selected);
    setShowDeleteSelectedModal(true);
  };

  const doDeleteSelectedConfirm = async () => {
    const selected = deleteSelectedModalAccounts;
    setShowDeleteSelectedModal(false);
    setDeleteSelectedModalAccounts(null);
    if (!selected || selected.length === 0) return;
    try {
      for (const acc of selected) {
        await deleteAccount(acc.id);
      }
      await loadAccounts();
      const [historyData, counts] = await Promise.all([
        getAccountsForMergeHistory(),
        getAccountUsageCounts(),
      ]);
      setMergeHistoryData(historyData);
      setUsageCounts(counts);
      setSelectedAccountIds(new Set());
      showToast(`Deleted ${selected.length} account(s).`);
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to delete');
    }
  };

  const totalCount = (root: Account, children: Account[]) => {
    return (
      directReceipts(root.id) +
      directInvoices(root.id) +
      children.reduce((s, c) => s + directReceipts(c.id) + directInvoices(c.id), 0)
    );
  };
  const directCount = (id: string) => directReceipts(id) + directInvoices(id);

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6C5CE7" />
        </View>
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

      <Modal visible={showDuplicateNameModal} transparent animationType="fade" onRequestClose={handleDuplicateNameCloseOnly}>
        <TouchableOpacity style={styles.duplicateModalOverlay} activeOpacity={1} onPress={handleDuplicateNameCloseOnly}>
          <View style={styles.duplicateModalContentContainer} onStartShouldSetResponder={() => true}>
            <View style={styles.duplicateModalContent}>
              <View style={styles.duplicateModalHeader}>
                <Ionicons name="wallet-outline" size={48} color="#6C5CE7" />
                <Text style={styles.duplicateModalTitle}>Duplicate account name:</Text>
              </View>
              <View style={styles.duplicateModalMessageBlock}>
                <View style={styles.duplicateModalNameContainer}>
                  <Text style={styles.duplicateModalNameText}>{duplicateNameModalPayload?.duplicateName || '—'}</Text>
                </View>
              </View>
              <View style={styles.duplicateModalButtons}>
                <TouchableOpacity style={[styles.duplicateModalButton, styles.duplicateModalButtonReplace]} onPress={handleDuplicateNameKeepEditing} activeOpacity={0.8}>
                  <Ionicons name="create-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.duplicateModalButtonReplaceText}>Keep editing</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.duplicateModalButton, styles.duplicateModalButtonMerge]} onPress={handleDuplicateNameMerge} activeOpacity={0.8}>
                  <Ionicons name="git-merge-outline" size={20} color="#E74C3C" style={{ marginRight: 8 }} />
                  <Text style={styles.duplicateModalButtonMergeText}>Merge into existing</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.duplicateModalButton, styles.duplicateModalButtonDontChange]} onPress={handleDuplicateNameDontChange} activeOpacity={0.8}>
                  <Ionicons name="close-outline" size={18} color="#95A5A6" style={{ marginRight: 6 }} />
                  <Text style={styles.duplicateModalButtonDontChangeText}>Do not modify</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Quick Clean secondary float */}
      <Modal visible={showQuickCleanModal} transparent animationType="fade" onRequestClose={() => setShowQuickCleanModal(false)}>
        <TouchableOpacity style={styles.actionModalOverlay} activeOpacity={1} onPress={() => setShowQuickCleanModal(false)}>
          <View style={styles.actionModalContentContainer} onStartShouldSetResponder={() => true}>
            <View style={styles.actionModalContent}>
              <View style={styles.actionModalHeader}>
                <View style={styles.actionModalHeaderIconWrap}>
                  <Ionicons name="trash-outline" size={40} color="#E67E22" />
                </View>
                <Text style={styles.actionModalTitle}>Quick Clean</Text>
                <Text style={styles.actionModalSubtitle}>
                  Delete {cleanableRoots.length} empty account(s):
                </Text>
                <Text style={styles.actionModalSubtitleLight}>(no linked data, not merged)</Text>
              </View>
              <ScrollView style={styles.actionModalList} contentContainerStyle={styles.actionModalListContent} nestedScrollEnabled showsVerticalScrollIndicator>
                {cleanableRoots.map((r) => (
                  <View key={r.id} style={styles.actionModalRow}>
                    <Text style={styles.actionModalRowText} numberOfLines={1}>{r.name}</Text>
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

      {/* Merge: choose which account to keep, then confirm (secondary float) */}
      <Modal visible={showMergeTargetModal} transparent animationType="fade" onRequestClose={() => { setShowMergeTargetModal(false); setMergeTargetModalAccounts(null); setMergeTargetSelectedId(null); }}>
        <TouchableOpacity style={styles.actionModalOverlay} activeOpacity={1} onPress={() => { setShowMergeTargetModal(false); setMergeTargetModalAccounts(null); setMergeTargetSelectedId(null); }}>
          <View style={styles.actionModalContentContainer} onStartShouldSetResponder={() => true}>
            <View style={styles.actionModalContent}>
              <View style={styles.actionModalHeader}>
                <View style={styles.actionModalHeaderIconWrap}>
                  <Ionicons name="git-merge-outline" size={40} color="#6C5CE7" />
                </View>
                <Text style={styles.actionModalTitle}>Choose which account to keep,</Text>
                <Text style={styles.actionModalSubtitle}>Others will be merged into it.</Text>
              </View>
              <ScrollView style={styles.actionModalList} contentContainerStyle={styles.actionModalListContent} nestedScrollEnabled showsVerticalScrollIndicator>
                {(mergeTargetModalAccounts ?? []).map((acc) => (
                  <TouchableOpacity
                    key={acc.id}
                    style={[styles.actionModalRowTappable, mergeTargetSelectedId === acc.id && styles.actionModalRowSelected]}
                    onPress={() => setMergeTargetSelection(acc.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.actionModalRowText} numberOfLines={1}>{acc.name}</Text>
                    {mergeTargetSelectedId === acc.id ? (
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

      {/* Delete selected (secondary float) */}
      <Modal visible={showDeleteSelectedModal} transparent animationType="fade" onRequestClose={() => { setShowDeleteSelectedModal(false); setDeleteSelectedModalAccounts(null); }}>
        <TouchableOpacity style={styles.actionModalOverlay} activeOpacity={1} onPress={() => { setShowDeleteSelectedModal(false); setDeleteSelectedModalAccounts(null); }}>
          <View style={styles.actionModalContentContainer} onStartShouldSetResponder={() => true}>
            <View style={styles.actionModalContent}>
              <View style={styles.actionModalHeader}>
                <View style={styles.actionModalHeaderIconWrap}>
                  <Ionicons name="trash-outline" size={40} color="#E74C3C" />
                </View>
                <Text style={styles.actionModalSubtitle}>
                  Delete {deleteSelectedModalAccounts?.length ?? 0} selected account(s)?
                </Text>
              </View>
              <ScrollView style={styles.actionModalList} contentContainerStyle={styles.actionModalListContent} nestedScrollEnabled showsVerticalScrollIndicator>
                {(deleteSelectedModalAccounts ?? []).map((acc) => (
                  <View key={acc.id} style={styles.actionModalRow}>
                    <Text style={styles.actionModalRowText} numberOfLines={1}>{acc.name}</Text>
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

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
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
          {/* 表标题行：Account 右端紧跟 已选/总数 */}
          <View style={styles.headerTableRow}>
            <View style={styles.checkboxContainer} />
            <View style={styles.headerTableRowNameCell}>
              <Text style={styles.tableHeaderNameLeft}>Account</Text>
              <Text style={styles.headerSelectedCount}>
                （{selectedAccountIds.size}/{mergeHistoryData
                  ? mergeHistoryData.roots.length
                  : accounts.length}）
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
              text="Accounts for expenses & income, support merged accounts."
              style={styles.headerTitle}
              containerStyle={styles.gradientTextContainer}
            />
          </View>
        </View>
      )}

      <ScrollView ref={scrollViewRef} style={styles.scrollView} contentContainerStyle={[styles.scrollContent, styles.scrollContentTop, styles.scrollContentWithBottomBar, showAddForm && keyboardHeight > 0 && { paddingBottom: 88 + keyboardHeight + 6 }]} keyboardShouldPersistTaps="handled">
        {/* Accounts List */}
        <View ref={scrollContentRef} style={styles.accountsList}>
          {mergeMode ? (
            // Merge Mode: 直接显示复选框列表，不闪现 icon/AI；展开 icon 放最右
            accounts.map((account) => {
              const children = mergeHistoryData?.childrenByRootId?.get(account.id) ?? [];
              const expanded = expandedRootIds.has(account.id);
              const hasChildren = children.length > 0;
              return (
                <View key={account.id} style={styles.accountCard}>
                  <View
                    style={[
                      styles.accountRow,
                      styles.accountRowCountsGap,
                      selectedAccountIds.has(account.id) && styles.accountRowSelected,
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.mergeRowSelectionArea}
                      onPress={() => toggleAccountSelection(account.id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.checkboxContainer}>
                        {selectedAccountIds.has(account.id) ? (
                          <Ionicons name="checkbox" size={24} color="#6C5CE7" />
                        ) : (
                          <Ionicons name="checkbox-outline" size={24} color="#BDC3C7" />
                        )}
                      </View>
                      <Text style={styles.accountName} numberOfLines={1}>
                        {account.name}
                      </Text>
                      <View style={styles.countsCell}>
                        <Text style={styles.countText}>
                          {expanded ? directCount(account.id) : totalCount(account, children)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    {hasChildren ? (
                      <TouchableOpacity
                        style={styles.expandButtonSmall}
                        onPress={() => toggleExpand(account.id)}
                        hitSlop={{ left: 0, right: 48, top: 24, bottom: 24 }}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name={expanded ? 'chevron-down' : 'chevron-forward'}
                          size={14}
                          color="#6C5CE7"
                        />
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.expandPlaceholderSmall} />
                    )}
                  </View>
                  {expanded &&
                    children.map((child) => (
                      <View
                        key={child.id}
                        style={[
                          styles.childRow,
                          selectedAccountIds.has(child.id) && styles.accountRowSelected,
                        ]}
                      >
                        <TouchableOpacity
                          style={styles.mergeRowSelectionArea}
                          onPress={() => toggleAccountSelection(child.id)}
                          activeOpacity={0.7}
                        >
                          <View style={styles.checkboxContainer}>
                            {selectedAccountIds.has(child.id) ? (
                              <Ionicons name="checkbox" size={24} color="#6C5CE7" />
                            ) : (
                              <Ionicons name="checkbox-outline" size={24} color="#BDC3C7" />
                            )}
                          </View>
                          <Text style={styles.childName} numberOfLines={1}>
                            {child.name}
                          </Text>
                          <View style={styles.countsCell}>
                            <Text style={styles.countText}>{directCount(child.id)}</Text>
                          </View>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.childRowUnmergeButton}
                          onPress={() => handleUnmerge(child.id)}
                          hitSlop={{ left: 8, right: 8, top: 8, bottom: 8 }}
                        >
                          <Ionicons name="exit-outline" size={14} color="#6C5CE7" />
                        </TouchableOpacity>
                      </View>
                    ))}
                </View>
              );
            })
          ) : (
            // Normal Mode: Show regular account list
            accounts.map((account) => (
              <View key={account.id} style={styles.accountCard}>
                {editingId === account.id ? (
                  // Edit Mode
                  <View style={styles.editRow}>
                    {/* 第一行：名称 */}
                    <TextInput
                      ref={editNameInputRef}
                      style={styles.editInputInline}
                      value={editName}
                      onChangeText={setEditName}
                      placeholder="Account name"
                      placeholderTextColor="#95A5A6"
                    />
                    {/* 第二行：确认取消按钮 */}
                    <View style={actionButtonStyles.editRowButtons}>
                      <TouchableOpacity
                        style={actionButtonStyles.editCancelButton}
                        onPress={cancelEdit}
                      >
                        <Text style={actionButtonStyles.editCancelButtonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={actionButtonStyles.editConfirmButton}
                        onPress={() => handleUpdateAccount(account.id)}
                      >
                        <Text style={actionButtonStyles.editConfirmButtonText}>Confirm</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  // Display Mode
                  <TouchableOpacity
                    style={styles.accountRow}
                    onPress={() => {
                      if (mergeMode) {
                        toggleAccountSelection(account.id);
                      }
                    }}
                    disabled={mergeMode}
                  >
                    <View style={styles.accountIndicator}>
                      <Ionicons name="card-outline" size={16} color="#6C5CE7" />
                      {account.isAiRecognized && (
                        <View style={styles.aiBadgeInIcon}>
                          <Text style={styles.aiBadgeTextInIcon}>AI</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.accountName} numberOfLines={1}>
                      {account.name}
                    </Text>
                    {!mergeMode && (
                      <View style={styles.accountActions}>
                        <TouchableOpacity
                          style={styles.iconButton}
                          onPress={() => startEdit(account)}
                        >
                          <Ionicons name="create-outline" size={18} color="#6C5CE7" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}

          {/* Add Account Form - 列表最下方，与编辑表单一致（editRow） */}
          {showAddForm && (
            <View ref={addFormCardRef} style={styles.formCard}>
              <View style={styles.editRow}>
                <TextInput
                  ref={newNameInputRef}
                  style={styles.editInputInline}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Account name"
                  placeholderTextColor="#95A5A6"
                />
                <View style={actionButtonStyles.editRowButtons}>
                <TouchableOpacity
                  style={actionButtonStyles.editCancelButton}
                  onPress={() => {
                    setShowAddForm(false);
                    setNewName('');
                  }}
                >
                  <Text style={actionButtonStyles.editCancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={actionButtonStyles.editConfirmButton}
                  onPress={handleAddAccount}
                >
                  <Text style={actionButtonStyles.editConfirmButtonText}>Confirm</Text>
                </TouchableOpacity>
              </View>
              </View>
            </View>
          )}
        </View>

      </ScrollView>

      {/* 底部浮动：Add + Merge 按钮 */}
      {!showAddForm && !mergeMode && (
        <View style={[actionButtonStyles.bar, actionButtonStyles.barMergeMode]}>
          <TouchableOpacity style={actionButtonStyles.barButtonSecondaryFlex} onPress={() => setShowAddForm(true)}>
            <Ionicons name="add-circle" size={20} color="#6C5CE7" style={actionButtonStyles.barIconFix} />
            <Text style={actionButtonStyles.barButtonSecondaryText}>Add</Text>
          </TouchableOpacity>
          <TouchableOpacity style={actionButtonStyles.barButtonPrimaryFlex} onPress={handleStartMerge}>
            <Ionicons name="git-merge-outline" size={20} color="#fff" style={actionButtonStyles.barIconFix} />
            <Text style={actionButtonStyles.barButtonPrimaryText}>Merge & Clean</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Organize mode: Cancel 靠左, Merge 居中, Delete 靠右 */}
      {mergeMode && (
        <View style={[actionButtonStyles.bar, actionButtonStyles.barMergeMode]}>
          {selectedAccountIds.size === 0 && (
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
          {selectedAccountIds.size === 1 && (
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
          {selectedAccountIds.size >= 2 && (
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
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
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
  toastText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
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
    minHeight: 88,
  },
  headerMerge: {
    flexDirection: 'column',
    paddingTop: 13,
    paddingBottom: 0,
    minHeight: 88,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  headerMergeTextBlock: {
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    paddingBottom: 4,
    paddingLeft: 64,
    paddingRight: 16,
    paddingTop: 0,
    minHeight: 56,
  },
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
  headerPlaceholder: {
    height: 88,
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  gradientTextContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingRight: 12,
  },
  scrollContentTop: {
    paddingTop: 6,
  },
  scrollContentWithBottomBar: {
    paddingBottom: 88,
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  accountsList: {
    gap: 6,
  },
  accountCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 10,
    paddingRight: 4,
    minHeight: 40,
    ...(Platform.OS === 'web' && { flex: undefined, overflow: 'visible' as const }),
  },
  /** 展开 icon 或占位，固定宽度保证数字列对齐 */
  expandButtonSmall: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  mergeRowSelectionArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  expandPlaceholderSmall: {
    width: 20,
  },
  countsCell: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    minWidth: 72,
  },
  countText: {
    fontSize: 13,
    color: '#636E72',
    textAlign: 'right',
  },
  tableHeaderName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#636E72',
  },
  tableHeaderCount: {
    minWidth: 72,
    fontSize: 13,
    fontWeight: '600',
    color: '#636E72',
    textAlign: 'right',
  },
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
  childName: {
    flex: 1,
    fontSize: 14,
    color: '#636E72',
  },
  childRowUnmergeButton: {
    width: 20,
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
  },
  /** merge 表行：数字列与右端 icon 间距缩小，数字列右移 */
  accountRowCountsGap: { gap: 2 },
  accountIndicator: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    position: 'relative',
  },
  aiBadgeInIcon: {
    position: 'absolute',
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
  aiBadgeTextInIcon: {
    fontSize: 8,
    fontWeight: '600',
    color: '#6C5CE7',
  },
  accountName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: '#2D3436',
  },
  accountActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  addAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addAccountText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6C5CE7',
  },
  mergeAccountText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FF9500',
  },
  iconButton: {
    padding: 4,
  },
  editRow: {
    flexDirection: 'column',
    gap: 8,
  },
  editInputInline: {
    width: '100%',
    backgroundColor: '#F8F9FA',
    borderRadius: 6,
    padding: 8,
    fontSize: 15,
    color: '#2D3436',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    marginBottom: 8,
  },
  mergeHeaderTextInHeader: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'left',
  },
  mergeHeaderGradientContainer: {
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    width: '100%',
  },
  headerTableRowNameCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  tableHeaderNameLeft: {
    fontSize: 13,
    fontWeight: '600',
    color: '#636E72',
  },
  headerSelectedCount: {
    fontSize: 13,
    fontWeight: '600',
    color: '#636E72',
    marginLeft: 4,
  },
  mergeButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 6,
    flexShrink: 0,
  },
  mergeHeaderButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  mergeCancelButton: {
    flex: 1,
    backgroundColor: '#E9ECEF',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  mergeCancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#636E72',
  },
  mergeConfirmButton: {
    flex: 1,
    backgroundColor: '#6C5CE7',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  mergeConfirmButtonDisabled: {
    backgroundColor: '#BDC3C7',
    opacity: 0.5,
  },
  mergeConfirmButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  checkboxContainer: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  accountRowSelected: {
    backgroundColor: '#E8F4FD',
  },
  duplicateModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  duplicateModalContentContainer: { width: '100%', maxWidth: 400, alignItems: 'center' },
  duplicateModalContent: { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '100%', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8 },
  duplicateModalHeader: { alignItems: 'center', marginBottom: 16 },
  duplicateModalTitle: { fontSize: 22, fontWeight: '600', color: '#2D3436', marginTop: 12, marginBottom: 0 },
  duplicateModalMessageBlock: { marginBottom: 24, paddingHorizontal: 8, alignItems: 'center', width: '100%' },
  duplicateModalNameContainer: { marginTop: 8, marginBottom: 20, alignSelf: 'stretch', borderBottomWidth: 1, borderBottomColor: '#E0E7FF', paddingBottom: 8 },
  duplicateModalNameText: { fontSize: 18, fontWeight: '800', color: '#6C5CE7', textAlign: 'center', letterSpacing: 0.3 },
  duplicateModalButtons: { flexDirection: 'column', width: '100%', gap: 10 },
  duplicateModalButton: { width: '100%', paddingVertical: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', minHeight: 52, flexDirection: 'row' },
  duplicateModalButtonReplace: { backgroundColor: '#27AE60', shadowColor: '#27AE60', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  duplicateModalButtonReplaceText: { fontSize: 17, fontWeight: '700', color: '#fff', letterSpacing: 0.5 },
  duplicateModalButtonMerge: { backgroundColor: '#FFF5F5', borderWidth: 2, borderColor: '#E74C3C' },
  duplicateModalButtonMergeText: { fontSize: 16, fontWeight: '600', color: '#E74C3C' },
  duplicateModalButtonDontChange: { backgroundColor: '#F8F9FA', borderWidth: 1, borderColor: '#E9ECEF' },
  duplicateModalButtonDontChangeText: { fontSize: 15, fontWeight: '500', color: '#95A5A6' },

  // 二级选项浮窗（Quick Clean / Merge 选保留 / Delete 选中）- 可复用于其他可合并数据
  actionModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  actionModalContentContainer: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    alignItems: 'center',
  },
  actionModalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  actionModalHeader: {
    alignItems: 'center',
    alignSelf: 'stretch',
    marginBottom: 20,
    paddingTop: 4,
  },
  actionModalHeaderIconWrap: {
    marginBottom: 8,
  },
  actionModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A2E',
    marginTop: 8,
    marginBottom: 4,
    textAlign: 'center',
  },
  actionModalSubtitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A2E',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  actionModalSubtitleLight: {
    fontSize: 16,
    fontWeight: '400',
    color: '#1A1A2E',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
    marginTop: 2,
  },
  actionModalList: {
    width: '100%',
    minHeight: 120,
    maxHeight: 352,
    marginTop: 8,
    marginBottom: 20,
  },
  actionModalListContent: {
    paddingBottom: 8,
  },
  actionModalRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  actionModalRowTappable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  actionModalRowSelected: {
    backgroundColor: '#E8F4FD',
    borderLeftWidth: 3,
    borderLeftColor: '#6C5CE7',
  },
  actionModalRowText: {
    fontSize: 16,
    color: '#2D3436',
    flex: 1,
  },
  actionModalButtons: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
    justifyContent: 'flex-end',
  },
  actionModalButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  actionModalButtonSecondary: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  actionModalButtonSecondaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#636E72',
  },
  actionModalButtonPrimary: {
    backgroundColor: '#6C5CE7',
  },
  actionModalButtonPrimaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  actionModalButtonWarning: {
    backgroundColor: '#FFF5F0',
    borderWidth: 1,
    borderColor: '#E67E22',
  },
  actionModalButtonWarningText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#E67E22',
  },
  actionModalButtonDanger: {
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#E74C3C',
  },
  actionModalButtonDangerText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#E74C3C',
  },
});

