import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { getInvoiceById, saveInvoice, updateInvoiceItem, deleteInvoice } from '@/lib/invoices';
import { reprocessIncomeInvoiceFromStoredMedia } from '@/lib/reprocess-voucher-recognition';
import { supabase, uploadInvoiceImage } from '@/lib/supabase';
import { processImageForUpload } from '@/lib/image-processor';
import { getCategories } from '@/lib/categories';
import { getAttributions } from '@/lib/attributions';
import { sortScopeTagsForDisplay } from '@/lib/sort-scope-tags-for-display';
import { getAccounts, mergeAccount } from '@/lib/accounts';
import { getCustomerOptions } from '@/lib/customer-supplier-list';
import { normalizeNameForCompare } from '@/lib/name-utils';
import { mergeEntity, getCanonicalEntityId } from '@/lib/entities';
import { getChatLogsPaginated } from '@/lib/chat-logs';
import { playAudio, stopPlayback } from '@/lib/audio';
import { Invoice, InvoiceItem, Category, Attribution, VoucherStatus, Account } from '@/types';
import { format } from 'date-fns';
import { getLocalDateString } from '@/lib/date-utils';
import { showToast } from '@/lib/toast';
import { showChoiceDialog, showConfirmDestructiveDialog } from '@/lib/confirmDialog';
import {
  FileDetailModal,
  looksLikeDocumentAttachmentUrl,
  looksLikePdfUrl,
  type FileDetailModalFile,
} from '@/components/FileDetailModal';

export default function InvoiceDetailsScreen() {
  const { id, new: isNew } = useLocalSearchParams<{ id: string; new?: string }>();
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [editedInvoice, setEditedInvoice] = useState<Invoice | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isReprocessingRecognition, setIsReprocessingRecognition] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [attributions, setAttributions] = useState<Attribution[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showCategoryPicker, setShowCategoryPicker] = useState<number | null>(null);
  const [showAttributionPicker, setShowAttributionPicker] = useState<number | null>(null);
  const [showAccountPicker, setShowAccountPicker] = useState<boolean>(false);
  const [showCustomerPicker, setShowCustomerPicker] = useState<boolean>(false);
  const [customerOptions, setCustomerOptions] = useState<{ id: string; name: string; source: 'customer' | 'supplier' }[]>([]);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState<boolean>(false);
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [taxInputText, setTaxInputText] = useState<string>('');
  const [priceInputTexts, setPriceInputTexts] = useState<{ [index: number]: string }>({});
  const [showDuplicateNameModal, setShowDuplicateNameModal] = useState(false);
  const [duplicateNameModalPayload, setDuplicateNameModalPayload] = useState<{
    code: string;
    duplicateName: string;
    targetId?: string;
    targetSource?: 'customer' | 'supplier';
    triggeredBy: 'save' | 'dropdown';
  } | null>(null);
  const [pendingDuplicateChoice, setPendingDuplicateChoice] = useState<'replace' | 'merge' | 'keep_original' | null>(null);
  const [pendingDuplicatePayload, setPendingDuplicatePayload] = useState<{
    code: string;
    duplicateName: string;
    targetId?: string;
    targetSource?: 'customer' | 'supplier';
  } | null>(null);
  const [fileDetailForModal, setFileDetailForModal] = useState<FileDetailModalFile | null>(null);
  const editingRef = useRef(false);
  const invoiceStatusRef = useRef<string | null>(null);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  const applyInvoiceFormInputs = useCallback((data: Invoice) => {
    setTaxInputText((data.tax || 0).toString());
    const priceTexts: { [index: number]: string } = {};
    (data.items || []).forEach((item, index) => {
      priceTexts[index] = String(item.price ?? 0);
    });
    setPriceInputTexts(priceTexts);
  }, []);

  const loadInvoice = useCallback(async (options?: { forceSyncEdited?: boolean }) => {
    if (!id) return;
    try {
      const data = await getInvoiceById(id);
      const prevStatus = invoiceStatusRef.current;
      const nextStatus = data?.status ?? null;
      const recognitionJustFinished =
        prevStatus === 'processing' && !!nextStatus && nextStatus !== 'processing';
      invoiceStatusRef.current = nextStatus;
      setInvoice(data);
      const shouldSyncEdited =
        options?.forceSyncEdited ??
        (!editingRef.current || nextStatus === 'processing' || recognitionJustFinished);
      if (shouldSyncEdited && data) {
        setEditedInvoice(data);
        if (nextStatus === 'processing' || recognitionJustFinished || options?.forceSyncEdited) {
          applyInvoiceFormInputs(data);
        }
      }
      // 加载与该收入单相关的语音记录（用于回放按钮）：仅匹配 responseData.invoicePreview.id === 当前收入单 id
      try {
        const chatLogs = await getChatLogsPaginated(50, undefined, 'invoice');
        const targetId = String(data.id);
        const audioLog = chatLogs.find(
          (log) =>
            log.type === 'audio' &&
            log.audioUrl &&
            log.responseData?.invoicePreview &&
            String(log.responseData.invoicePreview.id) === targetId
        );
        setAudioUrl(audioLog?.audioUrl ?? null);
      } catch (chatError) {
        console.log('Failed to get chat logs for invoice audio:', chatError);
      }
      if (isNew === 'true' && data && data.status !== 'processing' && shouldSyncEdited) {
        setEditing(true);
        applyInvoiceFormInputs(data);
      }
    } catch (error) {
      showToast('Failed to load invoice details', 'error');
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [id, isNew, applyInvoiceFormInputs]);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      loadInvoice();
      loadCategories();
      loadAttributions();
      loadAccounts();
    });
    return () => task.cancel();
  }, [id, loadInvoice]);

  // Realtime：当前发票或明细被更新时自动重新加载
  useEffect(() => {
    if (!id) return;
    let ch: ReturnType<typeof supabase.channel> | null = null;
    let chItems: ReturnType<typeof supabase.channel> | null = null;
    const refresh = () => loadInvoice();
    ch = supabase
      .channel(`invoice-detail-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: `id=eq.${id}` }, refresh)
      .subscribe();
    chItems = supabase
      .channel(`invoice-detail-items-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoice_items', filter: `invoice_id=eq.${id}` }, refresh)
      .subscribe();
    return () => {
      if (ch) supabase.removeChannel(ch);
      if (chItems) supabase.removeChannel(chItems);
    };
  }, [id, loadInvoice]);

  useFocusEffect(
    useCallback(() => {
      loadCategories();
      loadAttributions();
      loadAccounts();
    }, [])
  );

  const loadCategories = async () => {
    try {
      const cats = await getCategories('income');
      setCategories(cats);
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  };

  const loadAttributions = async () => {
    try {
      const purps = await getAttributions('income');
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
      console.error('Error loading accounts:', error);
    }
  };

  const handleSave = async () => {
    if (!editedInvoice || !id || !invoice) return;

    if (pendingDuplicateChoice && pendingDuplicatePayload) {
      const choice = pendingDuplicateChoice;
      const payload = pendingDuplicatePayload;
      setPendingDuplicateChoice(null);
      setPendingDuplicatePayload(null);
      try {
        if (choice === 'replace') {
          await saveInvoice({ ...editedInvoice, id, status: 'confirmed' as VoucherStatus });
        } else if (choice === 'merge') {
          if (payload.code === 'ACCOUNT_NAME_EXISTS') {
            const currentId = invoice.accountId;
            const targetId = payload.targetId;
            if (currentId && targetId && currentId !== targetId) {
              await mergeAccount([currentId], targetId);
            }
            await saveInvoice({ ...editedInvoice, id, status: 'confirmed' as VoucherStatus });
          } else {
            const currentId = getCanonicalEntityId(invoice);
            const targetId = payload.targetId;
            if (currentId && targetId && currentId !== targetId) {
              await mergeEntity([currentId], targetId);
            }
            await saveInvoice({
              ...editedInvoice,
              id,
              status: 'confirmed' as VoucherStatus,
              entityId: targetId ?? editedInvoice.entityId,
              entity: targetId
                ? { id: targetId, name: payload.duplicateName || editedInvoice.customerName, spaceId: editedInvoice.spaceId, isAiRecognized: false }
                : editedInvoice.entity,
              customerName: payload.duplicateName || editedInvoice.customerName,
            });
          }
        } else {
          const reverted = { ...editedInvoice, id, status: 'confirmed' as VoucherStatus };
          if (payload.code === 'ACCOUNT_NAME_EXISTS') {
            reverted.accountId = invoice.accountId;
            reverted.account = invoice.account;
          } else {
            reverted.customerName = invoice.entity?.name ?? invoice.customerName ?? '';
            reverted.entityId = invoice.entityId ?? invoice.entity?.id;
            reverted.entity = invoice.entity;
          }
          await saveInvoice(reverted);
        }
        setEditing(false);
        showToast('Income saved', 'success');
        loadInvoice();
      } catch (e: any) {
        showToast(e?.message ?? 'Failed to save', 'error');
        console.error(e);
      }
      return;
    }

    try {
      await saveInvoice({
        ...editedInvoice,
        id,
        status: 'confirmed' as VoucherStatus,
      });
      setEditing(false);
      showToast('Income saved', 'success');
      loadInvoice();
    } catch (error: any) {
      const code = error?.code as string | undefined;
      const duplicateName = (error?.duplicateName ?? '') as string;
      const targetId = error?.targetId as string | undefined;
      const targetSource = error?.targetSource as 'customer' | 'supplier' | undefined;

      if (code === 'CUSTOMER_NAME_EXISTS' || code === 'SUPPLIER_NAME_EXISTS' || code === 'ENTITY_NAME_EXISTS') {
        setDuplicateNameModalPayload({
          code,
          duplicateName: duplicateName || '',
          targetId,
          targetSource,
          triggeredBy: 'save',
        });
        setShowDuplicateNameModal(true);
        return;
      }
      if (code === 'ACCOUNT_NAME_EXISTS') {
        setDuplicateNameModalPayload({
          code: 'ACCOUNT_NAME_EXISTS',
          duplicateName: duplicateName || '',
          targetId,
          targetSource: undefined,
          triggeredBy: 'save',
        });
        setShowDuplicateNameModal(true);
        return;
      }
      showToast('Failed to save', 'error');
      console.error(error);
    }
  };

  const handlePlayAudio = async () => {
    if (!audioUrl) return;
    if (isPlayingAudio) {
      await stopPlayback();
      setIsPlayingAudio(false);
    } else {
      setIsPlayingAudio(true);
      await playAudio(audioUrl, () => {
        setIsPlayingAudio(false);
      });
    }
  };

  /** Close modal only; keep edited state (mask/back). */
  const handleDuplicateNameCloseOnly = () => {
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
  };

  /** 保留原来的：dropdown 立即恢复编辑态原值；save 则恢复并用原值直接 confirm（通用三选项逻辑）。 */
  const handleDuplicateNameDontChange = async () => {
    const payload = duplicateNameModalPayload;
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
    if (payload?.triggeredBy === 'dropdown') {
      if (!invoice) return;
      if (payload?.code === 'ACCOUNT_NAME_EXISTS') {
        const origAccount = invoice.account ?? (invoice.accountId ? accounts.find((a) => a.id === invoice.accountId) : undefined);
        setEditedInvoice((prev) => (prev ? { ...prev, accountId: invoice.accountId, account: origAccount } : prev));
      } else {
        const origName = invoice.entity?.name ?? invoice.customerName ?? '';
        setEditedInvoice((prev) =>
          prev
            ? {
                ...prev,
                customerName: origName,
                entityId: invoice.entityId ?? invoice.entity?.id,
                entity: invoice.entity,
              }
            : prev
        );
      }
      return;
    }
    if (!invoice || !editedInvoice || !id) return;
    if (payload?.code === 'ACCOUNT_NAME_EXISTS') {
      const origAccount = invoice.account ?? (invoice.accountId ? accounts.find((a) => a.id === invoice.accountId) : undefined);
      setEditedInvoice((prev) => (prev ? { ...prev, accountId: invoice.accountId, account: origAccount } : prev));
      try {
        const reverted = {
          ...editedInvoice,
          id,
          status: 'confirmed' as VoucherStatus,
          accountId: invoice.accountId,
          account: origAccount,
        };
        await saveInvoice(reverted);
        setEditing(false);
        loadInvoice();
      } catch (e: any) {
        showToast(e?.message ?? 'Failed to save', 'error');
      }
      return;
    }
    const origName = invoice.entity?.name ?? invoice.customerName ?? '';
    setEditedInvoice((prev) =>
      prev
        ? {
            ...prev,
            customerName: origName,
            entityId: invoice.entityId ?? invoice.entity?.id,
            entity: invoice.entity,
          }
        : prev
    );
    try {
      const reverted = {
        ...editedInvoice,
        id,
        status: 'confirmed' as VoucherStatus,
        customerName: origName,
        entityId: invoice.entityId ?? invoice.entity?.id,
        entity: invoice.entity,
      };
      await saveInvoice(reverted);
      setEditing(false);
      loadInvoice();
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to save', 'error');
    }
  };

  const handleDuplicateNameReplace = async () => {
    const payload = duplicateNameModalPayload;
    if (!payload || !editedInvoice || !id) return;
    if (payload.triggeredBy === 'dropdown') {
      setPendingDuplicateChoice('replace');
      setPendingDuplicatePayload({
        code: payload.code,
        duplicateName: payload.duplicateName,
        targetId: payload.targetId,
        targetSource: payload.targetSource,
      });
      setShowDuplicateNameModal(false);
      setDuplicateNameModalPayload(null);
      return;
    }
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
    try {
      if (payload.code === 'ACCOUNT_NAME_EXISTS') {
        const finalTargetId = payload.targetId;
        if (!finalTargetId) {
          showToast('Target account not found.', 'info');
          return;
        }
        const savePayload = {
          ...editedInvoice,
          id,
          status: 'confirmed' as VoucherStatus,
          accountId: finalTargetId,
          account: { id: finalTargetId, name: payload.duplicateName } as Account,
        };
        await saveInvoice(savePayload);
        setEditing(false);
        loadInvoice();
        return;
      }
      let finalTargetId = payload.targetId;
      if (finalTargetId == null) {
        const options = await getCustomerOptions();
        const nameToFind = (payload.duplicateName || '').trim();
        const found = nameToFind ? options.find((o) => normalizeNameForCompare(o.name) === normalizeNameForCompare(nameToFind)) : null;
        if (!found) {
          if (!nameToFind) {
            showToast('Please select from the list', 'info');
            setShowCustomerPicker(true);
          } else {
            showToast(`No Payer found with name "${payload.duplicateName}". Please use the picker.`, 'info');
          }
          return;
        }
        finalTargetId = found.id;
      }
      const savePayload = {
        ...editedInvoice,
        id,
        status: 'confirmed' as VoucherStatus,
        customerName: payload.duplicateName || editedInvoice.customerName,
        entityId: finalTargetId,
        entity: {
          id: finalTargetId,
          name: payload.duplicateName || editedInvoice.customerName,
          spaceId: editedInvoice.spaceId,
          isAiRecognized: false,
        },
      };
      await saveInvoice(savePayload);
      setEditing(false);
      loadInvoice();
    } catch (e) {
      showToast('Failed to replace voucher', 'error');
      console.error(e);
    }
  };

  const handleDuplicateNameMerge = async () => {
    const payload = duplicateNameModalPayload;
    if (!payload || !invoice) return;
    if (payload.triggeredBy === 'dropdown') {
      setPendingDuplicateChoice('merge');
      setPendingDuplicatePayload({
        code: payload.code,
        duplicateName: payload.duplicateName,
        targetId: payload.targetId,
        targetSource: payload.targetSource,
      });
      setShowDuplicateNameModal(false);
      setDuplicateNameModalPayload(null);
      return;
    }
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
    try {
      if (payload.code === 'ACCOUNT_NAME_EXISTS') {
        const currentAccountId = invoice.accountId;
        const finalTargetId = payload.targetId;
        if (!currentAccountId || !finalTargetId) {
          showToast('This income has no linked account or target not found.', 'info');
          return;
        }
        if (currentAccountId === finalTargetId) {
          showToast('Already linked to this account.', 'info');
          return;
        }
        await mergeAccount([currentAccountId], finalTargetId);
        setEditing(false);
        loadInvoice();
        return;
      }
      const currentId = getCanonicalEntityId(invoice);
      if (!currentId) {
        showToast('This income has no linked Payer to merge.', 'info');
        return;
      }
      let finalTargetId = payload.targetId;
      if (finalTargetId == null) {
        const options = await getCustomerOptions();
        const nameToFindMerge = (payload.duplicateName || '').trim();
        const found = nameToFindMerge ? options.find((o) => normalizeNameForCompare(o.name) === normalizeNameForCompare(nameToFindMerge)) : null;
        if (!found) {
          showToast(nameToFindMerge ? `No Payer found with name "${payload.duplicateName}".` : 'Please select from the list.', 'info');
          return;
        }
        finalTargetId = found.id;
      }
      if (finalTargetId === currentId) {
        showToast('Already linked to this Payer.', 'info');
        return;
      }
      await mergeEntity([currentId], finalTargetId);
      if (editedInvoice && id) {
        await saveInvoice({
          ...editedInvoice,
          id,
          status: 'confirmed' as VoucherStatus,
          entityId: finalTargetId,
          entity: {
            id: finalTargetId,
            name: payload.duplicateName || editedInvoice.customerName,
            spaceId: editedInvoice.spaceId,
            isAiRecognized: false,
          },
          customerName: payload.duplicateName || editedInvoice.customerName,
        });
      }
      setEditing(false);
      loadInvoice();
    } catch (e: any) {
      showToast(e?.message ?? String(e), 'error');
      console.warn('Merge invoices customer/account link failed:', e);
    }
  };

  const handleConfirm = async () => {
    if (!id) return;
    try {
      await saveInvoice({
        ...(invoice!),
        id,
        status: 'confirmed' as VoucherStatus,
      });
      loadInvoice();
    } catch (error) {
      showToast('Failed to confirm income', 'error');
      console.error(error);
    }
  };

  const commonCurrencies = useMemo(() => ['USD', 'CAD', 'EUR', 'GBP', 'JPY', 'HKD', 'AUD', 'CNY'], []);

  const categoriesSorted = useMemo(() => sortScopeTagsForDisplay(categories), [categories]);
  const attributionsSorted = useMemo(() => sortScopeTagsForDisplay(attributions), [attributions]);

  const calculateItemsSum = useCallback((items: InvoiceItem[]) => {
    return items.reduce((sum, item) => sum + (item.price || 0), 0);
  }, []);

  const handleItemChange = (index: number, field: keyof InvoiceItem, value: any) => {
    if (!editedInvoice) return;
    const newItems = [...editedInvoice.items];
    const updatedItem = { ...newItems[index] } as InvoiceItem;
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
    } else {
      (updatedItem as any)[field] = value;
    }
    newItems[index] = updatedItem;
    const itemsSum = calculateItemsSum(newItems);
    const tax = editedInvoice.tax || 0;
    setEditedInvoice({ ...editedInvoice, items: newItems, totalAmount: itemsSum + tax });
  };

  const handleTaxChange = (tax: number) => {
    if (!editedInvoice) return;
    const itemsSum = calculateItemsSum(editedInvoice.items);
    setEditedInvoice({ ...editedInvoice, tax, totalAmount: itemsSum + tax });
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (event.type === 'dismissed') return;
    }
    if (selectedDate && editedInvoice) {
      setEditedInvoice({ ...editedInvoice, date: getLocalDateString(selectedDate) });
    }
  };

  const handleCurrencyChange = (currency: string) => {
    if (!editedInvoice) return;
    setEditedInvoice({ ...editedInvoice, currency: currency || undefined });
  };

  // 仅更新发票上的客户名称文本，保留已有关联 ID（有关联时后端会更新对应表）
  const handleCustomerNameChange = (customerName: string) => {
    if (!editedInvoice) return;
    setEditedInvoice({ ...editedInvoice, customerName });
  };

  const openCustomerPicker = async () => {
    try {
      const options = await getCustomerOptions();
      setCustomerOptions(options);
      setShowCustomerPicker(true);
    } catch (e) {
      console.warn('Failed to load customer options:', e);
    }
  };

  const handleSelectCustomer = (option: { id: string; name: string; source: 'customer' | 'supplier' } | null) => {
    if (!editedInvoice) return;
    setShowCustomerPicker(false);
    const currentId = getCanonicalEntityId(invoice);
    if (option === null) {
      setEditedInvoice({
        ...editedInvoice,
        customerName: editedInvoice.customerName ?? '',
        entityId: undefined,
        entity: undefined,
      });
      return;
    }
    setEditedInvoice({
      ...editedInvoice,
      customerName: option.name,
      entityId: option.id,
      entity: { id: option.id, name: option.name, spaceId: editedInvoice.spaceId, isAiRecognized: false },
    });
    // 从空改为选择时不弹三选项；仅当已有 Payer 且换成另一个时弹窗
    if (currentId && option.id !== currentId) {
      setDuplicateNameModalPayload({
        code: 'ENTITY_NAME_EXISTS',
        duplicateName: option.name,
        targetId: option.id,
        triggeredBy: 'dropdown',
      });
      setShowDuplicateNameModal(true);
    }
  };

  const handleItemChangeDirect = async (
    index: number,
    field: 'categoryId' | 'attributionId' | 'isAsset',
    value: any
  ) => {
    if (!id || !currentInvoice) return;
    const item = currentInvoice.items[index];
    if (!item || !item.id) return;
    try {
      const newItems = [...currentInvoice.items];
      const updatedItem = { ...newItems[index] } as InvoiceItem;
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
      setInvoice({ ...currentInvoice, items: newItems });
      await updateInvoiceItem(id, item.id, field, value);
    } catch (error) {
      console.error('Error updating item:', error);
      showToast('Failed to update item', 'error');
      loadInvoice();
    }
  };

  const handleAddItem = () => {
    if (!editedInvoice) return;
    const defaultCategory = categories.find(cat => cat.name === 'Sales') || categories[0];
    const defaultAttribution = attributions.length > 0 ? attributions[0] : null;
    const newItem: InvoiceItem = {
      name: '',
      categoryId: defaultCategory?.id ?? null,
      category: defaultCategory,
      attributionId: defaultAttribution?.id || null,
      attribution: defaultAttribution,
      price: 0,
      isAsset: false,
    };
    const newItems = [...editedInvoice.items, newItem];
    const itemsSum = calculateItemsSum(newItems);
    const tax = editedInvoice.tax || 0;
    setEditedInvoice({ ...editedInvoice, items: newItems, totalAmount: itemsSum + tax });
  };

  const handleDeleteItem = (index: number) => {
    if (!editedInvoice) return;
    const newItems = editedInvoice.items.filter((_, i) => i !== index);
    const itemsSum = calculateItemsSum(newItems);
    const tax = editedInvoice.tax || 0;
    setEditedInvoice({ ...editedInvoice, items: newItems, totalAmount: itemsSum + tax });
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

  const pickFromCamera = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        showToast('Camera access is required.', 'info');
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
      showToast('Failed to launch camera.', 'error');
    }
  };

  const pickFromLibrary = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showToast('Photo library access is required.', 'info');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) await uploadImage(result.assets[0].uri);
    } catch (error) {
      showToast('Failed to pick image.', 'error');
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

  const handleReRecognizeIncome = async () => {
    if (!id) return;
    setIsReprocessingRecognition(true);
    try {
      await reprocessIncomeInvoiceFromStoredMedia(id);
      await loadInvoice({ forceSyncEdited: true });
      showToast('Re-recognition complete', 'success');
    } catch (error) {
      console.error('Re-recognize failed:', error);
      const msg = error instanceof Error ? error.message : 'Recognition failed';
      showToast(msg, 'error');
      await loadInvoice({ forceSyncEdited: true });
    } finally {
      setIsReprocessingRecognition(false);
    }
  };

  const handleDeleteIncomeFromRetake = () => {
    if (!id) return;
    showConfirmDestructiveDialog(
      'Delete income',
      'This income record will be permanently deleted.',
      async () => {
        try {
          await deleteInvoice(id);
          showToast('Income deleted', 'info');
          router.back();
        } catch (e) {
          console.error(e);
          showToast('Failed to delete income', 'error');
        }
      },
      { confirmLabel: 'Delete' }
    );
  };

  const uploadImage = async (imageUri: string) => {
    if (!id) return;
    setIsUploadingImage(true);
    try {
      const imageUrl = await uploadInvoiceImage(imageUri, id, editedInvoice?.spaceId ?? invoice?.spaceId ?? '');
      await saveInvoice({ ...(editedInvoice || invoice)!, id, imageUrl });
      await loadInvoice();
    } catch (error) {
      showToast('Failed to upload image.', 'error');
    } finally {
      setIsUploadingImage(false);
    }
  };

  if (loading && !invoice) {
    return (
      <View style={styles.container}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <View style={styles.summaryCard}>
            <View style={styles.imagePlaceholder}>
              <ActivityIndicator size="large" color="#6C5CE7" />
            </View>
            <View style={styles.summaryContent}>
              <Text style={[styles.storeName, { color: '#BDC3C7' }]}>Loading...</Text>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (!invoice) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Income not found</Text>
      </View>
    );
  }

  const currentInvoice = editing ? (editedInvoice || invoice) : invoice;
  if (!currentInvoice) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Income not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.summaryCard}>
          <View style={styles.imageContainer}>
            <TouchableOpacity
              onPress={() => {
                if (currentInvoice.imageUrl) {
                  const isDoc =
                    looksLikeDocumentAttachmentUrl(currentInvoice.imageUrl) ||
                    currentInvoice.inputType === 'document';
                  if (isDoc) {
                    const file: FileDetailModalFile = {
                      id: `invoice-doc-${currentInvoice.id}`,
                      name: currentInvoice.customerName || currentInvoice.customer?.name || 'Income document',
                      imageUrl: currentInvoice.imageUrl,
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
              {currentInvoice.imageUrl ? (
                looksLikePdfUrl(currentInvoice.imageUrl) || currentInvoice.inputType === 'document' ? (
                  <View style={[styles.receiptImage, styles.thumbAlignTopLeft, styles.docThumbPlaceholder]}>
                    <Ionicons name="document-text" size={36} color="#6C5CE7" />
                    <Text style={styles.docThumbLabel} numberOfLines={1}>
                      {looksLikePdfUrl(currentInvoice.imageUrl) ? 'PDF' : 'Document'}
                    </Text>
                  </View>
                ) : (
                  <Image source={{ uri: currentInvoice.imageUrl }} style={[styles.receiptImage, styles.thumbAlignTopLeft]} resizeMode="cover" />
                )
              ) : (
                <View style={styles.imagePlaceholderContent}>
                  {isUploadingImage ? <ActivityIndicator size="small" color="#6C5CE7" /> : <Ionicons name="document-text" size={32} color="#95A5A6" />}
                </View>
              )}
            </TouchableOpacity>
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
                      value={editedInvoice?.customerName ?? editedInvoice?.customer?.name ?? editedInvoice?.customerSupplier?.name ?? currentInvoice.customerName ?? ''}
                      onChangeText={handleCustomerNameChange}
                      placeholder="Payer"
                      maxLength={100}
                    />
                    <TouchableOpacity
                      style={styles.storeNameDropdownIcon}
                      onPress={openCustomerPicker}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="chevron-down" size={18} color="#6C5CE7" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.storeName} numberOfLines={1}>
                    {currentInvoice.entity?.name || currentInvoice.customer?.name || currentInvoice.customerSupplier?.name || currentInvoice.customerName || '—'}
                  </Text>
                )}
                <View style={styles.amountRow}>
                  <View style={styles.amountContainer}>
                    <View style={styles.currencyContainer}>
                      {editing ? (
                        <TouchableOpacity style={styles.currencyPickerTouchable} onPress={() => setShowCurrencyPicker(true)} activeOpacity={0.7}>
                          <Text style={styles.currencyLabel}>{editedInvoice?.currency || 'Currency'}</Text>
                        </TouchableOpacity>
                      ) : (
                        currentInvoice.currency ? (
                          <View style={styles.currencyPickerReadonly}>
                            <Text style={styles.currencyLabel}>{currentInvoice.currency}</Text>
                          </View>
                        ) : null
                      )}
                    </View>
                    <Text style={styles.totalAmount}>
                      {editing
                        ? (() => {
                            const itemsSum = calculateItemsSum(editedInvoice?.items || []);
                            const tax = editedInvoice?.tax || 0;
                            const total = itemsSum + tax;
                            return (total < 0 ? '-' : '') + Math.abs(total).toFixed(2);
                          })()
                        : (Number.isFinite(Number(currentInvoice.totalAmount))
                            ? (Number(currentInvoice.totalAmount) < 0 ? '-' : '') + Math.abs(Number(currentInvoice.totalAmount)).toFixed(2)
                            : '—')}
                    </Text>
                    {editing ? (
                      <View style={styles.taxInputContainer}>
                        <Text style={styles.taxLabel}>Tax: </Text>
                        <TextInput
                          style={styles.taxInput}
                          value={taxInputText}
                          onChangeText={(text) => {
                            const validPattern = /^-?\d*\.?\d*$/;
                            if (text === '' || text === '-' || validPattern.test(text)) {
                              setTaxInputText(text);
                              if (text !== '' && text !== '-' && text !== '.') {
                                const tax = parseFloat(text);
                                if (!isNaN(tax)) handleTaxChange(tax);
                              } else if (text === '' || text === '-') handleTaxChange(0);
                            }
                          }}
                          onBlur={() => {
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
                        <Text style={styles.taxValueText}>{(currentInvoice.tax ?? 0).toFixed(2)}</Text>
                      </View>
                    )}
                  </View>
                </View>
                <View style={styles.dateContainer}>
                  {editing ? (
                    <TouchableOpacity style={styles.dateTouchable} onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
                      <View style={styles.dateTag}>
                        <Text style={styles.dateText}>{editedInvoice?.date ? formatDate(editedInvoice.date) : 'Select date'}</Text>
                        <Ionicons name="chevron-down" size={14} color="#6C5CE7" style={styles.tagIcon} />
                      </View>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.date}>{formatDate(currentInvoice.date)}</Text>
                  )}
                </View>
              </View>
              {currentInvoice.createdAt && (
                <View style={styles.submittedInfo}>
                  <Text style={styles.submittedText}>
                    {format(new Date(currentInvoice.createdAt), 'MMM dd, yyyy')}
                    {currentInvoice.createdByUser && <> by {currentInvoice.createdByUser.name || currentInvoice.createdByUser.email?.split('@')[0] || 'Unknown'}</>}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <View style={styles.paymentCard}>
          <View style={styles.paymentRow}>
            <Text style={styles.cardLabel}>Account</Text>
            <TouchableOpacity
              style={editing ? styles.accountTouchable : undefined}
              onPress={() => {
                if (!editing) {
                  setEditedInvoice({ ...currentInvoice });
                  setEditing(true);
                  setTaxInputText((editedInvoice || invoice)?.tax?.toString() ?? '0');
                  const priceTexts: { [index: number]: string } = {};
                  ((editedInvoice || invoice)?.items || []).forEach((item, index) => {
                    priceTexts[index] = String(item.price ?? 0);
                  });
                  setPriceInputTexts(priceTexts);
                }
                setShowAccountPicker(true);
              }}
              activeOpacity={0.7}
            >
              {editing ? (
                <View style={styles.accountTag}>
                  <Text style={styles.accountText} numberOfLines={1} ellipsizeMode="tail">
                    {currentInvoice.account?.name || 'Not set'}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color="#6C5CE7" style={styles.tagIcon} />
                </View>
              ) : (
                <Text style={styles.cardValue}>{currentInvoice.account?.name || 'Not set'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.itemsSection}>
          <View style={styles.sectionTitleContainer}>
            <Text style={styles.sectionTitle}>Items</Text>
          </View>
          {currentInvoice.items.map((item, index) => (
            <View key={index} style={[styles.itemCard, index < currentInvoice.items.length - 1 && styles.itemCardWithBorder]}>
              {editing && (
                <TouchableOpacity style={styles.deleteItemButton} onPress={() => handleDeleteItem(index)}>
                  <Ionicons name="close-circle" size={20} color="#E74C3C" />
                </TouchableOpacity>
              )}
              <View style={styles.itemHeader}>
                {editing ? (
                  <TextInput
                    style={styles.itemNameInput}
                    value={item.name}
                    onChangeText={(text) => handleItemChange(index, 'name', text)}
                    placeholder="Item name"
                  />
                ) : (
                  <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                )}
                {editing ? (
                  <TextInput
                    style={styles.priceInput}
                    value={priceInputTexts[index] !== undefined ? priceInputTexts[index] : String(item.price ?? 0)}
                    onChangeText={(text) => {
                      const validPattern = /^-?\d*\.?\d*$/;
                      if (text === '' || text === '-' || validPattern.test(text)) {
                        setPriceInputTexts(prev => ({ ...prev, [index]: text }));
                        if (text !== '' && text !== '-' && text !== '.') {
                          const price = parseFloat(text);
                          if (!isNaN(price)) handleItemChange(index, 'price', price);
                        } else if (text === '' || text === '-') handleItemChange(index, 'price', 0);
                      }
                    }}
                    onBlur={() => {
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
                  <Text style={styles.itemPrice}>{(item.price < 0 ? '-' : '') + (Number.isFinite(Number(item.price)) ? Math.abs(Number(item.price)).toFixed(2) : '0.00')}</Text>
                )}
              </View>
              <View style={styles.itemTags}>
                <View style={styles.tagGroupLeft}>
                  <TouchableOpacity style={styles.tagTouchable} onPress={() => setShowCategoryPicker(index)}>
                    <View style={[styles.tag, { backgroundColor: item.category?.color || '#95A5A6' }]}>
                      <Text style={styles.tagText} numberOfLines={1} ellipsizeMode="tail">{item.category?.name || 'Category'}</Text>
                      <Ionicons name="chevron-down" size={12} color="#fff" style={styles.tagIcon} />
                    </View>
                  </TouchableOpacity>
                </View>
                <View style={styles.tagGroupCenter}>
                  <TouchableOpacity style={styles.tagTouchable} onPress={() => setShowAttributionPicker(index)}>
                    <View style={[styles.tag, { backgroundColor: item.attribution?.color || attributions.find(p => p.id === item.attributionId)?.color || '#95A5A6' }]}>
                      <Text style={styles.tagText} numberOfLines={1} ellipsizeMode="tail">{item.attribution?.name || attributions.find(p => p.id === item.attributionId)?.name || 'Source'}</Text>
                      <Ionicons name="chevron-down" size={12} color="#fff" style={styles.tagIcon} />
                    </View>
                  </TouchableOpacity>
                </View>
                <View style={styles.tagGroupRight}>
                  <TouchableOpacity style={styles.assetTagTouchable} onPress={() => handleItemChangeDirect(index, 'isAsset', !item.isAsset)}>
                    <View style={[styles.assetTag, { backgroundColor: item.isAsset ? '#E8F4FD' : '#F0F0F0' }]}>
                      <Ionicons name={item.isAsset ? 'checkbox' : 'checkbox-outline'} size={14} color={item.isAsset ? '#6C5CE7' : '#95A5A6'} />
                      <Text style={[styles.assetTagText, { color: item.isAsset ? '#6C5CE7' : '#636E72' }]}>Asset</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
          {editing && (
            <View style={styles.addItemButtonContainer}>
              <TouchableOpacity style={styles.addItemButton} onPress={handleAddItem}>
                <Ionicons name="add-circle-outline" size={24} color="#6C5CE7" />
                <Text style={styles.addItemText}>Add Item</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {editing && (
        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.cancelButton} onPress={() => { setEditing(false); setEditedInvoice(invoice); }}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmButton} onPress={handleSave}>
            <Ionicons name="checkmark" size={24} color="#fff" />
            <Text style={styles.confirmButtonText}>Confirm</Text>
          </TouchableOpacity>
        </View>
      )}

      {!editing && (
        currentInvoice.status === 'needs_retake' ? (
          (currentInvoice.recognitionFailCount ?? 0) >= 3 ? (
            <TouchableOpacity
              style={[styles.fab, styles.retryFab]}
              onPress={handleDeleteIncomeFromRetake}
              disabled={isReprocessingRecognition}
              accessibilityLabel="Delete income"
            >
              <View style={styles.fabRingInner}>
                <Ionicons name="trash-outline" size={22} color="#E74C3C" />
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.fab, styles.retryFab]}
              onPress={handleReRecognizeIncome}
              disabled={isReprocessingRecognition}
              accessibilityLabel="Re-recognize income"
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
        ) : currentInvoice.status === 'duplicate' ? (
          <TouchableOpacity
            style={[styles.fab, styles.retryFab]}
            onPress={handleDeleteIncomeFromRetake}
            accessibilityLabel="Delete duplicate income"
          >
            <View style={styles.fabRingInner}>
              <Ionicons name="trash-outline" size={22} color="#E74C3C" />
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.fab, styles.editFab]}
            onPress={() => {
              setEditedInvoice({ ...currentInvoice });
              setEditing(true);
              setTaxInputText((editedInvoice || invoice)?.tax?.toString() ?? '0');
              const priceTexts: { [index: number]: string } = {};
              ((editedInvoice || invoice)?.items || []).forEach((item, index) => {
                priceTexts[index] = String(item.price ?? 0);
              });
              setPriceInputTexts(priceTexts);
            }}
          >
            <Ionicons name="create" size={32} color="#fff" />
          </TouchableOpacity>
        )
      )}

      {!editing && currentInvoice.status === 'pending' && (
        <TouchableOpacity style={[styles.fab, styles.confirmFab]} onPress={handleConfirm}>
          <Ionicons name="checkmark-circle" size={32} color="#fff" />
        </TouchableOpacity>
      )}

      <Modal visible={showImageModal} transparent animationType="fade" onRequestClose={() => setShowImageModal(false)}>
        <View style={styles.modalContainer}>
          <TouchableOpacity style={styles.modalCloseButton} onPress={() => setShowImageModal(false)}>
            <Ionicons name="close" size={32} color="#fff" />
          </TouchableOpacity>
          {currentInvoice.imageUrl && (
            <Image source={{ uri: currentInvoice.imageUrl }} style={styles.modalImage} resizeMode="contain" />
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

      <Modal visible={showDuplicateNameModal} transparent animationType="fade" onRequestClose={handleDuplicateNameCloseOnly}>
        <TouchableOpacity style={styles.duplicateModalOverlay} activeOpacity={1} onPress={handleDuplicateNameCloseOnly}>
          <View style={styles.duplicateModalContentContainer} onStartShouldSetResponder={() => true}>
            <View style={styles.duplicateModalContent}>
              <View style={styles.duplicateModalHeader}>
                <Ionicons
                  name={duplicateNameModalPayload?.code === 'ACCOUNT_NAME_EXISTS' ? 'wallet-outline' : 'person-outline'}
                  size={48}
                  color="#6C5CE7"
                />
                <Text style={styles.duplicateModalTitle}>
                  {duplicateNameModalPayload?.code === 'ACCOUNT_NAME_EXISTS' ? 'Replace account with:' : 'Replace Payer with:'}
                </Text>
              </View>
              <View style={styles.duplicateModalMessageBlock}>
                <View style={styles.duplicateModalNameContainer}>
                  <Text style={styles.duplicateModalNameText}>{duplicateNameModalPayload?.duplicateName || '—'}</Text>
                </View>
              </View>
              <View style={styles.duplicateModalButtons}>
                <TouchableOpacity style={[styles.duplicateModalButton, styles.duplicateModalButtonReplace]} onPress={handleDuplicateNameReplace} activeOpacity={0.8}>
                  <Ionicons name="swap-horizontal" size={20} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.duplicateModalButtonReplaceText}>Replace only this</Text>
                </TouchableOpacity>
                {(() => {
                  const hasLinkedForMerge = duplicateNameModalPayload?.code === 'ACCOUNT_NAME_EXISTS'
                    ? !!invoice?.accountId
                    : !!getCanonicalEntityId(invoice) &&
                      !!duplicateNameModalPayload?.targetId &&
                      getCanonicalEntityId(invoice) !== duplicateNameModalPayload.targetId;
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
                <TouchableOpacity style={[styles.duplicateModalButton, styles.duplicateModalButtonDontChange]} onPress={handleDuplicateNameDontChange} activeOpacity={0.8}>
                  <Ionicons name="time-outline" size={18} color="#95A5A6" style={{ marginRight: 6 }} />
                  <Text style={styles.duplicateModalButtonDontChangeText}>Do not replace</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showCategoryPicker !== null} transparent animationType="slide" onRequestClose={() => setShowCategoryPicker(null)}>
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setShowCategoryPicker(null)}>
          <View style={styles.pickerBottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Category</Text>
              <TouchableOpacity style={styles.pickerManageButton} onPress={() => { setShowCategoryPicker(null); router.push('/income-settings'); }}>
                <Ionicons name="settings-outline" size={20} color="#6C5CE7" />
                <Text style={styles.pickerManageText}>Manage</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView} showsVerticalScrollIndicator={false}>
              {categoriesSorted.map((cat) => {
                const itemIndex = showCategoryPicker;
                if (itemIndex === null) return null;
                const item = currentInvoice.items[itemIndex];
                const isSelected = item.categoryId === cat.id || item.category?.id === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.pickerOption, isSelected && styles.pickerOptionSelected]}
                    onPress={async () => {
                      setShowCategoryPicker(null);
                      await handleItemChangeDirect(itemIndex, 'categoryId', cat.id);
                    }}
                  >
                    <View style={[styles.pickerColorIndicator, { backgroundColor: cat.color || '#95A5A6' }]} />
                    <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected]}>{cat.name}</Text>
                    {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showAttributionPicker !== null} transparent animationType="slide" onRequestClose={() => setShowAttributionPicker(null)}>
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setShowAttributionPicker(null)}>
          <View style={styles.pickerBottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Source</Text>
              <TouchableOpacity style={styles.pickerManageButton} onPress={() => { setShowAttributionPicker(null); router.push('/income-settings'); }}>
                <Ionicons name="settings-outline" size={20} color="#6C5CE7" />
                <Text style={styles.pickerManageText}>Manage</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView} showsVerticalScrollIndicator={false}>
              {attributionsSorted.map((attrRow) => {
                const itemIndex = showAttributionPicker;
                if (itemIndex === null) return null;
                const item = currentInvoice.items[itemIndex];
                const isSelected = item.attributionId === attrRow.id;
                return (
                  <TouchableOpacity
                    key={attrRow.id}
                    style={[styles.pickerOption, isSelected && styles.pickerOptionSelected]}
                    onPress={async () => {
                      setShowAttributionPicker(null);
                      await handleItemChangeDirect(itemIndex, 'attributionId', attrRow.id);
                    }}
                  >
                    <View style={[styles.pickerColorIndicator, { backgroundColor: attrRow.color }]} />
                    <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected]}>{attrRow.name}</Text>
                    {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showAccountPicker} transparent animationType="slide" onRequestClose={() => setShowAccountPicker(false)}>
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setShowAccountPicker(false)}>
          <View style={styles.pickerBottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Account</Text>
              <TouchableOpacity style={styles.pickerManageButton} onPress={() => { setShowAccountPicker(false); router.push('/accounts-manage'); }}>
                <Ionicons name="settings-outline" size={18} color="#6C5CE7" />
                <Text style={styles.pickerManageText}>Manage</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView} showsVerticalScrollIndicator={false}>
              <TouchableOpacity
                style={[styles.pickerOption, !(editing ? editedInvoice : currentInvoice)?.account && styles.pickerOptionSelected]}
                onPress={() => {
                  if (editing && editedInvoice) {
                    setEditedInvoice({ ...editedInvoice, account: undefined, accountId: undefined });
                  } else {
                    setEditedInvoice({ ...currentInvoice, account: undefined, accountId: undefined });
                    setEditing(true);
                    setTaxInputText((editedInvoice || invoice)?.tax?.toString() ?? '0');
                    setPriceInputTexts({});
                  }
                  setShowAccountPicker(false);
                }}
              >
                <View style={[styles.pickerColorIndicator, { backgroundColor: '#95A5A6' }]} />
                <Text style={[styles.pickerOptionText, !(editing ? editedInvoice : currentInvoice)?.account && styles.pickerOptionTextSelected]}>Not set</Text>
                {!(editing ? editedInvoice : currentInvoice)?.account && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
              </TouchableOpacity>
              {accounts.map((account) => {
                const receiptToCheck = editing ? editedInvoice : currentInvoice;
                const isSelected = receiptToCheck?.account?.id === account.id;
                const currentAccountId = receiptToCheck?.accountId ?? receiptToCheck?.account?.id;
                return (
                  <TouchableOpacity
                    key={account.id}
                    style={[styles.pickerOption, isSelected && styles.pickerOptionSelected]}
                    onPress={() => {
                      if (editing && editedInvoice) {
                        setEditedInvoice({ ...editedInvoice, account, accountId: account.id });
                      } else {
                        setEditedInvoice({ ...currentInvoice, account, accountId: account.id });
                        setEditing(true);
                        setTaxInputText((editedInvoice || invoice)?.tax?.toString() ?? '0');
                        setPriceInputTexts({});
                      }
                      setShowAccountPicker(false);
                      // 从空改为选择时不弹三选项；仅当已有账户且换成另一个时弹窗
                      if (account.id !== currentAccountId && invoice?.accountId) {
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
                    <View style={[styles.pickerColorIndicator, { backgroundColor: '#6C5CE7' }]} />
                    <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected]}>{account.name}</Text>
                    {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showCustomerPicker} transparent animationType="slide" onRequestClose={() => setShowCustomerPicker(false)}>
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setShowCustomerPicker(false)}>
          <View style={styles.pickerBottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Payer</Text>
              <TouchableOpacity onPress={() => setShowCustomerPicker(false)} style={styles.pickerCloseButton}>
                <Text style={styles.pickerCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView} showsVerticalScrollIndicator={false}>
              {customerOptions.map((opt) => {
                const isSelected =
                  editedInvoice?.entityId === opt.id ||
                  editedInvoice?.entity?.id === opt.id ||
                  getCanonicalEntityId(editedInvoice) === opt.id;
                return (
                  <TouchableOpacity
                    key={`${opt.source}-${opt.id}`}
                    style={[styles.pickerOption, isSelected && styles.pickerOptionSelected]}
                    onPress={() => handleSelectCustomer(opt)}
                  >
                    <View style={[styles.pickerColorIndicator, { backgroundColor: '#6C5CE7' }]} />
                    <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected]} numberOfLines={1}>{opt.name}</Text>
                    {opt.source === 'supplier' && <Text style={styles.pickerOptionSubtext}>Supplier</Text>}
                    {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showCurrencyPicker} transparent animationType="slide" onRequestClose={() => setShowCurrencyPicker(false)}>
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setShowCurrencyPicker(false)}>
          <View style={styles.pickerBottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Currency</Text>
              <TouchableOpacity onPress={() => setShowCurrencyPicker(false)} style={styles.pickerCloseButton}>
                <Text style={styles.pickerCloseText}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView} showsVerticalScrollIndicator={false}>
              {commonCurrencies.map(code => {
                const currentCurrency = editedInvoice?.currency || currentInvoice.currency;
                const isSelected = currentCurrency === code;
                return (
                  <TouchableOpacity key={code} style={[styles.pickerOption, isSelected && styles.pickerOptionSelected]} onPress={() => { handleCurrencyChange(code); setShowCurrencyPicker(false); }}>
                    <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected]}>{code}</Text>
                    {isSelected && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity style={[styles.pickerOption, !(editedInvoice?.currency || currentInvoice.currency) && styles.pickerOptionSelected]} onPress={() => { handleCurrencyChange(''); setShowCurrencyPicker(false); }}>
                <Text style={[styles.pickerOptionText, !(editedInvoice?.currency || currentInvoice.currency) && styles.pickerOptionTextSelected]}>Not set</Text>
                {!(editedInvoice?.currency || currentInvoice.currency) && <Ionicons name="checkmark" size={20} color="#6C5CE7" />}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {showDatePicker && (
        <>
          {Platform.OS === 'ios' ? (
            <Modal visible={showDatePicker} transparent animationType="slide" onRequestClose={() => setShowDatePicker(false)}>
              <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setShowDatePicker(false)}>
                <View style={styles.pickerBottomSheet} onStartShouldSetResponder={() => true}>
                  <View style={styles.pickerHandle} />
                  <View style={styles.pickerHeader}>
                    <Text style={styles.pickerTitle}>Select date</Text>
                    <TouchableOpacity onPress={() => setShowDatePicker(false)} style={styles.pickerCloseButton}>
                      <Text style={styles.pickerCloseText}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={editedInvoice?.date ? parseLocalDate(editedInvoice.date) : new Date()}
                    mode="date"
                    display="spinner"
                    onChange={handleDateChange}
                    style={styles.datePickerIOS}
                  />
                </View>
              </TouchableOpacity>
            </Modal>
          ) : (
            <DateTimePicker
              value={editedInvoice?.date ? parseLocalDate(editedInvoice.date) : new Date()}
              mode="date"
              display="default"
              onChange={handleDateChange}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ECEFF1' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 12, paddingBottom: 100 },
  summaryCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'stretch' },
  imageContainer: { position: 'relative', marginRight: 12 },
  imagePlaceholder: { width: 80, height: 80, borderRadius: 8, backgroundColor: '#E9ECEF', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
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
  imagePlaceholderContent: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
  receiptImage: { width: '100%', height: '100%' },
  docThumbPlaceholder: {
    backgroundColor: '#F0EEFF',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  docThumbLabel: { fontSize: 11, fontWeight: '700', color: '#6C5CE7' },
  thumbAlignTopLeft: Platform.select({ web: { objectFit: 'cover' as const, objectPosition: 'top left' as const }, default: {} }),
  summaryContent: { flex: 1, justifyContent: 'space-between' },
  summaryContentTop: { flex: 1, justifyContent: 'space-between' },
  summaryContentMain: { flex: 1 },
  submittedInfo: { alignSelf: 'flex-end', marginTop: 4 },
  submittedText: { fontSize: 11, color: '#95A5A6', textAlign: 'right' },
  storeName: { fontSize: 17, fontWeight: '600', color: '#2D3436', lineHeight: 22, height: 22, marginBottom: 2, borderBottomWidth: 1, borderBottomColor: 'transparent', paddingVertical: 0 },
  storeNameInputRow: { flexDirection: 'row', alignItems: 'center', height: 22, marginBottom: 2 },
  storeNameInput: { flex: 1, fontSize: 17, fontWeight: '600', color: '#2D3436', lineHeight: 22, borderBottomWidth: 1, borderBottomColor: '#6C5CE7', height: 22, paddingVertical: 0, paddingRight: 4, transform: [{ translateY: -1 }] },
  storeNameDropdownIcon: { paddingLeft: 4, justifyContent: 'center', alignItems: 'center', height: 22 },
  pickerOptionSubtext: { fontSize: 12, color: '#95A5A6', marginRight: 8 },
  amountRow: { flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'baseline', marginTop: 2 },
  amountContainer: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  currencyLabel: { fontSize: 14, fontWeight: '600', color: '#636E72', lineHeight: 18 },
  totalAmount: { fontSize: 24, fontWeight: 'bold', color: '#D35400', marginRight: 8, lineHeight: 28 },
  taxText: { flexDirection: 'row', alignItems: 'center', marginLeft: 8, height: 20 },
  taxInputContainer: { flexDirection: 'row', alignItems: 'center', marginLeft: 8 },
  taxLabel: { fontSize: 11, color: '#636E72', fontWeight: '500', lineHeight: 16 },
  taxValueText: { fontSize: 11, color: '#636E72', fontWeight: '500', lineHeight: 16, marginLeft: 8 },
  taxInput: { fontSize: 11, color: '#636E72', fontWeight: '500', borderWidth: 1, borderColor: '#6C5CE7', borderRadius: 4, paddingVertical: 1, height: 20, paddingHorizontal: 4, minWidth: 50, textAlign: 'left', lineHeight: 16 },
  date: { fontSize: 14, fontWeight: '600', color: '#636E72', lineHeight: 18, marginTop: 2, marginLeft: 11, marginBottom: 0 },
  currencyContainer: { marginLeft: 0, marginRight: 4, minHeight: 20 },
  currencyPickerTouchable: { flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingRight: 8, paddingVertical: 1, borderRadius: 16, borderWidth: 1, borderColor: '#6C5CE7', backgroundColor: '#F8F9FA', height: 20 },
  currencyPickerReadonly: { flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingRight: 8, paddingVertical: 1, borderRadius: 16, borderWidth: 1, borderColor: 'transparent', backgroundColor: 'transparent', height: 20 },
  dateContainer: { marginTop: 8, height: 24 },
  dateTouchable: { alignSelf: 'flex-start' },
  dateText: { fontSize: 14, color: '#636E72', lineHeight: 18, fontWeight: '600' },
  dateTag: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 1, borderRadius: 16, borderWidth: 1, borderColor: '#6C5CE7', backgroundColor: '#F8F9FA', height: 20 },
  datePickerIOS: { width: '100%', height: 200 },
  paymentCard: { backgroundColor: '#fff', borderRadius: 12, paddingVertical: 2, paddingHorizontal: 12, marginBottom: 8 },
  paymentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLabel: { fontSize: 14, color: '#636E72', marginRight: 12, fontWeight: '500' },
  cardValue: { fontSize: 14, color: '#2D3436', fontWeight: '500', paddingVertical: 10, lineHeight: 20, marginRight: 37 },
  accountTouchable: { flex: 1, alignItems: 'flex-end', justifyContent: 'center', minHeight: 40 },
  accountTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F9FA', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 16, borderWidth: 1, borderColor: '#6C5CE7', maxWidth: 250, minWidth: 120, flexShrink: 0 },
  accountText: { fontSize: 14, color: '#2D3436', fontWeight: '500', flexShrink: 1, marginRight: 6, maxWidth: 200, lineHeight: 20 },
  itemsSection: { marginBottom: 12, backgroundColor: '#fff', borderRadius: 10, overflow: 'hidden' },
  sectionTitleContainer: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#E9ECEF' },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: '#2D3436' },
  itemCard: { backgroundColor: '#fff', borderRadius: 0, paddingLeft: 8, paddingTop: 4, paddingBottom: 4, paddingRight: 32, marginBottom: 0 },
  itemCardWithBorder: { borderBottomWidth: 1, borderBottomColor: '#E9ECEF' },
  deleteItemButton: { position: 'absolute', top: '50%', marginTop: -14, right: 0, zIndex: 1, padding: 4 },
  itemName: { flex: 1, fontSize: 15, fontWeight: '600', color: '#2D3436', marginRight: 6, lineHeight: 20, height: 20, borderBottomWidth: 1, borderBottomColor: 'transparent', paddingVertical: 0, transform: [{ translateY: -2 }] },
  itemNameInput: { flex: 1, fontSize: 15, fontWeight: '600', color: '#2D3436', borderBottomWidth: 1, borderBottomColor: '#6C5CE7', lineHeight: 20, height: 20, paddingVertical: 0, marginRight: 6, transform: [{ translateY: -4 }] },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 1 },
  itemTags: { flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', marginTop: 0, position: 'relative' },
  tagGroupLeft: { width: 120, alignItems: 'flex-start' },
  tagGroupCenter: { marginLeft: 2, alignItems: 'flex-start' },
  tagGroupRight: { flex: 1, alignItems: 'flex-end' },
  tagTouchable: { minHeight: 32, justifyContent: 'center', alignSelf: 'flex-start' },
  tag: { paddingLeft: 10, paddingRight: 5, paddingVertical: 4, borderRadius: 12, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: 140 },
  tagText: { color: '#fff', fontSize: 11, fontWeight: '600', flexShrink: 1 },
  tagIcon: { marginLeft: 4, opacity: 0.8, flexShrink: 0 },
  assetTagTouchable: { minHeight: 32, minWidth: 80, justifyContent: 'center', alignItems: 'flex-end' },
  assetTag: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  assetTagText: { fontSize: 11, fontWeight: '500', marginLeft: 3 },
  itemPrice: { fontSize: 16, fontWeight: '600', color: '#D35400', paddingVertical: 4, paddingHorizontal: 7, minWidth: 70, textAlign: 'right', lineHeight: 20 },
  priceInput: { fontSize: 16, fontWeight: '600', color: '#D35400', borderWidth: 1, borderColor: '#D35400', borderRadius: 4, paddingVertical: 3, paddingHorizontal: 6, minWidth: 70, textAlign: 'right', lineHeight: 20 },
  addItemButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F9FA', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: '#CED4DA', alignSelf: 'stretch' },
  addItemButtonContainer: { paddingTop: 12, paddingBottom: 4, backgroundColor: '#ECEFF1', alignItems: 'center' },
  addItemText: { marginLeft: 8, fontSize: 16, color: '#6C5CE7', fontWeight: '600' },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'transparent', paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8, borderTopWidth: 0, flexDirection: 'row', gap: 12 },
  fab: { position: 'absolute', right: 20, width: 64, height: 64, borderRadius: 32, backgroundColor: '#6C5CE7', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 6, elevation: 6 },
  editFab: { bottom: 20, backgroundColor: '#95A5A6' },
  retryFab: { bottom: 20, backgroundColor: '#E74C3C' },
  fabRingInner: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmFab: { bottom: 100 },
  cancelButton: { flex: 1, backgroundColor: '#DDE2E6', borderRadius: 12, padding: 16, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 6, elevation: 6 },
  cancelButtonText: { fontSize: 16, color: '#636E72', fontWeight: '600' },
  confirmButton: { flex: 1, backgroundColor: '#6C5CE7', borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 6, elevation: 6 },
  confirmButtonText: { marginLeft: 8, fontSize: 16, color: '#fff', fontWeight: '600' },
  errorText: { textAlign: 'center', marginTop: 50, fontSize: 16, color: '#E74C3C' },
  modalContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  modalCloseButton: { position: 'absolute', top: 50, right: 20, zIndex: 1, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: 8 },
  modalImage: { width: '100%', height: '100%' },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  pickerBottomSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 12, paddingBottom: 32, paddingHorizontal: 20, maxHeight: '70%' },
  pickerHandle: { width: 40, height: 4, backgroundColor: '#BDC3C7', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  pickerTitle: { fontSize: 18, fontWeight: '600', color: '#2D3436', flex: 1 },
  pickerManageButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#F0F0F0' },
  pickerManageText: { fontSize: 14, color: '#6C5CE7', fontWeight: '500', marginLeft: 4 },
  pickerScrollView: { maxHeight: 400 },
  pickerOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, marginBottom: 8, backgroundColor: '#F8F9FA', minHeight: 48 },
  pickerOptionSelected: { backgroundColor: '#E8F4FD' },
  pickerColorIndicator: { width: 20, height: 20, borderRadius: 10, marginRight: 12 },
  pickerOptionText: { flex: 1, fontSize: 16, color: '#2D3436', fontWeight: '500' },
  pickerOptionTextSelected: { color: '#6C5CE7', fontWeight: '600' },
  pickerCloseButton: { paddingHorizontal: 12, paddingVertical: 6 },
  pickerCloseText: { fontSize: 16, color: '#6C5CE7', fontWeight: '600' },
  duplicateModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  duplicateModalContentContainer: { width: '100%', maxWidth: 400, alignItems: 'center' },
  duplicateModalContent: { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '100%', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8 },
  duplicateModalHeader: { alignItems: 'center', marginBottom: 16 },
  duplicateModalTitle: { fontSize: 22, fontWeight: '600', color: '#2D3436', marginTop: 12, marginBottom: 0 },
  duplicateModalMessageBlock: { marginBottom: 24, paddingHorizontal: 8, alignItems: 'center', width: '100%' },
  duplicateModalNameContainer: { marginTop: 8, marginBottom: 20, alignSelf: 'stretch', borderBottomWidth: 1, borderBottomColor: '#E0E7FF', paddingBottom: 8 },
  duplicateModalNameText: { fontSize: 18, fontWeight: '800', color: '#6C5CE7', textAlign: 'center', letterSpacing: 0.3 },
  duplicateModalMessage: { fontSize: 15, color: '#636E72', textAlign: 'center', marginTop: 4 },
  duplicateModalButtons: { flexDirection: 'column', width: '100%', gap: 10 },
  duplicateModalButton: { width: '100%', paddingVertical: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', minHeight: 52, flexDirection: 'row' },
  duplicateModalButtonReplace: { backgroundColor: '#27AE60', shadowColor: '#27AE60', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  duplicateModalButtonReplaceText: { fontSize: 17, fontWeight: '700', color: '#fff', letterSpacing: 0.5 },
  duplicateModalButtonMerge: { backgroundColor: '#FFF5F5', borderWidth: 2, borderColor: '#E74C3C' },
  duplicateModalButtonMergeText: { fontSize: 16, fontWeight: '600', color: '#E74C3C' },
  duplicateModalButtonDontChange: { backgroundColor: '#F8F9FA', borderWidth: 1, borderColor: '#E9ECEF' },
  duplicateModalButtonDontChangeText: { fontSize: 15, fontWeight: '500', color: '#95A5A6' },
});
