/**
 * Web 端通用数据表格：支持列显隐与列顺序。
 * Web 列宽规则：
 * - 自动列宽总和尽量占满容器（齿轮列 40px + 数据列）。各列先取有效最小宽；若最小宽之和 ≤ 可用宽，则按最小宽权重分配剩余空间填满；若最小宽之和 > 可用宽，则各列取最小宽并允许横向溢出。
 * - 有效最小宽：`minChars`（如商户 30 / 账户 20）或 `contentMinSamples`+表头测宽；否则回退 `minWidth`。
 * - 全页刷新、换表、**容器宽度变化（含右侧 chat 栏开关）** 时整表重算；**Realtime / 数据更新不重算**。
 * - **手动拖单列宽、改可见列 / 列顺序**：不整表重算；其他列宽保持不变；仅新显示且尚无宽度的列取有效最小宽；列宽总和可溢出或不足容器。
 * - 拖拽过程：先冻结各列像素宽，并同步增减 `table` 总宽，使右侧各列平移、不被 `table-layout:fixed` 吸走空隙。
 * - 用户手动拖拽写入 columnWidths；单列 1px～视口 80%；表宽=列宽之和（可小于容器留白或大于容器滚动）。
 * - storageKey 区分表格实例；列宽不写 localStorage。
 * 仅 Web 使用；移动端由各页 SectionList 展示。
 */
import React, { useState, useCallback, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createPortal } from 'react-dom';

export interface DataTableColumn<T> {
  id: string;
  label: string;
  getValue: (row: T) => React.ReactNode;
  /** 用于表头排序比较；不提供则该列不可排序 */
  getSortValue?: (row: T) => string | number | Date | null | undefined;
  visible?: boolean;
  /** 回退最小宽（px）；优先于 minChars / contentMinSamples 未配置时使用 */
  minWidth?: number;
  /**
   * 按字符数估最小宽（商户/Payee 等不定长列）。与 contentMinSamples 互斥时优先 minChars。
   * 例：商户 30、账户 20。
   */
  minChars?: number;
  /**
   * 按表头 + 样例文案测宽得到最小宽（金额、日期、状态标签等定长内容列）。
   * 不读行数据，故数据更新不会改变最小宽。
   */
  contentMinSamples?: string[];
  /** 列最大宽度（px 或 CSS 长度如 50ch）；与 minWidth 一并作用于 th/td，避免单元格被长内容撑开 */
  maxWidth?: number | string;
  /** Web：点击该列单元格不触发表格行 onRowPress（行内编辑） */
  stopRowPress?: boolean;
}

export interface DataTableSection<T> {
  title: string;
  data: T[];
  /** Same as mobile: count of items (e.g. confirmed) for section header */
  count?: number;
  /** Label after count, e.g. "receipts", "income", "inbounds", "outbounds" */
  countLabel?: string;
  /** Total amount for section (same currency as currency) */
  totalAmount?: number;
  /** Currency code for totalAmount display */
  currency?: string;
  /** Optional color for amount (e.g. income orange #D35400) */
  amountColor?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  /** 平铺数据（与 sections 二选一） */
  data?: T[];
  /** 分组数据（与 data 二选一）；传入时表体按分组渲染并显示分组标题行；排序时为组内排序 */
  sections?: DataTableSection<T>[];
  keyExtractor: (row: T) => string;
  onRowPress?: (row: T) => void;
  /** 当前排序列 id，与 sortDirection 一起由父组件根据 onSort 维护 */
  sortKey?: string | null;
  /** 当前排序方向：asc 正序（表头显示向下箭头），desc 倒序（向上箭头） */
  sortDirection?: 'asc' | 'desc';
  /** 点击表头时调用，父组件负责对 data/sections 排序后重新传入 */
  onSort?: (columnId: string, direction: 'asc' | 'desc') => void;
  /** Web：区分不同表格的列宽状态键（会话内；刷新/重新进入该表会重算 intrinsic） */
  storageKey?: string;
  emptyMessage?: string;
  /** 是否启用行多选（Web） */
  selectable?: boolean;
  /** 受控：选中行的 key 列表（不传则由内部管理） */
  selectedIds?: string[];
  /** 选中行变化时回调（与 selectedIds 搭配使用） */
  onSelectedIdsChange?: (ids: string[]) => void;
  /** 为 true 时：未选中任何行时多选列不常显，仅悬停行显示该行复选框；选中至少一行后整列显示 */
  selectableRevealOnHover?: boolean;
  /** 可选：按行返回额外 class（如置灰 data-table-row-muted） */
  getRowClassName?: (row: T) => string;
}

const TABLE_HEADER_BG = '#F1F3F5';
const TABLE_ROW_BG = '#FFFFFF';
const TABLE_ROW_HOVER_BG = '#F8F9FA';
const TABLE_BORDER = '#DEE2E6';
const TABLE_SECTION_BG = '#E9ECEF';
/** 与 UI 规范一致的无衬线字体，避免 table 默认衬线（如 Times） */
const TABLE_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** 手动拖拽列宽上限：视口宽度的 80%（初始 intrinsic 不受此限制） */
function getManualColumnMaxPx(): number {
  if (typeof window === 'undefined') return 10000;
  return Math.max(1, Math.floor(window.innerWidth * 0.8));
}

function clampManualColumnWidth(px: number): number {
  return Math.min(getManualColumnMaxPx(), Math.max(1, Math.round(px)));
}

const GEAR_COLUMN_PX = 40;
/** th/td 水平 padding 合计（与 thStyle/tdStyle 的 14+14 对齐） */
const CELL_PAD_X_PX = 28;
/** 表头排序箭头预留 */
const SORT_ICON_RESERVE_PX = 18;
/** 容器宽度变化小于此值不触发重算（避免亚像素抖动） */
const CONTAINER_RESIZE_EPSILON_PX = 2;

let _measureCanvas: HTMLCanvasElement | null = null;

/** 用与表格一致的字体测文字宽度（不依赖行数据） */
export function measureTableTextWidthPx(
  text: string,
  opts?: { fontSize?: number; fontWeight?: number | string }
): number {
  const fontSize = opts?.fontSize ?? 14;
  const fontWeight = opts?.fontWeight ?? 400;
  const fallback = Math.ceil(Math.max(1, text.length) * fontSize * 0.55);
  if (typeof document === 'undefined') return fallback;
  try {
    if (!_measureCanvas) _measureCanvas = document.createElement('canvas');
    const ctx = _measureCanvas.getContext('2d');
    if (!ctx) return fallback;
    ctx.font = `${fontWeight} ${fontSize}px ${TABLE_FONT_FAMILY}`;
    return Math.ceil(ctx.measureText(text).width);
  } catch {
    return fallback;
  }
}

/** n 个字符宽的最小列宽（含单元格 padding） */
export function minWidthForChars(charCount: number): number {
  const sample = '0'.repeat(Math.max(1, Math.floor(charCount)));
  return measureTableTextWidthPx(sample, { fontSize: 14 }) + CELL_PAD_X_PX;
}

/** 表头 + 样例文案的内容最小宽（金额/日期/标签等） */
export function minWidthForContentSamples(label: string, samples: string[]): number {
  const headerW =
    measureTableTextWidthPx(label, { fontSize: 13, fontWeight: 600 }) + SORT_ICON_RESERVE_PX;
  let contentW = 0;
  for (const s of samples) {
    if (!s) continue;
    contentW = Math.max(contentW, measureTableTextWidthPx(s, { fontSize: 14 }));
  }
  return Math.max(headerW, contentW) + CELL_PAD_X_PX;
}

function resolveColumnMinWidthPx(col: {
  label: string;
  minWidth?: number;
  minChars?: number;
  contentMinSamples?: string[];
}): number {
  if (typeof col.minChars === 'number' && col.minChars > 0) {
    return Math.max(1, minWidthForChars(col.minChars));
  }
  if (col.contentMinSamples && col.contentMinSamples.length > 0) {
    return Math.max(1, minWidthForContentSamples(col.label, col.contentMinSamples));
  }
  return Math.max(1, col.minWidth ?? 90);
}

/** Web：从**本实例**根 View 读宽。勿用 `getElementById('data-table-wrapper')`：Stack 保留上一屏时命中隐藏节点会得到 0。 */
function readWebDataTableWrapperWidthPx(node: unknown): number {
  if (node == null || typeof node !== 'object') return 0;
  const el = node as HTMLElement;
  const ow = el.offsetWidth;
  const cw = el.clientWidth;
  if (typeof ow === 'number' && ow > 0) return Math.round(ow);
  if (typeof cw === 'number' && cw > 0) return Math.round(cw);
  if (typeof el.getBoundingClientRect === 'function') {
    const r = el.getBoundingClientRect();
    if (r.width > 0) return Math.round(r.width);
  }
  return 0;
}

/**
 * 按最小宽分配列宽：
 * - sum(min) ≤ available → 各列至少 min，剩余按 min 权重填满 available（总和 = available）
 * - sum(min) > available → 各列取 min，允许表宽溢出容器
 */
function distributeFlexColumnWidths(
  cols: { id: string; minWidth: number }[],
  availablePx: number
): Record<string, number> {
  if (cols.length === 0) return {};
  const mins = cols.map(c => Math.max(1, Math.round(c.minWidth)));
  const sumMin = mins.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};

  if (availablePx < 1 || sumMin >= availablePx) {
    cols.forEach((c, i) => {
      out[c.id] = mins[i];
    });
    return out;
  }

  const extra = availablePx - sumMin;
  const sumW = sumMin;
  const rawExtra = mins.map(w => (extra * w) / sumW);
  const floors = rawExtra.map(x => Math.floor(x));
  let used = floors.reduce((a, b) => a + b, 0);
  let rem = extra - used;
  const order = rawExtra.map((x, i) => ({ i, f: x - floors[i] })).sort((a, b) => b.f - a.f);
  for (let k = 0; k < rem && k < order.length; k++) floors[order[k].i]++;
  cols.forEach((c, i) => {
    out[c.id] = mins[i] + floors[i];
  });
  return out;
}

/** Web 浮窗统一样式：列配置、分组、筛选三者一致 */
export const WEB_POPOVER = {
  container: {
    position: 'fixed' as const,
    zIndex: 99999,
    backgroundColor: '#FAFBFC',
    borderRadius: 12,
    border: '1px solid #E9ECEF',
    padding: '12px 14px',
    minWidth: 220,
    maxWidth: 280,
    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
    fontFamily: TABLE_FONT_FAMILY,
    fontSize: 13,
  },
  containerWide: { minWidth: 260, maxWidth: 320, maxHeight: '80vh' as const, overflow: 'auto' as const },
  title: { fontSize: 13, fontWeight: '600' as const, color: '#495057', marginBottom: 8 },
  /** Single-line list rows: firm clients / engagements Group & Filter popovers */
  optionRow: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 12,
    borderRadius: 8,
    minHeight: 40,
    boxSizing: 'border-box',
    cursor: 'pointer',
  },
  optionText: {
    fontSize: 13,
    lineHeight: '20px',
    color: '#2D3436',
    fontWeight: '500' as const,
    flex: 1,
    minWidth: 0,
  },
  optionTextSelected: { color: '#6C5CE7', fontWeight: '600' as const },
  optionBgSelected: 'rgba(108, 92, 231, 0.1)',
  hint: { fontSize: 12, color: '#95A5A6' },
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', CAD: 'C$', CNY: '¥', JPY: '¥', EUR: '€', GBP: '£', AUD: 'A$',
  HKD: 'HK$', TWD: 'NT$', KRW: '₩', SGD: 'S$', MXN: 'MX$', INR: '₹',
  THB: '฿', VND: '₫', PHP: '₱', MYR: 'RM', IDR: 'Rp',
};
function formatSectionAmount(amount: number, currency?: string): string {
  const symbol = CURRENCY_SYMBOLS[currency || 'USD'] || (currency ? `${currency} ` : '$');
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${symbol}—`;
  return `${symbol}${n.toFixed(2)}`;
}

function TableGlobalStyles() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.createElement('style');
    el.setAttribute('data-data-table', 'styles');
    el.textContent = [
      `.data-table-data-row { background-color: ${TABLE_ROW_BG} !important; }`,
      `.data-table-row-hover:hover { background-color: ${TABLE_ROW_HOVER_BG} !important; }`,
      `.data-table-row-muted { opacity: 0.6 !important; }`,
      `.data-table-section-header td { font-weight: 600; background-color: ${TABLE_SECTION_BG} !important; }`,
      `table.data-table-body, table.data-table-body th, table.data-table-body td { font-family: ${TABLE_FONT_FAMILY} !important; }`,
      'table.data-table-body { height: auto !important; }',
      'table.data-table-body thead tr { height: 44px !important; }',
      'table.data-table-body thead th { height: 44px !important; max-height: 44px !important; box-sizing: border-box !important; }',
      'table.data-table-body tbody tr { height: 40px !important; }',
      'table.data-table-body tbody td.data-table-td-cell { height: 40px !important; max-height: 40px !important; box-sizing: border-box !important; overflow-x: visible !important; overflow-y: hidden !important; vertical-align: middle !important; }',
      'table.data-table-body tbody td.data-table-td-cell .data-table-cell-clip { display: block !important; min-width: 0 !important; box-sizing: border-box !important; max-height: 40px !important; overflow-x: visible !important; overflow-y: hidden !important; }',
      'table.data-table-body tbody td > div { max-height: 40px !important; min-height: 0 !important; overflow-x: visible !important; overflow-y: hidden !important; }',
      '.data-table-checkbox-reveal-on-hover tbody tr td:first-child input[type=checkbox] { opacity: 0; transition: opacity 0.15s ease; }',
      '.data-table-checkbox-reveal-on-hover tbody tr:hover td:first-child input[type=checkbox] { opacity: 1; }',
    ].join('\n');
    document.head.appendChild(el);
    return () => {
      if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, []);
  return null;
}

export default function DataTable<T>({
  columns,
  data: dataProp,
  sections: sectionsProp,
  keyExtractor,
  onRowPress,
  sortKey = null,
  sortDirection = 'asc',
  onSort,
  storageKey,
  emptyMessage = 'No data',
   selectable = false,
   selectedIds,
   onSelectedIdsChange,
   selectableRevealOnHover = false,
   getRowClassName,
}: DataTableProps<T>) {
  const hasSections = sectionsProp != null && sectionsProp.length > 0;
  const data = hasSections ? sectionsProp!.flatMap(s => s.data) : (dataProp ?? []);
  const sections = hasSections ? sectionsProp! : null;
  const defaultVisibleIds = useMemo(() => columns.filter(c => c.visible !== false).map(c => c.id), [columns]);
  const defaultOrderIds = useMemo(() => columns.map(c => c.id), [columns]);
  const columnIdsFingerprint = useMemo(() => columns.map(c => c.id).join(','), [columns]);
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const [visibleIds, setVisibleIds] = useState<Set<string>>(() => new Set(defaultVisibleIds));
  const [orderIds, setOrderIds] = useState<string[]>(() => defaultOrderIds);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());
  const [dropdownRect, setDropdownRect] = useState<{ left: number; top: number } | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const pickerWrapRef = useRef<View | null>(null);
  /** 本表格外层 View，用于测量「表格窗口」宽度（与全局 id 解耦） */
  const dataTableWrapperRef = useRef<View | null>(null);
  /** 挂载后的 DOM 节点；供 ResizeObserver 在 ref 就绪后重新订阅（避免首帧 ref 为空永久不观察） */
  const [wrapperDomNode, setWrapperDomNode] = useState<HTMLElement | null>(null);
  const setDataTableWrapperRef = useCallback((node: View | null) => {
    dataTableWrapperRef.current = node;
    if (Platform.OS !== 'web' || node == null) {
      setWrapperDomNode(null);
      return;
    }
    // RN Web：callback ref 即为宿主 DOM 节点
    const el = node as unknown as HTMLElement;
    setWrapperDomNode(typeof el.getBoundingClientRect === 'function' ? el : null);
  }, []);
  const columnResizingRef = useRef(false);

  /** 用户拖拽覆盖的列宽（会话内）；进入新表或 storageKey 变化时清空 */
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  /** 自动分配后冻结的列宽；仅换表 / 容器宽度变化时整表重算；改可见列与手动拖宽不重算 */
  const [intrinsicWidths, setIntrinsicWidths] = useState<Record<string, number>>({});
  const intrinsicWidthsRef = useRef(intrinsicWidths);
  intrinsicWidthsRef.current = intrinsicWidths;
  const intrinsicCapturedKeyRef = useRef<string | null>(null);
  const columnWidthsRef = useRef(columnWidths);
  columnWidthsRef.current = columnWidths;
  /** 容器宽度世代：ResizeObserver 检测到侧栏开关等宽度变化时递增，触发整表重算 */
  const [containerWidthEpoch, setContainerWidthEpoch] = useState(0);
  const lastObservedWrapperWidthRef = useRef(0);

  /** 不含 visibleIds / orderIds：改可见列或列序不触发整表重分配 */
  const layoutCaptureKey = useMemo(() => {
    return `${storageKey ?? ''}|${columnIdsFingerprint}|e${containerWidthEpoch}`;
  }, [storageKey, columnIdsFingerprint, containerWidthEpoch]);

  const commitColumnWidth = useCallback((colId: string, widthPx: number) => {
    const w = clampManualColumnWidth(widthPx);
    // 仅覆盖本列；不触发布局重算，其他列保持原宽
    setColumnWidths(prev => ({ ...prev, [colId]: w }));
  }, []);

  /** 换表 / 列集合变化：清空列宽状态并重置列顺序与可见性（避免复用实例时仍持有上一模块的 orderIds 导致 visible 为空） */
  const dataTableIdentityRef = useRef<string>('');
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    const id = `${storageKey ?? ''}|${columnIdsFingerprint}`;
    if (dataTableIdentityRef.current === id) return;
    dataTableIdentityRef.current = id;
    setColumnWidths({});
    intrinsicCapturedKeyRef.current = null;
    setIntrinsicWidths({});
    lastObservedWrapperWidthRef.current = 0;
    // 递增 epoch，确保换表后在 visibleIds 重置的下一帧触发整表分配（避免与旧可见列竞态）
    setContainerWidthEpoch(e => e + 1);
    const cols = columnsRef.current;
    setOrderIds(cols.map(c => c.id));
    setVisibleIds(new Set(cols.filter(c => c.visible !== false).map(c => c.id)));
  }, [storageKey, columnIdsFingerprint]);

  // 多选：内部维护选中行，若父组件提供受控 selectedIds 则以外部为准
  const [internalSelected, setInternalSelected] = useState<Set<string>>(new Set());
  const selectedSet = useMemo(() => {
    if (Array.isArray(selectedIds)) return new Set(selectedIds);
    return internalSelected;
  }, [selectedIds, internalSelected]);

  const setSelected = useCallback(
    (ids: string[]) => {
      if (onSelectedIdsChange) {
        onSelectedIdsChange(ids);
      } else {
        setInternalSelected(new Set(ids));
      }
    },
    [onSelectedIdsChange]
  );

  const toggleSection = useCallback((sectionIdx: number) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionIdx)) next.delete(sectionIdx);
      else next.add(sectionIdx);
      return next;
    });
  }, []);

  const idToColumn = useMemo(() => {
    const m = new Map<string, DataTableColumn<T>>();
    columns.forEach(c => m.set(c.id, c));
    return m;
  }, [columns]);

  const orderedVisibleColumns = useMemo(() => {
    const result: DataTableColumn<T>[] = [];
    orderIds.forEach(id => {
      if (visibleIds.has(id)) {
        const col = idToColumn.get(id);
        if (col) result.push(col);
      }
    });
    return result;
  }, [orderIds, visibleIds, idToColumn]);
  const orderedVisibleColumnsRef = useRef(orderedVisibleColumns);
  orderedVisibleColumnsRef.current = orderedVisibleColumns;

  // 容器宽度变化（右侧栏开关、窗口缩放等）→ 递增 epoch 触发整表重算；数据更新不改宽度故不触发
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof ResizeObserver === 'undefined') return;
    const node =
      wrapperDomNode ??
      (dataTableWrapperRef.current as unknown as HTMLElement | null);
    if (!node || typeof node.getBoundingClientRect !== 'function') return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.round(entry.contentRect.width || readWebDataTableWrapperWidthPx(node));
      if (w < 24) return;
      const prev = lastObservedWrapperWidthRef.current;
      if (prev > 0 && Math.abs(w - prev) < CONTAINER_RESIZE_EPSILON_PX) return;
      lastObservedWrapperWidthRef.current = w;
      if (prev === 0) return; // 首次观察只记录，交给下方 layout effect 做首次分配
      // 容器变化 = 整表重算：清除手动列宽与 intrinsic，按新容器重新填满/溢出
      intrinsicCapturedKeyRef.current = null;
      setColumnWidths({});
      setIntrinsicWidths({});
      setContainerWidthEpoch((e) => e + 1);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [storageKey, columnIdsFingerprint, wrapperDomNode]);

  // 整表按「表格窗口」宽度分配列宽（仅 layoutCaptureKey：换表 / 容器宽变化）；不因改可见列重入
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (intrinsicCapturedKeyRef.current === layoutCaptureKey) return;

    let cancelled = false;
    let attempts = 0;
    const captureKey = layoutCaptureKey;
    const run = () => {
      if (cancelled) return;
      if (intrinsicCapturedKeyRef.current === captureKey) return;
      attempts += 1;
      const w = readWebDataTableWrapperWidthPx(dataTableWrapperRef.current as unknown);
      if (w < 24 && attempts < 40) {
        requestAnimationFrame(run);
        return;
      }
      if (w >= 24) lastObservedWrapperWidthRef.current = w;
      const user = columnWidthsRef.current;
      const visible = orderedVisibleColumnsRef.current;
      if (visible.length === 0 && columns.length > 0 && attempts < 40) {
        requestAnimationFrame(run);
        return;
      }
      if (visible.length === 0) {
        intrinsicCapturedKeyRef.current = captureKey;
        return;
      }
      let reserved = 0;
      visible.forEach(col => {
        if (user[col.id] != null) reserved += clampManualColumnWidth(user[col.id]);
      });
      const flexCols = visible
        .filter(col => user[col.id] == null)
        .map(col => ({ id: col.id, minWidth: resolveColumnMinWidthPx(col) }));
      const available = Math.max(0, w - GEAR_COLUMN_PX - reserved);
      const next =
        flexCols.length > 0 ? distributeFlexColumnWidths(flexCols, available) : {};
      intrinsicCapturedKeyRef.current = captureKey;
      setIntrinsicWidths(() => {
        const merged: Record<string, number> = { ...next };
        // 保留当前不可见列的历史宽，便于再次显示时复用且不牵动其他列
        const prev = intrinsicWidthsRef.current;
        Object.keys(prev).forEach(id => {
          if (merged[id] == null && user[id] == null) merged[id] = prev[id];
        });
        return merged;
      });
    };
    requestAnimationFrame(run);
    return () => {
      cancelled = true;
    };
  }, [layoutCaptureKey, columns.length]);

  // 改可见列：不重分配已有列；仅为新显示且尚无宽度的列写入有效最小宽（总和可溢出/不足容器）
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    if (intrinsicCapturedKeyRef.current == null) return; // 等整表首次分配完成
    const user = columnWidthsRef.current;
    const prev = intrinsicWidthsRef.current;
    const patch: Record<string, number> = {};
    orderedVisibleColumns.forEach(col => {
      if (user[col.id] != null) return;
      if (prev[col.id] != null) return;
      patch[col.id] = resolveColumnMinWidthPx(col);
    });
    if (Object.keys(patch).length === 0) return;
    setIntrinsicWidths(p => ({ ...p, ...patch }));
  }, [orderedVisibleColumns]);

  const columnSizeStyle = useCallback((col: DataTableColumn<T>): { minWidth: number; width: number } => {
    const userW = columnWidths[col.id];
    const frozenW = intrinsicWidths[col.id];
    const floor = resolveColumnMinWidthPx(col);
    if (userW != null) {
      const w = clampManualColumnWidth(userW);
      return { minWidth: w, width: w };
    }
    if (frozenW != null) return { minWidth: frozenW, width: frozenW };
    /** 未冻结前也用 width=floor，避免 fixed 布局下「仅 minWidth」的列吃掉剩余宽度、挤占他列 */
    return { minWidth: floor, width: floor };
  }, [columnWidths, intrinsicWidths]);

  const toggleColumn = useCallback((id: string) => {
    setVisibleIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const moveColumn = useCallback((id: string, direction: 'left' | 'right') => {
    setOrderIds(prev => {
      const i = prev.indexOf(id);
      if (i === -1) return prev;
      const j = direction === 'left' ? i - 1 : i + 1;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  const reorderColumns = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setOrderIds(prev => {
      const arr = [...prev];
      const [removed] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, removed);
      return arr;
    });
  }, []);

  const displayOrder = useMemo(() => {
    if (draggedIndex == null || dropTargetIndex == null || draggedIndex === dropTargetIndex) return orderIds;
    const arr = orderIds.filter((_, i) => i !== draggedIndex);
    arr.splice(dropTargetIndex, 0, orderIds[draggedIndex]);
    return arr;
  }, [orderIds, draggedIndex, dropTargetIndex]);

  // 计算「全选」状态（所有行都被选中）
  const allSelectableKeys = useMemo(() => data.map(row => keyExtractor(row)), [data, keyExtractor]);
  const allSelected = useMemo(
    () => selectable && allSelectableKeys.length > 0 && allSelectableKeys.every(k => selectedSet.has(k)),
    [selectable, allSelectableKeys, selectedSet]
  );

  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || !showColumnPicker) {
      setDropdownRect(null);
      return;
    }
    const measure = () => {
      const el = (pickerWrapRef.current as unknown as HTMLElement | null) ?? document.getElementById('data-table-column-picker-wrap');
      if (el?.getBoundingClientRect) {
        const r = el.getBoundingClientRect();
        setDropdownRect({ left: r.left, top: r.bottom + 6 });
      } else {
        setDropdownRect(null);
      }
    };
    measure();
    const t = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(t);
  }, [showColumnPicker]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !showColumnPicker) return;
    const handler = (e: PointerEvent) => {
      const wrap = document.getElementById('data-table-column-picker-wrap');
      const dropdown = document.getElementById('data-table-column-picker-dropdown');
      const target = e.target as Node;
      if (wrap && !wrap.contains(target) && dropdown && !dropdown.contains(target)) setShowColumnPicker(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [showColumnPicker]);

  // 在 Web 平台上注入 CSS 样式以确保表头 sticky 生效
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    
    const styleId = 'data-table-sticky-header-style';
    // 移除旧的样式（如果存在）
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) {
      existingStyle.remove();
    }
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* 针对 React Native Web ScrollView 的滚动容器 */
      div[data-rn-scrollview] {
        overflow-y: auto !important;
      }
      /* 确保表格容器支持 sticky */
      .data-table-body {
        border-collapse: collapse;
      }
      /* 表头 sticky 样式 */
      .data-table-body thead {
        position: sticky !important;
        top: 0 !important;
        z-index: 10 !important;
        background-color: ${TABLE_HEADER_BG} !important;
      }
      .data-table-body thead th {
        position: sticky !important;
        top: 0 !important;
        z-index: 10 !important;
        background-color: ${TABLE_HEADER_BG} !important;
      }
      /* 针对可能的嵌套滚动容器 */
      [class*="ScrollView"] thead,
      [data-rn-scrollview] thead {
        position: sticky !important;
        top: 0 !important;
        z-index: 10 !important;
        background-color: ${TABLE_HEADER_BG} !important;
      }
      [class*="ScrollView"] thead th,
      [data-rn-scrollview] thead th {
        position: sticky !important;
        top: 0 !important;
        z-index: 10 !important;
        background-color: ${TABLE_HEADER_BG} !important;
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      const styleToRemove = document.getElementById(styleId);
      if (styleToRemove) {
        styleToRemove.remove();
      }
    };
  }, []);

  // 使用 useLayoutEffect 实现表头固定（使用 transform 方案）
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    
    let cleanup: (() => void) | null = null;
    
    const applyFixedHeader = () => {
      // 清理之前的监听器
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
      
      const table = document.querySelector('.data-table-body, #data-table-body') as HTMLTableElement;
      if (!table) return;
      
      // 找到包含表格的滚动容器
      let scrollContainer: HTMLElement | null = table.parentElement;
      while (scrollContainer && scrollContainer !== document.body) {
        const computedStyle = window.getComputedStyle(scrollContainer);
        const hasOverflow = computedStyle.overflowY === 'auto' || 
                           computedStyle.overflowY === 'scroll' ||
                           computedStyle.overflow === 'auto' ||
                           computedStyle.overflow === 'scroll';
        const hasScroll = scrollContainer.scrollHeight > scrollContainer.clientHeight;
        
        if (hasOverflow || hasScroll) {
          break;
        }
        scrollContainer = scrollContainer.parentElement;
      }
      
      // 如果没找到滚动容器，尝试查找 React Native Web ScrollView
      let finalScrollContainer: HTMLElement | Window = window;
      if (scrollContainer && scrollContainer !== document.body) {
        finalScrollContainer = scrollContainer;
      } else {
        const rnScrollView = document.querySelector('[data-rn-scrollview]') as HTMLElement ||
                            document.querySelector('[class*="ScrollView"]') as HTMLElement;
        if (rnScrollView) {
          finalScrollContainer = rnScrollView;
        }
      }
      
      const thead = table.querySelector('thead, #data-table-thead') as HTMLElement;
      if (!thead) return;
      
      let lastOffsetTop = -1;
      const updateHeaderPosition = () => {
        const tableRect = table.getBoundingClientRect();
        const scrollContainerRect = finalScrollContainer === window ? 
          { top: 0, bottom: window.innerHeight } : 
          (finalScrollContainer as HTMLElement).getBoundingClientRect();
        
        // 检查表格是否在视口中
        if (tableRect.bottom < scrollContainerRect.top || tableRect.top > scrollContainerRect.bottom) {
          // 表格不在视口中，恢复正常位置
          if (lastOffsetTop !== -1) {
            thead.style.transform = '';
            thead.style.position = '';
            lastOffsetTop = -1;
          }
          return;
        }
        
        // 如果表格顶部在滚动容器顶部之上，固定表头
        if (tableRect.top < scrollContainerRect.top) {
          const offsetTop = scrollContainerRect.top - tableRect.top;
          
          // 只在 offsetTop 变化时更新，减少抖动
          if (Math.abs(lastOffsetTop - offsetTop) > 0.5) {
            // 使用 transform 来定位，避免影响布局
            thead.style.position = 'relative';
            thead.style.transform = `translateY(${offsetTop}px)`;
            thead.style.zIndex = '10';
            thead.style.backgroundColor = TABLE_HEADER_BG;
            
            // 为表头单元格也设置样式
            const thElements = thead.querySelectorAll('th');
            thElements.forEach((th) => {
              const thEl = th as HTMLElement;
              thEl.style.backgroundColor = TABLE_HEADER_BG;
            });
            
            lastOffsetTop = offsetTop;
          }
        } else {
          // 表格顶部在滚动容器顶部之下，恢复正常位置
          if (lastOffsetTop !== -1) {
            thead.style.transform = '';
            thead.style.position = '';
            lastOffsetTop = -1;
          }
        }
      };
      
      // 初始更新
      updateHeaderPosition();
      
      // 监听滚动事件
      const handleScroll = () => {
        requestAnimationFrame(updateHeaderPosition);
      };
      
      const isWindow = finalScrollContainer === window;
      if (isWindow) {
        window.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', updateHeaderPosition);
        cleanup = () => {
          window.removeEventListener('scroll', handleScroll, true);
          window.removeEventListener('resize', updateHeaderPosition);
        };
      } else {
        const container = finalScrollContainer as HTMLElement;
        container.addEventListener('scroll', handleScroll, true);
        window.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', updateHeaderPosition);
        cleanup = () => {
          container.removeEventListener('scroll', handleScroll, true);
          window.removeEventListener('scroll', handleScroll, true);
          window.removeEventListener('resize', updateHeaderPosition);
        };
      }
    };
    
    // 延迟执行以确保 DOM 已完全渲染
    const timeoutId = setTimeout(() => {
      applyFixedHeader();
    }, 300);
    
    // 使用 MutationObserver 监听 DOM 变化
    const observer = new MutationObserver(() => {
      setTimeout(applyFixedHeader, 100);
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    
    return () => {
      clearTimeout(timeoutId);
      observer.disconnect();
      if (cleanup) {
        cleanup();
      }
    };
  }, [data, sections]);

  if (Platform.OS !== 'web') return null;

  /** 表宽=齿轮列 + 各数据列 width（px）；自动分配占满当时容器，最小宽之和过大时可溢出滚动；手动拖拽后可留白或滚动 */
  const totalDataPx = orderedVisibleColumns.reduce((sum, col) => sum + columnSizeStyle(col).width, 0);
  const tableWidthPx = GEAR_COLUMN_PX + totalDataPx;
  const tableStyle = {
    width: tableWidthPx,
    tableLayout: 'fixed' as const,
    borderCollapse: 'collapse' as const,
    fontFamily: TABLE_FONT_FAMILY,
    fontSize: 14,
    color: '#2D3436',
  };
  const thStyle = {
    padding: '10px 14px',
    textAlign: 'left' as const,
    fontFamily: TABLE_FONT_FAMILY,
    fontSize: 13,
    fontWeight: 600,
    color: '#495057',
    letterSpacing: 0.2,
    backgroundColor: TABLE_HEADER_BG,
    borderBottom: `2px solid ${TABLE_BORDER}`,
    whiteSpace: 'nowrap' as const,
    height: '44px' as const,
    maxHeight: '44px' as const,
    boxSizing: 'border-box' as const,
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
  };
  const tdStyle = {
    padding: '8px 14px',
    borderBottom: `1px solid ${TABLE_BORDER}`,
    fontFamily: TABLE_FONT_FAMILY,
    fontSize: 14,
    lineHeight: '20px' as const,
    height: '40px' as const,
    maxHeight: '40px' as const,
    verticalAlign: 'middle' as const,
    boxSizing: 'border-box' as const,
    overflowX: 'visible' as const,
    overflowY: 'hidden' as const,
  };
  const sectionHeaderStyle = {
    padding: '6px 14px',
    fontFamily: TABLE_FONT_FAMILY,
    fontSize: 13,
    fontWeight: 600,
    color: '#495057',
    backgroundColor: TABLE_SECTION_BG,
    borderBottom: `1px solid ${TABLE_BORDER}`,
    height: '36px' as const,
    boxSizing: 'border-box' as const,
    cursor: 'pointer' as const,
  };

  return (
    <View ref={setDataTableWrapperRef} style={styles.wrapper} nativeID="data-table-wrapper">
      <ScrollView 
        horizontal 
        style={styles.scroll} 
        contentContainerStyle={styles.scrollContent}
        nativeID="data-table-scroll-container"
      >
        <table
          style={tableStyle}
          className={'data-table-body' + (selectable && selectableRevealOnHover && selectedSet.size === 0 ? ' data-table-checkbox-reveal-on-hover' : '')}
          id="data-table-body"
        >
          <colgroup>
            <col style={{ width: 40, minWidth: 40 }} />
            {orderedVisibleColumns.map(col => {
              const s = columnSizeStyle(col);
              return <col key={col.id} style={{ width: s.width, minWidth: s.width }} />;
            })}
          </colgroup>
          <thead
            style={{
              position: 'sticky' as const,
              top: 0,
              zIndex: 10,
              backgroundColor: TABLE_HEADER_BG,
            }}
            id="data-table-thead"
          >
            <tr>
              <th style={{ ...thStyle, width: 40, minWidth: 40, padding: '8px' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
                  {selectable && (
                    <View
                      style={{
                        width: 20,
                        height: 16,
                        marginRight: 4,
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          if (!selectable) return;
                          if (allSelected) {
                            setSelected([]);
                          } else {
                            setSelected(allSelectableKeys);
                          }
                        }}
                        style={{
                          cursor: 'pointer',
                          width: 16,
                          height: 16,
                          /** 与 tbody 一致：始终挂载，避免选中前后表头布局抖动 */
                          opacity: !selectableRevealOnHover || selectedSet.size > 0 ? 1 : 0,
                          transition: selectableRevealOnHover ? 'opacity 0.15s ease' : undefined,
                          pointerEvents: !selectableRevealOnHover || selectedSet.size > 0 ? 'auto' : 'none',
                        }}
                      />
                    </View>
                  )}
                  <View
                    ref={pickerWrapRef}
                    style={styles.columnPickerWrap}
                    nativeID="data-table-column-picker-wrap"
                  >
                    <TouchableOpacity
                      onPress={() => setShowColumnPicker(v => !v)}
                      style={styles.columnPickerBtn}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="options-outline" size={18} color="#636E72" />
                    </TouchableOpacity>
                    {showColumnPicker && dropdownRect && typeof document !== 'undefined' && document.body &&
                      createPortal(
                        <div
                          id="data-table-column-picker-dropdown"
                          style={{
                            ...WEB_POPOVER.container,
                            left: dropdownRect.left,
                            top: dropdownRect.top,
                          }}
                        >
                          <View style={styles.columnPickerHeader}>
                            <Text style={[WEB_POPOVER.title, { marginBottom: 4, lineHeight: 20 }]}>Columns</Text>
                            <Text style={[WEB_POPOVER.hint, { lineHeight: 18 }]}>Drag to reorder. Toggle to show/hide.</Text>
                          </View>
                          <ScrollView style={styles.columnPickerScroll}>
                            {displayOrder.map((id, idx) => {
                              const col = idToColumn.get(id);
                              if (!col) return null;
                              const isVisible = visibleIds.has(id);
                              const originalIndex = orderIds.indexOf(id);
                              const isDragging = draggedIndex !== null && orderIds[draggedIndex] === id;
                              const rowContent = (
                                <View style={styles.columnPickerCheckRow}>
                                  <View style={styles.columnPickerDragHandle}>
                                    <Ionicons name="reorder-three" size={16} color="#95A5A6" />
                                  </View>
                                  <TouchableOpacity
                                    onPress={() => toggleColumn(id)}
                                    style={styles.columnPickerCheckRow}
                                    activeOpacity={0.7}
                                  >
                                    <View style={[styles.columnPickerCheck, isVisible && styles.columnPickerCheckOn]}>
                                      {isVisible && <Ionicons name="checkmark" size={14} color="#fff" />}
                                    </View>
                                    <Text style={styles.columnPickerLabel}>{col.label}</Text>
                                  </TouchableOpacity>
                                </View>
                              );
                              return Platform.OS === 'web' ? (
                                <div
                                  key={id}
                                  draggable
                                  data-drop-index={idx}
                                  onDragStart={(e: React.DragEvent) => {
                                    setDraggedIndex(originalIndex);
                                    setDropTargetIndex(null);
                                    if (e.dataTransfer) {
                                      e.dataTransfer.effectAllowed = 'move';
                                      e.dataTransfer.setData('text/plain', id);
                                    }
                                  }}
                                  onDragOver={(e: React.DragEvent) => {
                                    e.preventDefault();
                                    e.dataTransfer && (e.dataTransfer.dropEffect = 'move');
                                    setDropTargetIndex(idx);
                                  }}
                                  onDrop={(e: React.DragEvent) => {
                                    e.preventDefault();
                                    const toIndex = parseInt(
                                      (e.currentTarget?.getAttribute?.('data-drop-index') ?? '') || '-1',
                                      10
                                    );
                                    if (draggedIndex != null && toIndex >= 0 && draggedIndex !== toIndex) {
                                      reorderColumns(draggedIndex, toIndex);
                                    }
                                    setDraggedIndex(null);
                                    setDropTargetIndex(null);
                                  }}
                                  onDragEnd={() => {
                                    setDraggedIndex(null);
                                    setDropTargetIndex(null);
                                  }}
                                  style={{
                                    display: 'flex',
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    paddingTop: 10,
                                    paddingBottom: 10,
                                    paddingLeft: 12,
                                    paddingRight: 12,
                                    opacity: isDragging ? 0.6 : 1,
                                    cursor: 'grab',
                                    backgroundColor: dropTargetIndex === idx ? WEB_POPOVER.optionBgSelected : 'transparent',
                                    borderRadius: 8,
                                  }}
                                >
                                  {rowContent}
                                </div>
                              ) : (
                                <View key={id} style={[styles.columnPickerRow, isDragging && styles.columnPickerRowDragging]}>
                                  {rowContent}
                                </View>
                              );
                            })}
                          </ScrollView>
                        </div>,
                        document.body
                      )}
                  </View>
                </View>
              </th>
              {orderedVisibleColumns.map((col, colIdx) => {
                const isSortable = !!onSort && !!col.getSortValue;
                const isActive = sortKey === col.id;
                const nextDir = isActive && sortDirection === 'asc' ? 'desc' : 'asc';
                const size = columnSizeStyle(col);
                return (
                  <th
                    key={col.id}
                    data-column-id={col.id}
                    style={{
                      ...thStyle,
                      ...size,
                      ...(col.maxWidth != null && columnWidths[col.id] == null ? { maxWidth: col.maxWidth } : {}),
                      cursor: isSortable ? 'pointer' : 'default',
                      userSelect: 'none',
                      position: 'relative' as const,
                    }}
                    onClick={isSortable ? () => {
                      if (columnResizingRef.current) {
                        columnResizingRef.current = false;
                        return;
                      }
                      onSort(col.id, nextDir);
                    } : undefined}
                    role={isSortable ? 'button' : undefined}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ flexShrink: 0 }} numberOfLines={1}>{col.label}</Text>
                      {isSortable && isActive && (
                        <View style={{ flexShrink: 0 }}>
                          {sortDirection === 'desc' ? (
                            <Ionicons name="chevron-up" size={16} color="#6C5CE7" />
                          ) : (
                            <Ionicons name="chevron-down" size={16} color="#6C5CE7" />
                          )}
                        </View>
                      )}
                    </View>
                    {Platform.OS === 'web' && (
                      <div
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: 0,
                          bottom: 0,
                          width: 4,
                          cursor: 'col-resize',
                          backgroundColor: 'rgba(222, 226, 230, 0.3)',
                          borderRight: '1px solid rgba(173, 181, 189, 0.5)',
                          transition: 'background-color 0.15s ease',
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          columnResizingRef.current = true;
                          const th = e.currentTarget.parentElement as HTMLElement;
                          if (!th) return;
                          const table = th.closest('table') as HTMLTableElement | null;
                          if (!table) return;
                          const startX = e.clientX;
                          const startWidth = th.offsetWidth;
                          const colId = col.id;
                          const colNodes = table.querySelectorAll('colgroup col');
                          const headerCells = table.querySelectorAll('thead tr:first-child th');
                          // 冻结当前各列像素宽，避免 table-layout:fixed 在改单列时把空隙分给其他列
                          let startTableWidth = 0;
                          headerCells.forEach((cell, i) => {
                            const el = cell as HTMLElement;
                            const w = Math.max(1, Math.round(el.offsetWidth));
                            startTableWidth += w;
                            el.style.width = `${w}px`;
                            el.style.minWidth = `${w}px`;
                            el.style.maxWidth = '';
                            const colNode = colNodes.item(i) as HTMLElement | null;
                            if (colNode) {
                              colNode.style.width = `${w}px`;
                              colNode.style.minWidth = `${w}px`;
                            }
                          });
                          table.style.width = `${startTableWidth}px`;
                          table.style.minWidth = `${startTableWidth}px`;

                          const applyWidthPx = (rawPx: number) => {
                            const newWidth = clampManualColumnWidth(rawPx);
                            const delta = newWidth - startWidth;
                            const nextTableWidth = Math.max(GEAR_COLUMN_PX + 1, startTableWidth + delta);
                            th.style.width = `${newWidth}px`;
                            th.style.minWidth = `${newWidth}px`;
                            th.style.maxWidth = '';
                            const colNode = colNodes.item(colIdx + 1) as HTMLElement | null;
                            if (colNode) {
                              colNode.style.width = `${newWidth}px`;
                              colNode.style.minWidth = `${newWidth}px`;
                            }
                            const tds = table.querySelectorAll(`td:nth-child(${colIdx + 2})`);
                            tds.forEach((td: Element) => {
                              const el = td as HTMLElement;
                              el.style.width = `${newWidth}px`;
                              el.style.minWidth = `${newWidth}px`;
                              el.style.maxWidth = '';
                            });
                            // 同步缩/扩表宽，右侧各列随拖动平移，宽度不变
                            table.style.width = `${nextTableWidth}px`;
                            table.style.minWidth = `${nextTableWidth}px`;
                          };
                          const handleMouseMove = (moveE: MouseEvent) => {
                            const diff = moveE.clientX - startX;
                            applyWidthPx(startWidth + diff);
                          };
                          const handleMouseUp = () => {
                            document.removeEventListener('mousemove', handleMouseMove);
                            document.removeEventListener('mouseup', handleMouseUp);
                            document.body.style.cursor = '';
                            document.body.style.userSelect = '';
                            const finalW = clampManualColumnWidth(th.offsetWidth);
                            commitColumnWidth(colId, finalW);
                            setTimeout(() => { columnResizingRef.current = false; }, 0);
                          };
                          document.addEventListener('mousemove', handleMouseMove);
                          document.addEventListener('mouseup', handleMouseUp);
                          document.body.style.cursor = 'col-resize';
                          document.body.style.userSelect = 'none';
                        }}
                        onMouseEnter={(e) => {
                          if (Platform.OS === 'web') {
                            const el = e.currentTarget as HTMLElement;
                            el.style.backgroundColor = 'rgba(108, 92, 231, 0.15)';
                            el.style.borderRight = '1px solid rgba(108, 92, 231, 0.4)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (Platform.OS === 'web') {
                            const el = e.currentTarget as HTMLElement;
                            el.style.backgroundColor = 'rgba(222, 226, 230, 0.3)';
                            el.style.borderRight = '1px solid rgba(173, 181, 189, 0.5)';
                          }
                        }}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={orderedVisibleColumns.length + 1} style={{ ...tdStyle, textAlign: 'center', color: '#95A5A6', paddingTop: 32, paddingBottom: 32 }}>
                  {emptyMessage}
                </td>
              </tr>
            ) : sections ? (
              sections.map((section, sectionIdx) => {
                const isCollapsed = collapsedSections.has(sectionIdx);
                const sectionRowKeys = section.data.map(row => keyExtractor(row));
                const sectionAllSelected = selectable && sectionRowKeys.length > 0 && sectionRowKeys.every(k => selectedSet.has(k));
                return (
                  <React.Fragment key={`section-${sectionIdx}`}>
                    <tr
                      className="data-table-section-header"
                      onClick={() => toggleSection(sectionIdx)}
                      style={{ cursor: 'pointer' } as any}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e: any) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection(sectionIdx); } }}
                    >
                      <td style={{ ...tdStyle, width: 40, minWidth: 40, padding: '0 8px' }}>
                        {selectable && (
                          <input
                            type="checkbox"
                            checked={sectionAllSelected}
                            onChange={(e) => {
                              e.stopPropagation();
                              const next = new Set(selectedSet);
                              if (sectionAllSelected) {
                                sectionRowKeys.forEach(k => next.delete(k));
                              } else {
                                sectionRowKeys.forEach(k => next.add(k));
                              }
                              setSelected(Array.from(next));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{ cursor: 'pointer', width: 16, height: 16 }}
                          />
                        )}
                      </td>
                      <td colSpan={orderedVisibleColumns.length} style={sectionHeaderStyle}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                          <Ionicons name={isCollapsed ? 'chevron-forward' : 'chevron-down'} size={18} color="#636E72" />
                          <Text style={{ fontSize: 13, fontWeight: '600', color: '#495057', marginRight: 8 }}>{section.title}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginLeft: 4 }}>
                            {section.count != null && section.countLabel != null && (
                              <Text style={{ fontSize: 13, color: '#636E72' }}>{section.count} {section.countLabel}</Text>
                            )}
                            {section.totalAmount != null && section.totalAmount > 0 && section.currency != null && (
                              <Text style={{ fontSize: 13, fontWeight: '600', color: section.amountColor ?? '#2D3436' }}>
                                {formatSectionAmount(section.totalAmount, section.currency)}
                              </Text>
                            )}
                          </View>
                        </View>
                      </td>
                    </tr>
                    {!isCollapsed && section.data.map(row => {
                      const key = keyExtractor(row);
                      return (
                        <tr
                          key={key}
                          onClick={() => onRowPress?.(row)}
                          style={{
                            cursor: onRowPress ? 'pointer' : 'default',
                            backgroundColor: TABLE_ROW_BG,
                            height: '40px',
                          } as any}
                          className={`data-table-data-row ${onRowPress ? 'data-table-row-hover' : ''} ${getRowClassName?.(row) ?? ''}`.trim()}
                        >
                          <td style={{ ...tdStyle, width: 40, minWidth: 40, padding: '0 8px' }}>
                            {selectable && (
                              <input
                                type="checkbox"
                                checked={selectedSet.has(key)}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const next = new Set(selectedSet);
                                  if (next.has(key)) next.delete(key);
                                  else next.add(key);
                                  setSelected(Array.from(next));
                                }}
                                onClick={(e) => e.stopPropagation()}
                                style={{ cursor: 'pointer', width: 16, height: 16 }}
                              />
                            )}
                          </td>
                          {orderedVisibleColumns.map(col => (
                            <td
                              key={col.id}
                              className="data-table-td-cell"
                              style={{
                                ...tdStyle,
                                ...columnSizeStyle(col),
                                ...(col.maxWidth != null && columnWidths[col.id] == null ? { maxWidth: col.maxWidth } : {}),
                              }}
                              onClick={col.stopRowPress ? (e: React.MouseEvent) => e.stopPropagation() : undefined}
                            >
                              <View
                                style={styles.cellBodyClip}
                                {...(Platform.OS === 'web' ? ({ className: 'data-table-cell-clip' } as Record<string, string>) : {})}
                              >
                                {col.getValue(row)}
                              </View>
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })
            ) : (
              data.map(row => {
                const key = keyExtractor(row);
                return (
                  <tr
                    key={key}
                    onClick={() => onRowPress?.(row)}
                    style={{
                      cursor: onRowPress ? 'pointer' : 'default',
                      backgroundColor: TABLE_ROW_BG,
                      height: '40px',
                    } as any}
                    className={`data-table-data-row ${onRowPress ? 'data-table-row-hover' : ''} ${getRowClassName?.(row) ?? ''}`.trim()}
                  >
                    <td style={{ ...tdStyle, width: 40, minWidth: 40, padding: '0 8px' }}>
                      {selectable && (
                        <input
                          type="checkbox"
                          checked={selectedSet.has(key)}
                          onChange={(e) => {
                            e.stopPropagation();
                            const next = new Set(selectedSet);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            setSelected(Array.from(next));
                          }}
                          onClick={(e) => e.stopPropagation()}
                          style={{ cursor: 'pointer', width: 16, height: 16 }}
                        />
                      )}
                    </td>
                    {orderedVisibleColumns.map(col => (
                      <td
                        key={col.id}
                        className="data-table-td-cell"
                        style={{
                          ...tdStyle,
                          ...columnSizeStyle(col),
                          ...(col.maxWidth != null && columnWidths[col.id] == null ? { maxWidth: col.maxWidth } : {}),
                        }}
                        onClick={col.stopRowPress ? (e: React.MouseEvent) => e.stopPropagation() : undefined}
                      >
                        <View
                          style={styles.cellBodyClip}
                          {...(Platform.OS === 'web' ? ({ className: 'data-table-cell-clip' } as Record<string, string>) : {})}
                        >
                          {col.getValue(row)}
                        </View>
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollView>
      {/* Web 悬停行背景：注入全局样式 */}
      {Platform.OS === 'web' && <TableGlobalStyles />}
    </View>
  );
}

const styles = StyleSheet.create({
  /* 不占满视口、不参与 flex 拉伸，仅包住表格内容高度 */
  wrapper: { 
    width: '100%', 
    alignSelf: 'flex-start', 
    flexGrow: 0, 
    flexShrink: 0, 
    minHeight: 120,
    ...(Platform.OS === 'web' ? { overflow: 'visible' as const } : {}),
  },
  scroll: { alignSelf: 'flex-start', width: '100%', flexGrow: 0 },
  scrollContent: { minWidth: '100%', flexGrow: 0, alignSelf: 'flex-start' },
  /** 行高仍限 40px；水平方向允许内容溢出到相邻区域（与 td overflow-x: visible 一致） */
  cellBodyClip: {
    minWidth: 0,
    maxHeight: 40,
    overflowX: 'visible' as const,
    overflowY: 'hidden' as const,
    justifyContent: 'center' as const,
  },
  columnPickerWrap: { position: 'relative' as const },
  columnPickerBtn: { padding: 4 },
  columnPickerDropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    marginTop: 6,
    backgroundColor: '#FAFBFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    paddingVertical: 12,
    paddingHorizontal: 14,
    minWidth: 220,
    maxWidth: 280,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 12,
  },
  columnPickerDropdownPortal: {
    position: 'absolute' as const,
    zIndex: 99999,
    backgroundColor: '#FAFBFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    paddingVertical: 12,
    paddingHorizontal: 14,
    minWidth: 220,
    maxWidth: 280,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 12,
  },
  columnPickerHeader: { marginBottom: 4 },
  columnPickerTitle: { fontSize: 13, fontWeight: '600', color: '#495057', marginBottom: 4, letterSpacing: 0.2 },
  columnPickerHint: { fontSize: 12, color: '#95A5A6' },
  columnPickerScroll: { maxHeight: 320 },
  columnPickerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, minHeight: 40 },
  columnPickerRowDragging: { opacity: 0.6 },
  columnPickerCheckRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  columnPickerDragHandle: { marginRight: 6 },
  columnPickerCheck: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#BDC3C7',
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  columnPickerCheckOn: { backgroundColor: '#6C5CE7', borderColor: '#6C5CE7' },
  columnPickerLabel: { fontSize: 13, color: '#2D3436', fontWeight: '500' },
  columnPickerOrder: { flexDirection: 'row' },
  columnPickerOrderBtn: { padding: 4 },
  columnPickerOrderBtnDisabled: { opacity: 0.5 },
});
