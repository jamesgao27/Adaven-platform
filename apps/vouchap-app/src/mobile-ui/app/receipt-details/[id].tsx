import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  Modal,
  Platform,
  InteractionManager,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { getReceiptById, updateReceipt, updateReceiptItem, deleteReceipt } from '@/lib/database';
import { reprocessExpenseReceiptFromStoredMedia } from '@/lib/reprocess-voucher-recognition';
import { supabase, uploadReceiptImage } from '@/lib/supabase';
import { processImageForUpload } from '@/lib/image-processor';
import { getCategories } from '@/lib/categories';
import { getAttributions } from '@/lib/attributions';
import { sortScopeTagsForDisplay } from '@/lib/sort-scope-tags-for-display';
import { getAccounts, mergeAccount } from '@/lib/accounts';
import { getSupplierOptions } from '@/lib/customer-supplier-list';
import { normalizeNameForCompare } from '@/lib/name-utils';
import { mergeEntity, getCanonicalEntityId } from '@/lib/entities';
import { getChatLogsByReceiptId } from '@/lib/chat-logs';
import { getLocalDateString } from '@/lib/date-utils';
import { playAudio, stopPlayback } from '@/lib/audio';
import { Receipt, ReceiptItem, Category, Attribution, ReceiptStatus, Account } from '@/types';
import { format } from 'date-fns';
import { showToast } from '@/lib/toast';
import { showChoiceDialog, showConfirmDestructiveDialog } from '@/lib/confirmDialog';
import {
  FileDetailModal,
  looksLikeDocumentAttachmentUrl,
  looksLikePdfUrl,
  type FileDetailModalFile,
} from '@/components/FileDetailModal';
import {
  LineItemPillAnchorDropdownWeb,
  LineItemAttributionAnchorDropdownWeb,
  buildLineItemCategoryOptions,
  lineItemCategorySelectValue,
  buildLineItemAttributionOptions,
} from '@/components/voucher-table-columns';
import { useWebViewportKind } from '../../lib/web-viewport';

export default function ReceiptDetailsScreen() {
  const { id, new: isNew } = useLocalSearchParams<{ id: string; new?: string }>();
  const router = useRouter();
  const { isDesktopWeb } = useWebViewportKind();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [editedReceipt, setEditedReceipt] = useState<Receipt | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isReprocessingRecognition, setIsReprocessingRecognition] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [attributions, setAttributions] = useState<Attribution[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showCategoryPicker, setShowCategoryPicker] = useState<number | null>(null);
  const [showAttributionPicker, setShowAttributionPicker] = useState<number | null>(null);
  const [showAccountPicker, setShowAccountPicker] = useState<boolean>(false);
  const [showSupplierPicker, setShowSupplierPicker] = useState<boolean>(false);
  const [supplierOptions, setSupplierOptions] = useState<{ id: string; name: string; source: 'supplier' | 'customer' }[]>([]);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState<boolean>(false);
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [taxInputText, setTaxInputText] = useState<string>('');
  const [priceInputTexts, setPriceInputTexts] = useState<{ [index: number]: string }>({});
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [showDuplicateNameModal, setShowDuplicateNameModal] = useState(false);
  const [duplicateNameModalPayload, setDuplicateNameModalPayload] = useState<{
    code: string;
    duplicateName: string;
    targetId?: string;
    targetSource?: 'supplier' | 'customer';
    triggeredBy: 'save' | 'dropdown';
  } | null>(null);
  /** Replace/Merge 若只写 React state，下一次点 Confirm 才可能读到 pending，造成「弹窗选完还要再点一次确认」；用 ref 同步携带并在 save 来源时立即继续保存 */
  const duplicateResolutionRef = useRef<{
    choice: 'replace' | 'merge' | 'keep_original';
    payload: {
      code: string;
      duplicateName: string;
      targetId?: string;
      targetSource?: 'supplier' | 'customer';
    };
  } | null>(null);
  const [fileDetailForModal, setFileDetailForModal] = useState<FileDetailModalFile | null>(null);
  const editingRef = useRef(false);
  const receiptStatusRef = useRef<string | null>(null);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  const applyReceiptFormInputs = useCallback((data: Receipt) => {
    setTaxInputText((data.tax || 0).toString());
    const priceTexts: { [index: number]: string } = {};
    (data.items || []).forEach((item, index) => {
      priceTexts[index] = String(item.price ?? 0);
    });
    setPriceInputTexts(priceTexts);
  }, []);

  const loadReceipt = useCallback(async (options?: { forceSyncEdited?: boolean }) => {
    if (!id) return;
    try {
      const data = await getReceiptById(id);
      const prevStatus = receiptStatusRef.current;
      const nextStatus = data?.status ?? null;
      const recognitionJustFinished =
        prevStatus === 'processing' && !!nextStatus && nextStatus !== 'processing';
      receiptStatusRef.current = nextStatus;
      setReceipt(data);

      // 编辑态默认不覆盖草稿；识别中 / 识别刚完成必须同步，否则 UI 一直停在 Processing 占位
      const shouldSyncEdited =
        options?.forceSyncEdited ??
        (!editingRef.current || nextStatus === 'processing' || recognitionJustFinished);
      if (shouldSyncEdited && data) {
        setEditedReceipt(data);
        if (nextStatus === 'processing' || recognitionJustFinished || options?.forceSyncEdited) {
          applyReceiptFormInputs(data);
        }
      }

      // 仅语音录入才显示回放按钮（document 的 attachment_url 不得当作 audio）
      try {
        const chatLogs = await getChatLogsByReceiptId(id);
        const audioLog = chatLogs.find((log) => log.type === 'audio' && log.audioUrl);
        setAudioUrl(audioLog?.audioUrl ?? null);
      } catch (chatError) {
        console.log('Failed to get chat logs for audio:', chatError);
        setAudioUrl(null);
      }

      // 新单：识别完成后再自动进入编辑（processing 期间保持只读并跟随 realtime）
      if (isNew === 'true' && data && data.status !== 'processing' && shouldSyncEdited) {
        setEditing(true);
        applyReceiptFormInputs(data);
      }
    } catch (error) {
      showToast('Failed to load receipt details', 'error');
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [id, isNew, applyReceiptFormInputs]);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      loadReceipt();
      loadCategories();
      loadAttributions();
      loadAccounts();
    });
    return () => task.cancel();
  }, [id, loadReceipt]);

  // Realtime：当前小票或明细被更新时自动重新加载
  useEffect(() => {
    if (!id) return;
    let ch: ReturnType<typeof supabase.channel> | null = null;
    let chItems: ReturnType<typeof supabase.channel> | null = null;
    const refresh = () => {
      void loadReceipt();
    };
    ch = supabase
      .channel(`receipt-detail-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'receipts', filter: `id=eq.${id}` }, refresh)
      .subscribe();
    chItems = supabase
      .channel(`receipt-detail-items-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'receipt_items', filter: `receipt_id=eq.${id}` }, refresh)
      .subscribe();
    return () => {
      if (ch) supabase.removeChannel(ch);
      if (chItems) supabase.removeChannel(chItems);
    };
  }, [id, loadReceipt]);

  // Fallback poll while recognition is in progress (Realtime on receipts can miss updates on some devices)
  useEffect(() => {
    if (!id || receipt?.status !== 'processing') return;
    const timer = setInterval(() => {
      void loadReceipt();
    }, 2500);
    return () => clearInterval(timer);
  }, [id, receipt?.status, loadReceipt]);

  // 当页面获得焦点时（从其他页面返回），只重新加载分类、用途和支付账户（因为这些可能在管理页面被修改）
  // 小票数据不需要重新加载，除非id改变
  useFocusEffect(
    useCallback(() => {
      loadCategories();
      loadAttributions();
      loadAccounts();
    }, [])
  );

  const loadCategories = async () => {
    try {
      const cats = await getCategories('expense');
      setCategories(cats);
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  };

  const loadAttributions = async () => {
    try {
      const purps = await getAttributions('expense');
      setAttributions(purps);
    } catch (error) {
      console.error('Error loading attributions:', error);
    }
  };

  const loadAccounts = async () => {
    try {
      const data = await getAccounts();
      setAccounts(data);
    } catch (error) {
      console.error('Error loading payment accounts:', error);
    }
  };

  const openDuplicateModalFromSaveError = (error: any) => {
    const code = error?.code as string | undefined;
    const duplicateName = (error?.duplicateName ?? '') as string;
    const targetId = error?.targetId as string | undefined;
    const targetSource = error?.targetSource as 'supplier' | 'customer' | undefined;
    if (
      code === 'SUPPLIER_NAME_EXISTS' ||
      code === 'CUSTOMER_NAME_EXISTS' ||
      code === 'ENTITY_NAME_EXISTS' ||
      code === 'ACCOUNT_NAME_EXISTS'
    ) {
      setDuplicateNameModalPayload({
        code,
        duplicateName: duplicateName || '',
        targetId,
        targetSource: code === 'ENTITY_NAME_EXISTS' || code === 'ACCOUNT_NAME_EXISTS' ? undefined : targetSource,
        triggeredBy: 'save',
      });
      setShowDuplicateNameModal(true);
      return true;
    }
    return false;
  };

  const runDuplicateResolutionSave = async (
    choice: 'replace' | 'merge' | 'keep_original',
    payload: {
      code: string;
      duplicateName: string;
      targetId?: string;
      targetSource?: 'supplier' | 'customer';
    },
  ) => {
    if (!editedReceipt || !id || !receipt) return;
    try {
      if (choice === 'replace') {
        if (payload.code === 'ENTITY_NAME_EXISTS' && payload.targetId) {
          const entityPayload = {
            ...editedReceipt,
            status: 'confirmed' as ReceiptStatus,
            entityId: payload.targetId,
            entity: { id: payload.targetId, name: payload.duplicateName, spaceId: '', isAiRecognized: false } as any,
            supplierName: payload.duplicateName,
            storeName: payload.duplicateName,
          };
          (entityPayload as any).supplierId = undefined;
          (entityPayload as any).supplierCustomerId = undefined;
          (entityPayload as any).supplier = undefined;
          (entityPayload as any).supplierCustomer = undefined;
          await updateReceipt(id, entityPayload, true);
        } else {
          await updateReceipt(id, { ...editedReceipt, status: 'confirmed' as ReceiptStatus }, true);
        }
      } else if (choice === 'merge') {
        if (payload.code === 'ACCOUNT_NAME_EXISTS') {
          const currentAccountId = receipt.accountId;
          const targetId = payload.targetId;
          if (currentAccountId && targetId && currentAccountId !== targetId) {
            await mergeAccount([currentAccountId], targetId);
          }
          await updateReceipt(id, { ...editedReceipt, status: 'confirmed' as ReceiptStatus });
        } else if (payload.code === 'ENTITY_NAME_EXISTS' && payload.targetId) {
          const currentEntityId =
            editedReceipt.entityId ??
            editedReceipt.entity?.id ??
            editedReceipt.supplierId ??
            editedReceipt.supplierCustomerId ??
            receipt.entityId ??
            receipt.entity?.id ??
            receipt.supplierId ??
            receipt.supplierCustomerId ??
            null;
          if (currentEntityId && currentEntityId !== payload.targetId) {
            await mergeEntity([currentEntityId], payload.targetId);
          }
          const mergedPayload: any = {
            ...editedReceipt,
            status: 'confirmed' as ReceiptStatus,
            entityId: payload.targetId,
            entity: { id: payload.targetId, name: payload.duplicateName, spaceId: '', isAiRecognized: false } as any,
            supplierName: payload.duplicateName,
            storeName: payload.duplicateName,
          };
          mergedPayload.supplierId = undefined;
          mergedPayload.supplierCustomerId = undefined;
          mergedPayload.supplier = undefined;
          mergedPayload.supplierCustomer = undefined;
          await updateReceipt(id, mergedPayload, true);
        } else {
          const mergeFromId =
            receipt.entityId ??
            receipt.entity?.id ??
            receipt.supplierId ??
            receipt.supplierCustomerId ??
            null;
          const targetId = payload.targetId;
          if (mergeFromId && targetId && mergeFromId !== targetId) {
            await mergeEntity([mergeFromId], targetId);
          }
          const mergedPayload: any = {
            ...editedReceipt,
            status: 'confirmed' as ReceiptStatus,
            entityId: targetId,
            entity: targetId
              ? ({ id: targetId, name: payload.duplicateName, spaceId: '', isAiRecognized: false } as any)
              : editedReceipt.entity,
            supplierName: payload.duplicateName,
            storeName: payload.duplicateName,
          };
          mergedPayload.supplierId = undefined;
          mergedPayload.supplierCustomerId = undefined;
          mergedPayload.supplier = undefined;
          mergedPayload.supplierCustomer = undefined;
          await updateReceipt(id, mergedPayload, true);
        }
      } else {
        if (payload.code === 'ACCOUNT_NAME_EXISTS') {
          const reverted = {
            ...editedReceipt,
            status: 'confirmed' as ReceiptStatus,
            accountId: receipt.accountId,
            account: receipt.account,
          };
          await updateReceipt(id, reverted);
        } else if (payload.code === 'ENTITY_NAME_EXISTS') {
          const origName = receipt.entity?.name ?? receipt.supplier?.name ?? receipt.supplierCustomer?.name ?? receipt.supplierName ?? receipt.storeName ?? '';
          const reverted = {
            ...editedReceipt,
            status: 'confirmed' as ReceiptStatus,
            entityId: receipt.entityId ?? receipt.entity?.id,
            entity: receipt.entity,
            supplierName: origName,
            storeName: origName,
          };
          await updateReceipt(id, reverted);
        } else {
          const reverted = {
            ...editedReceipt,
            status: 'confirmed' as ReceiptStatus,
            supplierName: receipt.supplier?.name ?? receipt.supplierCustomer?.name ?? receipt.supplierName ?? receipt.storeName ?? '',
            storeName: receipt.supplier?.name ?? receipt.supplierCustomer?.name ?? receipt.storeName ?? '',
            supplierId: receipt.supplierId,
            supplierCustomerId: receipt.supplierCustomerId,
            supplier: receipt.supplier,
            supplierCustomer: receipt.supplierCustomer,
          };
          await updateReceipt(id, reverted);
        }
      }
      setEditing(false);
      showToast('Receipt saved', 'success');
      loadReceipt();
    } catch (e: any) {
      if (openDuplicateModalFromSaveError(e)) return;
      showToast(e?.message ?? 'Failed to save', 'error');
      console.error(e);
    }
  };

  const handleSave = async () => {
    if (!editedReceipt || !id || !receipt) return;

    const refSlot = duplicateResolutionRef.current;
    if (refSlot) {
      duplicateResolutionRef.current = null;
      await runDuplicateResolutionSave(refSlot.choice, refSlot.payload);
      return;
    }

    try {
      await updateReceipt(id, {
        ...editedReceipt,
        status: 'confirmed' as ReceiptStatus,
      });
      setEditing(false);
      showToast('Receipt saved', 'success');
      loadReceipt();
    } catch (error: any) {
      if (openDuplicateModalFromSaveError(error)) return;
      showToast('Failed to save', 'error');
      console.error(error);
    }
  };

  /** Close modal only; keep edited state (mask/back). */
  const handleDuplicateNameCloseOnly = () => {
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
  };

  /** dropdown：仅恢复编辑态；save：恢复并用原值立即保存（keep_original）。 */
  const handleDuplicateNameDontChange = async () => {
    const payload = duplicateNameModalPayload;
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
    if (!receipt) return;

    const revertEditedToOriginal = () => {
      if (payload?.code === 'ACCOUNT_NAME_EXISTS') {
        const origAccount = receipt.account ?? (receipt.accountId ? accounts.find((a) => a.id === receipt.accountId) : undefined);
        setEditedReceipt((prev) => (prev ? { ...prev, accountId: receipt.accountId, account: origAccount } : prev));
      } else if (payload?.code === 'ENTITY_NAME_EXISTS') {
        const origName = receipt.entity?.name ?? receipt.supplier?.name ?? receipt.supplierCustomer?.name ?? receipt.supplierName ?? receipt.storeName ?? '';
        setEditedReceipt((prev) =>
          prev
            ? {
                ...prev,
                entityId: receipt.entityId ?? receipt.entity?.id,
                entity: receipt.entity,
                supplierName: origName,
                storeName: origName,
                supplierId: undefined,
                supplierCustomerId: undefined,
                supplier: undefined,
                supplierCustomer: undefined,
              }
            : prev
        );
      } else {
        const origName =
          receipt.entity?.name ??
          receipt.supplier?.name ??
          receipt.supplierCustomer?.name ??
          receipt.supplierName ??
          receipt.storeName ??
          '';
        setEditedReceipt((prev) =>
          prev
            ? {
                ...prev,
                supplierName: origName,
                storeName: origName,
                entityId: receipt.entityId ?? receipt.entity?.id,
                entity: receipt.entity,
                supplierId: receipt.supplierId,
                supplierCustomerId: receipt.supplierCustomerId,
                supplier: receipt.supplier,
                supplierCustomer: receipt.supplierCustomer,
              }
            : prev
        );
      }
    };

    revertEditedToOriginal();
    if (payload?.triggeredBy === 'save') {
      await runDuplicateResolutionSave('keep_original', {
        code: payload.code,
        duplicateName: payload.duplicateName,
        targetId: payload.targetId,
        targetSource: payload.targetSource,
      });
    }
  };

  const handleDuplicateNameReplace = () => {
    const payload = duplicateNameModalPayload;
    if (!payload || !editedReceipt || !id) return;
    const snapshot = {
      code: payload.code,
      duplicateName: payload.duplicateName,
      targetId: payload.targetId,
      targetSource: payload.targetSource,
    };
    const fromSave = payload.triggeredBy === 'save';
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
    duplicateResolutionRef.current = { choice: 'replace', payload: snapshot };
    if (fromSave) {
      void handleSave();
    }
  };

  const handleDuplicateNameMerge = () => {
    const payload = duplicateNameModalPayload;
    if (!payload || !receipt || !editedReceipt || !id) return;
    const snapshot = {
      code: payload.code,
      duplicateName: payload.duplicateName,
      targetId: payload.targetId,
      targetSource: payload.targetSource,
    };
    const fromSave = payload.triggeredBy === 'save';
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
    duplicateResolutionRef.current = { choice: 'merge', payload: snapshot };
    if (fromSave) {
      void handleSave();
    }
  };

  const handleConfirm = async () => {
    if (!id) return;

    try {
      await updateReceipt(id, {
        status: 'confirmed' as ReceiptStatus,
      });
      loadReceipt();
    } catch (error) {
      showToast('Failed to confirm receipt', 'error');
      console.error(error);
    }
  };

  const commonCurrencies = useMemo(
    () => ['USD', 'CAD', 'EUR', 'GBP', 'JPY', 'HKD', 'AUD', 'CNY'],
    []
  );

  const categoriesSorted = useMemo(() => sortScopeTagsForDisplay(categories), [categories]);
  const attributionsSorted = useMemo(() => sortScopeTagsForDisplay(attributions), [attributions]);

  /** Must run before any early return — same source as `currentReceipt` below */
  const recognitionNoticeParagraphs = useMemo(() => {
    const source = editing ? (editedReceipt ?? receipt) : receipt;
    const raw = source?.recognitionNotice?.trim();
    if (!raw) return [];
    return raw.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  }, [editing, receipt, editedReceipt]);

  // 计算商品明细金额总和
  const calculateItemsSum = useCallback((items: ReceiptItem[]) => {
    return items.reduce((sum, item) => sum + (item.price || 0), 0);
  }, []);

  const handleItemChange = (index: number, field: keyof ReceiptItem, value: any) => {
    if (!editedReceipt) return;

    const newItems = [...editedReceipt.items];
    const updatedItem = { ...newItems[index] } as ReceiptItem;
    
    // 如果更新的是 categoryId，同时更新 category 对象
    if (field === 'categoryId') {
      const selectedCategory = categories.find(cat => cat.id === value);
      if (selectedCategory) {
        updatedItem.categoryId = value;
        updatedItem.category = selectedCategory;
      }
    } else if (field === 'attributionId') {
      const selectedAttribution = attributions.find(a => a.id === value);
      updatedItem.attributionId = value;
      updatedItem.attribution = selectedAttribution ?? null;
    } else {
      (updatedItem as any)[field] = value;
    }
    
    newItems[index] = updatedItem;
    
    // 自动计算总金额 = 商品明细金额总和 + 税费
    const itemsSum = calculateItemsSum(newItems);
    const tax = editedReceipt.tax || 0;
    const newTotalAmount = itemsSum + tax;
    
    setEditedReceipt({ 
      ...editedReceipt, 
      items: newItems,
      totalAmount: newTotalAmount,
    });
  };

  // 处理税费变更
  const handleTaxChange = (tax: number) => {
    if (!editedReceipt) return;
    
    const itemsSum = calculateItemsSum(editedReceipt.items);
    const newTotalAmount = itemsSum + tax;
    
    setEditedReceipt({
      ...editedReceipt,
      tax: tax,
      totalAmount: newTotalAmount,
    });
  };

  // 处理日期变更
  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (event.type === 'dismissed') {
        return;
      }
    }
    if (selectedDate && editedReceipt) {
      const dateString = getLocalDateString(selectedDate);
      setEditedReceipt({
        ...editedReceipt,
        date: dateString,
      });
    }
  };

  // 处理币种变更
  const handleCurrencyChange = (currency: string) => {
    if (!editedReceipt) return;
    
    setEditedReceipt({
      ...editedReceipt,
      currency: currency || undefined,
    });
  };

  // 处理供应商名称变更：仅更新小票上的名称文本，保留已有关联 ID（有关联时后端会更新对应表）
  const handleSupplierNameChange = (supplierName: string) => {
    if (!editedReceipt) return;
    setEditedReceipt({
      ...editedReceipt,
      supplierName,
      storeName: supplierName,
    });
  };

  const openSupplierPicker = async () => {
    try {
      const options = await getSupplierOptions();
      setSupplierOptions(options);
      setShowSupplierPicker(true);
    } catch (e) {
      console.warn('Failed to load supplier options:', e);
    }
  };

  const handleSelectSupplier = (option: { id: string; name: string; source: 'supplier' | 'customer' } | null) => {
    if (!editedReceipt) return;
    setShowSupplierPicker(false);
    const currentId = getCanonicalEntityId(receipt);
    if (option === null) {
      setEditedReceipt({
        ...editedReceipt,
        supplierName: editedReceipt.supplierName ?? editedReceipt.storeName ?? '',
        storeName: editedReceipt.supplierName ?? editedReceipt.storeName ?? '',
        entityId: undefined,
        entity: undefined,
        supplierId: undefined,
        supplierCustomerId: undefined,
        supplier: undefined,
        supplierCustomer: undefined,
      });
      return;
    }
    if (option.source === 'supplier') {
      setEditedReceipt({
        ...editedReceipt,
        supplierName: option.name,
        storeName: option.name,
        entityId: option.id,
        entity: { id: option.id, name: option.name, spaceId: '', isAiRecognized: false } as any,
        supplierId: undefined,
        supplierCustomerId: undefined,
        supplier: undefined,
        supplierCustomer: undefined,
      });
    } else {
      setEditedReceipt({
        ...editedReceipt,
        supplierName: option.name,
        storeName: option.name,
        entityId: option.id,
        entity: { id: option.id, name: option.name, spaceId: '', isAiRecognized: false } as any,
        supplierId: undefined,
        supplierCustomerId: undefined,
        supplier: undefined,
        supplierCustomer: undefined,
      });
    }
    // 从空改为选择时不弹三选项；仅当已有 Payee 且换成另一个时弹窗
    const hasExistingLink = !!currentId;
    if (option.id !== currentId && hasExistingLink) {
      setDuplicateNameModalPayload({
        code: option.source === 'supplier' ? 'SUPPLIER_NAME_EXISTS' : 'CUSTOMER_NAME_EXISTS',
        duplicateName: option.name,
        targetId: option.id,
        targetSource: option.source,
        triggeredBy: 'dropdown',
      });
      setShowDuplicateNameModal(true);
    }
  };

  // 直接更新商品项并保存（不进入编辑模式）
  const handleItemChangeDirect = async (
    index: number,
    field: 'categoryId' | 'attributionId' | 'isAsset',
    value: any
  ) => {
    if (!id || !currentReceipt) return;

    const item = currentReceipt.items[index];
    if (!item || !item.id) {
      console.error('Item not found or missing ID');
      return;
    }

    try {
      // 先更新本地状态以立即反映变化（保持原有顺序）
      const newItems = [...currentReceipt.items];
      const updatedItem = { ...newItems[index] } as ReceiptItem;

      if (field === 'categoryId') {
        const selectedCategory = categories.find(cat => cat.id === value);
        if (selectedCategory) {
          updatedItem.categoryId = value;
          updatedItem.category = selectedCategory;
        }
      } else if (field === 'attributionId') {
        const selectedAttribution = attributions.find(p => p.id === value);
        if (selectedAttribution) {
          updatedItem.attributionId = value;
          updatedItem.attribution = selectedAttribution;
        } else {
          updatedItem.attributionId = value as string | null;
          updatedItem.attribution = undefined;
        }
      } else if (field === 'isAsset') {
        updatedItem.isAsset = value;
      }

      newItems[index] = updatedItem;
      const updatedReceipt = { ...currentReceipt, items: newItems };
      setReceipt(updatedReceipt);
      if (editing) {
        setEditedReceipt(updatedReceipt);
      }

      // 保存到数据库（使用 item.id 而不是 index，确保不依赖顺序）
      await updateReceiptItem(id, item.id, field, value);
    } catch (error) {
      console.error('Error updating item:', error);
      showToast('Failed to update item', 'error');
      // 如果失败，重新加载以恢复原状态
      await loadReceipt({ forceSyncEdited: true });
    }
  };

  const handleAddItem = () => {
    if (!editedReceipt || categories.length === 0) return;

    // Use the first available category as default
    const defaultCategory = categories.find(cat => cat.name === 'Meal') || categories.find(cat => cat.name === 'Shopping') || categories[0];
    
    // Use the first available attribution as default, or null if none
    const defaultAttribution = attributions.length > 0 ? attributions[0] : null;
    
    const newItem: ReceiptItem = {
      name: 'Receipt item',
      categoryId: defaultCategory.id,
      category: defaultCategory,
      attributionId: defaultAttribution?.id || null,
      attribution: defaultAttribution,
      price: 0,
      isAsset: false,
    };
    const newItems = [...editedReceipt.items, newItem];
    
    // 自动计算总金额
    const itemsSum = calculateItemsSum(newItems);
    const tax = editedReceipt.tax || 0;
    const newTotalAmount = itemsSum + tax;
    
    setEditedReceipt({
      ...editedReceipt,
      items: newItems,
      totalAmount: newTotalAmount,
    });
  };

  const handleDeleteItem = (index: number) => {
    if (!editedReceipt) return;

    const newItems = editedReceipt.items.filter((_, i) => i !== index);
    
    // 自动计算总金额
    const itemsSum = calculateItemsSum(newItems);
    const tax = editedReceipt.tax || 0;
    const newTotalAmount = itemsSum + tax;
    
    setEditedReceipt({ 
      ...editedReceipt, 
      items: newItems,
      totalAmount: newTotalAmount,
    });
  };

  // 解析日期字符串为本地时区，避免 UTC 时区转换问题
  const parseLocalDate = (dateString: string): Date => {
    // dateString 格式应为 "YYYY-MM-DD"
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  const formatDate = (dateString: string) => {
    try {
      const date = parseLocalDate(dateString);
      return format(date, 'MMM dd, yyyy');
    } catch {
      return dateString;
    }
  };

  const pickFromCamera = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        showToast('Vouchap needs access to your camera to take photos.', 'info');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        const uri = result.assets[0].uri;
        const processedUri = await processImageForUpload(uri, { autoCrop: true, quality: 0.85 });
        await uploadImage(processedUri);
      }
    } catch (error) {
      console.error('Error launching camera:', error);
      showToast('Failed to launch camera. Please try again.', 'error');
    }
  };

  const pickFromLibrary = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showToast('Vouchap needs access to your photo library to upload images.', 'info');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        await uploadImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      showToast('Failed to pick image. Please try again.', 'error');
    }
  };

  const handleImagePicker = async () => {
    if (!id) return;
    showChoiceDialog('Add Photo', 'Choose an option', [
      { text: 'Camera', onPress: pickFromCamera, style: 'primary' },
      { text: 'Photo Library', onPress: pickFromLibrary, style: 'primary' },
      { text: 'Cancel', onPress: () => {}, style: 'cancel' },
    ]);
  };

  const handleReRecognizeExpense = async () => {
    if (!id) return;
    setIsReprocessingRecognition(true);
    try {
      await reprocessExpenseReceiptFromStoredMedia(id);
      await loadReceipt({ forceSyncEdited: true });
      showToast('Re-recognition complete', 'success');
    } catch (error) {
      console.error('Re-recognize failed:', error);
      const msg = error instanceof Error ? error.message : 'Recognition failed';
      showToast(msg, 'error');
      await loadReceipt({ forceSyncEdited: true });
    } finally {
      setIsReprocessingRecognition(false);
    }
  };

  const handleDeleteExpenseFromRetake = () => {
    if (!id) return;
    showConfirmDestructiveDialog(
      'Delete expense',
      'This expense will be permanently deleted.',
      async () => {
        try {
          await deleteReceipt(id);
          showToast('Expense deleted', 'info');
          router.back();
        } catch (e) {
          console.error(e);
          showToast('Failed to delete expense', 'error');
        }
      },
      { confirmLabel: 'Delete' }
    );
  };

  const uploadImage = async (imageUri: string) => {
    if (!id) return;

    setIsUploadingImage(true);
    try {
      // 上传图片到 storage
      const imageUrl = await uploadReceiptImage(imageUri, id, receipt?.spaceId ?? '');
      
      // 更新 receipt 的 imageUrl
      await updateReceipt(id, { imageUrl });
      
      // 重新加载 receipt 以更新显示
      await loadReceipt();
    } catch (error) {
      console.error('Error uploading image:', error);
      showToast('Failed to upload image. Please try again.', 'error');
    } finally {
      setIsUploadingImage(false);
    }
  };

  // 播放/停止录音
  const handlePlayAudio = async () => {
    if (!audioUrl) return;
    
    if (isPlayingAudio) {
      await stopPlayback();
      setIsPlayingAudio(false);
    } else {
      setIsPlayingAudio(true);
      await playAudio(audioUrl, () => {
        // 播放完成后重置状态
        setIsPlayingAudio(false);
      });
    }
  };


  // 先占位：显示布局骨架，数据在后台加载
  if (loading && !receipt) {
    return (
      <View style={styles.container}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <View style={styles.summaryCard}>
            <View style={styles.imagePlaceholder}>
              <ActivityIndicator size="large" color="#6C5CE7" />
            </View>
            <View style={{ flex: 1, justifyContent: 'center', paddingLeft: 12 }}>
              <Text style={[styles.storeName, { color: '#BDC3C7' }]}>Loading...</Text>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (!receipt) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Expense not found</Text>
      </View>
    );
  }

  const currentReceipt = editing ? (editedReceipt || receipt) : receipt;

  if (!currentReceipt) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Expense not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {currentReceipt.status === 'needs_retake' && recognitionNoticeParagraphs.length > 0 ? (
          <View style={styles.recognitionNoticeBanner} accessibilityRole="alert">
            <View style={styles.recognitionNoticeHeaderRow}>
              <Ionicons name="alert-circle" size={22} color="#B7791F" />
              <Text style={styles.recognitionNoticeTitle}>Recognition unavailable</Text>
            </View>
            {recognitionNoticeParagraphs.map((para, i) => (
              <Text key={i} style={styles.recognitionNoticeBody}>
                {para}
              </Text>
            ))}
          </View>
        ) : null}
        {/* 小票摘要卡片 */}
        <View style={styles.summaryCard}>
          <View style={styles.imageContainer}>
            <TouchableOpacity
              onPress={() => {
                if (currentReceipt.imageUrl) {
                  const isDoc =
                    looksLikeDocumentAttachmentUrl(currentReceipt.imageUrl) ||
                    currentReceipt.inputType === 'document';
                  if (isDoc) {
                    const file: FileDetailModalFile = {
                      id: `receipt-doc-${currentReceipt.id}`,
                      name: currentReceipt.storeName || currentReceipt.supplierName || 'Expense document',
                      imageUrl: currentReceipt.imageUrl,
                      hideRightPanel: true,
                    };
                    setFileDetailForModal(file);
                  } else {
                    setShowImageModal(true);
                  }
                } else {
                  handleImagePicker();
                }
              }}
              style={styles.imagePlaceholder}
              disabled={isUploadingImage}
            >
              {currentReceipt.imageUrl ? (
                looksLikePdfUrl(currentReceipt.imageUrl) || currentReceipt.inputType === 'document' ? (
                  <View style={[styles.receiptImage, styles.thumbAlignTopLeft, styles.docThumbPlaceholder]}>
                    <Ionicons name="document-text" size={36} color="#6C5CE7" />
                    <Text style={styles.docThumbLabel} numberOfLines={1}>
                      {looksLikePdfUrl(currentReceipt.imageUrl) ? 'PDF' : 'Document'}
                    </Text>
                  </View>
                ) : (
                  <Image
                    source={{ uri: currentReceipt.imageUrl }}
                    style={[styles.receiptImage, styles.thumbAlignTopLeft]}
                    resizeMode="cover"
                  />
                )
              ) : (
                <View style={styles.imagePlaceholderContent}>
                  {isUploadingImage ? (
                    <ActivityIndicator size="small" color="#6C5CE7" />
                  ) : (
                    <Ionicons name="camera" size={32} color="#95A5A6" />
                  )}
                </View>
              )}
            </TouchableOpacity>
            {/* 语音录入播放按钮 - 显示在图片右下角 */}
            {audioUrl && (
              <TouchableOpacity
                style={[
                  styles.audioPlayButton,
                  isPlayingAudio && styles.audioPlayButtonActive,
                ]}
                onPress={handlePlayAudio}
              >
                <Ionicons 
                  name={isPlayingAudio ? 'pause' : 'play'} 
                  size={14} 
                  color="#fff" 
                />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.summaryContent}>
            <View style={styles.summaryContentTop}>
              <View style={styles.summaryContentMain}>
                {editing ? (
                  <View style={styles.storeNameInputRow}>
                    <TextInput
                      style={styles.storeNameInput}
                      value={editedReceipt?.supplierName ?? editedReceipt?.storeName ?? editedReceipt?.supplier?.name ?? editedReceipt?.supplierCustomer?.name ?? currentReceipt.supplierName ?? ''}
                      onChangeText={handleSupplierNameChange}
                      placeholder="Payee"
                      maxLength={100}
                    />
                    <TouchableOpacity
                      style={styles.storeNameDropdownIcon}
                      onPress={openSupplierPicker}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="chevron-down" size={18} color="#6C5CE7" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.storeName} numberOfLines={1}>
                    {currentReceipt.entity?.name || currentReceipt.supplier?.name || currentReceipt.supplierCustomer?.name || currentReceipt.supplierName || '—'}
                  </Text>
                )}
                <View style={styles.amountRow}>
                  <View style={styles.amountContainer}>
                    <View style={styles.currencyContainer}>
                      {editing ? (
                        <TouchableOpacity
                          style={styles.currencyPickerTouchable}
                          onPress={() => setShowCurrencyPicker(true)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.currencyLabel}>
                            {editedReceipt?.currency || 'Currency'}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        currentReceipt.currency ? (
                          <View style={styles.currencyPickerReadonly}>
                            <Text style={styles.currencyLabel}>
                              {currentReceipt.currency}
                            </Text>
                          </View>
                        ) : null
                      )}
                    </View>
                    {editing ? (
                      <Text style={styles.totalAmount}>
                        {(() => {
                          const itemsSum = calculateItemsSum(editedReceipt?.items || []);
                          const tax = editedReceipt?.tax || 0;
                          const total = itemsSum + tax;
                          return (total < 0 ? '-' : '') + Math.abs(total).toFixed(2);
                        })()}
                      </Text>
                    ) : (
                      <Text style={styles.totalAmount}>
                        {(Number.isFinite(Number(currentReceipt.totalAmount)) ? ((Number(currentReceipt.totalAmount) < 0 ? '-' : '') + Math.abs(Number(currentReceipt.totalAmount)).toFixed(2)) : '—')}
                      </Text>
                    )}
                    {editing ? (
                      <View style={styles.taxInputContainer}>
                        <Text style={styles.taxLabel}>Tax: </Text>
                        <TextInput
                          style={styles.taxInput}
                          value={taxInputText}
                          onChangeText={(text) => {
                            // 验证输入：只允许数字、负号和小数点
                            const validPattern = /^-?\d*\.?\d*$/;
                            if (text === '' || text === '-' || validPattern.test(text)) {
                              setTaxInputText(text);
                              // 如果文本是有效的数字，更新 tax 值
                              if (text !== '' && text !== '-' && text !== '.') {
                                const tax = parseFloat(text);
                                if (!isNaN(tax)) {
                                  handleTaxChange(tax);
                                }
                              } else if (text === '' || text === '-') {
                                handleTaxChange(text === '' ? 0 : 0);
                              }
                            }
                          }}
                          onBlur={() => {
                            // 失去焦点时，确保值是有效的数字
                            const tax = parseFloat(taxInputText);
                            if (isNaN(tax)) {
                              setTaxInputText('0');
                              handleTaxChange(0);
                            } else {
                              setTaxInputText(tax.toString());
                              handleTaxChange(tax);
                            }
                          }}
                          keyboardType="numbers-and-punctuation"
                          placeholder="0.00"
                        />
                      </View>
                    ) : (
                      <View style={styles.taxText}>
                        <Text style={styles.taxLabel}>Tax:</Text>
                        <Text style={styles.taxValueText}>
                          {(() => {
                            const tax = currentReceipt.tax ?? 0;
                            return (tax < 0 ? '-' : '') + Math.abs(tax).toFixed(2);
                          })()}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                <View style={styles.dateContainer}>
              {editing ? (
                isDesktopWeb ? (
                  <View style={styles.dateTouchable}>
                    {React.createElement('input', {
                      type: 'date',
                      value: editedReceipt?.date || currentReceipt.date || '',
                      onChange: (e: any) => {
                        const v = (e.target as HTMLInputElement).value;
                        if (!v) return;
                        const [year, month, day] = v.split('-').map((n) => parseInt(n, 10));
                        if (!year || !month || !day) return;
                        const d = new Date(year, month - 1, day);
                        handleDateChange({ type: 'set' }, d);
                      },
                      style: {
                        width: '100%',
                        padding: 6,
                        borderRadius: 999,
                        border: '1px solid #CED4DA',
                        fontSize: 13,
                      },
                    })}
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.dateTouchable}
                    onPress={() => setShowDatePicker(true)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.dateTag}>
                      <Text style={styles.dateText}>
                        {editedReceipt?.date ? formatDate(editedReceipt.date) : 'Select date'}
                      </Text>
                      <Ionicons
                        name="chevron-down"
                        size={14}
                        color="#6C5CE7"
                        style={styles.tagIcon}
                      />
                    </View>
                  </TouchableOpacity>
                )
              ) : (
                <Text style={styles.date}>{formatDate(currentReceipt.date)}</Text>
              )}
                </View>
              </View>
              {currentReceipt.createdAt && (
                <View style={styles.submittedInfo}>
                  <Text style={styles.submittedText}>
                    {format(new Date(currentReceipt.createdAt), 'MMM dd, yyyy')}
                    {currentReceipt.createdByUser && (
                      <> by {currentReceipt.createdByUser.name || currentReceipt.createdByUser.email?.split('@')[0] || 'Unknown'}</>
                    )}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* 支付账户 */}
        <View style={styles.paymentCard}>
          <View style={styles.paymentRow}>
            <Text style={styles.cardLabel}>Account</Text>
            <TouchableOpacity
              style={editing ? styles.accountTouchable : undefined}
              onPress={() => {
                console.log('Payment account button pressed');
                console.log('Current editing state:', editing);
                console.log('Current picker state:', showAccountPicker);
                console.log('Payment accounts available:', accounts.length);
                
                if (!editing) {
                  setEditedReceipt({ ...currentReceipt });
                  setEditing(true);
        // 初始化输入文本状态
        const currentReceiptForInit = editedReceipt || receipt;
        setTaxInputText((currentReceiptForInit?.tax || 0).toString());
        const priceTexts: { [index: number]: string } = {};
        (currentReceiptForInit?.items || []).forEach((item, index) => {
          priceTexts[index] = String(item.price ?? 0);
        });
        setPriceInputTexts(priceTexts);
                }
                
                // 直接设置状态，不使用 setTimeout
                console.log('Setting showAccountPicker to true');
                setShowAccountPicker(true);
                
                // 验证状态是否更新
                setTimeout(() => {
                  console.log('Picker state after update:', showAccountPicker);
                }, 100);
              }}
              activeOpacity={0.7}
            >
              {editing ? (
                <View style={styles.accountTag}>
                  <Text style={styles.accountText} numberOfLines={1} ellipsizeMode="tail">
                    {currentReceipt.account?.name || 'Not set'}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color="#6C5CE7" style={styles.tagIcon} />
                </View>
              ) : (
                <Text style={styles.cardValue}>
                  {currentReceipt.account?.name || 'Not set'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* 商品列表 */}
        <View style={styles.itemsSection}>
          <View style={styles.sectionTitleContainer}>
            <Text style={styles.sectionTitle}>Items</Text>
          </View>
          {currentReceipt.items.map((item, index) => {
            const categoryOpts = buildLineItemCategoryOptions(item, categories);
            const categoryValue = lineItemCategorySelectValue(item.categoryId, categoryOpts);
            const attributionOpts = buildLineItemAttributionOptions(item, attributions);
            const lineStableId = item.id ?? `${id ?? 'new'}-line-${index}`;
            return (
            <View 
              key={index} 
              style={[
                styles.itemCard,
                index < currentReceipt.items.length - 1 && styles.itemCardWithBorder
              ]}
            >
              {editing && (
                <TouchableOpacity
                  style={styles.deleteItemButton}
                  onPress={() => handleDeleteItem(index)}
                >
                  <Ionicons name="close-circle" size={20} color="#E74C3C" />
                </TouchableOpacity>
              )}

              {/* 第一行：商品名称 + 价格 */}
              <View style={styles.itemHeader}>
                {editing ? (
                  <TextInput
                    style={styles.itemNameInput}
                    value={item.name}
                    onChangeText={(text) => handleItemChange(index, 'name', text)}
                    placeholder="Item name"
                  />
                ) : (
                  <Text style={styles.itemName} numberOfLines={1}>
                    {item.name}
                  </Text>
                )}
                {editing ? (
                  <TextInput
                    style={styles.priceInput}
                    value={priceInputTexts[index] !== undefined ? priceInputTexts[index] : String(item.price ?? 0)}
                    onChangeText={(text) => {
                      // 验证输入：只允许数字、负号和小数点
                      const validPattern = /^-?\d*\.?\d*$/;
                      if (text === '' || text === '-' || validPattern.test(text)) {
                        setPriceInputTexts(prev => ({ ...prev, [index]: text }));
                        // 如果文本是有效的数字，更新 price 值
                        if (text !== '' && text !== '-' && text !== '.') {
                          const price = parseFloat(text);
                          if (!isNaN(price)) {
                            handleItemChange(index, 'price', price);
                          }
                        } else if (text === '' || text === '-') {
                          handleItemChange(index, 'price', text === '' ? 0 : 0);
                        }
                      }
                    }}
                    onBlur={() => {
                      // 失去焦点时，确保值是有效的数字
                      const text = priceInputTexts[index] !== undefined ? priceInputTexts[index] : String(item.price ?? 0);
                      const price = parseFloat(text);
                      if (isNaN(price)) {
                        setPriceInputTexts(prev => ({ ...prev, [index]: '0' }));
                        handleItemChange(index, 'price', 0);
                      } else {
                        setPriceInputTexts(prev => ({ ...prev, [index]: price.toString() }));
                        handleItemChange(index, 'price', price);
                      }
                    }}
                    keyboardType="numbers-and-punctuation"
                    placeholder="Price"
                  />
                ) : (
                  <Text style={styles.itemPrice}>
                    {item.price < 0 ? '-' : ''}
                    {Math.abs(item.price).toFixed(2)}
                  </Text>
                )}
              </View>

              {/* 第二行：分类（左） + 用途（中） + 资产（右） */}
              <View style={styles.itemTags}>
                  {/* 分类标签 - 左侧，左对齐 */}
                  <View style={styles.tagGroupLeft}>
                    {isDesktopWeb && categories.length > 0 ? (
                      <View style={{ alignSelf: 'flex-start', maxWidth: 200 }}>
                        <LineItemPillAnchorDropdownWeb
                          kind="category"
                          rowId={lineStableId}
                          ariaLabel="Category"
                          value={categoryValue}
                          options={categoryOpts}
                          onValueChange={v => {
                            if (item.id) void handleItemChangeDirect(index, 'categoryId', v);
                            else if (editedReceipt) handleItemChange(index, 'categoryId', v);
                          }}
                        />
                      </View>
                    ) : (
                    <TouchableOpacity
                      style={styles.tagTouchable}
                      onPress={() => {
                        setShowCategoryPicker(index);
                      }}
                    >
                      <View
                        style={[
                          styles.tag,
                          { backgroundColor: item.category?.color || '#95A5A6' },
                        ]}
                      >
                        <Text 
                          style={styles.tagText}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {item.category?.name || 'Unknown'}
                        </Text>
                        <Ionicons name="chevron-down" size={12} color="#fff" style={styles.tagIcon} />
                      </View>
                    </TouchableOpacity>
                    )}
                  </View>

                  {/* 用途标签 - 居中，左对齐 */}
                  <View style={styles.tagGroupCenter}>
                    {isDesktopWeb && attributionOpts.length > 0 ? (
                      <View style={{ alignSelf: 'flex-start', maxWidth: 220 }}>
                        <LineItemAttributionAnchorDropdownWeb
                          rowId={lineStableId}
                          value={item.attributionId}
                          options={attributionOpts}
                          onValueChange={v => {
                            if (item.id) void handleItemChangeDirect(index, 'attributionId', v);
                            else if (editedReceipt) handleItemChange(index, 'attributionId', v);
                          }}
                        />
                      </View>
                    ) : isDesktopWeb ? (
                      <Text style={{ fontSize: 13, color: '#95A5A6', alignSelf: 'flex-start' }}>—</Text>
                    ) : (
                    <TouchableOpacity
                      style={styles.tagTouchable}
                      onPress={() => {
                        setShowAttributionPicker(index);
                      }}
                    >
                      <View
                        style={[
                          styles.tag,
                          { 
                            backgroundColor: item.attribution?.color || attributions.find(p => p.id === item.attributionId)?.color || '#95A5A6' 
                          },
                        ]}
                      >
                        <Text 
                          style={styles.tagText}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {item.attribution?.name || attributions.find(p => p.id === item.attributionId)?.name || 'Unknown'}
                        </Text>
                        <Ionicons name="chevron-down" size={12} color="#fff" style={styles.tagIcon} />
                      </View>
                    </TouchableOpacity>
                    )}
                  </View>

                  {/* 资产标签 - 右侧，右对齐 */}
                  <View style={styles.tagGroupRight}>
                    <TouchableOpacity
                      style={styles.assetTagTouchable}
                      onPress={() => {
                        handleItemChangeDirect(index, 'isAsset', !item.isAsset);
                      }}
                    >
                      <View style={[
                        styles.assetTag,
                        {
                          backgroundColor: item.isAsset ? '#E8F4FD' : '#F0F0F0',
                        }
                      ]}>
                        <Ionicons
                          name={item.isAsset ? 'checkbox' : 'checkbox-outline'}
                          size={14}
                          color={item.isAsset ? '#6C5CE7' : '#95A5A6'}
                        />
                        <Text style={[
                          styles.assetTagText,
                          { color: item.isAsset ? '#6C5CE7' : '#636E72' }
                        ]}>
                          Asset
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                </View>
            </View>
            );
          })}

          {editing && (
            <View style={styles.addItemButtonContainer}>
              <TouchableOpacity
                style={styles.addItemButton}
                onPress={handleAddItem}
              >
                <Ionicons name="add-circle-outline" size={24} color="#6C5CE7" />
                <Text style={styles.addItemText}>Add Item</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {/* 底部确认按钮 */}
      {editing && (
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => {
              setEditing(false);
              setEditedReceipt(receipt);
            }}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmButton} onPress={handleSave}>
            <Ionicons name="checkmark" size={24} color="#fff" />
            <Text style={styles.confirmButtonText}>Confirm</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 编辑/重新识别按钮 - 不在编辑模式时显示 */}
      {!editing && (
        currentReceipt.status === 'needs_retake' ? (
          (currentReceipt.recognitionFailCount ?? 0) >= 3 ? (
            <TouchableOpacity
              style={[styles.fab, styles.retryFab]}
              onPress={handleDeleteExpenseFromRetake}
              disabled={isReprocessingRecognition}
              accessibilityLabel="Delete expense"
            >
              <View style={styles.fabRingInner}>
                <Ionicons name="trash-outline" size={22} color="#E74C3C" />
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.fab, styles.retryFab]}
              onPress={handleReRecognizeExpense}
              disabled={isReprocessingRecognition}
              accessibilityLabel="Re-recognize receipt"
            >
              <View style={styles.fabRingInner}>
                {isReprocessingRecognition ? (
                  <ActivityIndicator size="small" color="#E74C3C" />
                ) : (
                  <Ionicons name="refresh-outline" size={22} color="#E74C3C" />
                )}
              </View>
            </TouchableOpacity>
          )
        ) : currentReceipt.status === 'duplicate' ? (
          <TouchableOpacity
            style={[styles.fab, styles.retryFab]}
            onPress={handleDeleteExpenseFromRetake}
            accessibilityLabel="Delete duplicate expense"
          >
            <View style={styles.fabRingInner}>
              <Ionicons name="trash-outline" size={22} color="#E74C3C" />
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.fab, styles.editFab]}
            onPress={() => {
              setEditedReceipt({ ...currentReceipt });
              setEditing(true);
          // 初始化输入文本状态
          const currentReceiptForInit = editedReceipt || receipt;
          setTaxInputText((currentReceiptForInit?.tax || 0).toString());
          const priceTexts: { [index: number]: string } = {};
          (currentReceiptForInit?.items || []).forEach((item, index) => {
            priceTexts[index] = String(item.price ?? 0);
          });
          setPriceInputTexts(priceTexts);
            }}
          >
            <Ionicons name="create" size={32} color="#fff" />
          </TouchableOpacity>
        )
      )}
      
      {/* 确认按钮 - pending 且不在编辑模式（needs_retake 由上方重试/删除 FAB 处理；样式保持紫底实心白勾） */}
      {!editing && currentReceipt.status === 'pending' && (
        <TouchableOpacity
          style={[styles.fab, styles.confirmFab]}
          onPress={handleConfirm}
        >
          <Ionicons name="checkmark-circle" size={32} color="#fff" />
        </TouchableOpacity>
      )}

      {/* 图片查看模态框 */}
      <Modal
        visible={showImageModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowImageModal(false)}
      >
        <View style={styles.modalContainer}>
          <TouchableOpacity
            style={styles.modalCloseButton}
            onPress={() => setShowImageModal(false)}
          >
            <Ionicons name="close" size={32} color="#fff" />
          </TouchableOpacity>
          {currentReceipt.imageUrl && (
            <Image
              source={{ uri: currentReceipt.imageUrl }}
              style={styles.modalImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      {fileDetailForModal && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setFileDetailForModal(null)}
        >
          <FileDetailModal
            file={fileDetailForModal}
            onClose={() => setFileDetailForModal(null)}
          />
        </Modal>
      )}

      {/* Duplicate name: Replace only this / Replace all (Merge) / Save as original */}
      <Modal
        visible={showDuplicateNameModal}
        transparent={true}
        animationType="fade"
        onRequestClose={handleDuplicateNameCloseOnly}
      >
        <TouchableOpacity style={styles.duplicateModalOverlay} activeOpacity={1} onPress={handleDuplicateNameCloseOnly}>
          <View style={styles.duplicateModalContentContainer} onStartShouldSetResponder={() => true}>
            <View style={styles.duplicateModalContent}>
              <View style={styles.duplicateModalHeader}>
                <Ionicons
                  name={duplicateNameModalPayload?.code === 'ACCOUNT_NAME_EXISTS' ? 'wallet-outline' : 'business-outline'}
                  size={48}
                  color="#6C5CE7"
                />
                <Text style={styles.duplicateModalTitle}>
                  {duplicateNameModalPayload?.code === 'ACCOUNT_NAME_EXISTS'
                    ? 'Replace account with:'
                    : 'Replace Payee with:'}
                </Text>
              </View>
              <View style={styles.duplicateModalMessageBlock}>
                <View style={styles.duplicateModalNameContainer}>
                  <Text style={styles.duplicateModalNameText}>{duplicateNameModalPayload?.duplicateName || '—'}</Text>
                </View>
              </View>
              <View style={styles.duplicateModalButtons}>
                <TouchableOpacity
                  style={[styles.duplicateModalButton, styles.duplicateModalButtonReplace]}
                  onPress={handleDuplicateNameReplace}
                  activeOpacity={0.8}
                >
                  <Ionicons name="swap-horizontal" size={20} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.duplicateModalButtonReplaceText}>Replace only this</Text>
                </TouchableOpacity>
                {(() => {
                  const targetId = duplicateNameModalPayload?.targetId;
                  const payeeSource = editedReceipt ?? receipt;
                  const draftPayeeId =
                    payeeSource?.entityId ??
                    payeeSource?.entity?.id ??
                    payeeSource?.supplierId ??
                    payeeSource?.supplierCustomerId ??
                    null;
                  /** 选单改 Payee 弹窗：合并「来源」应是保存前数据库侧的旧关联，不是草稿里已选中的新 entity */
                  const originalPayeeId =
                    receipt?.entityId ??
                    receipt?.entity?.id ??
                    receipt?.supplierId ??
                    receipt?.supplierCustomerId ??
                    null;
                  const hasLinkedForMerge = duplicateNameModalPayload?.code === 'ACCOUNT_NAME_EXISTS'
                    ? !!receipt?.accountId
                    : duplicateNameModalPayload?.code === 'ENTITY_NAME_EXISTS'
                      ? !!targetId && !!draftPayeeId && draftPayeeId !== targetId
                      : !!(targetId && originalPayeeId && originalPayeeId !== targetId);
                  return (
                    <TouchableOpacity
                      style={[styles.duplicateModalButton, styles.duplicateModalButtonMerge, !hasLinkedForMerge && { opacity: 0.5 }]}
                      onPress={hasLinkedForMerge ? handleDuplicateNameMerge : undefined}
                      activeOpacity={0.8}
                      disabled={!hasLinkedForMerge}
                    >
                      <Ionicons name="git-merge-outline" size={20} color="#E74C3C" style={{ marginRight: 8 }} />
                      <Text style={styles.duplicateModalButtonMergeText}>Replace all (Merge)</Text>
                    </TouchableOpacity>
                  );
                })()}
                <TouchableOpacity
                  style={[styles.duplicateModalButton, styles.duplicateModalButtonDontChange]}
                  onPress={handleDuplicateNameDontChange}
                  activeOpacity={0.8}
                >
                  <Ionicons name="time-outline" size={18} color="#95A5A6" style={{ marginRight: 6 }} />
                  <Text style={styles.duplicateModalButtonDontChangeText}>Do not replace</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 分类选择器 */}
      <Modal
        visible={Platform.OS !== 'web' && showCategoryPicker !== null}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowCategoryPicker(null)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowCategoryPicker(null)}
        >
          <View style={styles.pickerBottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Category</Text>
              <TouchableOpacity
                style={styles.pickerManageButton}
                onPress={() => {
                  setShowCategoryPicker(null);
                  router.push('/expense-settings');
                }}
              >
                <Ionicons name="settings-outline" size={20} color="#6C5CE7" />
                <Text style={styles.pickerManageText}>Manage</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView} showsVerticalScrollIndicator={false}>
              {categoriesSorted.map((cat) => {
                const itemIndex = showCategoryPicker;
                if (itemIndex === null) return null;
                const item = currentReceipt.items[itemIndex];
                const isSelected = item.categoryId === cat.id || item.category?.id === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[
                      styles.pickerOption,
                      isSelected && styles.pickerOptionSelected,
                    ]}
                    onPress={async () => {
                      setShowCategoryPicker(null);
                      await handleItemChangeDirect(itemIndex, 'categoryId', cat.id);
                    }}
                  >
                    <View
                      style={[
                        styles.pickerColorIndicator,
                        { backgroundColor: cat.color || '#95A5A6' },
                      ]}
                    />
                    <Text
                      style={[
                        styles.pickerOptionText,
                        isSelected && styles.pickerOptionTextSelected,
                      ]}
                    >
                      {cat.name}
                    </Text>
                    {isSelected && (
                      <Ionicons name="checkmark" size={20} color="#6C5CE7" />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 用途选择器 */}
      <Modal
        visible={Platform.OS !== 'web' && showAttributionPicker !== null}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowAttributionPicker(null)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowAttributionPicker(null)}
        >
          <View style={styles.pickerBottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Attribution</Text>
              <TouchableOpacity
                style={styles.pickerManageButton}
                onPress={() => {
                  setShowAttributionPicker(null);
                  router.push('/expense-settings');
                }}
              >
                <Ionicons name="settings-outline" size={20} color="#6C5CE7" />
                <Text style={styles.pickerManageText}>Manage</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView} showsVerticalScrollIndicator={false}>
              {attributionsSorted.map((attrRow) => {
                const itemIndex = showAttributionPicker;
                if (itemIndex === null) return null;
                const item = currentReceipt.items[itemIndex];
                const isSelected = item.attributionId === attrRow.id;
                return (
                  <TouchableOpacity
                    key={attrRow.id}
                    style={[
                      styles.pickerOption,
                      isSelected && styles.pickerOptionSelected,
                    ]}
                    onPress={async () => {
                      setShowAttributionPicker(null);
                      await handleItemChangeDirect(itemIndex, 'attributionId', attrRow.id);
                    }}
                  >
                    <View
                      style={[
                        styles.pickerColorIndicator,
                        { backgroundColor: attrRow.color },
                      ]}
                    />
                    <Text
                      style={[
                        styles.pickerOptionText,
                        isSelected && styles.pickerOptionTextSelected,
                      ]}
                    >
                      {attrRow.name}
                    </Text>
                    {isSelected && (
                      <Ionicons name="checkmark" size={20} color="#6C5CE7" />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 支付账户选择器 */}
      <Modal
        visible={showAccountPicker}
        transparent={true}
        animationType="slide"
        statusBarTranslucent={true}
        onRequestClose={() => {
          console.log('Modal onRequestClose called');
          setShowAccountPicker(false);
        }}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => {
            console.log('Overlay pressed, closing picker');
            setShowAccountPicker(false);
          }}
        >
          <View 
            style={styles.pickerBottomSheet} 
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Account</Text>
              <TouchableOpacity
                style={styles.pickerManageButton}
                onPress={() => {
                  setShowAccountPicker(false);
                  router.push('/accounts-manage');
                }}
              >
                <Ionicons name="settings-outline" size={18} color="#6C5CE7" />
                <Text style={styles.pickerManageText}>Manage</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView} showsVerticalScrollIndicator={false}>
              {/* 无支付账户选项 */}
              <TouchableOpacity
                style={[
                  styles.pickerOption,
                  !(editing ? editedReceipt : currentReceipt)?.account && styles.pickerOptionSelected,
                ]}
                onPress={() => {
                  const receiptToUpdate = editing ? editedReceipt : currentReceipt;
                  if (receiptToUpdate) {
                    if (editing && editedReceipt) {
                      setEditedReceipt({
                        ...editedReceipt,
                        account: undefined,
                        accountId: undefined,
                      });
                    } else {
                      setEditedReceipt({
                        ...currentReceipt,
                        account: undefined,
                        accountId: undefined,
                      });
                      setEditing(true);
        // 初始化输入文本状态
        const currentReceiptForInit = editedReceipt || receipt;
        setTaxInputText((currentReceiptForInit?.tax || 0).toString());
        const priceTexts: { [index: number]: string } = {};
        (currentReceiptForInit?.items || []).forEach((item, index) => {
          priceTexts[index] = String(item.price ?? 0);
        });
        setPriceInputTexts(priceTexts);
                    }
                  }
                  setShowAccountPicker(false);
                }}
              >
                <View
                  style={[
                    styles.pickerColorIndicator,
                    { backgroundColor: '#95A5A6' },
                  ]}
                />
                <Text
                  style={[
                    styles.pickerOptionText,
                    !(editing ? editedReceipt : currentReceipt)?.account && styles.pickerOptionTextSelected,
                  ]}
                >
                  Not set
                </Text>
                {!(editing ? editedReceipt : currentReceipt)?.account && (
                  <Ionicons name="checkmark" size={20} color="#6C5CE7" />
                )}
              </TouchableOpacity>

              {/* 支付账户列表 */}
              {accounts.map((account) => {
                const receiptToCheck = editing ? editedReceipt : currentReceipt;
                const isSelected = receiptToCheck?.account?.id === account.id;
                const currentAccountId = receiptToCheck?.accountId ?? receiptToCheck?.account?.id;
                return (
                  <TouchableOpacity
                    key={account.id}
                    style={[
                      styles.pickerOption,
                      isSelected && styles.pickerOptionSelected,
                    ]}
                    onPress={() => {
                      if (editing && editedReceipt) {
                        setEditedReceipt({
                          ...editedReceipt,
                          account: account,
                          accountId: account.id,
                        });
                      } else {
                        setEditedReceipt({
                          ...currentReceipt,
                          account: account,
                          accountId: account.id,
                        });
                        setEditing(true);
        // 初始化输入文本状态
        const currentReceiptForInit = editedReceipt || receipt;
        setTaxInputText((currentReceiptForInit?.tax || 0).toString());
        const priceTexts: { [index: number]: string } = {};
        (currentReceiptForInit?.items || []).forEach((item, index) => {
          priceTexts[index] = String(item.price ?? 0);
        });
        setPriceInputTexts(priceTexts);
                      }
                      setShowAccountPicker(false);
                      // 从空改为选择时不弹三选项；仅当已有账户且换成另一个时弹窗
                      if (account.id !== currentAccountId && receipt?.accountId) {
                        setDuplicateNameModalPayload({
                          code: 'ACCOUNT_NAME_EXISTS',
                          duplicateName: account.name,
                          targetId: account.id,
                          targetSource: undefined,
                          triggeredBy: 'dropdown',
                        });
                        setShowDuplicateNameModal(true);
                      }
                    }}
                  >
                    <View
                      style={[
                        styles.pickerColorIndicator,
                        { backgroundColor: '#6C5CE7' },
                      ]}
                    />
                    <Text
                      style={[
                        styles.pickerOptionText,
                        isSelected && styles.pickerOptionTextSelected,
                      ]}
                    >
                      {account.name}
                    </Text>
                    {isSelected && (
                      <Ionicons name="checkmark" size={20} color="#6C5CE7" />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 选择其他供应商 */}
      <Modal
        visible={showSupplierPicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowSupplierPicker(false)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowSupplierPicker(false)}
        >
          <View style={styles.pickerBottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Payee</Text>
              <TouchableOpacity
                onPress={() => setShowSupplierPicker(false)}
                style={styles.pickerCloseButton}
              >
                <Text style={styles.pickerCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView} showsVerticalScrollIndicator={false}>
              {supplierOptions.map((opt) => {
                const isSelected =
                  editedReceipt?.entityId === opt.id ||
                  (opt.source === 'supplier' && editedReceipt?.supplierId === opt.id) ||
                  (opt.source === 'customer' && editedReceipt?.supplierCustomerId === opt.id);
                return (
                  <TouchableOpacity
                    key={`${opt.source}-${opt.id}`}
                    style={[styles.pickerOption, isSelected && styles.pickerOptionSelected]}
                    onPress={() => handleSelectSupplier(opt)}
                  >
                    <View style={[styles.pickerColorIndicator, { backgroundColor: '#6C5CE7' }]} />
                    <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected]} numberOfLines={1}>
                      {opt.name}
                    </Text>
                    {opt.source === 'customer' && (
                      <Text style={styles.pickerOptionSubtext}>Payee</Text>
                    )}
                    {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 币种选择器 */}
      <Modal
        visible={showCurrencyPicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowCurrencyPicker(false)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowCurrencyPicker(false)}
        >
          <View style={styles.pickerBottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Currency</Text>
              <TouchableOpacity
                onPress={() => setShowCurrencyPicker(false)}
                style={styles.pickerCloseButton}
              >
                <Text style={styles.pickerCloseText}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView} showsVerticalScrollIndicator={false}>
              {commonCurrencies.map(code => {
                const currentCurrency = editedReceipt?.currency || currentReceipt.currency;
                const isSelected = currentCurrency === code;
                return (
                  <TouchableOpacity
                    key={code}
                    style={[
                      styles.pickerOption,
                      isSelected && styles.pickerOptionSelected,
                    ]}
                    onPress={() => {
                      if (editedReceipt) {
                        handleCurrencyChange(code);
                      }
                      setShowCurrencyPicker(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.pickerOptionText,
                        isSelected && styles.pickerOptionTextSelected,
                      ]}
                    >
                      {code}
                    </Text>
                    {isSelected && (
                      <Ionicons name="checkmark" size={20} color="#6C5CE7" />
                    )}
                  </TouchableOpacity>
                );
              })}
              
              {/* Not set 放在最后 */}
              <TouchableOpacity
                style={[
                  styles.pickerOption,
                  !(editedReceipt?.currency || currentReceipt.currency) && styles.pickerOptionSelected,
                ]}
                onPress={() => {
                  if (editedReceipt) {
                    handleCurrencyChange('');
                  }
                  setShowCurrencyPicker(false);
                }}
              >
                <Text
                  style={[
                    styles.pickerOptionText,
                    !(editedReceipt?.currency || currentReceipt.currency) && styles.pickerOptionTextSelected,
                  ]}
                >
                  Not set
                </Text>
                {!(editedReceipt?.currency || currentReceipt.currency) && (
                  <Ionicons name="checkmark" size={20} color="#6C5CE7" />
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 日期选择器 */}
      {showDatePicker && (
        <>
          {Platform.OS === 'ios' ? (
            <Modal
              visible={showDatePicker}
              transparent={true}
              animationType="slide"
              onRequestClose={() => setShowDatePicker(false)}
            >
              <TouchableOpacity
                style={styles.pickerOverlay}
                activeOpacity={1}
                onPress={() => setShowDatePicker(false)}
              >
                <View style={styles.pickerBottomSheet} onStartShouldSetResponder={() => true}>
                  <View style={styles.pickerHandle} />
                  <View style={styles.pickerHeader}>
                    <Text style={styles.pickerTitle}>Select date</Text>
                    <TouchableOpacity
                      onPress={() => setShowDatePicker(false)}
                      style={styles.pickerCloseButton}
                    >
                      <Text style={styles.pickerCloseText}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={editedReceipt?.date ? parseLocalDate(editedReceipt.date) : new Date()}
                    mode="date"
                    display="spinner"
                    onChange={handleDateChange}
                    style={styles.datePickerIOS}
                  />
                </View>
              </TouchableOpacity>
            </Modal>
          ) : Platform.OS === 'android' ? (
            <DateTimePicker
              value={editedReceipt?.date ? parseLocalDate(editedReceipt.date) : new Date()}
              mode="date"
              display="default"
              onChange={handleDateChange}
            />
          ) : (
            <View style={styles.webDatePickerWrapper}>
              {React.createElement('input', {
                type: 'date',
                value: editedReceipt?.date || currentReceipt.date || '',
                onChange: (e: any) => {
                  const v = (e.target as HTMLInputElement).value;
                  if (!v) return;
                  const [year, month, day] = v.split('-').map((n) => parseInt(n, 10));
                  if (!year || !month || !day) return;
                  const d = new Date(year, month - 1, day);
                  handleDateChange({ type: 'set' }, d);
                },
                style: {
                  width: '100%',
                  padding: 8,
                  borderRadius: 8,
                  border: '1px solid #CED4DA',
                  fontSize: 14,
                },
              })}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // 略微加深灰度，让内容白色卡片更突出
    backgroundColor: '#ECEFF1',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 12,
    paddingBottom: 100,
  },
  recognitionNoticeBanner: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FEF9E7',
    borderWidth: 1,
    borderColor: '#F0D78C',
  },
  recognitionNoticeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  recognitionNoticeTitle: {
    marginLeft: 8,
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#7D5A0C',
  },
  recognitionNoticeBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#5D4E37',
    marginTop: 6,
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  imageContainer: {
    position: 'relative',
    marginRight: 12,
  },
  imagePlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#E9ECEF',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePlaceholderContent: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  webDatePickerWrapper: {
    marginTop: 8,
  },
  audioPlayButton: {
    position: 'absolute',
    bottom: 0,
    left: '50%',
    marginLeft: -12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#6C5CE7',
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  audioPlayButtonActive: {
    backgroundColor: '#E74C3C',
  },
  receiptImage: {
    width: '100%',
    height: '100%',
  },
  docThumbPlaceholder: {
    backgroundColor: '#F0EEFF',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  docThumbLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6C5CE7',
  },
  /** 非正方形缩略图取靠上/靠左部分，不居中 */
  thumbAlignTopLeft: Platform.select({ web: { objectFit: 'cover' as const, objectPosition: 'top left' as const }, default: {} }),
  summaryContent: {
    flex: 1,
    justifyContent: 'space-between',
  },
  summaryContentTop: {
    flex: 1,
    justifyContent: 'space-between',
  },
  summaryContentMain: {
    flex: 1,
  },
  submittedInfo: {
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  submittedText: {
    fontSize: 11,
    color: '#95A5A6',
    textAlign: 'right',
  },
  storeName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#2D3436',
    lineHeight: 22,
    height: 22, // 固定高度，作为三行高度计算基准
    // 略微上移并压缩与下方金额行的间距
    marginBottom: 2,
    // 加一个透明下边框，让编辑/非编辑模式整体高度一致，避免文字在切换时上下跳动
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
    paddingVertical: 0,
  },
  storeNameInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 22,
    marginBottom: 2,
  },
  storeNameInput: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: '#2D3436',
    lineHeight: 22,
    borderBottomWidth: 1,
    borderBottomColor: '#6C5CE7',
    height: 22,
    paddingVertical: 0,
    paddingRight: 4,
    transform: [{ translateY: -1 }],
  },
  storeNameDropdownIcon: {
    paddingLeft: 4,
    justifyContent: 'center',
    alignItems: 'center',
    height: 22,
  },
  pickerOptionSubtext: {
    fontSize: 12,
    color: '#95A5A6',
    marginRight: 8,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'baseline',
    // 与上方商家名称、下方日期形成更均衡的三行行距
    marginTop: 2,
  },
  amountContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  currencyLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#636E72',
    lineHeight: 18,
  },
  // 保留占位，若后续需要针对只读态额外调整可继续使用
  currencyLabelReadonly: {},
  totalAmount: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#6C5CE7',
    marginRight: 8,
    lineHeight: 28,
  },
  taxText: {
    // 阅读模式下 Tax 行的容器
    flexDirection: 'row',
    alignItems: 'center',
    // 与编辑态 taxInputContainer.marginLeft 保持一致，确保与总金额的水平间距固定
    marginLeft: 8,
    height: 20, // 与编辑态 taxInput.height 一致，避免高度抖动
  },
  taxInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  taxLabel: {
    fontSize: 11,
    color: '#636E72',
    fontWeight: '500',
    lineHeight: 16,
  },
  taxValueText: {
    fontSize: 11,
    color: '#636E72',
    fontWeight: '500',
    lineHeight: 16,
    // 税额数字向右略移，使“Tax:”与数字之间保持固定间距
    marginLeft: 8,
  },
  taxInput: {
    fontSize: 11,
    color: '#636E72',
    fontWeight: '500',
    borderWidth: 1,
    borderColor: '#6C5CE7',
    borderRadius: 4,
    paddingVertical: 1,
    height: 20,
    paddingHorizontal: 4,
    minWidth: 50,
    textAlign: 'left',
    lineHeight: 16,
  },
  date: {
    fontSize: 14, // 与币种相同
    fontWeight: '600', // 与币种相同粗细
    color: '#636E72',
    // 对齐编辑态的 dateText 与 dateTag 中的文字位置（略上移、略右移）
    lineHeight: 18,
    marginTop: 2,
    // 略小于 dateTag 的 paddingHorizontal，抵消渲染差异
    marginLeft: 11,
    marginBottom: 0,
  },
  currencyContainer: {
    // 与日期左侧对齐：币种框左边缘应与日期框左边缘对齐
    marginLeft: 0,
    marginRight: 4,
    // 不再强制 minWidth，让左右留白只由 padding 决定，避免右侧空白过大
    minHeight: 20,
  },
  currencyPickerTouchable: {
    // 采用与日期编辑态相同的圆角框风格（去除下拉箭头后适当缩减左右留白）
    flexDirection: 'row',
    alignItems: 'center',
    // 左右内边距保持完全一致，保证视觉对称
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#6C5CE7',
    backgroundColor: '#F8F9FA',
    height: 20,
  },
  currencyPickerReadonly: {
    // 与编辑态的 currencyPickerTouchable 完全同宽同内边距，只是边框透明，避免左右抖动
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    height: 20,
  },
  currencyInput: {
    fontSize: 14,
    fontWeight: '600',
    color: '#636E72',
    borderWidth: 1,
    borderColor: '#6C5CE7',
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    minWidth: 60,
    lineHeight: 20,
    height: 24, // 固定高度，避免布局跳动
  },
  dateContainer: {
    marginTop: 8,
    // 固定高度，保证编辑/非编辑模式下头部卡片总高度一致
    height: 24,
  },
  dateTouchable: {
    // 只作为点击区域容器，具体视觉样式由 dateTag 控制
    alignSelf: 'flex-start',
  },
  dateText: {
    fontSize: 14, // 与币种相同
    color: '#636E72',
    lineHeight: 18,
    fontWeight: '600', // 与币种相同加粗程度
  },
  dateTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#6C5CE7',
    backgroundColor: '#F8F9FA',
    height: 20,
  },
  dateIcon: {
    marginLeft: 6,
  },
  datePickerIOS: {
    width: '100%',
    height: 200,
  },
  paymentCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 2,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLabel: {
    fontSize: 14,
    color: '#636E72',
    marginRight: 12,
    fontWeight: '500',
  },
  cardValue: {
    // 与编辑模式下的 accountText 保持一致的文字样式
    fontSize: 14,
    color: '#2D3436',
    fontWeight: '500',
    paddingVertical: 10, // 增加上下内间距，增加非编辑状态的高度
    lineHeight: 20, // 确保行高一致
    // 阅读模式下账户名整体向左移动约 20 像素（通过增加右侧留白实现，不改变卡片高度）
    marginRight: 37,
  },
  accountTouchable: {
    flex: 1,
    alignItems: 'flex-end',
    justifyContent: 'center',
    minHeight: 40, // 保持最小高度一致
  },
  accountTag: {
    flexDirection: 'row',
    alignItems: 'center',
    // 与币种、税、日期等编辑套框统一底色
    backgroundColor: '#F8F9FA',
    paddingHorizontal: 12,
    paddingVertical: 4, // 减小上下内间距，与非编辑状态的 cardValue 保持一致
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#6C5CE7',
    maxWidth: 250,
    minWidth: 120,
    flexShrink: 0,
  },
  accountText: {
    fontSize: 14,
    color: '#2D3436',
    fontWeight: '500',
    flexShrink: 1,
    marginRight: 6,
    maxWidth: 200,
    lineHeight: 20, // 确保行高一致
  },
  input: {
    fontSize: 16,
    color: '#2D3436',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
    paddingVertical: 8,
  },
  inputInline: {
    fontSize: 15,
    color: '#2D3436',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
    paddingVertical: 4,
    flex: 1,
    textAlign: 'right',
  },
  itemsSection: {
    marginBottom: 12,
    backgroundColor: '#fff',
    borderRadius: 10,
    overflow: 'hidden',
  },
  sectionTitleContainer: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#2D3436',
  },
  itemCard: {
    backgroundColor: '#fff',
    borderRadius: 0,
    paddingLeft: 8,
    paddingTop: 4,
    paddingBottom: 4,
    paddingRight: 32, // 增加右端留白，为删除按钮留出空间
    marginBottom: 0,
  },
  itemCardWithBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  deleteItemButton: {
    position: 'absolute',
    top: '50%',
    marginTop: -14, // 图标高度20px + padding 4px * 2 = 28px，一半是14px
    right: 0, // 向右移动（减少right值，图标更靠右）
    zIndex: 1,
    padding: 4, // 增加点击区域
  },
  itemName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
    marginRight: 6,
    // 固定高度和行高，作为商品名称行的基准
    lineHeight: 20,
    height: 20,
    // 与编辑态保持相同的下划线占位，避免切换时文字上下抖动
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
    paddingVertical: 0,
    // 与编辑态保持相同的 Y 偏移，彻底消除切换时的相对位移
    transform: [{ translateY: -2 }],
  },
  itemNameInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
    // 下划线输入样式，但高度和 itemName 完全一致
    borderBottomWidth: 1,
    // 使用与套框相同的主题色和线宽
    borderBottomColor: '#6C5CE7',
    lineHeight: 20,
    height: 20,
    paddingVertical: 0,
    marginRight: 6,
    // 再向上微移 1px，进一步抵消进入编辑模式时的肉眼下移
    transform: [{ translateY: -4 }],
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 1,
  },
  itemTags: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginTop: 0,
    position: 'relative',
  },
  tagGroupLeft: {
    width: 120, // 固定宽度，与tag的maxWidth一致
    alignItems: 'flex-start',
  },
  tagGroupCenter: {
    marginLeft: 2, // 向左移动8（从4减到-4，总共左移8）
    alignItems: 'flex-start',
  },
  tagGroupRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  tagTouchable: {
    minHeight: 32,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  tag: {
    paddingLeft: 10,
    paddingRight: 5, // 右端留白减半（从10减到5）
    paddingVertical: 4,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: 140, // 约16个字符的宽度（11px字体，中文字符约8.5px/字符）
  },
  tagText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  tagIcon: {
    marginLeft: 4,
    opacity: 0.8,
    flexShrink: 0,
  },
  tagSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  assetTagTouchable: {
    minHeight: 32,
    minWidth: 80,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  assetTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  assetTagText: {
    fontSize: 11,
    fontWeight: '500',
    marginLeft: 3,
  },
  itemPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6C5CE7',
    paddingVertical: 4, // 与 priceInput 保持一致的高度（borderWidth 1px + paddingVertical 3px）
    paddingHorizontal: 7, // 与 priceInput 保持一致（borderWidth 1px + paddingHorizontal 6px）
    minWidth: 70,
    textAlign: 'right',
    lineHeight: 20, // 确保行高一致
  },
  priceInput: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6C5CE7',
    borderWidth: 1,
    borderColor: '#6C5CE7',
    borderRadius: 4,
    paddingVertical: 3,
    paddingHorizontal: 6,
    minWidth: 70,
    textAlign: 'right',
    lineHeight: 20, // 确保行高一致
  },
  assetCheckbox: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  assetLabel: {
    marginLeft: 8,
    fontSize: 14,
    color: '#636E72',
  },
  addItemButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // 采用与其他编辑套框统一的底色，但边框弱化
    backgroundColor: '#F8F9FA',
    // 减小圆角，以表意“新的一行 item”
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#CED4DA',
    // 宽度与 itemCard 一致：在父容器内占满横向空间
    alignSelf: 'stretch',
  },
  addItemButtonContainer: {
    // 将 Add Item 按钮放置在灰色背景上，与 item 卡片底色区分开
    paddingTop: 12,
    paddingBottom: 4,
    backgroundColor: '#ECEFF1',
    alignItems: 'center',
  },
  addItemText: {
    marginLeft: 8,
    fontSize: 16,
    color: '#6C5CE7',
    fontWeight: '600',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    // 不再使用遮挡式背景，只保留按钮的浮动布局
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 8,
    borderTopWidth: 0,
    flexDirection: 'row',
    gap: 12,
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#6C5CE7',
    justifyContent: 'center',
    alignItems: 'center',
    // 统一浮动按钮阴影样式
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 6,
  },
  editFab: {
    bottom: 20,
    backgroundColor: '#95A5A6',
    // 继承 fab 的阴影，不再单独弱化
  },
  retryFab: {
    bottom: 20,
    backgroundColor: '#E74C3C',
  },
  /** 重试/删除 FAB：外环用 fab 底色；内白圆 + 线形 icon（确认 pending 仍为整颗紫底 + 白实心勾，不用此环） */
  fabRingInner: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmFab: {
    bottom: 100,
    // 使用与 fab / editFab 相同的阴影层级
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 6,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    // iOS：四周均匀阴影（略加深以区分白底）
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.11,
    shadowRadius: 10,
    // Android：elevation 会产生偏下阴影，改为 0 并用细边框保持轮廓
    ...(Platform.OS === 'android'
      ? { elevation: 0, borderWidth: 1, borderColor: 'rgba(0,0,0,0.14)' }
      : { elevation: 3 }),
  },
  cancelButtonText: {
    fontSize: 16,
    color: '#636E72',
    fontWeight: '600',
  },
  confirmButton: {
    flex: 1,
    backgroundColor: '#6C5CE7',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    ...(Platform.OS === 'android'
      ? { elevation: 0, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' }
      : { elevation: 4 }),
  },
  confirmButtonText: {
    marginLeft: 8,
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  errorText: {
    textAlign: 'center',
    marginTop: 50,
    fontSize: 16,
    color: '#E74C3C',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: 8,
  },
  modalImage: {
    width: '100%',
    height: '100%',
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  pickerBottomSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingBottom: 32,
    paddingHorizontal: 20,
    maxHeight: '70%',
  },
  pickerHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#BDC3C7',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2D3436',
    flex: 1,
  },
  pickerManageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F0F0F0',
  },
  pickerManageText: {
    fontSize: 14,
    color: '#6C5CE7',
    fontWeight: '500',
    marginLeft: 4,
  },
  pickerScrollView: {
    maxHeight: 400,
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#F8F9FA',
    minHeight: 48,
  },
  pickerOptionSelected: {
    backgroundColor: '#E8F4FD',
  },
  pickerColorIndicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginRight: 12,
  },
  pickerOptionText: {
    flex: 1,
    fontSize: 16,
    color: '#2D3436',
    fontWeight: '500',
  },
  pickerOptionTextSelected: {
    color: '#6C5CE7',
    fontWeight: '600',
  },
  pickerCloseButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pickerCloseText: {
    fontSize: 16,
    color: '#6C5CE7',
    fontWeight: '600',
  },
  duplicateModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  duplicateModalContentContainer: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  duplicateModalContent: {
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
  duplicateModalHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  duplicateModalTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#2D3436',
    marginTop: 12,
    marginBottom: 0,
  },
  duplicateModalMessageBlock: {
    marginBottom: 24,
    paddingHorizontal: 8,
    alignItems: 'center',
    width: '100%',
  },
  duplicateModalNameContainer: {
    marginTop: 8,
    marginBottom: 20,
    alignSelf: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E7FF',
    paddingBottom: 8,
  },
  duplicateModalNameText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#6C5CE7',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  duplicateModalMessage: {
    fontSize: 15,
    color: '#636E72',
    textAlign: 'center',
    marginTop: 4,
  },
  duplicateModalButtons: {
    flexDirection: 'column',
    width: '100%',
    gap: 10,
  },
  duplicateModalButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    flexDirection: 'row',
  },
  duplicateModalButtonReplace: {
    backgroundColor: '#27AE60',
    shadowColor: '#27AE60',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  duplicateModalButtonReplaceText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  duplicateModalButtonMerge: {
    backgroundColor: '#FFF5F5',
    borderWidth: 2,
    borderColor: '#E74C3C',
  },
  duplicateModalButtonMergeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#E74C3C',
  },
  duplicateModalButtonDontChange: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  duplicateModalButtonDontChangeText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#95A5A6',
  },
});

