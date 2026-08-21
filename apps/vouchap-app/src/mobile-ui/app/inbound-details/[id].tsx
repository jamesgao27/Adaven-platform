import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
  Image,
  InteractionManager,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { getInboundById, saveInbound, deleteInbound } from '@/lib/inbound';
import { supabase, uploadInboundImage } from '@/lib/supabase';
import { processImageForUpload } from '@/lib/image-processor';
import { getSupplierOptions } from '@/lib/customer-supplier-list';
import { mergeEntity, getCanonicalEntityId } from '@/lib/entities';
import { Inbound, InboundItem, VoucherStatus } from '@/types';
import { format } from 'date-fns';
import { getChatLogsByReceiptId } from '@/lib/chat-logs';
import { playAudio, stopPlayback } from '@/lib/audio';
import { showAiInventory } from '@/lib/feature-flags';
import { voucherDetailStyles as styles } from '../../styles/voucher-detail-styles';
import { getLocalDateString } from '@/lib/date-utils';
import { showToast } from '@/lib/toast';
import { confirmDestructive } from '@/lib/alertWeb';
import { showChoiceDialog } from '@/lib/confirmDialog';

export default function InboundDetailsScreen() {
  const { id, new: isNew } = useLocalSearchParams<{ id: string; new?: string }>();
  const router = useRouter();
  const [inbound, setInbound] = useState<Inbound | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editedInbound, setEditedInbound] = useState<Inbound | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showSupplierPicker, setShowSupplierPicker] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [supplierOptions, setSupplierOptions] = useState<{ id: string; name: string; source: 'supplier' | 'customer' }[]>([]);
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
  const editingRef = useRef(false);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  const loadInbound = useCallback(async (options?: { forceSyncEdited?: boolean }) => {
    if (!id) return;
    try {
      const data = await getInboundById(id);
      setInbound(data);
      const shouldSyncEdited = options?.forceSyncEdited ?? !editingRef.current;
      if (shouldSyncEdited) {
        setEditedInbound(data);
      }
      if (isNew === 'true' && shouldSyncEdited) setEditing(true);

      // 加载与该入库单相关的语音记录（用于回放按钮）
      try {
        const chatLogs = await getChatLogsByReceiptId(id);
        const audioLog = chatLogs.find(
          (log) =>
            log.type === 'audio' &&
            log.audioUrl &&
            (log.voucherType === 'inbound' || log.voucherType == null)
        );
        if (audioLog?.audioUrl) {
          setAudioUrl(audioLog.audioUrl);
        } else {
          setAudioUrl(null);
        }
      } catch (chatError) {
        console.log('Failed to get chat logs for inbound audio:', chatError);
      }
    } catch (error) {
      showToast('Failed to load inbound', 'error');
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => {
    if (!showAiInventory) router.replace('/');
  }, []);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => loadInbound());
    return () => task.cancel();
  }, [id, loadInbound]);

  // Realtime：当前入库单或明细被更新时自动重新加载
  useEffect(() => {
    if (!id) return;
    let ch: ReturnType<typeof supabase.channel> | null = null;
    let chItems: ReturnType<typeof supabase.channel> | null = null;
    const refresh = () => loadInbound();
    ch = supabase
      .channel(`inbound-detail-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inbound', filter: `id=eq.${id}` }, refresh)
      .subscribe();
    chItems = supabase
      .channel(`inbound-detail-items-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inbound_items', filter: `inbound_id=eq.${id}` }, refresh)
      .subscribe();
    return () => {
      if (ch) supabase.removeChannel(ch);
      if (chItems) supabase.removeChannel(chItems);
    };
  }, [id, loadInbound]);

  const handleSave = async () => {
    if (!editedInbound || !id) return;
    try {
      await saveInbound({
        ...editedInbound,
        id,
        status: 'confirmed' as VoucherStatus,
      });
      showToast('Inbound saved', 'success');
      setEditing(false);
      loadInbound();
    } catch (error: any) {
      const code = error?.code as string | undefined;
      const duplicateName = (error?.duplicateName ?? '') as string;
      const targetId = error?.targetId as string | undefined;
      const targetSource = error?.targetSource as 'supplier' | 'customer' | undefined;
      if (code === 'SUPPLIER_NAME_EXISTS' || code === 'CUSTOMER_NAME_EXISTS' || code === 'ENTITY_NAME_EXISTS') {
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
      showToast('Failed to save', 'error');
      console.error(error);
    }
  };

  const handleDuplicateNameCloseOnly = () => {
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
  };

  /** 通用三选项逻辑：dropdown 立即恢复编辑态原值；save 则恢复并用原值直接 confirm。 */
  const handleDuplicateNameDontChange = async () => {
    const payload = duplicateNameModalPayload;
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
    if (payload?.triggeredBy === 'dropdown') {
      if (!inbound) return;
      const origName = inbound.entity?.name ?? inbound.supplierName ?? '';
      setEditedInbound((prev) =>
        prev
          ? {
              ...prev,
              supplierName: origName,
              entityId: inbound.entityId ?? inbound.entity?.id,
              entity: inbound.entity,
            }
          : prev
      );
      return;
    }
    if (!inbound || !editedInbound || !id) return;
    const origName = inbound.entity?.name ?? inbound.supplierName ?? '';
    setEditedInbound((prev) =>
      prev
        ? {
            ...prev,
            supplierName: origName,
            entityId: inbound.entityId ?? inbound.entity?.id,
            entity: inbound.entity,
          }
        : prev
    );
    try {
      const reverted = {
        ...editedInbound,
        id,
        status: 'confirmed' as VoucherStatus,
        supplierName: origName,
        entityId: inbound.entityId ?? inbound.entity?.id,
        entity: inbound.entity,
      };
      await saveInbound(reverted);
      setEditing(false);
      loadInbound();
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to save', 'error');
    }
  };

  const handleDuplicateNameReplace = async () => {
    const payload = duplicateNameModalPayload;
    if (!payload || !editedInbound || !id) return;
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
    const finalTargetId = payload.targetId;
    const finalName = payload.duplicateName || editedInbound.supplierName;
    if (!finalTargetId) {
      showToast('Target not found.', 'info');
      return;
    }
    try {
      await saveInbound({
        ...editedInbound,
        id,
        status: 'confirmed' as VoucherStatus,
        entityId: finalTargetId,
        entity: {
          id: finalTargetId,
          name: finalName || '',
          spaceId: editedInbound.spaceId,
          isAiRecognized: false,
        },
        supplierName: finalName,
      });
      setEditing(false);
      loadInbound();
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to replace', 'error');
    }
  };

  const handleDuplicateNameMerge = async () => {
    const payload = duplicateNameModalPayload;
    if (!payload || !inbound) return;
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
    const currentId = getCanonicalEntityId(inbound);
    const finalTargetId = payload.targetId;
    if (!currentId || !finalTargetId) {
      showToast('No linked Sender to merge or target not found.', 'info');
      return;
    }
    if (currentId === finalTargetId) {
      showToast('Already linked to this Sender.', 'info');
      return;
    }
    try {
      await mergeEntity([currentId], finalTargetId);
      await saveInbound({
        ...(editedInbound || inbound),
        id: id!,
        status: 'confirmed' as VoucherStatus,
        entityId: finalTargetId,
        entity: {
          id: finalTargetId,
          name: payload.duplicateName || inbound.supplierName || '',
          spaceId: inbound.spaceId,
          isAiRecognized: false,
        },
        supplierName: payload.duplicateName || inbound.supplierName,
      });
      setEditing(false);
      loadInbound();
    } catch (e: any) {
      showToast(e?.message ?? String(e), 'error');
    }
  };

  const handleDelete = () => {
    if (!id) return;
    confirmDestructive(
      'Delete Inbound',
      'Are you sure you want to delete this inbound?',
      async () => {
        try {
          await deleteInbound(id);
          router.back();
        } catch (error) {
          showToast('Failed to delete', 'error');
        }
      },
      { confirmLabel: 'Delete' }
    );
  };

  const parseLocalDate = (dateString: string): Date => {
    const [y, m, d] = dateString.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const formatDate = (dateString: string) => {
    try {
      return format(parseLocalDate(dateString), 'MMM dd, yyyy');
    } catch {
      return dateString;
    }
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (event.type === 'dismissed') return;
    }
    if (selectedDate && editedInbound) {
      setEditedInbound({ ...editedInbound, date: getLocalDateString(selectedDate) });
    }
  };

  const handleSupplierNameChange = (supplierName: string) => {
    if (!editedInbound) return;
    setEditedInbound({ ...editedInbound, supplierName });
  };

  const openSupplierPicker = async () => {
    try {
      const options = await getSupplierOptions();
      setSupplierOptions(options);
      setShowSupplierPicker(true);
    } catch (e) {
      console.warn('Failed to load supplier options', e);
    }
  };

  const handleSelectSupplier = (option: { id: string; name: string; source: 'supplier' | 'customer' } | null) => {
    if (!editedInbound) return;
    setShowSupplierPicker(false);
    if (option === null) {
      setEditedInbound({ ...editedInbound, supplierName: '', entityId: undefined, entity: undefined });
      return;
    }
    setEditedInbound({
      ...editedInbound,
      supplierName: option.name,
      entityId: option.id,
      entity: { id: option.id, name: option.name, spaceId: editedInbound.spaceId, isAiRecognized: false },
    });
    const currentId = getCanonicalEntityId(inbound);
    // 从空改为选择时不弹三选项；仅当已有 Sender 且换成另一个时弹窗
    if (option.id !== currentId && currentId) {
      setDuplicateNameModalPayload({
        code: 'ENTITY_NAME_EXISTS',
        duplicateName: option.name,
        targetId: option.id,
        triggeredBy: 'dropdown',
      });
      setShowDuplicateNameModal(true);
    }
  };

  const calculateItemsTotal = (items: InboundItem[]) => {
    return items.reduce((sum, it) => sum + (it.quantity || 0) * (it.unitPrice ?? 0), 0);
  };

  const handleItemChange = (index: number, field: keyof InboundItem, value: any) => {
    if (!editedInbound) return;
    const newItems = [...editedInbound.items];
    const item = { ...newItems[index], [field]: value } as InboundItem;
    newItems[index] = item;
    const totalAmount = calculateItemsTotal(newItems);
    setEditedInbound({ ...editedInbound, items: newItems, totalAmount: totalAmount > 0 ? totalAmount : undefined });
  };

  const handleAddItem = () => {
    if (!editedInbound) return;
    const newItem: InboundItem = {
      inboundId: editedInbound.id || '',
      productName: '',
      quantity: 1,
      unit: '件',
      unitPrice: undefined,
    };
    const newItems = [...editedInbound.items, newItem];
    setEditedInbound({ ...editedInbound, items: newItems });
  };

  const handleDeleteItem = (index: number) => {
    if (!editedInbound) return;
    const newItems = editedInbound.items.filter((_, i) => i !== index);
    const totalAmount = calculateItemsTotal(newItems);
    setEditedInbound({ ...editedInbound, items: newItems, totalAmount });
  };

  const pickFromCamera = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        showToast('Vouchap needs access to your camera.', 'info');
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
      showToast('Failed to launch camera.', 'error');
    }
  };

  const pickFromLibrary = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showToast('Vouchap needs access to your photo library.', 'info');
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

  const uploadImage = async (imageUri: string) => {
    if (!id) return;
    setIsUploadingImage(true);
    try {
      const imageUrl = await uploadInboundImage(imageUri, id, editedInbound?.spaceId ?? inbound?.spaceId ?? '');
      await saveInbound({ ...(editedInbound || inbound)!, id, imageUrl });
      await loadInbound();
    } catch (error) {
      console.error('Error uploading image:', error);
      showToast('Failed to upload image.', 'error');
    } finally {
      setIsUploadingImage(false);
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

  if (!showAiInventory) return null;

  if (loading && !inbound) {
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

  if (!inbound) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Inbound not found</Text>
      </View>
    );
  }

  const current = editing ? (editedInbound || inbound) : inbound;

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* 入库单摘要卡片 - 复用 receipt 结构 */}
        <View style={styles.summaryCard}>
          <View style={styles.imageContainer}>
            <TouchableOpacity
              onPress={() => {
                if (current.imageUrl) {
                  setShowImageModal(true);
                } else {
                  handleImagePicker();
                }
              }}
              style={styles.imagePlaceholder}
              disabled={isUploadingImage}
            >
              {current.imageUrl ? (
                <Image source={{ uri: current.imageUrl }} style={[styles.receiptImage, styles.thumbAlignTopLeft]} resizeMode="cover" />
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
                {/* Sender */}
                {editing ? (
                  <View style={styles.storeNameInputRow}>
                    <TextInput
                      style={styles.storeNameInput}
                      value={editedInbound?.supplierName ?? (editedInbound as any)?.entity?.name ?? ''}
                      onChangeText={handleSupplierNameChange}
                      placeholder="Sender"
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
                    {(current as any).entity?.name || current.supplierName || '—'}
                  </Text>
                )}
                {/* 金额 - 暂留空税额 */}
                <View style={styles.amountRow}>
                  <View style={styles.amountContainer}>
                    {current.totalAmount != null && current.totalAmount > 0 && (
                      <Text style={styles.totalAmount}>
                        {(current.totalAmount < 0 ? '-' : '') + Math.abs(current.totalAmount).toFixed(2)}
                      </Text>
                    )}
                  </View>
                </View>
                {/* 发货时间 */}
                <View style={styles.dateContainer}>
                  {editing ? (
                    <TouchableOpacity
                      style={styles.dateTouchable}
                      onPress={() => setShowDatePicker(true)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.dateTag}>
                        <Text style={styles.dateText}>
                          {editedInbound?.date ? formatDate(editedInbound.date) : 'Select date'}
                        </Text>
                        <Ionicons name="chevron-down" size={14} color="#6C5CE7" style={styles.tagIcon} />
                      </View>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.date}>{formatDate(current.date)}</Text>
                  )}
                </View>
              </View>
              {/* 录入时间 + 录入人员 */}
              {current.createdAt && (
                <View style={styles.submittedInfo}>
                  <Text style={styles.submittedText}>
                    {format(new Date(current.createdAt), 'MMM dd, yyyy')}
                    {/* TODO: 添加 createdByUser 支持 */}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* 仓库+仓位 - 复用 receipt 的支付账户结构 */}
        <View style={styles.paymentCard}>
          <View style={styles.paymentRow}>
            <Text style={styles.cardLabel}>仓库+仓位</Text>
            {editing ? (
              <TouchableOpacity style={styles.accountTouchable} activeOpacity={0.7}>
                <View style={styles.accountTag}>
                  <Text style={styles.accountText} numberOfLines={1} ellipsizeMode="tail">
                    暂未设置
                  </Text>
                  <Ionicons name="chevron-down" size={14} color="#6C5CE7" style={styles.tagIcon} />
                </View>
              </TouchableOpacity>
            ) : (
              <Text style={styles.cardValue}>暂未设置</Text>
            )}
          </View>
        </View>

        {/* 商品列表 - 复用 receipt 的 items 结构 */}
        <View style={styles.itemsSection}>
          <View style={styles.sectionTitleContainer}>
            <Text style={styles.sectionTitle}>Items</Text>
          </View>
          {current.items.map((item, index) => (
            <View
              key={index}
              style={[styles.itemCard, index < current.items.length - 1 && styles.itemCardWithBorder]}
            >
              {editing && (
                <TouchableOpacity
                  style={styles.deleteItemButton}
                  onPress={() => handleDeleteItem(index)}
                >
                  <Ionicons name="close-circle" size={20} color="#E74C3C" />
                </TouchableOpacity>
              )}

              {/* 第一行：SKU品名 + 数量 */}
              <View style={styles.itemHeader}>
                {editing ? (
                  <TextInput
                    style={styles.itemNameInput}
                    value={item.productName ?? ''}
                    onChangeText={(text) => handleItemChange(index, 'productName', text)}
                    placeholder="SKU品名"
                  />
                ) : (
                  <Text style={styles.itemName} numberOfLines={1}>
                    {item.productName ?? ''}
                  </Text>
                )}
                {editing ? (
                  <TextInput
                    style={styles.quantityInput}
                    value={String(item.quantity)}
                    onChangeText={(text) => handleItemChange(index, 'quantity', parseFloat(text) || 0)}
                    keyboardType="decimal-pad"
                    placeholder="数量"
                  />
                ) : (
                  <Text style={styles.itemQuantity}>
                    {item.quantity}
                  </Text>
                )}
              </View>

              {/* 第二行：SKU编码（左） + 品质（中） + 单位（右） */}
              <View style={styles.itemTags}>
                {/* SKU编码 - 左侧 */}
                <View style={styles.tagGroupLeft}>
                  <View style={styles.tag}>
                    <Text style={styles.tagText} numberOfLines={1} ellipsizeMode="tail">
                      {item.skuId ? `SKU: ${item.skuId}` : 'SKU编码'}
                    </Text>
                  </View>
                </View>

                {/* 品质（次品数/合格品数） - 居中 */}
                <View style={styles.tagGroupCenter}>
                  <View style={styles.tag}>
                    <Text style={styles.tagText} numberOfLines={1} ellipsizeMode="tail">
                      品质
                    </Text>
                  </View>
                </View>

                {/* 单位 - 右侧 */}
                <View style={styles.tagGroupRight}>
                  {editing ? (
                    <TextInput
                      style={styles.unitInput}
                      value={item.unit ?? '件'}
                      onChangeText={(text) => handleItemChange(index, 'unit', text)}
                      placeholder="单位"
                    />
                  ) : (
                    <View style={styles.unitTag}>
                      <Text style={styles.unitTagText}>{item.unit ?? '件'}</Text>
                    </View>
                  )}
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
                    value={editedInbound?.date ? parseLocalDate(editedInbound.date) : new Date()}
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
              value={editedInbound?.date ? parseLocalDate(editedInbound.date) : new Date()}
              mode="date"
              display="default"
              onChange={handleDateChange}
            />
          )}
        </>
      )}

      {/* 底部按钮 */}
      {editing && (
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => {
              setEditing(false);
              setEditedInbound(inbound);
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

      {/* 编辑按钮 */}
      {!editing && (
        <TouchableOpacity
          style={[styles.fab, styles.editFab]}
          onPress={() => {
            setEditedInbound({ ...inbound });
            setEditing(true);
          }}
        >
          <Ionicons name="create" size={32} color="#fff" />
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
          {current.imageUrl && (
            <Image source={{ uri: current.imageUrl }} style={styles.modalImage} resizeMode="contain" />
          )}
        </View>
      </Modal>

      {/* Duplicate name: Replace only this / Replace all (Merge) / Do not replace */}
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
                <Ionicons name="business-outline" size={48} color="#6C5CE7" />
                <Text style={styles.duplicateModalTitle}>Replace Sender with:</Text>
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
                  const hasLinkedForMerge =
                    !!getCanonicalEntityId(inbound) &&
                    !!duplicateNameModalPayload?.targetId &&
                    getCanonicalEntityId(inbound) !== duplicateNameModalPayload.targetId;
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

      {/* 供应商选择器 */}
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
              <Text style={styles.pickerTitle}>Select Sender</Text>
              <TouchableOpacity
                onPress={() => setShowSupplierPicker(false)}
                style={styles.pickerCloseButton}
              >
                <Text style={styles.pickerCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView} showsVerticalScrollIndicator={false}>
              <TouchableOpacity
                style={styles.pickerOption}
                onPress={() => handleSelectSupplier(null)}
              >
                <Text style={styles.pickerOptionText}>Clear</Text>
              </TouchableOpacity>
              {supplierOptions.map((opt) => (
                <TouchableOpacity
                  key={opt.id}
                  style={[
                    styles.pickerOption,
                    editedInbound?.entityId === opt.id && styles.pickerOptionSelected,
                  ]}
                  onPress={() => handleSelectSupplier(opt)}
                >
                  <View style={[styles.pickerColorIndicator, { backgroundColor: '#6C5CE7' }]} />
                  <Text
                    style={[
                      styles.pickerOptionText,
                      editedInbound?.entityId === opt.id && styles.pickerOptionTextSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {opt.name}
                  </Text>
                  {editedInbound?.entityId === opt.id && (
                    <Ionicons name="checkmark" size={20} color="#6C5CE7" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

