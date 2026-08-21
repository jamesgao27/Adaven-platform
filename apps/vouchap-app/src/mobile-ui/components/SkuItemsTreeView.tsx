/**
 * SkuItemsTreeView — SKU 模板的 WBS 树形编辑器
 *
 * 细节样式以 client 端 project-todos（TaxFilingTodosView，tax-filing/project/[projectId]）为基准，
 * 与之一致的部分：行高、列宽、字体、圆角、间距、斑马色、phase 块、PendingAddRow 结构及图标。
 *
 * 列结构对齐：无 progress/status 两列，用 Kind 列（= roleCol）、Type 列（= statusCol）+ 尾部列（After row + 删除）。
 * 功能差异：无状态/文件计数；行内编辑 title；Kind/Type/依赖/删除为 SKU 独有。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Pressable,
  Alert, Platform, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FirmSkuItem } from '@/types';

// ─────────────────────────────────────────
// 常量
// ─────────────────────────────────────────
const TREE_ROW_BG_EVEN = '#FFFFFF';
const TREE_ROW_BG_ODD  = '#F8F9FA';
const ADD_ICON_SLOT_WIDTH = 24;

const KIND_COLOR: Record<string, { bg: string; text: string }> = {
  phase:   { bg: '#EDE9FD', text: '#6C5CE7' },
  section: { bg: '#E3F2FD', text: '#1E88E5' },
  task:    { bg: '#E8F5E9', text: '#27AE60' },
};
const TYPE_COLOR: Record<string, { bg: string; text: string }> = {
  client: { bg: '#FFF3E0', text: '#E67E22' },
  firm:   { bg: '#EDE9FD', text: '#6C5CE7' },
};

// ─────────────────────────────────────────
// buildTree & buildWbsMap
// ─────────────────────────────────────────
export interface SkuTreeNode {
  item: FirmSkuItem;
  wbsCode: string;
  depth: number;
  children: SkuTreeNode[];
}

function buildSkuTree(items: FirmSkuItem[]): SkuTreeNode[] {
  const childrenOf = new Map<string | null, FirmSkuItem[]>();
  items.forEach((it) => {
    const k = it.parentId ?? null;
    if (!childrenOf.has(k)) childrenOf.set(k, []);
    childrenOf.get(k)!.push(it);
  });
  childrenOf.forEach((arr) => arr.sort((a, b) => a.sortOrder - b.sortOrder));

  function build(parentId: string | null, depth: number, prefix: string): SkuTreeNode[] {
    return (childrenOf.get(parentId) ?? []).map((item, idx) => {
      const wbsCode = prefix ? `${prefix}.${idx + 1}` : `${idx + 1}`;
      return { item, wbsCode, depth, children: build(item.id, depth + 1, wbsCode) };
    });
  }
  return build(null, 0, '');
}

function flattenSkuTree(nodes: SkuTreeNode[]): SkuTreeNode[] {
  const result: SkuTreeNode[] = [];
  function walk(list: SkuTreeNode[]) {
    list.forEach((n) => { result.push(n); walk(n.children); });
  }
  walk(nodes);
  return result;
}

// ─────────────────────────────────────────
// PendingAddRow（与 TaxFilingTodosView 同结构）
// ─────────────────────────────────────────
function PendingAddRow({
  depth, wbsCode, rowBg, maxLeftBlockWidth, onConfirm, onCancel,
}: {
  depth: number; wbsCode: string; rowBg: string;
  maxLeftBlockWidth: number;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState('');
  const indent = depth * 14;
  // 与 client 端 project-todos 的 PendingAddRow 一致：仅左侧一块，无右侧列，图标与 placeholder 同
  return (
    <View style={ts.treeRowWrap}>
      <View style={[ts.treeRow, ts.pendingAddRow, { backgroundColor: rowBg }]}>
        <View style={[ts.treeRowLeftBlock, { width: maxLeftBlockWidth }]}>
          <View style={{ width: 12 + indent }} />
          <View style={ts.chevronWrap} />
          <View style={ts.wbsHotzone}>
            <Text style={ts.wbsColText}>{wbsCode}</Text>
          </View>
          <View style={ts.pendingAddInputRow}>
            <TextInput
              style={ts.pendingAddInput}
              value={val}
              onChangeText={setVal}
              placeholder="New item name"
              placeholderTextColor="#95A5A6"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => { if (val.trim()) onConfirm(val.trim()); }}
            />
            <Pressable style={ts.cancelAddBtn} onPress={onCancel} hitSlop={8}>
              <Ionicons name="close-outline" size={16} color="#95A5A6" />
            </Pressable>
            <Pressable style={ts.confirmAddBtn} onPress={() => { if (val.trim()) onConfirm(val.trim()); }} hitSlop={8}>
              <Ionicons name="checkmark-outline" size={16} color="#6C5CE7" />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────
// SkuRow — 单行渲染
// ─────────────────────────────────────────
function SkuRow({
  node, collapsed, maxLeftBlockWidth,
  rowBg,
  wbsToIdMap, idToWbsMap,
  pendingParentId,
  rowIdShowingAdd, setRowIdShowingAdd,
  hideAddTimeoutRef,
  onToggleCollapse, onStartAdd, onConfirmAdd, onCancelAdd,
  onEditTitle, onEditKind, onEditType, onSetDependsOn, onDelete,
}: {
  node: SkuTreeNode;
  collapsed: Set<string>;
  maxLeftBlockWidth: number;
   /** 当前行背景色（斑马色由调用方传入） */
  rowBg: string;
  wbsToIdMap: Map<string, string>;
  idToWbsMap: Map<string, string>;
  pendingParentId: string | null;
  rowIdShowingAdd: string | null;
  setRowIdShowingAdd: (id: string | null) => void;
  hideAddTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  onToggleCollapse: (id: string) => void;
  onStartAdd: (parentId: string) => void;
  onConfirmAdd: (parentId: string, title: string) => void;
  onCancelAdd: () => void;
  onEditTitle: (id: string, title: string) => void;
  onEditKind: (id: string, kind: 'phase' | 'section' | 'task') => void;
  onEditType: (id: string, type: 'client' | 'firm') => void;
  onSetDependsOn: (id: string, dependsOnId: string | null) => void;
  onDelete: (id: string) => void;
}) {
  const { item, wbsCode, depth, children } = node;
  const indent = depth * 14;
  const isCollapsed = collapsed.has(item.id);
  const hasChildren = children.length > 0;
  const isTask = item.itemKind === 'task';
  const kindColors = KIND_COLOR[item.itemKind] ?? KIND_COLOR.task;
  const side = item.type ?? 'client';
  const typeColors = TYPE_COLOR[side] ?? TYPE_COLOR.client;

  // 依赖行号
  const currentDepsWbs = item.dependsOnId ? (idToWbsMap.get(item.dependsOnId) ?? '') : '';
  const [depsInput, setDepsInput] = useState(currentDepsWbs);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(item.title);
  const showAddIcon = !isTask && rowIdShowingAdd === item.id;

  const handleTitleBlur = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== item.title) onEditTitle(item.id, trimmed);
    else setTitleDraft(item.title);
  };

  const handleDepsBlur = () => {
    const raw = depsInput.trim();
    // 清空 = 取消前置
    if (!raw) {
      if (item.dependsOnId) onSetDependsOn(item.id, null);
      return;
    }
    const targetId = wbsToIdMap.get(raw);
    if (!targetId) {
      const msg = `Row "${raw}" not found`;
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Invalid row', msg);
      // 回滚为当前有效值
      setDepsInput(currentDepsWbs);
      return;
    }
    if (targetId === item.id) {
      const msg = 'Cannot depend on itself';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Invalid row', msg);
      setDepsInput(currentDepsWbs);
      return;
    }
    if (targetId !== item.dependsOnId) onSetDependsOn(item.id, targetId);
  };

  const showRowIconsOnTouchStart = setRowIdShowingAdd
    ? () => {
        if (hideAddTimeoutRef.current) { clearTimeout(hideAddTimeoutRef.current); hideAddTimeoutRef.current = null; }
        setRowIdShowingAdd(item.id);
      }
    : undefined;
  const showRowIconsOnTouchEnd = hideAddTimeoutRef
    ? () => {
        hideAddTimeoutRef.current = setTimeout(() => setRowIdShowingAdd(null), 1200);
      }
    : undefined;

  const addHandlers = {
    onTouchStart: showRowIconsOnTouchStart, onTouchEnd: showRowIconsOnTouchEnd,
    onMouseDown: showRowIconsOnTouchStart, onMouseUp: showRowIconsOnTouchEnd,
    onMouseEnter: showRowIconsOnTouchStart, onMouseLeave: showRowIconsOnTouchEnd,
  };

  const titleStyle = depth === 0 ? ts.treeTitleL0 : depth === 1 ? ts.treeTitleL1 : ts.treeTitleL2;

  const rowContainerStyle = [
    ts.treeRow,
    { backgroundColor: rowBg },
    item.itemKind === 'section' && { borderTopWidth: 1, borderTopColor: '#E9ECEF' },
  ];

  const titleCell = editingTitle ? (
    <TextInput
      style={[ts.treeTitleAdaptive, titleStyle, ts.titleInlineInput]}
      value={titleDraft}
      onChangeText={setTitleDraft}
      onBlur={handleTitleBlur}
      autoFocus
      returnKeyType="done"
      onSubmitEditing={handleTitleBlur}
    />
  ) : (
    <TouchableOpacity
      style={ts.titleHotzone}
      onPress={() => { setTitleDraft(item.title); setEditingTitle(true); }}
      activeOpacity={0.7}
    >
      <View style={ts.treeTitleWrapAdaptive}>
        <Text style={[ts.treeTitleAdaptive, titleStyle]} numberOfLines={1}>{item.title}</Text>
      </View>
    </TouchableOpacity>
  );

  // Kind / Type：Kind 仍用选单，责任方（Type）点击循环切换（与 todos 的 role/status 列一致：点击弹出选项）
  const openKindPicker = () => {
    Alert.alert(
      'Kind',
      undefined,
      (['phase', 'section', 'task'] as const).map((k) => ({
        text: k,
        onPress: () => onEditKind(item.id, k),
      })),
    );
  };

  // 责任方：点击循环切换 client ↔ firm，无需浮层/选单
  const cycleType = () => {
    const next = (side === 'client' ? 'firm' : 'client') as 'client' | 'firm';
    onEditType(item.id, next);
  };

  // 与 TaxFilingTodosView 完全一致的列结构：无 progress/status，Kind 列 = roleCol，Type 列 = statusCol，尾部 = deps + delete
  const progressPlaceholder = <View style={ts.progressPlaceholder} />;
  const kindColContent = (
    <Pressable style={ts.kindCol} onPress={openKindPicker}>
      <View style={[ts.kindPill, { backgroundColor: kindColors.bg }]}>
        <Text style={[ts.kindPillText, { color: kindColors.text }]}>{item.itemKind}</Text>
      </View>
    </Pressable>
  );
  const typeColContent = (
    <Pressable style={ts.typeCol} onPress={cycleType}>
      <View style={[ts.typePill, { backgroundColor: typeColors.bg }]}>
        <Text style={[ts.typePillText, { color: typeColors.text }]} numberOfLines={1}>{side}</Text>
      </View>
    </Pressable>
  );
  // phase/section：左侧与 add 同区显示 - 标（删除）；task：尾部用 - 标删除（非 cancel）
  const deleteMinusIcon = (
    <TouchableOpacity
      style={ts.deletePhaseIconWrap}
      onPress={() => onDelete(item.id)}
      activeOpacity={0.6}
      hitSlop={8}
    >
      <View style={ts.deletePhaseIconBtn}>
        <Ionicons name="remove" size={8} color="#FFF" />
      </View>
    </TouchableOpacity>
  );
  const addIconSlotContent = !isTask ? (
    <View style={[ts.addIconSlot, { width: ADD_ICON_SLOT_WIDTH }]} pointerEvents="box-none">
      <View style={ts.addAndDeleteRow}>
        {showAddIcon ? (
          <Pressable onPress={() => onStartAdd(item.id)} style={{ padding: 2 }}>
            <Ionicons name="add-circle" size={18} color="#6C5CE7" />
          </Pressable>
        ) : null}
        {deleteMinusIcon}
      </View>
    </View>
  ) : null;
  // SKU 详情：Depends on 入口常显，不需触摸即显示（phase/section/task 一致，有无关联均可编辑）
  const trailingColContent = (
    <View style={ts.trailingCol}>
      <View style={ts.depsInlineWrap}>
        <Ionicons name="return-down-forward-outline" size={10} color="#6C5CE7" />
        <TextInput
          style={ts.depsInputField}
          value={depsInput}
          onChangeText={setDepsInput}
          onBlur={handleDepsBlur}
          placeholder="—"
          placeholderTextColor="#B2BEC3"
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
        />
      </View>
      {isTask ? deleteMinusIcon : null}
    </View>
  );

  const rowContent = (
    <>
      <View style={[ts.treeRowLeftBlock, { width: maxLeftBlockWidth }]}>
        <View style={[ts.showAddTouchArea, { flexDirection: 'row', alignItems: 'center' }]} {...addHandlers}>
          <View style={{ width: 12 + indent }} />
          <View style={ts.chevronWrap}>
            {hasChildren ? (
              <TouchableOpacity onPress={() => onToggleCollapse(item.id)}>
                <Ionicons name={isCollapsed ? 'chevron-forward' : 'chevron-down'} size={14} color="#636E72" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
        <View style={ts.wbsHotzone}>
          <Text style={ts.wbsColText}>{wbsCode}</Text>
        </View>
        <View style={[ts.titleColumnWrap]}>
          {titleCell}
          {addIconSlotContent}
          <View style={ts.titleColumnTrailing} {...addHandlers} />
        </View>
      </View>
      {progressPlaceholder}
      {kindColContent}
      {typeColContent}
      {trailingColContent}
    </>
  );

  return (
    <View style={ts.treeRowWrap}>
      {/* ── 主行 ── */}
      <View style={rowContainerStyle}>
        <View style={[ts.rowShowAddWrap]} {...addHandlers}>
          <View style={ts.rowShowAddInner}>{rowContent}</View>
        </View>
      </View>

      {/* ── 子节点 ── */}
      {hasChildren && !isCollapsed && children.map((child, cidx) => {
        // 子节点斑马色：与当前行相反颜色起步，再在本组内部交替
        const firstChildBg = rowBg === TREE_ROW_BG_EVEN ? TREE_ROW_BG_ODD : TREE_ROW_BG_EVEN;
        const childRowBg = cidx % 2 === 0
          ? firstChildBg
          : (firstChildBg === TREE_ROW_BG_EVEN ? TREE_ROW_BG_ODD : TREE_ROW_BG_EVEN);
        return (
          <SkuRow
            key={child.item.id}
            node={child}
            collapsed={collapsed}
            maxLeftBlockWidth={maxLeftBlockWidth}
            rowBg={childRowBg}
            wbsToIdMap={wbsToIdMap}
            idToWbsMap={idToWbsMap}
            pendingParentId={pendingParentId}
            rowIdShowingAdd={rowIdShowingAdd}
            setRowIdShowingAdd={setRowIdShowingAdd}
            hideAddTimeoutRef={hideAddTimeoutRef}
            onToggleCollapse={onToggleCollapse}
            onStartAdd={onStartAdd}
            onConfirmAdd={onConfirmAdd}
            onCancelAdd={onCancelAdd}
            onEditTitle={onEditTitle}
            onEditKind={onEditKind}
            onEditType={onEditType}
            onSetDependsOn={onSetDependsOn}
            onDelete={onDelete}
          />
        );
      })}

      {/* ── PendingAddRow ── */}
      {pendingParentId === item.id && (
        <PendingAddRow
          depth={depth + 1}
          wbsCode={`${wbsCode}.${children.length + 1}`}
          rowBg={TREE_ROW_BG_ODD}
          maxLeftBlockWidth={maxLeftBlockWidth}
          onConfirm={(title) => onConfirmAdd(item.id, title)}
          onCancel={onCancelAdd}
        />
      )}
    </View>
  );
}

// ─────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────
export interface SkuItemsTreeViewProps {
  items: FirmSkuItem[];
  onEditTitle:    (id: string, title: string)    => void;
  onEditKind:     (id: string, kind: 'phase' | 'section' | 'task') => void;
  onEditType:     (id: string, type: 'client' | 'firm') => void;
  onSetDependsOn: (id: string, dependsOnId: string | null) => void;
  onDelete:       (id: string) => void;
  onAddChild:     (parentId: string, title: string, kind: 'phase' | 'section' | 'task') => void;
  onAddRoot:      (title: string) => void;
}

export function SkuItemsTreeView({
  items, onEditTitle, onEditKind, onEditType, onSetDependsOn, onDelete, onAddChild, onAddRoot,
}: SkuItemsTreeViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [rowIdShowingAdd, setRowIdShowingAdd] = useState<string | null>(null);
  const [pendingParentId, setPendingParentId] = useState<string | null>(null);
  const hideAddTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const phaseNodes = useMemo(() => buildSkuTree(items), [items]);
  const allFlat    = useMemo(() => flattenSkuTree(phaseNodes), [phaseNodes]);

  const wbsToIdMap = useMemo(() => {
    const m = new Map<string, string>();
    allFlat.forEach(({ item, wbsCode }) => m.set(wbsCode, item.id));
    return m;
  }, [allFlat]);

  const idToWbsMap = useMemo(() => {
    const m = new Map<string, string>();
    allFlat.forEach(({ item, wbsCode }) => m.set(item.id, wbsCode));
    return m;
  }, [allFlat]);

  const maxLeftBlockWidth = useMemo(() => {
    let maxW = 0;
    allFlat.forEach(({ item, depth }) => {
      const w = 12 + depth * 14 + 28 + 36 + (item.title?.length ?? 0) * 8 + 16;
      if (w > maxW) maxW = w;
    });
    const minW = 160;
    const cap = Math.floor(Dimensions.get('window').width * 0.82 - 32) - 52;
    return Math.min(Math.max(maxW, minW), cap);
  }, [allFlat]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleStartAdd = useCallback((parentId: string) => {
    if (hideAddTimeoutRef.current) { clearTimeout(hideAddTimeoutRef.current); hideAddTimeoutRef.current = null; }
    setRowIdShowingAdd(null);
    setPendingParentId(parentId);
  }, []);

  const handleConfirmAdd = useCallback((parentId: string, title: string) => {
    const parent = allFlat.find((n) => n.item.id === parentId);
    const parentKind = parent?.item.itemKind ?? 'phase';
    const childKind: 'phase' | 'section' | 'task' =
      parentKind === 'phase' ? 'section' : 'task';
    onAddChild(parentId, title, childKind);
    setPendingParentId(null);
    setCollapsed((prev) => { const next = new Set(prev); next.delete(parentId); return next; });
  }, [allFlat, onAddChild]);

  const handleCancelAdd = useCallback(() => setPendingParentId(null), []);

  if (phaseNodes.length === 0) {
    return (
      <View style={ts.emptyWrap}>
        <Text style={ts.emptyText}>No items yet. Add a phase to get started.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={ts.scroll} contentContainerStyle={ts.scrollContent}>
      <View style={ts.phaseBlocksWrap}>
        {phaseNodes.map((phaseNode, idx) => {
          const rowBg = idx % 2 === 0 ? TREE_ROW_BG_EVEN : TREE_ROW_BG_ODD;
          return (
            <View key={phaseNode.item.id} style={ts.phaseBlock}>
              <SkuRow
                node={phaseNode}
                collapsed={collapsed}
                maxLeftBlockWidth={maxLeftBlockWidth}
                rowBg={rowBg}
                wbsToIdMap={wbsToIdMap}
                idToWbsMap={idToWbsMap}
                pendingParentId={pendingParentId}
                rowIdShowingAdd={rowIdShowingAdd}
                setRowIdShowingAdd={setRowIdShowingAdd}
                hideAddTimeoutRef={hideAddTimeoutRef}
                onToggleCollapse={toggleCollapse}
                onStartAdd={handleStartAdd}
                onConfirmAdd={handleConfirmAdd}
                onCancelAdd={handleCancelAdd}
                onEditTitle={onEditTitle}
                onEditKind={onEditKind}
                onEditType={onEditType}
                onSetDependsOn={onSetDependsOn}
                onDelete={onDelete}
              />
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

// ─────────────────────────────────────────
// Styles — 与 TaxFilingTodosView 完全对齐
// ─────────────────────────────────────────
const ts = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  phaseBlocksWrap: { gap: 12, backgroundColor: '#F8F9FA' },
  phaseBlock: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DEE2E6',
    overflow: 'hidden',
  },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { fontSize: 15, color: '#636E72' },

  // ── 行结构 ──
  treeRowWrap: {},
  treeRow: {
    flexDirection: 'row', alignItems: 'stretch',
    paddingVertical: 10, paddingRight: 12,
    minHeight: 40, flexWrap: 'nowrap',
  },
  rowShowAddWrap: { flex: 1, flexDirection: 'row', alignItems: 'stretch', minWidth: 0, cursor: 'pointer' } as any,
  rowShowAddInner: { flex: 1, flexDirection: 'row', alignItems: 'stretch', minWidth: 0 },
  treeRowLeftBlock: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap', minWidth: 0, marginRight: 48,
  },
  showAddTouchArea: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', cursor: 'pointer' } as any,
  chevronWrap: { width: 28, alignItems: 'center', justifyContent: 'center' },
  wbsHotzone: { width: 36, marginRight: 8, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  wbsColText: { fontSize: 11, color: '#95A5A6', fontWeight: '500' },
  titleColumnWrap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  titleColumnTrailing: { flex: 1, minWidth: 0, cursor: 'pointer' } as any,
  titleHotzone: { alignSelf: 'stretch', justifyContent: 'center', flexShrink: 0 },
  treeTitleWrapAdaptive: { flexDirection: 'row', alignItems: 'center' },
  treeTitleAdaptive: { fontSize: 15, color: '#2D3436' },
  treeTitleL0: { fontWeight: '700', fontSize: 15, color: '#2D3436' },
  treeTitleL1: { fontWeight: '600', fontSize: 14, color: '#2D3436' },
  treeTitleL2: { fontWeight: '500', fontSize: 13, color: '#636E72' },
  titleInlineInput: {
    minWidth: 120, maxWidth: 320, borderBottomWidth: 1,
    borderBottomColor: '#6C5CE7', paddingVertical: 1,
  },
  addIconSlot: { width: 24, height: 20, justifyContent: 'center', alignItems: 'center' },
  addAndDeleteRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  deletePhaseIconWrap: { padding: 0, marginLeft: 0, marginTop: 2 },
  deletePhaseIconBtn: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E74C3C',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── PendingAdd（与 client project-todos 一致）──
  pendingAddRow: { minHeight: 40 },
  pendingAddInputRow: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0, gap: 6 },
  pendingAddInput: {
    flex: 1, fontSize: 14, color: '#2D3436',
    paddingVertical: 2, paddingHorizontal: 0,
    minHeight: 24, minWidth: 60, borderWidth: 0,
  },
  cancelAddBtn: { padding: 2, minWidth: 28, minHeight: 28, justifyContent: 'center', alignItems: 'center', cursor: 'pointer' } as any,
  confirmAddBtn: { padding: 2, minWidth: 28, minHeight: 28, justifyContent: 'center', alignItems: 'center', cursor: 'pointer' } as any,

  // ── 与 TaxFilingTodosView 完全一致的列宽与样式（无 progress/status，用 Kind/Type 列代替 role/status）──
  progressPlaceholder: {
    width: 52, minWidth: 52, marginRight: 32, alignSelf: 'stretch',
  },
  kindCol: {
    width: 64, minWidth: 64, alignItems: 'flex-start', justifyContent: 'center', alignSelf: 'stretch',
  },
  kindPill: {
    alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  kindPillText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' as const },
  typeCol: {
    width: 120, minWidth: 120, alignItems: 'flex-start', justifyContent: 'center', alignSelf: 'stretch',
  },
  typePill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typePillText: { fontSize: 11, fontWeight: '600' },
  trailingCol: {
    flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0, alignSelf: 'stretch', minWidth: 72,
  },
  depsInlineWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  depsInputField: {
    width: 44, height: 24, borderWidth: 1, borderColor: '#DFE6E9',
    borderRadius: 6, paddingHorizontal: 6, fontSize: 11, fontWeight: '700',
    color: '#2D3436', backgroundColor: '#fff', textAlign: 'center',
  },
  deleteIconBtn: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
});
