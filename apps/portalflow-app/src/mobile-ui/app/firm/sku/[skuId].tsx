/**
 * Firm — SKU 配置页
 *
 * 双 Tab 架构（与 project/[projectId]/index.tsx 对齐）：
 *   WBS  tab  — SkuItemsTreeView（与 TaxFilingTodosView 相同视觉）
 *   Info tab  — Hero card + Classification card（与 info.tsx 完全相同样式）
 *
 * Op row：
 *   WBS 激活  → "Add phase" 按钮
 *   Info 激活 → "Edit" 图标  /  editing 时显示 "Cancel" + "Save"
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, ScrollView,
  TouchableOpacity, TextInput, Alert, Platform, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  getSkuById,
  getSkuItems,
  getFirmOrderLabelsByDimension,
  updateFirmSku,
  createSkuItem,
  updateSkuItem,
  deleteSkuItem,
  updateSkuItemDependsOn,
  deleteFirmSku,
  applySkuItemsTreeOrder,
  type ProjectTodoNode,
} from '@/lib/firm';
import type { FirmSku, FirmSkuItem } from '@/types';
import { uploadFirmSkuImage } from '@/lib/supabase';
import { showToast } from '@/lib/toast';
import { showConfirmDestructiveDialog } from '@/lib/confirmDialog';
import { TaxFilingTodosView } from '@/components/TaxFilingTodosView';

// ─────────────────────────────────────────
// 常量（与 info.tsx 保持一致）
// ─────────────────────────────────────────
const TAX_COUNTRY_OPTIONS = [
  { value: '', label: '—' },
  { value: 'CANADA', label: 'Canada' },
  { value: 'USA', label: 'USA' },
];
const TAX_SCENARIO_OPTIONS = [
  { value: '', label: '—' },
  { value: 'T1', label: 'T1' },
  { value: 'T2', label: 'T2' },
  { value: '1040', label: '1040' },
  { value: '1120-S', label: '1120-S' },
];

// tag 调色板（与 info.tsx 一致）
const TAG_PALETTE: [string, string][] = [
  ['#EDE9FD', '#6C5CE7'],
  ['#E3F2FD', '#1E88E5'],
  ['#E8F5E9', '#27AE60'],
  ['#FFF3E0', '#E67E22'],
  ['#FCE4EC', '#E91E63'],
  ['#E8EAF6', '#3F51B5'],
  ['#E0F7FA', '#00838F'],
  ['#FFF8E1', '#F9A825'],
];
function getTagColor(s: string): [string, string] {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xfffff;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length]!;
}

const COVER_H = 88;

/** 将 sku_items 转为 TaxFilingTodosView 所需的 ProjectTodoNode 树（catalog 模式） */
function skuItemsToProjectTodoTree(items: FirmSkuItem[]): ProjectTodoNode[] {
  const byParent = new Map<string | null, FirmSkuItem[]>();
  items.forEach((it) => {
    const k = it.parentId ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(it);
  });
  for (const list of byParent.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);

  function build(parentKey: string | null, depth: number): ProjectTodoNode[] {
    const list = byParent.get(parentKey) ?? [];
    return list.map((it) => {
      const depIds =
        Array.isArray(it.dependsOnIds) && it.dependsOnIds.length > 0
          ? it.dependsOnIds
          : it.dependsOnId
            ? [it.dependsOnId]
            : [];
      return {
        id: it.id,
        orderId: '',
        parentId: it.parentId ?? null,
        type: it.type,
        initialResponsibleSide: it.type,
        title: it.title,
        description: it.description ?? null,
        status: 'in_progress' as const,
        sortOrder: it.sortOrder,
        depth,
        itemKind: it.itemKind,
        dependsOnId: depIds[0] ?? null,
        dependsOnIds: depIds,
        children: build(it.id, depth + 1),
      };
    });
  }
  return build(null, 0);
}

/** 收集某节点及其所有后代 id（用于递归删除，按子先父后顺序） */
function collectIdsPostOrder(items: FirmSkuItem[], parentId: string): string[] {
  const children = items.filter((it) => (it.parentId ?? null) === parentId);
  const order: string[] = [];
  for (const c of children) {
    order.push(...collectIdsPostOrder(items, c.id));
  }
  order.push(parentId);
  return order;
}

// ─────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────
export default function FirmSkuDetailScreen() {
  const { skuId, tab, edit, isNew } = useLocalSearchParams<{ skuId: string; tab?: string; edit?: string; isNew?: string }>();
  const router = useRouter();

  // ── 数据状态 ──
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [sku, setSku]           = useState<FirmSku | null>(null);
  const [items, setItems]       = useState<FirmSkuItem[]>([]);

  // ── Tab / Edit ──
  const initialTab: 'todos' | 'info' = tab === 'info' ? 'info' : 'todos';
  const initialEditing = edit === '1' || edit === 'true';
  const [activeTab, setActiveTab]   = useState<'todos' | 'info'>(initialTab);
  const [infoEditing, setInfoEditing] = useState(initialEditing);
  const [todosDirty, setTodosDirty] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [uploading, setUploading]   = useState(false);

  // ── Info 编辑草稿 ──
  const [editName, setEditName]             = useState('');
  const [editDesc, setEditDesc]             = useState('');
  const [editImageUrl, setEditImageUrl]     = useState<string | null>(null);
  const [editTaxCountry, setEditTaxCountry] = useState('');
  const [editTaxScenario, setEditTaxScenario] = useState('');
  type TemplateStatus = 'draft' | 'private' | 'published';
  const [editStatus, setEditStatus] = useState<TemplateStatus>('draft');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [customLabelOptions, setCustomLabelOptions] = useState<string[]>([]);

  // ── 新建 SKU 检测：从 Service Catalog「New service」进入时带 isNew=1，若期间无任何修改则离开时自动删除该草稿
  const isNewSku = isNew === '1' || isNew === 'true';
  const hasTouchedRef = useRef(false);
  const markTouched = useCallback(() => {
    hasTouchedRef.current = true;
  }, []);

  // ─────────────── load ───────────────
  const load = useCallback(async () => {
    if (!skuId) { setError('Missing SKU ID'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [skuData, itemsData] = await Promise.all([getSkuById(skuId), getSkuItems(skuId)]);
      if (!skuData) { setError('SKU not found'); setLoading(false); return; }
      const skuForState: FirmSku = {
        ...skuData,
        id: skuId,
        firmSpaceId: skuData.firmSpaceId ?? '',
        description: skuData.description ?? undefined,
        imageUrl: skuData.imageUrl ?? undefined,
        taxCountry: skuData.taxCountry ?? undefined,
        taxScenario: skuData.taxScenario ?? undefined,
      };
      setSku(skuForState);
      setItems(itemsData);
      resetDraft(skuForState);
      const fid = (skuData.firmSpaceId ?? '').trim();
      if (fid) {
        try {
          const custom = await getFirmOrderLabelsByDimension(fid, 'custom');
          setCustomLabelOptions(custom);
        } catch {
          setCustomLabelOptions([]);
        }
      } else {
        setCustomLabelOptions([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [skuId]);

  function resetDraft(data: FirmSku) {
    setEditName(data.name ?? '');
    setEditDesc(data.description ?? '');
    setEditImageUrl(data.imageUrl ?? null);
    setEditTaxCountry(data.taxCountry ?? '');
    setEditTaxScenario(data.taxScenario ?? '');
    setEditTags(data.tags ?? []);
    setTagInput('');
    const status: TemplateStatus = data.templateStatus ?? (data.isPublished ? 'published' : (data.taxCountry || data.taxScenario ? 'private' : 'draft'));
    setEditStatus(status);
  }

  const addCustomLabelTag = useCallback(() => {
    const t = tagInput.trim();
    if (!t) return;
    setEditTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setCustomLabelOptions((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setTagInput('');
  }, [tagInput]);

  useEffect(() => { load(); }, [load]);

  // 新建且未被修改的 SKU：离开详情页时自动删除，避免留下空的 firm.skus 记录
  useEffect(() => {
    return () => {
      if (!skuId || !isNewSku || hasTouchedRef.current) return;
      deleteFirmSku(skuId as string);
    };
  }, [skuId, isNewSku]);

  // ─────────────── Info: save ───────────────
  const handleSaveInfo = useCallback(async () => {
    if (!skuId) return;
    setSaving(true);
    const pendingTag = tagInput.trim();
    const trimmedTags = Array.from(
      new Set([
        ...editTags.map((t) => t.trim()).filter((t) => t.length > 0),
        ...(pendingTag ? [pendingTag] : []),
      ]),
    );
    const { error: err } = await updateFirmSku(skuId, {
      name: editName.trim() || sku?.name,
      description: editDesc.trim() || null,
      imageUrl: editImageUrl,
      templateStatus: editStatus,
      taxCountry: editTaxCountry || null,
      taxScenario: editTaxScenario || null,
      tags: trimmedTags,
    });
    setSaving(false);
    if (err) { showToast('Failed to save', 'error'); return; }
    if (pendingTag) {
      setCustomLabelOptions((prev) => (prev.includes(pendingTag) ? prev : [...prev, pendingTag]));
      setTagInput('');
    }
    markTouched();
    showToast('Saved', 'success');
    setInfoEditing(false);
    await load();
  }, [skuId, editName, editDesc, editImageUrl, editTaxCountry, editTaxScenario, editStatus, editTags, tagInput, sku?.name, load]);

  const handleCancelEdit = useCallback(() => {
    if (sku) resetDraft(sku);
    setInfoEditing(false);
  }, [sku]);

  // ─────────────── Info: cover ───────────────
  const handlePickImage = useCallback(async () => {
    if (!infoEditing) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { showToast('Need photo library access', 'info'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 2],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0] || !skuId) return;
    setUploading(true);
    try {
      const url = await uploadFirmSkuImage(result.assets[0].uri, skuId);
      const { error: err } = await updateFirmSku(skuId, { imageUrl: url });
      if (err) throw err;
      setEditImageUrl(url);
      markTouched();
      showToast('Cover updated', 'success');
    } catch {
      showToast('Failed to upload cover', 'error');
    } finally {
      setUploading(false);
    }
  }, [skuId, infoEditing]);

  // ─────────────── Info: delete SKU ───────────────
  const handleDeleteSku = useCallback(() => {
    if (!skuId) return;
    showConfirmDestructiveDialog(
      'Delete Service Template',
      'Delete this Service Template and all its checklist items? This cannot be undone.',
      async () => {
        markTouched();
        await deleteFirmSku(skuId as string);
        showToast('Service Template deleted', 'success');
        router.back();
      },
      { confirmLabel: 'Delete' },
    );
  }, [skuId, router, markTouched]);

  // ─────────────── WBS: dependency（与 TaxFilingTodosView 浮窗一致：多选 dependsOnIds → firm.sku_items.depends_on_ids） ───────────────
  const onCatalogSetDependsOn = useCallback(
    async (itemId: string, dependsOnIds: string[] | null) => {
      const ids = dependsOnIds?.length ? dependsOnIds : [];
      setItems((prev) =>
        prev.map((it) =>
          it.id === itemId
            ? { ...it, dependsOnId: ids[0] ?? null, dependsOnIds: ids }
            : it,
        ),
      );
      const { error } = await updateSkuItemDependsOn(itemId, dependsOnIds);
      if (error) {
        showToast('Failed to update dependency', 'error');
        await load();
        return { error };
      }
      markTouched();
      return { error: null };
    },
    [load, markTouched],
  );

  // ─────────────── guards ───────────────
  if (loading) return <View style={s.centered}><ActivityIndicator size="large" color="#6C5CE7" /></View>;
  if (error || !sku) {
    return (
      <View style={s.centered}>
        <Text style={s.errorText}>{error ?? 'Not found'}</Text>
        <TouchableOpacity style={s.backBtnFull} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color="#6C5CE7" />
          <Text style={s.backBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────
  const displayName = infoEditing ? editName : (sku.name ?? '—');

  // 右侧 op row：Info 复用项目详情（Edit info 按钮 / Cancel+Save）；Todos 无编辑 icon，列表变化时仅显示 Refresh（立即写库，一键重新拉取服务器状态）
  const opContextArea =
    activeTab === 'todos' ? (
      todosDirty ? (
        <View style={s.operationEditGroup}>
          <TouchableOpacity
            style={[s.operationBtn, s.operationBtnSmall]}
            onPress={async () => { await load(); setTodosDirty(false); }}
            activeOpacity={0.7}
          >
            <Text style={s.operationBtnText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      ) : null
    ) : activeTab === 'info' && infoEditing ? (
      <View style={s.editActions}>
        <TouchableOpacity style={s.cancelBtn} onPress={handleCancelEdit} activeOpacity={0.7}>
          <Text style={s.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.saveBtn, saving && s.saveBtnDisabled]}
          onPress={handleSaveInfo}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={s.saveBtnText}>Save</Text>}
        </TouchableOpacity>
      </View>
    ) : activeTab === 'info' ? (
      <TouchableOpacity
        style={[s.operationBtn, s.operationBtnRight]}
        onPress={() => setInfoEditing(true)}
        activeOpacity={0.7}
      >
        <Ionicons name="create-outline" size={16} color="#6C5CE7" />
        <Text style={s.operationBtnText}>Edit info</Text>
      </TouchableOpacity>
    ) : null;

  // ─────────────────────────────────────────
  // Info Tab Content
  // ─────────────────────────────────────────
  const infoContent = (
    <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>

      {/* ══ Card 1 — Hero ══ */}
      <View style={s.card}>
        <View style={s.heroRow}>
          {/* 封面 */}
          <TouchableOpacity
            style={s.coverWrap}
            onPress={handlePickImage}
            activeOpacity={infoEditing ? 0.8 : 1}
            disabled={!infoEditing}
          >
            {editImageUrl
              ? <Image source={{ uri: editImageUrl }} style={s.coverImg} resizeMode="cover" />
              : <View style={s.coverPlaceholder}>
                  {uploading
                    ? <ActivityIndicator size="small" color="#6C5CE7" />
                    : <Ionicons name="image-outline" size={30} color="#BDC3C7" />}
                </View>}
            {infoEditing && !uploading && (
              <View style={s.coverOverlay as any}>
                <Ionicons name="camera" size={20} color="#fff" />
              </View>
            )}
            {uploading && (
              <View style={s.coverOverlay as any}>
                <ActivityIndicator size="large" color="#fff" />
              </View>
            )}
          </TouchableOpacity>

          {/* 名称 + 描述 */}
          <View style={s.heroMeta}>
            {infoEditing
              ? <TextInput
                  style={s.nameInput}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Service name"
                  placeholderTextColor="#B2BEC3"
                />
              : <Text style={s.nameText} numberOfLines={3}>{sku.name ?? '—'}</Text>}

            {infoEditing
              ? <TextInput
                  style={s.descInput}
                  value={editDesc}
                  onChangeText={setEditDesc}
                  placeholder="Brief description…"
                  placeholderTextColor="#B2BEC3"
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              : sku.description
                  ? <Text style={s.descText} numberOfLines={5}>{sku.description}</Text>
                  : <Text style={s.descEmpty}>No description</Text>}
          </View>
        </View>
      </View>

      {/* ══ Card 2 — Classification ══ */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Classification</Text>

        {/* Jurisdiction */}
        <View style={s.cfRow}>
          <View style={s.cfTagCol}><Text style={s.cfLabel}>Jurisdiction</Text></View>
          <View style={s.cfValueCol}>
            {infoEditing ? (
              <View style={s.optionRow}>
                {TAX_COUNTRY_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value || '_c'}
                    style={[s.optChip, editTaxCountry === opt.value && s.optChipActive]}
                    onPress={() => setEditTaxCountry(opt.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.optChipText, editTaxCountry === opt.value && s.optChipTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : sku.taxCountry ? (() => {
              const [bg, fg] = getTagColor(sku.taxCountry);
              return <View style={[s.valueTagPill, { backgroundColor: bg }]}><Text style={[s.valueTagText, { color: fg }]}>{sku.taxCountry}</Text></View>;
            })() : <Text style={s.cfEmptyTag}>—</Text>}
          </View>
        </View>

        <View style={s.divider} />

        {/* Scenario */}
        <View style={s.cfRow}>
          <View style={s.cfTagCol}><Text style={s.cfLabel}>Scenario</Text></View>
          <View style={s.cfValueCol}>
            {infoEditing ? (
              <View style={s.optionRow}>
                {TAX_SCENARIO_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value || '_s'}
                    style={[s.optChip, editTaxScenario === opt.value && s.optChipActive]}
                    onPress={() => setEditTaxScenario(opt.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.optChipText, editTaxScenario === opt.value && s.optChipTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : sku.taxScenario ? (() => {
              const [bg, fg] = getTagColor(sku.taxScenario);
              return <View style={[s.valueTagPill, { backgroundColor: bg }]}><Text style={[s.valueTagText, { color: fg }]}>{sku.taxScenario}</Text></View>;
            })() : <Text style={s.cfEmptyTag}>—</Text>}
          </View>
        </View>

        <View style={s.divider} />

        {/* Custom labels — firm label library + free-text add (syncs firm.skus.tags + custom_label_ids) */}
        <View style={s.cfRow}>
          <View style={s.cfTagCol}><Text style={s.cfLabel}>Custom labels</Text></View>
          <View style={[s.cfValueCol, { gap: 8 }]}>
            {!infoEditing ? (
              <View style={s.tagsRow}>
                {sku.tags && sku.tags.length > 0 ? (
                  sku.tags.map((t) => {
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
            ) : (
              <View style={s.tagsRow}>
                {(customLabelOptions.length > 0 ? customLabelOptions : editTags).map((t) => {
                  const isSelected = editTags.includes(t);
                  const [bg, fg] = getTagColor(t);
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[s.tagPill, isSelected && { backgroundColor: bg, borderColor: 'transparent' }]}
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
                    placeholder="Add label"
                    placeholderTextColor="#B2BEC3"
                    onSubmitEditing={addCustomLabelTag}
                    returnKeyType="done"
                    blurOnSubmit={false}
                  />
                  <TouchableOpacity onPress={addCustomLabelTag} activeOpacity={0.7} hitSlop={6}>
                    <Text style={s.tagPillText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>

      </View>

      {/* ══ Card 3 — Publishing ══ */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Publishing</Text>

        {/* Status — 编辑时三态可选，保存后生效 */}
        <View style={s.cfRow}>
          <View style={s.cfTagCol}><Text style={s.cfLabel}>Status</Text></View>
          <View style={s.cfValueCol}>
            {infoEditing ? (
              <View style={s.statusPillsRow}>
                {(['draft', 'private', 'published'] as const).map((status) => (
                  <TouchableOpacity
                    key={status}
                    style={[
                      s.statusPill,
                      editStatus === status && s.statusPillActive,
                      editStatus === status && status === 'draft' && s.statusPillDraft,
                      editStatus === status && status === 'private' && s.statusPillPrivate,
                      editStatus === status && status === 'published' && s.statusPillPublished,
                    ]}
                    onPress={() => setEditStatus(status)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        s.statusPillText,
                        editStatus === status && s.statusPillTextActive,
                        editStatus === status && status === 'draft' && s.statusPillTextDraft,
                        editStatus === status && status === 'private' && s.statusPillTextPrivate,
                        editStatus === status && status === 'published' && s.statusPillTextPublished,
                      ]}
                    >
                      {status === 'draft' ? 'Draft' : status === 'private' ? 'Private' : 'Published'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              (() => {
                let label = 'Draft';
                let bg = '#F0F2F5';
                let color = '#636E72';
                if (sku.templateStatus === 'published' || sku.templateStatus === 'private' || sku.templateStatus === 'draft') {
                  label = sku.templateStatus === 'published' ? 'Published' : sku.templateStatus === 'private' ? 'Private' : 'Draft';
                  if (label === 'Published') { bg = '#E8F5E9'; color = '#27AE60'; }
                  else if (label === 'Private') { bg = '#E3F2FD'; color = '#1E88E5'; }
                } else {
                  const hasSetup = !!sku.taxCountry || !!sku.taxScenario;
                  if (sku.isPublished) {
                    label = 'Published';
                    bg = '#E8F5E9';
                    color = '#27AE60';
                  } else if (hasSetup) {
                    label = 'Private';
                    bg = '#E3F2FD';
                    color = '#1E88E5';
                  }
                }
                return (
                  <View style={[s.valueTagPill, { backgroundColor: bg }]}>
                    <Text style={[s.valueTagText, { color }]}>{label}</Text>
                  </View>
                );
              })()
            )}
          </View>
        </View>

        <View style={s.divider} />

        {/* Provider note (placeholder) */}
        <View style={s.cfRow}>
          <View style={s.cfTagCol}><Text style={s.cfLabel}>Provider note</Text></View>
          <View style={s.cfValueCol}>
            <Text style={s.publishingSecondaryText}>
              Coming soon: add richer provider profile and notes for this service.
            </Text>
          </View>
        </View>

        <View style={s.divider} />

        {/* Marketplace usage (placeholder) */}
        <View style={s.cfRow}>
          <View style={s.cfTagCol}><Text style={s.cfLabel}>Marketplace usage</Text></View>
          <View style={s.cfValueCol}>
            <Text style={s.publishingSecondaryText}>
              Used by 0 clients (coming soon).
            </Text>
          </View>
        </View>
      </View>

      {/* ══ Danger zone — Delete Service Template ══ */}
      <View style={s.dangerCard}>
        <Text style={s.dangerTitle}>Danger zone</Text>
        <Text style={s.dangerDesc}>
          Deleting this Service Template will remove it from your Service Catalog.
          Checklist items linked to it will also be removed.
        </Text>
        <TouchableOpacity
          style={s.deleteSkuBtn}
          onPress={handleDeleteSku}
          activeOpacity={0.8}
        >
          <Ionicons name="trash-outline" size={16} color="#fff" />
          <Text style={s.deleteSkuBtnText}>Delete Service Template</Text>
        </TouchableOpacity>
      </View>

    </ScrollView>
  );

  // ─────────────────────────────────────────
  // Full Render
  // ─────────────────────────────────────────
  return (
    <View style={s.container}>

      {/* ── 顶行（无右侧切换 icon，与项目详情一致）── */}
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} activeOpacity={0.7} style={s.backIcon}>
          <Ionicons name="arrow-back" size={22} color="#2D3436" />
        </TouchableOpacity>
        <Text style={s.topTitle} numberOfLines={1}>{displayName}</Text>
      </View>

      {/* ── Op row（项目详情式分段页签 + 上下文操作）── */}
      <View style={s.opRow}>
        <View style={s.tabGroup}>
          <TouchableOpacity
            style={[s.tabChip, activeTab === 'todos' && s.tabChipActive]}
            onPress={() => { setActiveTab('todos'); setInfoEditing(false); }}
            activeOpacity={0.8}
          >
            <Text style={[s.tabChipText, activeTab === 'todos' && s.tabChipTextActive]}>Todos</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tabChip, activeTab === 'info' && s.tabChipActive]}
            onPress={() => setActiveTab('info')}
            activeOpacity={0.8}
          >
            <Text style={[s.tabChipText, activeTab === 'info' && s.tabChipTextActive]}>Info</Text>
          </TouchableOpacity>
        </View>
        {opContextArea}
      </View>

      {/* ── Content ── */}
      {activeTab === 'todos' ? (
        <TaxFilingTodosView
          tree={skuItemsToProjectTodoTree(items)}
          viewerRole="firm"
          onRefresh={async () => { await load(); setTodosDirty(false); }}
          onTodoTreeOrderSaved={() => {}}
          createProjectTodo={async (params) => {
            const parentId = params.parentId ?? null;
            const { id, error: err } = await createSkuItem({
              skuId: skuId!,
              parentId,
              itemKind: params.itemKind ?? 'task',
              type: params.type,
              title: params.title,
            });
            if (err) return { id: null, error: new Error(err.message) };
            setItems((prev) => {
              const nextSort = prev.filter((it) => (it.parentId ?? null) === parentId).reduce((a, it) => Math.max(a, it.sortOrder), -1) + 1;
              return [
                ...prev,
                {
                  id: id!,
                  skuId: skuId!,
                  parentId,
                  itemKind: (params.itemKind ?? 'task') as FirmSkuItem['itemKind'],
                  type: params.type,
                  title: params.title,
                  description: null,
                  sortOrder: nextSort,
                } as FirmSkuItem,
              ];
            });
            setTodosDirty(true);
            markTouched();
            return { id, error: null };
          }}
          onAddPhase={undefined}
          catalogMode
          onCatalogDeleteItem={(itemId) => {
            showConfirmDestructiveDialog(
              'Delete item',
              'Delete this item? This cannot be undone.',
              async () => {
                const { error: err } = await deleteSkuItem(itemId);
                if (err) { showToast('Failed to delete', 'error'); return; }
                setItems((prev) => prev.filter((it) => it.id !== itemId));
                setTodosDirty(true);
                markTouched();
              },
              { confirmLabel: 'Delete' }
            );
          }}
          onCatalogUpdateType={async (itemId, type) => {
            setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, type } : it)));
            setTodosDirty(true);
            const { error: err } = await updateSkuItem(itemId, { type });
            if (err) { showToast('Failed to update', 'error'); await load(); return; }
            markTouched();
          }}
          onCatalogSetDependsOn={onCatalogSetDependsOn}
          onRequestDeletePhase={(phaseId, _phaseTitle) => {
            showConfirmDestructiveDialog(
              'Delete phase',
              'Delete this phase and all its sections and tasks? This cannot be undone.',
              async () => {
                const idsToDelete = collectIdsPostOrder(items, phaseId);
                for (const id of idsToDelete) {
                  const { error: err } = await deleteSkuItem(id);
                  if (err) { showToast('Failed to delete', 'error'); await load(); return; }
                }
                setItems((prev) => prev.filter((it) => !idsToDelete.includes(it.id)));
                setTodosDirty(true);
                markTouched();
              },
              { confirmLabel: 'Delete' }
            );
          }}
          persistTodoTreeOrder={
            Platform.OS === 'web' && skuId
              ? async (roots) => {
                  const { error } = await applySkuItemsTreeOrder(skuId as string, roots);
                  if (!error) {
                    setItems((prev) => {
                      const byId = new Map(prev.map((it) => [it.id, it]));
                      const next: FirmSkuItem[] = [];
                      const walk = (nodes: ProjectTodoNode[], parentId: string | null) => {
                        nodes.forEach((n, idx) => {
                          const base = byId.get(n.id);
                          if (base) {
                            next.push({ ...base, parentId, sortOrder: idx + 1 });
                            walk(n.children, n.id);
                          }
                        });
                      };
                      walk(roots, null);
                      return next;
                    });
                    setTodosDirty(true);
                    markTouched();
                  }
                  return { error };
                }
              : undefined
          }
          onPersistTodoTitle={
            Platform.OS === 'web'
              ? async (itemId, title) => updateSkuItem(itemId, { title })
              : undefined
          }
        />
      ) : infoContent}

    </View>
  );
}

// ─────────────────────────────────────────
// Styles
// ─────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  centered:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { fontSize: 15, color: '#636E72', marginBottom: 16 },

  // ── 顶行 ──
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 20,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E9ECEF',
    gap: 8,
  },
  backIcon:     { padding: 4 },
  topTitle:     { flex: 1, fontSize: 16, fontWeight: '700', color: '#2D3436', minWidth: 0 },

  // ── Op row（与项目详情一致：灰底分段 + 白 pill 选中）──
  opRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E9ECEF',
    gap: 10,
  },
  tabGroup: {
    flexDirection: 'row',
    backgroundColor: '#F0F2F5',
    borderRadius: 8,
    padding: 3,
    gap: 2,
  },
  tabChip: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 6 },
  tabChipActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  tabChipText: { fontSize: 13, fontWeight: '600', color: '#95A5A6' },
  tabChipTextActive: { color: '#2D3436' },

  // ── Op context（复用项目详情：Edit info 按钮 + Cancel/Save；Todos 为取消/保持）──
  operationBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, backgroundColor: '#F8F9FA',
    gap: 5,
  },
  operationBtnRight: { marginLeft: 'auto' as any },
  operationBtnText: { fontSize: 13, color: '#6C5CE7', fontWeight: '500' },
  operationEditGroup: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' as any },
  operationBtnSmall: { paddingHorizontal: 10, paddingVertical: 6 },
  operationBtnPrimary: { backgroundColor: '#6C5CE7' },
  editIconBtn: { marginLeft: 'auto' as any, padding: 4 },
  editActions: { marginLeft: 'auto' as any, flexDirection: 'row', gap: 8 },
  cancelBtn:   { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: '#F0F2F5' },
  cancelBtnText: { fontSize: 13, fontWeight: '500', color: '#636E72' },
  saveBtn:      { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20, backgroundColor: '#6C5CE7' },
  saveBtnText:  { fontSize: 13, fontWeight: '700', color: '#fff' },
  saveBtnDisabled: { opacity: 0.5 },

  backBtnFull:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 16 },
  backBtnText:  { fontSize: 16, color: '#6C5CE7', fontWeight: '500' },

  // ── Info scroll ──
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48, gap: 12 },

  // ── 通用卡片（与 info.tsx 完全对齐）──
  card: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DEE2E6',
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  cardTitle: {
    fontSize: 11, fontWeight: '700', color: '#95A5A6',
    textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 10,
  },

  // ── Card 1: Hero ──
  heroRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginBottom: 8 },
  coverWrap: {
    width: COVER_H, height: COVER_H,
    borderRadius: 10, backgroundColor: '#E9ECEF',
    overflow: 'hidden', flexShrink: 0,
  },
  coverImg: { width: COVER_H, height: COVER_H },
  coverPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.38)',
    justifyContent: 'center', alignItems: 'center',
  },
  heroMeta: { flex: 1, gap: 6, paddingTop: 2 },
  nameText:  { fontSize: 17, fontWeight: '700', color: '#2D3436', lineHeight: 23 },
  nameInput: {
    fontSize: 16, fontWeight: '600', color: '#2D3436',
    borderWidth: 1, borderColor: '#6C5CE7', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 7,
    backgroundColor: '#fff', lineHeight: 22,
  },
  descText:  { fontSize: 13, color: '#636E72', lineHeight: 19 },
  descEmpty: { fontSize: 13, color: '#B2BEC3', fontStyle: 'italic' },
  descInput: {
    fontSize: 13, color: '#2D3436',
    borderWidth: 1, borderColor: '#6C5CE7', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 7,
    backgroundColor: '#fff', minHeight: 60, lineHeight: 19,
  },

  // ── Card 2: Classification（与 info.tsx 完全一致）──
  cfRow: {
    flexDirection: 'row', alignItems: 'center',
    minHeight: 44, paddingHorizontal: 4, gap: 16,
  },
  cfTagCol: { width: 90, alignItems: 'flex-end', justifyContent: 'center', flexShrink: 0 },
  cfLabel:  { fontSize: 13, fontWeight: '500', color: '#636E72' },
  cfEmptyTag: { fontSize: 13, color: '#B2BEC3' },
  cfValueCol: { flex: 1, alignItems: 'flex-start', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E9ECEF' },

  valueTagPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  valueTagText: { fontSize: 12, fontWeight: '600' },
  publishingSecondaryText: { fontSize: 12, color: '#636E72' },

  optionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  optChip: {
    paddingVertical: 4, paddingHorizontal: 10, borderRadius: 20,
    borderWidth: 1, borderColor: '#DFE6E9', backgroundColor: '#F8F9FA',
  },
  optChipActive: { borderColor: '#6C5CE7', backgroundColor: '#EDE9FD' },
  optChipText: { fontSize: 12, color: '#636E72', fontWeight: '500' },
  optChipTextActive: { color: '#6C5CE7', fontWeight: '700' },

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
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as const, outlineWidth: 0 } : {}),
  },

  publishedToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
    backgroundColor: '#F0F2F5',
  },
  publishedToggleActive: { backgroundColor: '#00B894' },
  publishedToggleText: { fontSize: 12, fontWeight: '600', color: '#636E72' },
  publishedToggleTextActive: { color: '#fff' },

  statusPillsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  statusPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: '#F0F2F5',
    borderWidth: 1,
    borderColor: '#DFE6E9',
  },
  statusPillActive: { borderWidth: 1.5 },
  statusPillDraft: { backgroundColor: '#F0F2F5', borderColor: '#636E72' },
  statusPillPrivate: { backgroundColor: '#E3F2FD', borderColor: '#1E88E5' },
  statusPillPublished: { backgroundColor: '#E8F5E9', borderColor: '#27AE60' },
  statusPillText: { fontSize: 12, fontWeight: '600', color: '#636E72' },
  statusPillTextActive: {},
  statusPillTextDraft: { color: '#2D3436' },
  statusPillTextPrivate: { color: '#1E88E5' },
  statusPillTextPublished: { color: '#27AE60' },

  // ── Danger zone ──
  dangerCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FEF5F5',
    borderWidth: 1,
    borderColor: '#F8D7DA',
    gap: 8,
  },
  dangerTitle: { fontSize: 14, fontWeight: '600', color: '#C0392B' },
  dangerDesc: { fontSize: 12, color: '#7F8C8D' },
  deleteSkuBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#E74C3C',
  },
  deleteSkuBtnText: { fontSize: 13, fontWeight: '600', color: '#fff' },
});
