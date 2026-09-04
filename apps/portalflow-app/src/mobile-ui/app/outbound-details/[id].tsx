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
import { getOutboundById, saveOutbound, deleteOutbound } from '@/lib/outbound';
import { supabase, uploadOutboundImage } from '@/lib/supabase';
import { processImageForUpload } from '@/lib/image-processor';
import { getCustomerOptions } from '@/lib/customer-supplier-list';
import { mergeEntity, getCanonicalEntityId } from '@/lib/entities';
import { Outbound, OutboundItem, VoucherStatus } from '@/types';
import { format } from 'date-fns';
import { showAiInventory } from '@/lib/feature-flags';
import { voucherDetailStyles as styles } from '../../styles/voucher-detail-styles';
import { getLocalDateString } from '@/lib/date-utils';
import { showToast } from '@/lib/toast';
import { confirmDestructive } from '@/lib/alertWeb';
import { showChoiceDialog } from '@/lib/confirmDialog';

export default function OutboundDetailsScreen() {
  const { id, new: isNew } = useLocalSearchParams<{ id: string; new?: string }>();
  const router = useRouter();
  const [outbound, setOutbound] = useState<Outbound | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editedOutbound, setEditedOutbound] = useState<Outbound | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [customerOptions, setCustomerOptions] = useState<{ id: string; name: string; source: 'customer' | 'supplier' }[]>([]);
  const [showDuplicateNameModal, setShowDuplicateNameModal] = useState(false);
  const [duplicateNameModalPayload, setDuplicateNameModalPayload] = useState<{
    code: string;
    duplicateName: string;
    targetId?: string;
    targetSource?: 'customer' | 'supplier';
    triggeredBy: 'save' | 'dropdown';
  } | null>(null);
  const editingRef = useRef(false);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  const loadOutbound = useCallback(async (options?: { forceSyncEdited?: boolean }) => {
    if (!id) return;
    try {
      const data = await getOutboundById(id);
      setOutbound(data);
      const shouldSyncEdited = options?.forceSyncEdited ?? !editingRef.current;
      if (shouldSyncEdited) {
        setEditedOutbound(data);
      }
      if (isNew === 'true' && shouldSyncEdited) setEditing(true);
    } catch (error) {
      showToast('Failed to load outbound', 'error');
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => {
    if (!showAiInventory) router.replace('/');
  }, []);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => loadOutbound());
    return () => task.cancel();
  }, [id, loadOutbound]);

  // Realtime：当前出库单或明细被更新时自动重新加载
  useEffect(() => {
    if (!id) return;
    let ch: ReturnType<typeof supabase.channel> | null = null;
    let chItems: ReturnType<typeof supabase.channel> | null = null;
    const refresh = () => loadOutbound();
    ch = supabase
      .channel(`outbound-detail-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outbound', filter: `id=eq.${id}` }, refresh)
      .subscribe();
    chItems = supabase
      .channel(`outbound-detail-items-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outbound_items', filter: `outbound_id=eq.${id}` }, refresh)
      .subscribe();
    return () => {
      if (ch) supabase.removeChannel(ch);
      if (chItems) supabase.removeChannel(chItems);
    };
  }, [id, loadOutbound]);

  const handleSave = async () => {
    if (!editedOutbound || !id) return;
    try {
      await saveOutbound({
        ...editedOutbound,
        id,
        status: 'confirmed' as VoucherStatus,
      });
      showToast('Outbound saved', 'success');
      setEditing(false);
      loadOutbound();
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
      if (!outbound) return;
      const origName = outbound.entity?.name ?? outbound.customerName ?? '';
      setEditedOutbound((prev) =>
        prev
          ? {
              ...prev,
              customerName: origName,
              entityId: outbound.entityId ?? outbound.entity?.id,
              entity: outbound.entity,
            }
          : prev
      );
      return;
    }
    if (!outbound || !editedOutbound || !id) return;
    const origName = outbound.entity?.name ?? outbound.customerName ?? '';
    setEditedOutbound((prev) =>
      prev
        ? {
            ...prev,
            customerName: origName,
            entityId: outbound.entityId ?? outbound.entity?.id,
            entity: outbound.entity,
          }
        : prev
    );
    try {
      const reverted = {
        ...editedOutbound,
        id,
        status: 'confirmed' as VoucherStatus,
        customerName: origName,
        entityId: outbound.entityId ?? outbound.entity?.id,
        entity: outbound.entity,
      };
      await saveOutbound(reverted);
      setEditing(false);
      loadOutbound();
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to save', 'error');
    }
  };

  const handleDuplicateNameReplace = async () => {
    const payload = duplicateNameModalPayload;
    if (!payload || !editedOutbound || !id) return;
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
    const finalTargetId = payload.targetId;
    const finalName = payload.duplicateName || editedOutbound.customerName;
    if (!finalTargetId) {
      showToast('Target not found.', 'info');
      return;
    }
    try {
      await saveOutbound({
        ...editedOutbound,
        id,
        status: 'confirmed' as VoucherStatus,
        entityId: finalTargetId,
        entity: {
          id: finalTargetId,
          name: finalName || '',
          spaceId: editedOutbound.spaceId,
          isAiRecognized: false,
        },
        customerName: finalName,
      });
      setEditing(false);
      loadOutbound();
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to replace', 'error');
    }
  };

  const handleDuplicateNameMerge = async () => {
    const payload = duplicateNameModalPayload;
    if (!payload || !outbound) return;
    setShowDuplicateNameModal(false);
    setDuplicateNameModalPayload(null);
    const currentId = getCanonicalEntityId(outbound);
    const finalTargetId = payload.targetId;
    if (!currentId || !finalTargetId) {
      showToast('No linked Receiver to merge or target not found.', 'info');
      return;
    }
    if (currentId === finalTargetId) {
      showToast('Already linked to this Receiver.', 'info');
      return;
    }
    try {
      await mergeEntity([currentId], finalTargetId);
      await saveOutbound({
        ...(editedOutbound || outbound),
        id: id!,
        status: 'confirmed' as VoucherStatus,
        entityId: finalTargetId,
        entity: {
          id: finalTargetId,
          name: payload.duplicateName || outbound.customerName || '',
          spaceId: outbound.spaceId,
          isAiRecognized: false,
        },
        customerName: payload.duplicateName || outbound.customerName,
      });
      setEditing(false);
      loadOutbound();
    } catch (e: any) {
      showToast(e?.message ?? String(e), 'error');
    }
  };

  const openCustomerPicker = async () => {
    try {
      const options = await getCustomerOptions();
      setCustomerOptions(options);
      setShowCustomerPicker(true);
    } catch (e) {
      console.warn('Failed to load customer options', e);
    }
  };

  const handleSelectCustomer = (option: { id: string; name: string; source: 'customer' | 'supplier' }) => {
    if (!editedOutbound) return;
    setShowCustomerPicker(false);
    setEditedOutbound({
      ...editedOutbound,
      entityId: option.id,
      entity: { id: option.id, name: option.name, spaceId: editedOutbound.spaceId, isAiRecognized: false },
      customerName: option.name,
    });
    const currentId = getCanonicalEntityId(outbound);
    // 从空改为选择时不弹三选项；仅当已有 Receiver 且换成另一个时弹窗
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

  const handleDelete = () => {
    if (!id) return;
    confirmDestructive(
      'Delete Outbound',
      'Are you sure you want to delete this outbound?',
      async () => {
        try {
          await deleteOutbound(id);
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
    if (selectedDate && editedOutbound) {
      setEditedOutbound({ ...editedOutbound, date: getLocalDateString(selectedDate) });
    }
  };

  const handleCustomerNameChange = (customerName: string) => {
    if (!editedOutbound) return;
    setEditedOutbound({ ...editedOutbound, customerName });
  };

  const calculateItemsTotal = (items: OutboundItem[]) => {
    return items.reduce((sum, it) => sum + (it.quantity || 0) * (it.unitPrice ?? 0), 0);
  };

  const handleItemChange = (index: number, field: keyof OutboundItem, value: any) => {
    if (!editedOutbound) return;
    const newItems = [...editedOutbound.items];
    const item = { ...newItems[index], [field]: value } as OutboundItem;
    newItems[index] = item;
    const totalAmount = calculateItemsTotal(newItems);
    setEditedOutbound({ ...editedOutbound, items: newItems, totalAmount: totalAmount > 0 ? totalAmount : undefined });
  };

  const handleAddItem = () => {
    if (!editedOutbound) return;
    const newItem: OutboundItem = {
      outboundId: editedOutbound.id || '',
      productName: '',
      quantity: 1,
      unit: '件',
      unitPrice: undefined,
    };
    const newItems = [...editedOutbound.items, newItem];
    setEditedOutbound({ ...editedOutbound, items: newItems });
  };

  const handleDeleteItem = (index: number) => {
    if (!editedOutbound) return;
    const newItems = editedOutbound.items.filter((_, i) => i !== index);
    const totalAmount = calculateItemsTotal(newItems);
    setEditedOutbound({ ...editedOutbound, items: newItems, totalAmount });
  };

  const pickFromCamera = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        showToast('Portalflow needs access to your camera.', 'info');
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
        showToast('Portalflow needs access to your photo library.', 'info');
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
      const imageUrl = await uploadOutboundImage(imageUri, id, editedOutbound?.spaceId ?? outbound?.spaceId ?? '');
      await saveOutbound({ ...(editedOutbound || outbound)!, id, imageUrl });
      await loadOutbound();
    } catch (error) {
      console.error('Error uploading image:', error);
      showToast('Failed to upload image.', 'error');
    } finally {
      setIsUploadingImage(false);
    }
  };

  if (!showAiInventory) return null;

  if (loading && !outbound) {
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

  if (!outbound) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Outbound not found</Text>
      </View>
    );
  }

  const current = editing ? (editedOutbound || outbound) : outbound;

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* 出库单摘要卡片 - 复用 receipt 结构 */}
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
          </View>
          <View style={styles.summaryContent}>
            <View style={styles.summaryContentTop}>
              <View style={styles.summaryContentMain}>
                {/* Receiver */}
                {editing ? (
                  <View style={styles.storeNameInputRow}>
                    <TextInput
                      style={styles.storeNameInput}
                      value={editedOutbound?.customerName ?? (editedOutbound as any)?.entity?.name ?? ''}
                      onChangeText={handleCustomerNameChange}
                      placeholder="Receiver"
                      maxLength={100}
                    />
                    <TouchableOpacity onPress={openCustomerPicker} style={{ paddingLeft: 8 }}>
                      <Ionicons name="chevron-down" size={20} color="#6C5CE7" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.storeName} numberOfLines={1}>
                    {(current as any).entity?.name || current.customerName || '—'}
                  </Text>
                )}
                {/* 金额 - 暂留空税额 */}
                <View style={styles.amountRow}>
                  <View style={styles.amountContainer}>
                    {current.totalAmount != null && current.totalAmount > 0 && (
                      <Text style={[styles.totalAmount, { color: '#D35400' }]}>
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
                          {editedOutbound?.date ? formatDate(editedOutbound.date) : '选择日期'}
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
                    style={[styles.quantityInput, { color: '#D35400', borderColor: '#D35400' }]}
                    value={String(item.quantity)}
                    onChangeText={(text) => handleItemChange(index, 'quantity', parseFloat(text) || 0)}
                    keyboardType="decimal-pad"
                    placeholder="数量"
                  />
                ) : (
                  <Text style={[styles.itemQuantity, { color: '#D35400' }]}>
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
                    <Text style={styles.pickerTitle}>选择日期</Text>
                    <TouchableOpacity
                      onPress={() => setShowDatePicker(false)}
                      style={styles.pickerCloseButton}
                    >
                      <Text style={styles.pickerCloseText}>完成</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={editedOutbound?.date ? parseLocalDate(editedOutbound.date) : new Date()}
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
              value={editedOutbound?.date ? parseLocalDate(editedOutbound.date) : new Date()}
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
              setEditedOutbound(outbound);
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
            setEditedOutbound({ ...outbound });
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
                <Ionicons name="person-outline" size={48} color="#6C5CE7" />
                <Text style={styles.duplicateModalTitle}>Replace Receiver with:</Text>
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
                    !!getCanonicalEntityId(outbound) &&
                    !!duplicateNameModalPayload?.targetId &&
                    getCanonicalEntityId(outbound) !== duplicateNameModalPayload.targetId;
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

      {/* 客户选择器 */}
      <Modal
        visible={showCustomerPicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowCustomerPicker(false)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowCustomerPicker(false)}
        >
          <View style={styles.pickerBottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Receiver</Text>
              <TouchableOpacity onPress={() => setShowCustomerPicker(false)} style={styles.pickerCloseButton}>
                <Text style={styles.pickerCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView} showsVerticalScrollIndicator={false}>
              {customerOptions.map((opt) => (
                <TouchableOpacity
                  key={`${opt.source}-${opt.id}`}
                  style={[styles.pickerOption, editedOutbound?.entityId === opt.id && styles.pickerOptionSelected]}
                  onPress={() => handleSelectCustomer(opt)}
                >
                  <View style={[styles.pickerColorIndicator, { backgroundColor: '#6C5CE7' }]} />
                  <Text
                    style={[styles.pickerOptionText, editedOutbound?.entityId === opt.id && styles.pickerOptionTextSelected]}
                    numberOfLines={1}
                  >
                    {opt.name}
                  </Text>
                  {editedOutbound?.entityId === opt.id && (
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

