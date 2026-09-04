/**
 * ProjectInfoTab — 可嵌入 index.tsx 的项目信息面板（无导航头操作）。
 * 默认导出的 ProjectInfoScreen 保留作独立路由兜底（向后兼容），
 * 实际交互入口已迁移至 index.tsx 的页签系统。
 *
 * 布局：
 *   Card 1 — Hero：放大封面（176px）+ 名称 + 描述
 *   Card 2 — Classification：税季 / 国别 / 场景 / 自定义标签
 *   Card 3 — Firm & Order：事务所信息 + 订单主要字段
 *
 * 编辑态设计原则（参考 receipt-details）：
 *   各字段原地转为 TextInput / 选项组，布局不跳动。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  TextInput,
  Platform,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { format } from 'date-fns';
import {
  getOrderById,
  getProjectById,
  getFirmOrderLabelsByDimension,
  updateProject,
  updateOrderClassificationByLabelNames,
  type FirmProjectInfo,
} from '@/lib/firm';
import { supabase, uploadProjectCover } from '@/lib/supabase';
import { showToast } from '@/lib/toast';
import { getTaxSeasonColor, getTaxSeasonBgColor } from '@/lib/tax-season-colors';
import { getCurrentSpace } from '@/lib/auth';
import { subscribeFirmOrderAndLinkedProject } from '../../../../lib/engagement-realtime';

// ── Stage display configs（4 态，与 firm.orders.status 一致） ──
const STAGE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  onboarding: { label: 'Onboarding', color: '#E67E22', bg: '#FFF3E0' },
  processing: { label: 'Processing', color: '#29B6F7', bg: '#E1F5FE' },
  completed:  { label: 'Completed',  color: '#00875A', bg: '#E3FCEF' },
  cancelled:  { label: 'Cancelled',  color: '#636E72', bg: '#F0F2F5' },
};

const COVER_SIZE = 176;

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return format(d, 'MMM dd, yyyy');
}

const TAG_PALETTE: [string, string][] = [
  ['#EDE9FD', '#6C5CE7'],  // violet
  ['#E3F2FD', '#1E88E5'],  // blue
  ['#E8F5E9', '#2ECC71'],  // green
  ['#FFF3E0', '#E67E22'],  // amber
  ['#FCE4EC', '#E91E63'],  // rose
  ['#E0F7FA', '#00ACC1'],  // teal
  ['#FFF8E1', '#F9A825'],  // yellow
  ['#F3E5F5', '#9C27B0'],  // purple
];

function getTagColor(tag: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) & 0xffff;
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// ProjectInfoTab  —  嵌入式项目信息面板
// ─────────────────────────────────────────────────────────────────────────────
export interface ProjectInfoTabHandle {
  /** 由外部（index.tsx 操作行按钮）触发进入编辑态 */
  startEditing: () => void;
  /** 由外部触发取消编辑，恢复原值 */
  cancelEditing: () => void;
  /** 由外部触发保存编辑，返回是否保存成功 */
  saveEditing: () => Promise<boolean>;
}

export const ProjectInfoTab = forwardRef<
  ProjectInfoTabHandle,
  { projectId: string; mode?: 'client' | 'firm'; footer?: React.ReactNode; onSaved?: () => void | Promise<void> }
>(function ProjectInfoTabInner({ projectId, mode = 'client', footer, onSaved }, ref) {
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [order, setOrder]               = useState<Awaited<ReturnType<typeof getOrderById>>>(null);
  const [project, setProject]           = useState<FirmProjectInfo | null>(null);
  const [firmName, setFirmName]         = useState('');
  const [firmDesc, setFirmDesc]         = useState('');
  const [editingHero, setEditingHero]           = useState(false);
  const [editingClassification, setEditingClassification] = useState(false);

  // edit state
  const [editName, setEditName]               = useState('');
  const [editDesc, setEditDesc]               = useState('');
  const [editImageUrl, setEditImageUrl]       = useState<string | null>(null);
  const [editTaxCountry, setEditTaxCountry]   = useState('');
  const [editTaxScenario, setEditTaxScenario] = useState('');
  const [editTags, setEditTags]               = useState<string[]>([]);
  const [tagInput, setTagInput]               = useState('');
  const [seasonLabelOptions, setSeasonLabelOptions] = useState<string[]>([]);
  const [countryLabelOptions, setCountryLabelOptions] = useState<string[]>([]);
  const [scenarioLabelOptions, setScenarioLabelOptions] = useState<string[]>([]);
  const [customLabelOptions, setCustomLabelOptions] = useState<string[]>([]);
  const [uploadingCover, setUploadingCover]   = useState(false);
  const [editTaxSeasonYear, setEditTaxSeasonYear] = useState<string>('');

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const projectData = await getProjectById(projectId);
      if (!projectData) { setError('Project not found'); return; }
      setProject(projectData);

      const orderData = await getOrderById(projectData.orderId);
      if (!orderData) { setError('Order not found'); return; }
      setOrder(orderData);

      setEditName(projectData.name ?? '');
      setEditDesc(projectData.description ?? '');
      setEditImageUrl(projectData.imageUrl ?? null);
      // Classification 以 projects 为唯一下拉/保存源；初始值来自订单确认时触发器从 template/order 写入 project
      setEditTaxCountry(projectData.taxCountry ?? '');
      setEditTaxScenario(projectData.taxScenario ?? '');
      setEditTags(projectData.tags ?? []);
      setEditTaxSeasonYear(projectData.taxSeasonYear != null ? String(projectData.taxSeasonYear) : '');

      if (mode === 'firm' && orderData.firmSpaceId) {
        const [seasonLabels, countryLabels, scenarioLabels, customLabels] = await Promise.all([
          getFirmOrderLabelsByDimension(orderData.firmSpaceId, 'season'),
          getFirmOrderLabelsByDimension(orderData.firmSpaceId, 'country'),
          getFirmOrderLabelsByDimension(orderData.firmSpaceId, 'scenario'),
          getFirmOrderLabelsByDimension(orderData.firmSpaceId, 'custom'),
        ]);
        setSeasonLabelOptions(seasonLabels);
        setCountryLabelOptions(countryLabels);
        setScenarioLabelOptions(scenarioLabels);
        setCustomLabelOptions(customLabels);
      }

      // firm 模式：显示 client 空间名；client 模式：显示 firm 空间名
      const spaceIdToFetch = mode === 'firm' ? orderData.clientSpaceId : orderData.firmSpaceId;
      if (spaceIdToFetch) {
        const { data: space } = await supabase
          .from('spaces')
          .select('name')
          .eq('id', spaceIdToFetch)
          .maybeSingle();
        setFirmName((space as any)?.name ?? '');
        setFirmDesc('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [projectId, mode]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!order?.id) return;
    return subscribeFirmOrderAndLinkedProject(
      { orderId: order.id, projectId: project?.id ?? null },
      () => {
        void load();
      }
    );
  }, [order?.id, project?.id, load]);

  const handlePickImage = useCallback(async () => {
    if (!editingHero || uploadingCover) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { showToast('Need photo library access', 'info'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets[0]) return;
      if (!project?.id) return;
      setUploadingCover(true);
      const imageUrl = await uploadProjectCover(result.assets[0].uri, project.id, order?.clientSpaceId ?? '');
      const { error: saveErr } = await updateProject(project.id, { imageUrl });
      if (saveErr) throw saveErr;
      setEditImageUrl(imageUrl);
      showToast('Cover updated', 'success');
      void Promise.resolve(onSaved?.()).catch(() => {});
    } catch {
      showToast('Failed to update cover', 'error');
    } finally {
      setUploadingCover(false);
    }
  }, [editingHero, uploadingCover, project?.id, order?.clientSpaceId, onSaved]);

  /** 保存全部字段（供外部 ref 使用的兜底入口） */
  const handleSaveAll = useCallback(async (): Promise<boolean> => {
    if (!project?.id) return false;
    setSaving(true);
    try {
      const pendingTag = tagInput.trim();
      const trimmedTags = Array.from(
        new Set([
          ...editTags.map((t) => t.trim()).filter((t) => t.length > 0),
          ...(pendingTag ? [pendingTag] : []),
        ]),
      );
      const parsedYear = (() => {
        const y = parseInt(editTaxSeasonYear.trim(), 10);
        return Number.isFinite(y) ? y : null;
      })();

      if (mode === 'firm') {
        const { error: heroErr } = await updateProject(project.id, {
          name: editName.trim() || project.name,
          description: editDesc.trim() || null,
          imageUrl: editImageUrl ?? undefined,
        });
        if (heroErr) throw heroErr;

        const { error: projClassErr } = await updateProject(project.id, {
          taxCountry: editTaxCountry.trim() || null,
          taxScenario: editTaxScenario.trim() || null,
          tags: trimmedTags.length > 0 ? trimmedTags : null,
          taxSeasonYear: parsedYear,
        });
        if (projClassErr) throw projClassErr;

        const { error: classErr } = await updateOrderClassificationByLabelNames({
          orderId: order.id,
          firmSpaceId: order.firmSpaceId,
          taxCountry: editTaxCountry.trim() || null,
          taxScenario: editTaxScenario.trim() || null,
          taxSeasonLabelName: editTaxSeasonYear.trim() || null,
          customTags: trimmedTags,
        });
        if (classErr) throw classErr;
      } else {
        const { error: err } = await updateProject(project.id, {
          name: editName.trim() || project.name,
          description: editDesc.trim() || null,
          imageUrl: editImageUrl ?? undefined,
          taxCountry: editTaxCountry.trim() || null,
          taxScenario: editTaxScenario.trim() || null,
          tags: trimmedTags.length > 0 ? trimmedTags : null,
          taxSeasonYear: parsedYear,
        });
        if (err) throw err;
      }

      if (pendingTag) {
        setCustomLabelOptions((prev) => (prev.includes(pendingTag) ? prev : [...prev, pendingTag]));
        setTagInput('');
      }
      setEditingHero(false);
      setEditingClassification(false);
      showToast('Saved', 'success');
      await load();
      await Promise.resolve(onSaved?.());
      return true;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to save', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [project?.id, project?.name, editName, editDesc, editImageUrl, editTaxCountry, editTaxScenario, editTags, editTaxSeasonYear, tagInput, load, mode, order, onSaved]);

  /** 仅保存 Hero 卡片字段（名称 / 描述 / 封面） */
  const handleSaveHero = useCallback(async (): Promise<void> => {
    if (!project?.id) return;
    setSaving(true);
    try {
      const { error: err } = await updateProject(project.id, {
        name: editName.trim() || project.name,
        description: editDesc.trim() || null,
        imageUrl: editImageUrl ?? undefined,
      });
      if (err) throw err;
      setEditingHero(false);
      showToast('Saved', 'success');
      await load();
      await Promise.resolve(onSaved?.());
    } catch {
      showToast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }, [project?.id, project?.name, editName, editDesc, editImageUrl, load, onSaved]);

  /** 仅保存 Classification 卡片字段（税季 / 国别 / 场景 / 标签） */
  const handleSaveClassification = useCallback(async (): Promise<void> => {
    if (!project?.id) return;
    setSaving(true);
    try {
      const parsedYear = (() => {
        const y = parseInt(editTaxSeasonYear.trim(), 10);
        return Number.isFinite(y) ? y : null;
      })();
      const trimmedCountry = editTaxCountry.trim() || null;
      const trimmedScenario = editTaxScenario.trim() || null;
      const pendingTag = tagInput.trim();
      const trimmedTags = Array.from(
        new Set([
          ...editTags.map((t) => t.trim()).filter((t) => t.length > 0),
          ...(pendingTag ? [pendingTag] : []),
        ]),
      );
      let err: Error | null = null;
      if (mode === 'firm') {
        const r1 = await updateProject(project.id, {
          taxCountry: trimmedCountry,
          taxScenario: trimmedScenario,
          tags: trimmedTags.length > 0 ? trimmedTags : null,
          taxSeasonYear: parsedYear,
        });
        err = r1.error;
        if (!err) {
          const r2 = await updateOrderClassificationByLabelNames({
            orderId: order.id,
            firmSpaceId: order.firmSpaceId,
            taxCountry: trimmedCountry,
            taxScenario: trimmedScenario,
            taxSeasonLabelName: editTaxSeasonYear.trim() || null,
            customTags: trimmedTags,
          });
          err = r2.error;
        }
      } else {
        const r = await updateProject(project.id, {
          taxCountry: trimmedCountry,
          taxScenario: trimmedScenario,
          tags: trimmedTags.length > 0 ? trimmedTags : null,
          taxSeasonYear: parsedYear,
        });
        err = r.error;
      }
      if (err) throw err;
      if (pendingTag) {
        setCustomLabelOptions((prev) => (prev.includes(pendingTag) ? prev : [...prev, pendingTag]));
        setTagInput('');
      }
      setEditingClassification(false);
      showToast('Saved', 'success');
      await load();
      await Promise.resolve(onSaved?.());
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }, [project?.id, editTaxCountry, editTaxScenario, editTags, editTaxSeasonYear, load, mode, order?.id, order?.firmSpaceId, onSaved]);

  const handleCancelEditAll = useCallback(() => {
    if (!project) return;
    setEditName(project.name ?? '');
    setEditDesc(project.description ?? '');
    setEditImageUrl(project.imageUrl ?? null);
    setEditTaxCountry(project.taxCountry ?? '');
    setEditTaxScenario(project.taxScenario ?? '');
    setEditTags(project.tags ?? []);
    setEditTaxSeasonYear(project.taxSeasonYear != null ? String(project.taxSeasonYear) : '');
    setTagInput('');
    setEditingHero(false);
    setEditingClassification(false);
  }, [project]);

  /** 仅取消 Hero 卡片的编辑（还原名称/描述/封面） */
  const handleCancelHero = useCallback(() => {
    if (!project) return;
    setEditName(project.name ?? '');
    setEditDesc(project.description ?? '');
    setEditImageUrl(project.imageUrl ?? null);
    setEditingHero(false);
  }, [project]);

  /** 仅取消 Classification 卡片编辑（还原税季/国别/场景/标签） */
  const handleCancelClassification = useCallback(() => {
    if (!project) return;
    setEditTaxCountry(project.taxCountry ?? '');
    setEditTaxScenario(project.taxScenario ?? '');
    setEditTags(project.tags ?? []);
    setTagInput('');
    setEditTaxSeasonYear(project.taxSeasonYear != null ? String(project.taxSeasonYear) : '');
    setEditingClassification(false);
  }, [project]);

  // useImperativeHandle 放在 handleSave / handleCancelEdit 定义之后，避免暂时性死区
  useImperativeHandle(
    ref,
    () => ({
      startEditing: () => {
        setEditingHero(true);
        setEditingClassification(true);
      },
      cancelEditing: () => handleCancelEditAll(),
      saveEditing: () => handleSaveAll(),
    }),
    [handleCancelEditAll, handleSaveAll]
  );

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    setEditTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setCustomLabelOptions((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setTagInput('');
  };
  const removeTag = (t: string) => setEditTags((p) => p.filter((x) => x !== t));

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator size="large" color="#6C5CE7" />
      </View>
    );
  }
  if (error || !order || !project) {
    return (
      <View style={s.centered}>
        <Ionicons name="alert-circle-outline" size={36} color="#B2BEC3" style={{ marginBottom: 10 }} />
        <Text style={s.errorText}>{error ?? 'Project not found'}</Text>
      </View>
    );
  }

  const derivedTaxSeasonYear = order.dueAt || order.createdAt
    ? new Date((order.dueAt || order.createdAt)!).getFullYear()
    : null;
  const taxSeasonYear =
    project.taxSeasonYear != null ? project.taxSeasonYear : derivedTaxSeasonYear;
  const taxSeasonLabelName = taxSeasonYear != null ? String(taxSeasonYear) : null;
  const stageConfig = STAGE_CONFIG[order.status] ?? STAGE_CONFIG.onboarding;
  const displayImageUrl = editingHero ? editImageUrl : project.imageUrl;

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
      {/* ══════════════════════════════════════════════
          Card 1 — Hero：封面 + 名称 + 描述
      ══════════════════════════════════════════════ */}
      <View style={s.card}>
        {/* Info 编辑入口：Hero 卡片右上角铅笔 / 取消 / 保持 */}
        {!editingHero ? (
          <TouchableOpacity
            style={s.cardEditIcon}
            onPress={() => setEditingHero(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="create-outline" size={18} color="#636E72" />
          </TouchableOpacity>
        ) : (
          <View style={s.cardEditActions}>
            <TouchableOpacity
              style={[s.cardEditBtn, s.cardEditCancelBtn]}
              onPress={handleCancelHero}
              activeOpacity={0.7}
            >
              <Text style={s.cardEditCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.cardEditBtn, s.cardEditSaveBtn]}
              onPress={handleSaveHero}
              disabled={saving}
              activeOpacity={0.7}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={s.cardEditSaveText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
        {/* 顶行：封面 + 右侧信息 */}
        <View style={s.heroRow}>
          {/* 封面 */}
          <TouchableOpacity
            style={s.coverWrap}
            onPress={handlePickImage}
            activeOpacity={editingHero ? 0.8 : 1}
            disabled={!editingHero || uploadingCover}
          >
            {displayImageUrl
              ? <Image source={{ uri: displayImageUrl }} style={s.coverImg} resizeMode="cover" />
              : <View style={s.coverPlaceholder}>
                  {uploadingCover
                    ? <ActivityIndicator size="small" color="#6C5CE7" />
                    : <Ionicons name="image-outline" size={44} color="#BDC3C7" />}
                </View>}
            {editingHero && !uploadingCover && (
              <View style={s.coverOverlay as any}>
                <Ionicons name="camera" size={22} color="#fff" />
              </View>
            )}
            {uploadingCover && (
              <View style={s.coverOverlay as any}>
                <ActivityIndicator size="large" color="#fff" />
              </View>
            )}
          </TouchableOpacity>

          {/* 名称 + 描述 */}
          <View style={s.heroMeta}>
            {/* 名称 */}
            {editingHero
              ? <TextInput
                  style={s.nameInput}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Project name"
                  placeholderTextColor="#B2BEC3"
                  multiline={false}
                />
              : <Text style={s.nameText} numberOfLines={3}>{project.name ?? '—'}</Text>}

            {/* 描述 */}
            {editingHero
              ? <TextInput
                  style={s.descInput}
                  value={editDesc}
                  onChangeText={setEditDesc}
                  placeholder="Add a description…"
                  placeholderTextColor="#B2BEC3"
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              : (project.description
                  ? <Text style={s.descText} numberOfLines={5}>{project.description}</Text>
                  : <Text style={s.descEmpty}>No description</Text>)}
          </View>
        </View>

      </View>

      {/* ══════════════════════════════════════════════
          Card 2 — Classification：税季 / 国别 / 场景 / 标签
          布局：左列为提示文字（右对齐），右列为实际标签（左对齐）
      ══════════════════════════════════════════════ */}
      <View style={s.card}>
        {/* Classification 卡片编辑入口：右上角铅笔 / 取消 / 保持 */}
        {!editingClassification ? (
          <TouchableOpacity
            style={s.cardEditIcon}
            onPress={() => setEditingClassification(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="create-outline" size={18} color="#636E72" />
          </TouchableOpacity>
        ) : (
          <View style={s.cardEditActions}>
            <TouchableOpacity
              style={[s.cardEditBtn, s.cardEditCancelBtn]}
              onPress={handleCancelClassification}
              activeOpacity={0.7}
            >
              <Text style={s.cardEditCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.cardEditBtn, s.cardEditSaveBtn]}
              onPress={handleSaveClassification}
              disabled={saving}
              activeOpacity={0.7}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={s.cardEditSaveText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
        <Text style={s.cardTitle}>Classification</Text>

        {/* Tax season — 彩色 pill；firm 可从维度 chips 选；client 仅数字年份 */}
        <View style={s.cfRow}>
          <View style={s.cfTagCol}>
            <Text style={s.cfLabel}>Tax season</Text>
          </View>
          <View style={s.cfValueCol}>
            {editingClassification && mode === 'firm' ? (
              <View style={[s.optionRow, { alignItems: 'center', justifyContent: 'space-between' }]}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, flex: 1 }}>
                  {seasonLabelOptions.map((label) => (
                      <TouchableOpacity
                        key={label}
                        style={[
                          s.optChip,
                          label === editTaxSeasonYear.trim() && s.optChipActive,
                        ]}
                        onPress={() => setEditTaxSeasonYear(label)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            s.optChipText,
                            label === editTaxSeasonYear.trim() && s.optChipTextActive,
                          ]}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                </View>
                <TextInput
                  style={[s.tagsInput, { width: 80, marginLeft: 8 }]}
                  value={editTaxSeasonYear}
                  onChangeText={setEditTaxSeasonYear}
                  placeholder="YYYY"
                  placeholderTextColor="#B2BEC3"
                />
              </View>
            ) : editingClassification && mode === 'client' ? (
              <TextInput
                style={[s.tagsInput, { minWidth: 100, maxWidth: 120 }]}
                value={editTaxSeasonYear}
                onChangeText={setEditTaxSeasonYear}
                placeholder="YYYY"
                placeholderTextColor="#B2BEC3"
                keyboardType="number-pad"
              />
            ) : taxSeasonLabelName ? (
              <View
                style={[
                  s.taxSeasonPill,
                  {
                    backgroundColor:
                      taxSeasonYear != null ? getTaxSeasonBgColor(taxSeasonYear) : '#EEF2F7',
                  },
                ]}
              >
                <Text
                  style={[
                    s.taxSeasonPillText,
                    { color: taxSeasonYear != null ? getTaxSeasonColor(taxSeasonYear) : '#5A6B7A' },
                  ]}
                >
                  {taxSeasonLabelName}
                </Text>
              </View>
            ) : (
              <Text style={s.cfEmptyTag}>—</Text>
            )}
          </View>
        </View>

        <View style={s.divider} />

        {/* Tax jurisdiction */}
        <View style={s.cfRow}>
          <View style={s.cfTagCol}>
            <Text style={s.cfLabel}>Jurisdiction</Text>
          </View>
          <View style={s.cfValueCol}>
            {editingClassification && mode === 'firm'
              ? (
                <View style={[s.optionRow, { alignItems: 'center', justifyContent: 'space-between' }]}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, flex: 1 }}>
                    {countryLabelOptions.map((opt) => (
                      <TouchableOpacity
                        key={opt}
                        style={[s.optChip, editTaxCountry === opt && s.optChipActive]}
                        onPress={() => setEditTaxCountry(opt)}
                        activeOpacity={0.7}
                      >
                        <Text style={[s.optChipText, editTaxCountry === opt && s.optChipTextActive]}>
                          {opt}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    style={[s.tagsInput, { width: 120, marginLeft: 8 }]}
                    value={editTaxCountry}
                    onChangeText={setEditTaxCountry}
                    placeholder=""
                    placeholderTextColor="#B2BEC3"
                  />
                </View>
              )
              : editingClassification && mode === 'client'
                ? (
                  <TextInput
                    style={[s.tagsInput, { flex: 1, minWidth: 120 }]}
                    value={editTaxCountry}
                    onChangeText={setEditTaxCountry}
                    placeholder="e.g. CANADA"
                    placeholderTextColor="#B2BEC3"
                    autoCapitalize="characters"
                  />
                )
              : project.taxCountry
                  ? (() => {
                      const name = project.taxCountry as string;
                      const [bg, fg] = getTagColor(name);
                      return <View style={[s.valueTagPill, { backgroundColor: bg }]}><Text style={[s.valueTagText, { color: fg }]}>{name}</Text></View>;
                    })()
                  : <Text style={s.cfEmptyTag}>—</Text>}
          </View>
        </View>

        <View style={s.divider} />

        {/* Tax scenario */}
        <View style={s.cfRow}>
          <View style={s.cfTagCol}>
            <Text style={s.cfLabel}>Scenario</Text>
          </View>
          <View style={s.cfValueCol}>
            {editingClassification && mode === 'firm'
              ? (
                <View style={[s.optionRow, { alignItems: 'center', justifyContent: 'space-between' }]}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, flex: 1 }}>
                    {scenarioLabelOptions.map((opt) => (
                      <TouchableOpacity
                        key={opt}
                        style={[s.optChip, editTaxScenario === opt && s.optChipActive]}
                        onPress={() => setEditTaxScenario(opt)}
                        activeOpacity={0.7}
                      >
                        <Text style={[s.optChipText, editTaxScenario === opt && s.optChipTextActive]}>
                          {opt}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    style={[s.tagsInput, { width: 120, marginLeft: 8 }]}
                    value={editTaxScenario}
                    onChangeText={setEditTaxScenario}
                    placeholder=""
                    placeholderTextColor="#B2BEC3"
                  />
                </View>
              )
              : editingClassification && mode === 'client'
                ? (
                  <TextInput
                    style={[s.tagsInput, { flex: 1, minWidth: 120 }]}
                    value={editTaxScenario}
                    onChangeText={setEditTaxScenario}
                    placeholder="e.g. T1"
                    placeholderTextColor="#B2BEC3"
                  />
                )
              : project.taxScenario
                  ? (() => {
                      const name = project.taxScenario as string;
                      const [bg, fg] = getTagColor(name);
                      return <View style={[s.valueTagPill, { backgroundColor: bg }]}><Text style={[s.valueTagText, { color: fg }]}>{name}</Text></View>;
                    })()
                  : <Text style={s.cfEmptyTag}>—</Text>}
          </View>
        </View>

        <View style={s.divider} />

        {/* Custom label — firm 维度多选；client 点标签删除 + 新增；只读来自 project.tags */}
        <View style={s.cfRow}>
          <View style={s.cfTagCol}>
            <Text style={s.cfLabel}>Custom label</Text>
          </View>
          <View style={[s.cfValueCol, { gap: 8 }]}>
            {!editingClassification ? (
              <View style={s.tagsRow}>
                {project.tags && project.tags.length > 0 ? (
                  project.tags.map((t) => {
                    const [bg, fg] = getTagColor(t);
                    return (
                      <View key={t} style={[s.valueTagPill, { backgroundColor: bg }]}>
                        <Text style={[s.valueTagText, { color: fg }]}>{t}</Text>
                      </View>
                    );
                  })
                ) : (
                  <Text style={s.cfEmptyTag}>—</Text>
                )}
              </View>
            ) : mode === 'firm' ? (
              <View style={s.tagsRow}>
                {(customLabelOptions.length > 0 ? customLabelOptions : editTags).map((t) => {
                  const isSelected = editTags.includes(t);
                  const [bg, fg] = getTagColor(t);
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[
                        s.tagPill,
                        isSelected && { backgroundColor: bg, borderColor: 'transparent' },
                      ]}
                      onPress={() => {
                        setEditTags((prev) =>
                          prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
                        );
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.tagPillText, isSelected && { color: fg }]}>{t}</Text>
                    </TouchableOpacity>
                  );
                })}
                <View style={s.tagInlineInputWrap}>
                  <TextInput
                    style={[s.tagInlineInput, { flex: 1 }]}
                    value={tagInput}
                    onChangeText={setTagInput}
                    placeholder=""
                    placeholderTextColor="#B2BEC3"
                    onSubmitEditing={addTag}
                    returnKeyType="done"
                    blurOnSubmit={false}
                  />
                  <TouchableOpacity onPress={addTag} activeOpacity={0.7} hitSlop={6}>
                    <Text style={s.tagPillText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={s.tagsRow}>
                {editTags.map((t) => {
                  const [bg, fg] = getTagColor(t);
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[s.tagPill, { backgroundColor: bg, borderColor: 'transparent' }]}
                      onPress={() => removeTag(t)}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.tagPillText, { color: fg }]}>{t} ·</Text>
                    </TouchableOpacity>
                  );
                })}
                <View style={s.tagInlineInputWrap}>
                  <TextInput
                    style={[s.tagInlineInput, { flex: 1 }]}
                    value={tagInput}
                    onChangeText={setTagInput}
                    placeholder="Add label"
                    placeholderTextColor="#B2BEC3"
                    onSubmitEditing={addTag}
                    returnKeyType="done"
                    blurOnSubmit={false}
                  />
                  <TouchableOpacity onPress={addTag} activeOpacity={0.7} hitSlop={6}>
                    <Text style={s.tagPillText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* ══════════════════════════════════════════════
          Card 3 — Firm & Order
      ══════════════════════════════════════════════ */}
      <View style={s.card}>
        {/* ─── Firm / Client ─── */}
        <Text style={s.cardTitle}>{mode === 'firm' ? 'Client' : 'Firm'}</Text>

        <View style={s.infoRow}>
          <View style={s.infoIconWrap}>
            <Ionicons name="business-outline" size={16} color="#6C5CE7" />
          </View>
          <View style={s.infoBody}>
            <Text style={s.infoLabel}>Name</Text>
            <Text style={s.infoValue} numberOfLines={1}>{firmName || '—'}</Text>
          </View>
        </View>

        {firmDesc ? (
          <View style={[s.infoRow, s.infoRowBorder]}>
            <View style={s.infoIconWrap}>
              <Ionicons name="information-circle-outline" size={16} color="#636E72" />
            </View>
            <View style={s.infoBody}>
              <Text style={s.infoLabel}>About</Text>
              <Text style={s.infoValue} numberOfLines={3}>{firmDesc}</Text>
            </View>
          </View>
        ) : null}

        {/* ─── Order ─── */}
        <Text style={[s.cardTitle, s.cardTitleSecond]}>Order</Text>

        {/* 第一行：No. + Status */}
        <View style={s.tableRow}>
          <View style={s.tableCell}>
            <Text style={s.tableCellLabel}>No.</Text>
            <Text style={s.tableCellMono} numberOfLines={1}>
              {order.id.slice(0, 8).toUpperCase()}
            </Text>
          </View>
          <View style={[s.tableCell, s.tableCellBorderLeft]}>
            <Text style={s.tableCellLabel}>Status</Text>
            <View style={[s.stageBadge, { backgroundColor: stageConfig?.bg ?? '#F0F2F5', alignSelf: 'flex-start' }]}>
              <Text style={[s.stageBadgeText, { color: stageConfig?.color ?? '#636E72' }]}>
                {stageConfig?.label ?? order.status}
              </Text>
            </View>
          </View>
        </View>

        {/* 第二行：Created + Last updated */}
        <View style={[s.tableRow, s.tableRowBorder]}>
          <View style={s.tableCell}>
            <Text style={s.tableCellLabel}>Created</Text>
            <Text style={s.tableCellValue}>{formatDate(order.createdAt)}</Text>
          </View>
          <View style={[s.tableCell, s.tableCellBorderLeft]}>
            <Text style={s.tableCellLabel}>Last updated</Text>
            <Text style={s.tableCellValue}>{formatDate(order.updatedAt)}</Text>
          </View>
        </View>

        <View style={[s.tableRow, s.tableRowBorder]}>
          <View style={s.tableCellFull}>
            <Text style={s.tableCellLabel}>Manager</Text>
            <Text style={s.tableCellValue}>{order.managerName ?? '—'}</Text>
          </View>
        </View>
      </View>

      {footer ? <View style={{ marginTop: 12 }}>{footer}</View> : null}

    </ScrollView>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Default export — 独立路由兜底（向后兼容，实际入口已迁至 index.tsx 页签）
// ─────────────────────────────────────────────────────────────────────────────
export default function ProjectInfoScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const [mode, setMode] = useState<'client' | 'firm'>('client');
  useEffect(() => {
    let mounted = true;
    getCurrentSpace(true).then((space) => {
      if (!mounted) return;
      setMode(space?.kind === 'provider' ? 'firm' : 'client');
    });
    return () => {
      mounted = false;
    };
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: '#F0F2F5' }}>
      <ProjectInfoTab projectId={projectId ?? ''} mode={mode} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { padding: 10, paddingBottom: 4, gap: 4 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  errorText: { fontSize: 15, color: '#636E72', textAlign: 'center' },

  // ── 通用卡片 ──
  card: {
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DEE2E6',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 2,
    marginBottom: 2,
    position: 'relative',
  },
  cardEditIcon: {
    position: 'absolute',
    top: 10,
    right: 12,
    padding: 4,
    zIndex: 1,
  },
  cardEditActions: {
    position: 'absolute',
    right: 12,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 1,
  },
  cardEditBtn: {
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // 阴影参考凭证详情底部 Confirm/Cancel 规范
    ...(Platform.OS === 'ios'
      ? {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.12,
          shadowRadius: 4,
        }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 2 } : {}),
  },
  cardEditCancelBtn: {
    borderColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
  },
  cardEditSaveBtn: {
    borderColor: '#6C5CE7',
    backgroundColor: '#6C5CE7',
  },
  cardEditCancelText: {
    fontSize: 12,
    color: '#636E72',
    fontWeight: '500',
  },
  cardEditSaveText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  cardTitle: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#95A5A6',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 7,
  },
  cardTitleSecond: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E9ECEF',
  },

  // ── Card 1: Hero ──
  heroRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  coverWrap: {
    width: COVER_SIZE,
    height: COVER_SIZE,
    borderRadius: 10,
    backgroundColor: '#E9ECEF',
    overflow: 'hidden',
    flexShrink: 0,
  },
  coverImg: { width: COVER_SIZE, height: COVER_SIZE },
  coverPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.38)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroMeta: { flex: 1, gap: 6, paddingTop: 2 },
  nameText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2D3436',
    lineHeight: 23,
  },
  nameInput: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
    borderWidth: 1,
    borderColor: '#6C5CE7',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#fff',
    lineHeight: 22,
  },
  descText: { fontSize: 13, color: '#636E72', lineHeight: 19 },
  descEmpty: { fontSize: 13, color: '#B2BEC3', fontStyle: 'italic' },
  descInput: {
    fontSize: 13,
    color: '#2D3436',
    borderWidth: 1,
    borderColor: '#6C5CE7',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#fff',
    minHeight: 72,
    lineHeight: 19,
  },

  // ── Card 2: Classification（左列提示右对齐，右列内容左对齐） ──
  cfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 32,          // 进一步压缩行高，仍保留可读性
    paddingHorizontal: 0,
    gap: 8,
  },
  // 左侧提示列：固定宽度，文字右对齐
  cfTagCol: {
    width: 90,
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cfLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#636E72',
  },
  cfEmptyTag: { fontSize: 13, color: '#B2BEC3' },
  // 右侧内容列：占剩余空间，文字左对齐
  cfValueCol: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',   // 默认 flexDirection:column 时为垂直居中
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E9ECEF' },

  // 税季彩色 pill（与 index.tsx 同款）：浅底色 + 深字色
  taxSeasonPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#F3F4FF',
  },
  taxSeasonPillText: { fontSize: 12, color: '#2D3436', fontWeight: '700' },

  // 其他字段只读 tag（灰底深字）
  valueTagPill: {
    backgroundColor: '#E9ECEF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  valueTagText: { fontSize: 12, fontWeight: '600', color: '#2D3436' },

  optionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  optChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DFE6E9',
    backgroundColor: '#FFFFFF',
  },
  optChipActive: { borderColor: '#6C5CE7', backgroundColor: '#EDE9FD' },
  optChipText: { fontSize: 12, color: '#636E72', fontWeight: '500' },
  optChipTextActive: { color: '#6C5CE7', fontWeight: '700' },

  // Custom label row — 阅读/编辑态共用同一 flex-wrap 容器，行高由 cfRow minHeight 保证
  // justifyContent: 'flex-start' 覆盖 cfValueCol 的 'center'，确保左端对齐
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
  },
  tagPill: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DFE6E9',
  },
  tagPillText: { fontSize: 12, color: '#2D3436', fontWeight: '500' },
  tagEditPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDE9FD',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
  },
  tagEditPillText: { fontSize: 12, color: '#6C5CE7', fontWeight: '600' },
  // 内联输入框：与标签同一视觉体系的小 pill 套框，避免系统默认蓝色高亮边框
  tagInlineInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DFE6E9',
    backgroundColor: '#FFFFFF',
    gap: 4,
    minWidth: 72,
  },
  tagInlineInput: {
    fontSize: 12,
    color: '#2D3436',
    paddingVertical: 0,
    minWidth: 44,
    maxWidth: 110,
    // React Native Web: 关闭默认的蓝色 outline
    outlineStyle: 'none',
    outlineWidth: 0,
  },
  // 已有标签建议 pill（带浅色彩色背景，点击即选）
  tagSuggestionPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  tagSuggestionText: { fontSize: 12, fontWeight: '500' },

  // ── Card 3: Firm ──
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    gap: 10,
  },
  infoRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E9ECEF',
  },
  infoIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#EBEBEB',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  infoBody: { flex: 1, gap: 2 },
  infoLabel: { fontSize: 11, fontWeight: '600', color: '#95A5A6', textTransform: 'uppercase', letterSpacing: 0.4 },
  infoValue: { fontSize: 14, fontWeight: '600', color: '#2D3436' },
  stageBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  stageBadgeText: { fontSize: 12, fontWeight: '700' },

  // ── Card 3: Order 表格 ──
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 10,
  },
  tableRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E9ECEF',
  },
  tableCell: {
    flex: 1,
    gap: 4,
    paddingRight: 8,
  },
  tableCellBorderLeft: {
    paddingRight: 0,
    paddingLeft: 12,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#E9ECEF',
  },
  tableCellFull: { flex: 1, paddingRight: 0 },
  tableCellLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#95A5A6',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  tableCellValue: { fontSize: 13, fontWeight: '600', color: '#2D3436', lineHeight: 18 },
  tableCellMono: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2D3436',
    letterSpacing: 0.8,
    fontVariant: ['tabular-nums'],
  },

  // ── 编辑操作行 ──
  editActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#F0F2F5',
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: '#636E72' },
  saveBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#6C5CE7',
    alignItems: 'center',
  },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
