/**
 * 项目信息页：编辑封面、名称、分类标签；查看 firm 与 order 信息。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  TextInput,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  getOrderById,
  getProjectByOrderId,
  updateProject,
  updateOrderStatus,
  confirmOrderAndCreateProjectTodos,
  type FirmProjectInfo,
} from '@/lib/firm';
import { preflightFirmEngagementConfirmOrAlert } from '@/lib/firm-engagement-preflight-ui';
import { supabase, uploadProjectCover } from '@/lib/supabase';
import { showToast } from '@/lib/toast';
import EngagementConsentModal from '@/components/EngagementConsentModal';
import { useWebViewportKind } from '../../../../lib/web-viewport';

const STAGE_LABEL: Record<string, string> = {
  onboarding: 'Onboarding',
  processing: 'Processing',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export default function OrderInfoScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const { isDesktopWeb } = useWebViewportKind();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Awaited<ReturnType<typeof getOrderById>>>(null);
  const [project, setProject] = useState<FirmProjectInfo | null>(null);
  const [firmName, setFirmName] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editImageUrl, setEditImageUrl] = useState<string | null>(null);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [uploadingCover, setUploadingCover] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [consentVisible, setConsentVisible] = useState(false);

  const isOnboarding = order?.status === 'onboarding';

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    setError(null);
    try {
      const [orderData, projectData] = await Promise.all([
        getOrderById(orderId),
        getProjectByOrderId(orderId),
      ]);
      if (!orderData) {
        setError('Order not found');
        return;
      }
      setOrder(orderData);
      setProject(projectData ?? null);
      setEditName(projectData?.name ?? orderData?.skuName ?? '');
      setEditImageUrl(projectData?.imageUrl ?? null);
      setEditTags(projectData?.tags ?? []);
      if (orderData.firmSpaceId) {
        const { data: space } = await supabase
          .from('spaces')
          .select('name')
          .eq('id', orderData.firmSpaceId)
          .maybeSingle();
        setFirmName((space as any)?.name ?? '');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRejectOrder = useCallback(async () => {
    if (!orderId) return;
    async function doReject() {
      setRejecting(true);
      const { error } = await updateOrderStatus(orderId, 'cancelled');
      setRejecting(false);
      if (error) {
        showToast(error.message ?? 'Failed to reject', 'error');
        return;
      }
      showToast('Order rejected', 'success');
      router.back();
    }
    if (isDesktopWeb) {
      if (!window.confirm('Reject this order? You can\'t undo this.')) return;
      await doReject();
      return;
    }
    Alert.alert('Reject order', 'Reject this order? You can\'t undo this.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reject', style: 'destructive', onPress: () => void doReject() },
    ]);
  }, [orderId, router, isDesktopWeb]);

  const performAcceptOrder = useCallback(async () => {
    if (!orderId) return;
    setAccepting(true);
    const pre = await preflightFirmEngagementConfirmOrAlert(orderId, router);
    if (!pre) {
      setAccepting(false);
      return;
    }
    const { error } = await confirmOrderAndCreateProjectTodos(orderId);
    setAccepting(false);
    if (error) {
      showToast(error.message ?? 'Failed to accept', 'error');
      return;
    }
    showToast('Order accepted', 'success');
    const project = await getProjectByOrderId(orderId);
    if (project?.id) {
      router.replace(`/tax-filing/project/${project.id}`);
    } else {
      load();
    }
  }, [orderId, router, load]);

  const handleAcceptOrder = useCallback(() => {
    if (accepting) return;
    setConsentVisible(true);
  }, [accepting]);

  const handlePickImage = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showToast('Need photo library access', 'info');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [3, 2],
        quality: 0.8,
      });
      if (result.canceled || !result.assets[0]) return;
      const uri = result.assets[0].uri;
      if (!project?.id) return;
      setUploadingCover(true);
      const clientSpaceId = order?.clientSpaceId ?? '';
      const imageUrl = await uploadProjectCover(uri, project.id, clientSpaceId);
      setEditImageUrl(imageUrl);
      await updateProject(project.id, { imageUrl });
      showToast('Cover updated', 'success');
    } catch (e) {
      showToast('Failed to update cover', 'error');
    } finally {
      setUploadingCover(false);
    }
  }, [project?.id, order?.clientSpaceId]);

  const handleSave = useCallback(async () => {
    if (!project?.id) return;
    setSaving(true);
    try {
      const { error: err } = await updateProject(project.id, {
        name: editName || project.name,
        imageUrl: editImageUrl ?? undefined,
        tags: editTags,
      });
      if (err) throw err;
      setEditing(false);
      showToast('Saved', 'success');
      load();
    } catch (e) {
      showToast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }, [project?.id, project?.name, editName, editImageUrl, editTags, load]);

  const taxSeasonYear = project?.taxSeasonYear != null
    ? project.taxSeasonYear
    : (order?.dueAt || order?.createdAt
        ? new Date((order.dueAt || order.createdAt)!).getFullYear()
        : null);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6C5CE7" />
      </View>
    );
  }
  if (error || !order) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'Not found'}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color="#6C5CE7" />
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <EngagementConsentModal
        visible={consentVisible}
        loading={accepting}
        onClose={() => {
          if (!accepting) setConsentVisible(false);
        }}
        onConfirm={() => {
          setConsentVisible(false);
          void performAcceptOrder();
        }}
      />
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBack} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color="#2D3436" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Project info</Text>
        {isOnboarding ? (
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={handleRejectOrder}
              disabled={rejecting || accepting}
              style={styles.headerRejectBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.headerRejectBtnText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleAcceptOrder}
              disabled={rejecting || accepting}
              style={styles.headerAcceptBtn}
              activeOpacity={0.7}
            >
              {accepting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.headerAcceptBtnText}>Accept</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : editing ? (
          <TouchableOpacity
            style={styles.headerSave}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.7}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#6C5CE7" />
            ) : (
              <Text style={styles.headerSaveText}>Save</Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.headerEdit}
            onPress={() => setEditing(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="create-outline" size={22} color="#6C5CE7" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Cover</Text>
          <TouchableOpacity
            style={styles.coverWrap}
            onPress={!isOnboarding && editing && !uploadingCover ? handlePickImage : undefined}
            activeOpacity={!isOnboarding && editing ? 0.8 : 1}
            disabled={isOnboarding || !editing || uploadingCover}
          >
            {editImageUrl ? (
              <Image source={{ uri: editImageUrl }} style={styles.coverImg} resizeMode="cover" />
            ) : (
              <View style={styles.coverPlaceholder}>
                {uploadingCover ? (
                  <ActivityIndicator size="small" color="#6C5CE7" />
                ) : (
                  <Ionicons name="image-outline" size={40} color="#B2BEC3" />
                )}
                <Text style={styles.coverPlaceholderText}>
                  {uploadingCover ? 'Uploading…' : !isOnboarding && editing ? 'Tap to change' : 'No cover'}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Project name</Text>
          {!isOnboarding && editing ? (
            <TextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
              placeholder="Name"
              placeholderTextColor="#95A5A6"
            />
          ) : (
            <Text style={styles.value}>{project?.name ?? (editName || '—')}</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Custom label</Text>
          <View style={styles.tagsRow}>
            {taxSeasonYear != null && (
              <View style={styles.tagPill}>
                <Text style={styles.tagPillText}>{taxSeasonYear} (Tax season)</Text>
              </View>
            )}
            {editTags.map((t) => (
              <View key={t} style={[styles.tagPill, styles.tagPillCustom]}>
                <Text style={styles.tagPillText}>{t}</Text>
              </View>
            ))}
          </View>
          {false && (
            <View style={styles.tagInputRow}>
              <TextInput
                style={styles.tagInput}
                value={tagInput}
                onChangeText={setTagInput}
                placeholder="Add tag"
                placeholderTextColor="#95A5A6"
                onSubmitEditing={() => {
                  const t = tagInput.trim();
                  if (t && !editTags.includes(t)) {
                    setEditTags((prev) => [...prev, t]);
                    setTagInput('');
                  }
                }}
              />
              <TouchableOpacity
                style={styles.tagAddBtn}
                onPress={() => {
                  const t = tagInput.trim();
                  if (t && !editTags.includes(t)) {
                    setEditTags((prev) => [...prev, t]);
                    setTagInput('');
                  }
                }}
              >
                <Text style={styles.tagAddBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Firm</Text>
          <Text style={styles.value}>{firmName || '—'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Order</Text>
          <View style={styles.orderRow}>
            <Text style={styles.value}>Status</Text>
            <View style={[styles.statusPill, { backgroundColor: '#E9ECEF' }]}>
              <Text style={styles.statusPillText}>{STAGE_LABEL[order.status] ?? order.status}</Text>
            </View>
          </View>
          {order.dueAt && (
            <View style={styles.orderRow}>
              <Text style={styles.value}>Due</Text>
              <Text style={styles.valueSecondary}>
                {new Date(order.dueAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </Text>
            </View>
          )}
          <View style={styles.orderRow}>
            <Text style={styles.value}>Manager</Text>
            <Text style={styles.valueSecondary}>{order.managerName ?? '—'}</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8F9FA', padding: 20 },
  errorText: { fontSize: 16, color: '#636E72', marginBottom: 16 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 16 },
  backBtnText: { fontSize: 16, color: '#6C5CE7', fontWeight: '500' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 48,
    paddingBottom: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  headerBack: { padding: 8 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '600', color: '#2D3436', marginLeft: 4 },
  headerEdit: { padding: 8 },
  headerSave: { padding: 8, minWidth: 56, alignItems: 'flex-end' },
  headerSaveText: { fontSize: 16, color: '#6C5CE7', fontWeight: '600' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerRejectBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#FFE5E5' },
  headerRejectBtnText: { color: '#C0392B', fontWeight: '600', fontSize: 14 },
  headerAcceptBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#6C5CE7' },
  headerAcceptBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  section: { marginBottom: 24 },
  sectionLabel: { fontSize: 12, fontWeight: '600', color: '#636E72', marginBottom: 8, textTransform: 'uppercase' },
  coverWrap: {
    width: '100%',
    aspectRatio: 3 / 2,
    backgroundColor: '#E9ECEF',
    borderRadius: 12,
    overflow: 'hidden',
  },
  coverImg: { width: '100%', height: '100%' },
  coverPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
  },
  coverPlaceholderText: { fontSize: 14, color: '#95A5A6', marginTop: 8 },
  input: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#2D3436',
  },
  value: { fontSize: 16, color: '#2D3436', fontWeight: '500' },
  valueSecondary: { fontSize: 14, color: '#636E72' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagPill: {
    backgroundColor: '#E8F4FD',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  tagPillCustom: { backgroundColor: '#F0F0F0' },
  tagPillText: { fontSize: 13, color: '#2D3436', fontWeight: '500' },
  tagInputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  tagInput: {
    flex: 1,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#2D3436',
  },
  tagAddBtn: { paddingHorizontal: 16, paddingVertical: 10 },
  tagAddBtnText: { fontSize: 15, color: '#6C5CE7', fontWeight: '600' },
  orderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusPillText: { fontSize: 13, color: '#2D3436', fontWeight: '500' },
});
