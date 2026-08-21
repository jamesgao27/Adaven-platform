/**
 * TaxFilingTodosView — 与 client 侧 tax-filing/project/[projectId]/index.tsx 完全一致的
 * Todos 树形列表。可被 client 和 firm 两侧共同复用。
 *
 * 调用方只需提供：
 *   - tree / orderId / clientSpaceId
 *   - createProjectTodo（创建子节点）
 *   - onRefresh（任何操作后告知父级树已更新）
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  useContext,
  type DragEvent as WebDragEvent,
  type MutableRefObject,
  type RefObject,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Pressable,
  Alert,
  Platform,
  Image,
  Dimensions,
  Modal,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { createPortal, flushSync } from 'react-dom';
import { Ionicons } from '@expo/vector-icons';
import {
  getProjectTodosTree,
  getAttachmentsByProjectTodoIds,
  createProjectTodoAttachment,
  deleteProjectTodoAttachment,
  updateProjectTodoAttachment,
  getProjectTodoAttachmentWithContext,
  getProjectTodoAttachmentById,
  getProjectByOrderId,
  updateProjectTodo,
  updateProjectTodoDependsOn,
  changeProjectTodoResponsibleSide,
  deleteProjectTodoWithChildren,
  type ProjectTodoNode,
  type ProjectTodoReceiptSummary,
  moveProjectTodoInTree,
  findTodoNodeById,
  renumberTodoTreeSortOrders,
  type TodoDropPosition,
} from '@/lib/firm';
import { cloneProjectTodoTree, patchProjectTodoInTree } from '@/lib/project-todo-tree-patch';
import { getLatestTaxFilingAttachmentPreviewByAttachmentId } from '../../shared-logic/chat-logs';
import {
  TODO_STATUS_COLOR,
  getStatusLabel,
  getStatusColor,
} from '@/lib/constants/project-todo-status';
import { supabase, uploadTaxFilingFile } from '@/lib/supabase';
import { pickTaxFilingDocument } from '@/lib/tax-filing-document-picker';
import { FileDetailModal } from '@/components/FileDetailModal';
import { showAlertDialog, showConfirmDestructiveDialog } from '@/lib/confirmDialog';
import { alertClientRecognitionQuotaBlocked } from '@/lib/recognition-preflight-ui';
import { router } from 'expo-router';
import { runTaxFilingRecognition } from '@/lib/tax-filing-recognition-run';
import {
  assertClientRecognitionAllowed,
  recordClientRecognitionSuccessIfEnforced,
} from '@/lib/client-recognition-quota';
import { classificationLabelsForTaxFilingPrompt } from '@/lib/tax-filing-project-classification-labels';
import { runWithRecognitionRetry, getUserFacingMessage } from '@/lib/recognition-retry';
import { processTaxFilingAttachmentAfterCreate } from '@/lib/tax-filing-attachment-followup';
import { taxFilingTodoUploadIsImageKind } from '@/lib/tax-filing-todo-upload-helpers';
import { resolveUploaderNameForTaxFilingAttachment } from '@/lib/tax-filing-uploader-name';
import { buildTaxFilingAttachmentDefaultDisplayName } from '@/lib/tax-filing-attachment-display-name';
import { isMobileWebWidth } from '../lib/web-viewport';

// ──────────────────────────────────────────────────
// 常量 & 工具函数
// ──────────────────────────────────────────────────

const TREE_ROW_BG_EVEN = '#FFFFFF';
const TREE_ROW_BG_ODD = '#F8F9FA';

/** Web 拖放幽灵层：单行高度（与占位条一致） */
const TODO_DRAG_GHOST_ROW_HEIGHT = 44;

/** 拖动手柄列占位宽度（隐藏手柄时保留，避免布局跳动） */
const TODO_DRAG_HANDLE_SLOT_WIDTH = 22;

/** 与 TodoTree Web 行一致：chevron 列、WBS 列 */
const TODO_DRAG_GHOST_CHEVRON_COL_W = 28;
const TODO_DRAG_GHOST_WBS_COL_W = 36;
const TODO_DRAG_GHOST_WBS_COL_MR = 8;

function filterProjectTodoTreeForListDisplay(
  roots: ProjectTodoNode[],
  opts: { hideTasksWithNoFiles: boolean; hideCanceledTasks: boolean },
  taskFilesMap: Record<string, ProjectTodoReceiptSummary[]>,
): ProjectTodoNode[] {
  if (!opts.hideTasksWithNoFiles && !opts.hideCanceledTasks) return roots;

  function hideTask(node: ProjectTodoNode): boolean {
    if (node.itemKind !== 'task') return false;
    if (opts.hideCanceledTasks && node.status === 'canceled') return true;
    if (opts.hideTasksWithNoFiles && (taskFilesMap[node.id]?.length ?? 0) === 0) return true;
    return false;
  }

  function walk(nodes: ProjectTodoNode[]): ProjectTodoNode[] {
    const out: ProjectTodoNode[] = [];
    for (const node of nodes) {
      if (node.itemKind === 'task') {
        if (!hideTask(node)) out.push(node);
        continue;
      }
      const children = walk(node.children);
      if (children.length > 0) out.push({ ...node, children });
    }
    return out;
  }

  return walk(roots);
}
const TODO_DRAG_GHOST_SPINE_BASE = 12;
const TODO_DRAG_GHOST_INDENT_UNIT = 14;

/** Chrome：未解码完的 img 作 drag image 时会回退成从左上角飞入的默认图标（地球/文档）；canvas 可同步使用 */
let todoDragBlankCanvas: HTMLCanvasElement | null = null;
function setTodoTreeTransparentDragImage(dt: DataTransfer) {
  if (typeof document === 'undefined') return;
  if (!todoDragBlankCanvas) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    todoDragBlankCanvas = c;
  }
  try {
    const c = todoDragBlankCanvas;
    // Safari：部分版本要求 setDragImage 所用节点在 document 内，否则拖放链可能异常
    if (c.parentNode !== document.body) {
      c.setAttribute('aria-hidden', 'true');
      c.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.appendChild(c);
    }
    dt.setDragImage(c, 0, 0);
  } catch {
    /* Safari 旧版对 canvas drag image 偶发抛错，忽略后仍可用默认幽灵图 */
  }
}

/** Web：canvas 测量，字重/字号与 Todo 标题行一致 */
function measureTodoRenameTextWidthWeb(text: string, fontSize: number, fontWeight: string): number {
  if (typeof document === 'undefined') return 0;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    ctx.font = `${fontWeight} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    let maxLine = 0;
    for (const line of text.split(/\r?\n/)) {
      const m = ctx.measureText(line);
      const w =
        typeof m.actualBoundingBoxLeft === 'number' && typeof m.actualBoundingBoxRight === 'number'
          ? Math.ceil(m.actualBoundingBoxRight - m.actualBoundingBoxLeft)
          : Math.ceil(m.width);
      if (w > maxLine) maxLine = w;
    }
    return maxLine + 8;
  } catch {
    return 0;
  }
}

/** 原生 / 回退：按码位保守加宽，避免中英文混排低估 */
function estimateTodoRenameTextWidthFallback(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0x7f) {
      w += fontSize * 0.68;
    } else if (
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x3000 && cp <= 0x303f) ||
      (cp >= 0xff00 && cp <= 0xffef) ||
      (cp >= 0x3040 && cp <= 0x30ff) ||
      (cp >= 0xac00 && cp <= 0xd7af)
    ) {
      w += fontSize * 1.15;
    } else {
      w += fontSize * 1.08;
    }
  }
  return Math.ceil(w) + 6;
}

function todoRenameTitleFontWeightForDepth(depth: number): string {
  if (depth === 0) return '700';
  if (depth === 1) return '600';
  return '500';
}

function todoRenameInputContentWidthPx(text: string, fontSize: number, depth: number): number {
  const fw = todoRenameTitleFontWeightForDepth(depth);
  if (Platform.OS === 'web') {
    const mw = measureTodoRenameTextWidthWeb(text, fontSize, fw);
    if (mw > 0) return mw;
  }
  return estimateTodoRenameTextWidthFallback(text, fontSize);
}

/** 含边框与内边距，保证输入框宽度不小于现有名称的显示宽度 */
function todoRenameInputMinWidthPx(text: string, fontSize: number, depth: number): number {
  const horizontalChrome = 28;
  return Math.max(96, todoRenameInputContentWidthPx(text, fontSize, depth) + horizontalChrome);
}

function titleFontSizeForTodoDepth(depth: number): number {
  if (depth === 0) return 15;
  if (depth === 1) return 14;
  return 13;
}

/** 全树节点当前标题按层级字号测量后取最大，供行内重命名输入框统一宽度（避免随草稿变宽引起抖动） */
function maxTodoRenameInputWidthAcrossProjectTree(phases: ProjectTodoNode[]): number {
  let maxW = 96;
  const visit = (n: ProjectTodoNode, depth: number) => {
    const fs = titleFontSizeForTodoDepth(depth);
    maxW = Math.max(maxW, todoRenameInputMinWidthPx(n.title ?? '', fs, depth));
    for (const c of n.children) visit(c, depth + 1);
  };
  for (const p of phases) visit(p, 0);
  return maxW;
}

function nextProjectTodoSiblingSortOrder(siblings: ProjectTodoNode[]): number {
  if (siblings.length === 0) return 1;
  return Math.max(...siblings.map((s) => s.sortOrder), 0) + 1;
}

/** 与 createProjectTodo 写入库中的 status 规则一致，供本地合并树 */
function buildInsertedProjectTodoNode(params: {
  id: string;
  orderId: string;
  parentId: string | null;
  title: string;
  itemKind: 'phase' | 'section' | 'task';
  type: 'client' | 'firm';
  sortOrder: number;
  depth: number;
}): ProjectTodoNode {
  const isTask = params.itemKind === 'task';
  const isFirm = params.type === 'firm';
  const status: ProjectTodoNode['status'] = isTask
    ? isFirm
      ? 'in_progress'
      : 'to_submit'
    : 'completed';
  return {
    id: params.id,
    orderId: params.orderId,
    parentId: params.parentId,
    type: params.type,
    initialResponsibleSide: params.type,
    title: params.title,
    description: null,
    status,
    sortOrder: params.sortOrder,
    depth: params.depth,
    itemKind: params.itemKind,
    dependsOnId: null,
    dependsOnIds: [],
    children: [],
  };
}

/** 不可变插入：parentId === null 时在根级末尾追加 phase；否则挂到对应父节点 children 末尾 */
function insertProjectTodoInTreeRoots(
  roots: ProjectTodoNode[],
  parentId: string | null,
  child: ProjectTodoNode,
): ProjectTodoNode[] {
  if (parentId == null) {
    return [...roots, child];
  }
  return roots.map((n) => {
    if (n.id === parentId) {
      return { ...n, children: [...n.children, child] };
    }
    return { ...n, children: insertProjectTodoInTreeRoots(n.children, parentId, child) };
  });
}

/**
 * 父级 onRefresh 后恢复滚动：内层 ScrollView + Web 上祖先链中的 overflow 容器 + document 滚动。
 * Expo Web 常见为中间层 div 滚动而非 window，仅 scrollTo/仅 window 都会表现为「整页回顶」。
 */
type TodosScrollRestorePayload = {
  innerY: number;
  /** 自 ScrollView 可滚动节点之父起，向外每层「可纵向滚动」祖先的 scrollTop，顺序与恢复时一致 */
  ancestorScrollTops: number[];
  windowY: number;
};

function readWebWindowScrollY(): number {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return 0;
  return (
    window.scrollY ||
    window.pageYOffset ||
    document.documentElement?.scrollTop ||
    document.body?.scrollTop ||
    0
  );
}

function writeWebWindowScrollY(y: number) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.scrollTo({ top: y, left: 0, behavior: 'auto' });
}

function readScrollViewYFromRef(ref: RefObject<ScrollView | null>, fallback: number): number {
  const inst = ref.current as unknown as { getScrollableNode?: () => { scrollTop?: number } | null } | null;
  if (!inst?.getScrollableNode) return fallback;
  try {
    const node = inst.getScrollableNode();
    if (node != null && typeof (node as HTMLElement).scrollTop === 'number') {
      return (node as HTMLElement).scrollTop;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

function isElementVerticallyScrollable(el: HTMLElement): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const st = window.getComputedStyle(el);
  const oy = st.overflowY;
  if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') return false;
  return el.scrollHeight > el.clientHeight + 1;
}

function captureTodosScrollPositions(
  ref: RefObject<ScrollView | null>,
  fallbackInner: number,
): TodosScrollRestorePayload {
  const innerY = readScrollViewYFromRef(ref, fallbackInner);
  const ancestorScrollTops: number[] = [];
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return { innerY, ancestorScrollTops, windowY: 0 };
  }
  try {
    const inst = ref.current as unknown as { getScrollableNode?: () => HTMLElement | null } | null;
    let el: HTMLElement | null = inst?.getScrollableNode?.()?.parentElement ?? null;
    for (let d = 0; el && d < 18; d++) {
      if (isElementVerticallyScrollable(el)) {
        ancestorScrollTops.push(el.scrollTop);
      }
      el = el.parentElement;
    }
  } catch {
    /* ignore */
  }
  return { innerY, ancestorScrollTops, windowY: readWebWindowScrollY() };
}

function applyTodosScrollRestore(ref: RefObject<ScrollView | null>, payload: TodosScrollRestorePayload) {
  ref.current?.scrollTo({ y: payload.innerY, animated: false });

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      const inst = ref.current as unknown as { getScrollableNode?: () => HTMLElement | null } | null;
      let el: HTMLElement | null = inst?.getScrollableNode?.()?.parentElement ?? null;
      let i = 0;
      for (let d = 0; el && d < 18; d++) {
        if (isElementVerticallyScrollable(el)) {
          if (i < payload.ancestorScrollTops.length) {
            el.scrollTop = payload.ancestorScrollTops[i]!;
            i += 1;
          }
        }
        el = el.parentElement;
      }
    } catch {
      /* ignore */
    }
    writeWebWindowScrollY(payload.windowY);
  }
}

type TodoGhostRow = {
  title: string;
  itemKind: ProjectTodoNode['itemKind'];
  wbs: string;
  /** 与 TodoTree 中 depth 一致：phase=0，section=1…，用于 12+depth*14 左缩进 */
  renderDepth: number;
  /** 与行内 nodeIsBlocked 一致（父链锁定或本节点在 blockedNodes） */
  nodeIsBlocked: boolean;
  /** 仅 task：责任方，用于 Firm/Client 徽章 */
  responsibleSide?: ProjectTodoNode['type'];
  /** 仅 task：取消态隐藏徽章并套用 treeTitleCanceled */
  status?: ProjectTodoNode['status'];
};

/** 与 allNodesWbsMap / TodoTree 一致的 WBS 与层级深度 */
function buildTodoDragWbsMaps(tree: ProjectTodoNode[]): {
  wbsById: Record<string, string>;
  renderDepthById: Record<string, number>;
} {
  const wbsById: Record<string, string> = {};
  const renderDepthById: Record<string, number> = {};
  tree.forEach((phaseRoot, phaseIndex) => {
    const rootWbs = String(phaseIndex + 1);
    wbsById[phaseRoot.id] = rootWbs;
    renderDepthById[phaseRoot.id] = 0;
    const walk = (nodes: ProjectTodoNode[], prefix: string, parentRenderDepth: number) => {
      nodes.forEach((node, idx) => {
        const wbs = `${prefix}.${idx + 1}`;
        wbsById[node.id] = wbs;
        renderDepthById[node.id] = parentRenderDepth + 1;
        walk(node.children, wbs, parentRenderDepth + 1);
      });
    };
    walk(phaseRoot.children, rootWbs, 0);
  });
  return { wbsById, renderDepthById };
}

/** 展开状态下可见子树行，用于幽灵预览与占位高度（尊重 collapsed）；含原 WBS、责任方、锁定态与表格式 renderDepth */
function collectVisibleTodoGhostRows(
  root: ProjectTodoNode | null | undefined,
  collapsed: Set<string>,
  maps: { wbsById: Record<string, string>; renderDepthById: Record<string, number> },
  blockedNodes: Set<string>,
  /** 拖动容器的 TodoTree 传入的 isBlocked（祖先链已锁） */
  rootAncestorBlocked: boolean,
): TodoGhostRow[] {
  if (!root) return [];
  const out: TodoGhostRow[] = [];
  const walk = (n: ProjectTodoNode, parentChainBlocked: boolean) => {
    const nodeIsBlocked = parentChainBlocked || blockedNodes.has(n.id);
    const isTask = n.itemKind === 'task';
    out.push({
      title: n.title,
      itemKind: n.itemKind,
      wbs: maps.wbsById[n.id] ?? '?',
      renderDepth: maps.renderDepthById[n.id] ?? 0,
      nodeIsBlocked,
      ...(isTask ? { responsibleSide: n.type, status: n.status } : {}),
    });
    if (n.children.length > 0 && !collapsed.has(n.id)) {
      n.children.forEach((c) => walk(c, nodeIsBlocked));
    }
  };
  walk(root, rootAncestorBlocked);
  return out;
}

type TodoDragStartAnchor = {
  clientX: number;
  clientY: number;
  rowElement: HTMLElement;
  ghostRows: TodoGhostRow[];
};

/** 根据 URL 或 docType 返回文件类型图标名 */
function getFileFormatIcon(url: string | null | undefined, docType: string | null | undefined): 'document-text' | 'image' | 'document' {
  const ext = (url ? url.split(/[#?]/)[0].split('.').pop()?.toLowerCase() : '') ?? '';
  if (ext === 'pdf') return 'document-text';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return 'image';
  if (docType) return 'document-text';
  return 'document';
}

function formatFileDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}

const STATUS_PRIORITY = ['to_submit', 'missing_info', 'reviewing', 'in_progress', 'completed'] as const;

function worstStatus(a: string, b: string): string {
  const ia = STATUS_PRIORITY.indexOf(a as any);
  const ib = STATUS_PRIORITY.indexOf(b as any);
  if (ia === -1) return b;
  if (ib === -1) return a;
  return ia <= ib ? a : b;
}

/** 前置依赖小标签用色：红橙蓝绿灰，文字用实色、底色 20% 透明度 */
function getDepStatusColor(status: string): { text: string; bg: string } {
  const R = (r: number, g: number, b: number) => ({ text: `rgb(${r},${g},${b})`, bg: `rgba(${r},${g},${b},0.2)` });
  switch (status) {
    case 'missing_info': return R(231, 76, 60);
    case 'to_submit':    return R(230, 126, 34);
    case 'reviewing':
    case 'in_progress':  return R(52, 152, 219);
    case 'completed':    return R(39, 174, 96);
    case 'canceled':
    default:             return R(127, 140, 141);
  }
}

type HandoffButton = { verb: string; toSide: 'client' | 'firm'; newStatus?: ProjectTodoNode['status']; primary?: boolean };
function findNodeById(nodes: ProjectTodoNode[], id: string): ProjectTodoNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNodeById(n.children, id);
    if (found) return found;
  }
  return null;
}
function getHandoffButtonsForNode(node: ProjectTodoNode | null, viewerRole: 'client' | 'firm', nodeIsBlocked: boolean): HandoffButton[] {
  if (!node || node.itemKind !== 'task' || nodeIsBlocked) return [];
  const status = node.status;
  const buttons: HandoffButton[] = [];
  if (viewerRole === 'client') {
    switch (status) {
      case 'to_submit':
      case 'missing_info':
        buttons.push({ verb: 'Submit to firm', toSide: 'firm', newStatus: 'reviewing', primary: true });
        break;
      case 'reviewing':
      case 'in_progress':
        buttons.push({ verb: 'Recall', toSide: 'client', newStatus: 'to_submit', primary: true });
        break;
      default:
        break;
    }
  } else {
    switch (status) {
      case 'to_submit':
      case 'missing_info':
        buttons.push({ verb: 'Take over', toSide: 'firm', newStatus: 'in_progress', primary: true });
        break;
      case 'reviewing':
      case 'in_progress':
        buttons.push({ verb: 'Confirm', toSide: 'firm', newStatus: 'completed', primary: true });
        buttons.push({ verb: 'Return to client', toSide: 'client', newStatus: 'missing_info', primary: false });
        break;
      default:
        break;
    }
  }
  return buttons;
}

export function collectTaskIds(nodes: ProjectTodoNode[]): string[] {
  const ids: string[] = [];
  function walk(list: ProjectTodoNode[]) {
    list.forEach((n) => {
      if (n.itemKind === 'task') ids.push(n.id);
      walk(n.children);
    });
  }
  walk(nodes);
  return ids;
}

type TodoDragContextValue = {
  enabled: boolean;
  draggingId: string | null;
  /** 与 draggingId 同步，但在 startDrag 内先写入，保证首帧 dragover 即可 preventDefault */
  draggingIdRef: MutableRefObject<string | null>;
  dragOver: { targetId: string; position: TodoDropPosition } | null;
  /** 与 dragOver state 同步，drop 时读取避免闭包滞后于最后一次 dragover */
  dragOverRef: MutableRefObject<{ targetId: string; position: TodoDropPosition } | null>;
  /** 预览树有效时：目标位用占位条，与幽灵层不重复 */
  previewActive: boolean;
  placeholderRowCount: number;
  treeRef: MutableRefObject<ProjectTodoNode[]>;
  startDrag: (id: string, anchor?: TodoDragStartAnchor) => void;
  endDrag: () => void;
  setDragOver: (v: { targetId: string; position: TodoDropPosition } | null) => void;
  commitDrop: (targetId: string, position: TodoDropPosition) => Promise<void>;
};

const TodoDragContext = createContext<TodoDragContextValue | null>(null);

/** true：桌面 Web 表格布局（缩进、拖放、悬停）；false：与原生 App 一致（含手机浏览器窄屏）。 */
const TaxFilingTodoDesktopWebLayoutContext = createContext(true);

/** Web 拖放：按纵向位置决定 before / into / after */
function pickTodoDropBand(
  clientY: number,
  rectTop: number,
  rectHeight: number,
  draggingKind: 'phase' | 'section' | 'task',
  targetKind: 'phase' | 'section' | 'task',
): TodoDropPosition {
  const y = clientY - rectTop;
  const frac = rectHeight > 0 ? y / rectHeight : 0.5;
  const canInto =
    (targetKind === 'phase' && draggingKind === 'section') ||
    (targetKind === 'section' && draggingKind === 'task');
  if (canInto && frac > 0.28 && frac < 0.72) return 'into';
  return frac < 0.5 ? 'before' : 'after';
}

function useNodeStats(nodes: ProjectTodoNode[]) {
  return useMemo(() => {
    const taskTotal: Record<string, number> = {};
    const taskSuccess: Record<string, number> = {};
    const effectiveStatus: Record<string, string> = {};

    function walk(list: ProjectTodoNode[]): { total: number; success: number; status: string } {
      let total = 0;
      let success = 0;
      let status: string = 'completed';
      list.forEach((n) => {
        if (n.itemKind === 'task') {
          taskTotal[n.id] = 1;
          effectiveStatus[n.id] = n.status;
          if (n.status === 'canceled') {
            taskSuccess[n.id] = 0;
          } else {
            total += 1;
            if (n.status === 'completed') success += 1;
            status = worstStatus(status, n.status);
            taskSuccess[n.id] = n.status === 'completed' ? 1 : 0;
          }
        } else {
          const sub = walk(n.children);
          total += sub.total;
          success += sub.success;
          status = worstStatus(status, sub.status);
          taskTotal[n.id] = sub.total;
          taskSuccess[n.id] = sub.success;
          effectiveStatus[n.id] = sub.status;
        }
      });
      return { total, success, status };
    }
    walk(nodes);
    return { taskTotal, taskSuccess, effectiveStatus };
  }, [nodes]);
}

// ──────────────────────────────────────────────────
// AddPhaseInputRow（点击 Add a phase 后显示，录入名称并聚焦）
// ──────────────────────────────────────────────────

function AddPhaseInputRow({
  onConfirm,
  onCancel,
  contentMaxWidth,
}: {
  onConfirm: (title: string) => void;
  onCancel: () => void;
  contentMaxWidth?: number;
}) {
  const [title, setTitle] = useState('');
  const inputRef = useRef<TextInput>(null);
  const titleRef = useRef(title);
  titleRef.current = title;
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm(titleRef.current);
  }, [onConfirm]);

  const inputRowStyle = contentMaxWidth != null
    ? [ts.addPhaseInputRow, { maxWidth: contentMaxWidth }]
    : ts.addPhaseInputRow;

  return (
    <View style={ts.addPhaseRow}>
      <View style={inputRowStyle}>
        <TextInput
          ref={inputRef}
          style={ts.addPhaseInput}
          value={title}
          onChangeText={setTitle}
          placeholder="New phase name"
          placeholderTextColor="#95A5A6"
          returnKeyType="done"
          onSubmitEditing={handleConfirm}
          blurOnSubmit
        />
        <Pressable style={ts.cancelAddBtn} onPress={onCancel} hitSlop={8}>
          <Ionicons name="close-outline" size={16} color="#95A5A6" />
        </Pressable>
        <Pressable style={ts.confirmAddBtn} onPress={handleConfirm} hitSlop={8}>
          <Ionicons name="checkmark-outline" size={16} color="#6C5CE7" />
        </Pressable>
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────────
// PendingAddRow
// ──────────────────────────────────────────────────

function PendingAddRow({
  parentId,
  parentType,
  nextWbsCode,
  depth,
  rowBg,
  maxLeftBlockWidth,
  onConfirm,
  onCancel,
}: {
  parentId: string;
  parentType: ProjectTodoNode['type'];
  nextWbsCode: string;
  depth: number;
  rowBg: string;
  maxLeftBlockWidth: number;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const inputRef = useRef<TextInput>(null);
  const titleRef = useRef(title);
  titleRef.current = title;
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm(titleRef.current);
  }, [onConfirm]);

  const isTaskDepth = depth >= 2;
  // phase / section 用 depth 缩进；真正的 task 再额外缩进一大截，肉眼可见
  const indent = depth * 14 + (isTaskDepth ? 24 : 0);
  const titleFontSize = depth === 0 ? 15 : depth === 1 ? 14 : 13;
  const addPlaceholder = depth === 0 ? 'New section name' : 'New task name';
  return (
    <View style={ts.treeRowWrap}>
      <View style={[ts.treeRow, ts.pendingAddRow, { backgroundColor: rowBg }]}>
        <View style={[ts.treeRowLeftBlock, { width: maxLeftBlockWidth }]}>
          <View style={{ width: 12 + indent }} />
          <View style={ts.chevronWrap} />
          <View style={ts.wbsHotzone}>
            <Text
              style={ts.wbsColText}
              {...(Platform.OS === 'web' ? { numberOfLines: 1 } : {})}
            >
              {nextWbsCode}
            </Text>
          </View>
          <View style={ts.pendingAddInputRow}>
            <TextInput
              ref={inputRef}
              style={[ts.pendingAddInput, { fontSize: titleFontSize }]}
              value={title}
              onChangeText={setTitle}
              placeholder={addPlaceholder}
              placeholderTextColor="#95A5A6"
              returnKeyType="done"
              onSubmitEditing={handleConfirm}
              blurOnSubmit
            />
            <Pressable style={ts.cancelAddBtn} onPress={onCancel} hitSlop={8}>
              <Ionicons name="close-outline" size={16} color="#95A5A6" />
            </Pressable>
            <Pressable style={ts.confirmAddBtn} onPress={handleConfirm} hitSlop={8}>
              <Ionicons name="checkmark-outline" size={16} color="#6C5CE7" />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────────
// TodoTree (recursive)
// ──────────────────────────────────────────────────

function TodoTree({
  nodes,
  depth,
  wbsPrefix,
  blockIndex,
  collapsed,
  taskFilesExpanded,
  taskFilesMap,
  nodeStats,
  maxLeftBlockWidth,
  parentRowBg,
  viewerRole,
  blockedNodes,
  isBlocked = false,
  allNodesFlat,
  depsPanelNodeId,
  setDepsPanelNodeId,
  onSetDependsOn,
  onToggleCollapse,
  onToggleTaskFiles,
  rowIdShowingAdd,
  setRowIdShowingAdd,
  rowIdShowingDeps,
  setRowIdShowingDeps,
  hideDepsTimeoutRef,
  addIconHighlightedRowId,
  setAddIconHighlightedRowId,
  hideAddTimeoutRef,
  rowIdShowingDragHandle,
  setRowIdShowingDragHandle,
  hideDragHandleTimeoutRef,
  pendingParentId,
  onStartAddChild,
  onConfirmAddChild,
  onCancelAddChild,
  onCancelTask,
  onRestoreTask,
  onUploadFile,
  onRemoveFile,
  onRequestMoveFile,
  onFileRowPress,
  onHandoffTask,
  onRequestDeletePhase,
  phaseAndSectionWithWbs,
  rowFileColHoverId,
  setRowFileColHoverId,
  hideFileColTimeoutRef,
  rowIdShowingStatusVerb,
  setRowIdShowingStatusVerb,
  onRetryRecognizeFile,
  catalogMode = false,
  onCatalogDeleteItem,
  onCatalogUpdateType,
  hideDepsEditor = false,
  renameInline = null,
  onRenameInlineTitleChange,
  onCancelRenameInline,
  onConfirmRenameInline,
  renameInlineSaving = false,
  onStartRenameInline,
  renameInlineListInputWidthPx = 96,
  fileRenameInline = null,
  onFileRenameTitleChange,
  onCancelFileRename,
  onConfirmFileRename,
  fileRenameSaving = false,
  onStartFileRename,
  fileRowHoverKey = null,
  onFileRowHoverIn,
  onFileRowHoverOut,
}: {
  nodes: ProjectTodoNode[];
  depth: number;
  wbsPrefix: string;
  blockIndex?: number;
  collapsed: Set<string>;
  taskFilesExpanded: Set<string>;
  taskFilesMap: Record<string, ProjectTodoReceiptSummary[]>;
  nodeStats: { taskTotal: Record<string, number>; taskSuccess: Record<string, number>; effectiveStatus: Record<string, string> };
  maxLeftBlockWidth: number;
  parentRowBg?: string;
  viewerRole: 'client' | 'firm';
  /** 通过 depends_on_id 计算得出的全部被锁节点 ID 集合（含传递性扩展） */
  blockedNodes: Set<string>;
  /** 父级已被锁定时为 true，子节点直接继承 */
  isBlocked?: boolean;
  /** 扁平化的全树节点（供依赖候选列表 / 状态计算使用） */
  allNodesFlat: ProjectTodoNode[];
  /** 当前展开依赖选择浮窗的节点 id（null=无） */
  depsPanelNodeId: string | null;
  setDepsPanelNodeId: (id: string | null) => void;
  onSetDependsOn: (nodeId: string, dependsOnIds: string[] | null) => void;
  /** 所有 phase / section 节点及其 WBS 编号，供任务前置依赖选单使用 */
  phaseAndSectionWithWbs: { id: string; wbs: string; title: string }[];
  onToggleCollapse: (id: string) => void;
  onToggleTaskFiles: (id: string) => void;
  rowIdShowingAdd?: string | null;
  setRowIdShowingAdd?: (id: string | null) => void;
  rowIdShowingDeps?: string | null;
  setRowIdShowingDeps?: (id: string | null) => void;
  hideDepsTimeoutRef?: { current: ReturnType<typeof setTimeout> | null };
  addIconHighlightedRowId?: string | null;
  setAddIconHighlightedRowId?: (id: string | null) => void;
  hideAddTimeoutRef?: { current: ReturnType<typeof setTimeout> | null };
  rowIdShowingDragHandle?: string | null;
  setRowIdShowingDragHandle?: (id: string | null) => void;
  hideDragHandleTimeoutRef?: { current: ReturnType<typeof setTimeout> | null };
  /** zone2：文件计数列 hover，显示 Upload */
  rowFileColHoverId?: string | null;
  setRowFileColHoverId?: (id: string | null) => void;
  hideFileColTimeoutRef?: { current: ReturnType<typeof setTimeout> | null };
  /** zone3：状态标签点击后，该行状态 pill 变为动词按钮 */
  rowIdShowingStatusVerb?: string | null;
  setRowIdShowingStatusVerb?: (id: string | null) => void;
  pendingParentId?: string | null;
  onStartAddChild?: (parentId: string) => void;
  onConfirmAddChild?: (parentId: string, parentType: ProjectTodoNode['type'], title: string) => void;
  onCancelAddChild?: () => void;
  onCancelTask?: (todoId: string) => void;
  /** 恢复（从 canceled）或重启（从 completed）；传 initialResponsibleSide 以重置责任方 */
  onRestoreTask?: (todoId: string, initialResponsibleSide: 'client' | 'firm') => void;
  onUploadFile?: (todoId: string) => void;
  onRemoveFile?: (todoId: string, attachmentId: string) => void;
  /** 长按文件行时请求移动到其他 task，由父组件弹选单并调用 updateProjectTodoAttachment */
  onRequestMoveFile?: (attachmentId: string, fromTodoId: string) => void;
  /** 文件识别失败或卡住时，点击重试识别 */
  onRetryRecognizeFile?: (attachmentId: string) => void;
  /** 点击文件行时打开大浮窗展示文件详情（缩略图 + 识别内容） */
  onFileRowPress?: (attachmentId: string, todoId: string) => void;
  onHandoffTask?: (todoId: string, from: 'client' | 'firm', to: 'client' | 'firm', verb: string, newStatus?: ProjectTodoNode['status']) => void;
  /** 仅 phase 行：点击带圈 - 时请求删除该 phase 及所有子级（浮窗二次确认） */
  onRequestDeletePhase?: (phaseId: string, phaseTitle: string) => void;
  /** Catalog 模式：隐藏状态/文件列，task 的 - 为删除，责任方可点击切换 */
  catalogMode?: boolean;
  onCatalogDeleteItem?: (itemId: string) => void;
  onCatalogUpdateType?: (itemId: string, type: 'client' | 'firm') => void;
  /** 只读预览：不展示 depends on 编辑入口（仅展示已有依赖） */
  hideDepsEditor?: boolean;
  /** Web：当前行内重命名状态（与 PendingAddRow 同交互） */
  renameInline?: { id: string; title: string } | null;
  onRenameInlineTitleChange?: (text: string) => void;
  onCancelRenameInline?: () => void;
  onConfirmRenameInline?: () => void | Promise<void>;
  renameInlineSaving?: boolean;
  /** Web：点击铅笔进入行内重命名 */
  onStartRenameInline?: (nodeId: string, currentTitle: string) => void;
  /** Web：由整棵树最长标题算出的统一输入框宽度（px） */
  renameInlineListInputWidthPx?: number;
  /** Web：task 下附件行内重命名（与 renameInline 同交互） */
  fileRenameInline?: { attachmentId: string; todoId: string; title: string } | null;
  onFileRenameTitleChange?: (text: string) => void;
  onCancelFileRename?: () => void;
  onConfirmFileRename?: () => void | Promise<void>;
  fileRenameSaving?: boolean;
  onStartFileRename?: (attachmentId: string, todoId: string, currentTitle: string) => void;
  /** Web：与任务行一致，悬停附件行时显示改名铅笔 */
  fileRowHoverKey?: string | null;
  onFileRowHoverIn?: (todoId: string, attachmentId: string) => void;
  onFileRowHoverOut?: (todoId: string, attachmentId: string) => void;
}) {
  const dragCtx = useContext(TodoDragContext);
  const isDesktopWebTree = useContext(TaxFilingTodoDesktopWebLayoutContext);
  // 桌面 Web：保留层级缩进；移动端与手机浏览器与 App 一致，左对齐为主
  const indentUnit = isDesktopWebTree ? 14 : 0;
  const baseIndent = isDesktopWebTree ? depth * indentUnit : 0;
  const { taskTotal, taskSuccess, effectiveStatus } = nodeStats;
  const [activeDepChipId, setActiveDepChipId] = useState<string | null>(null);
  const [depsControlsNodeId, setDepsControlsNodeId] = useState<string | null>(null);

  return (
    <>
      {nodes.map((node, idx) => {
        if (isDesktopWebTree && dragCtx?.enabled && dragCtx.previewActive && dragCtx.draggingId === node.id) {
          const h = Math.max(1, dragCtx.placeholderRowCount) * TODO_DRAG_GHOST_ROW_HEIGHT;
          return (
            <View key={node.id} style={ts.treeRowWrap} pointerEvents="none">
              <View
                style={{
                  height: h,
                  marginHorizontal: 4,
                  marginVertical: 1,
                  borderRadius: 8,
                  backgroundColor: 'rgba(108, 92, 231, 0.06)',
                  borderWidth: 1,
                  borderColor: 'rgba(108, 92, 231, 0.28)',
                  borderStyle: 'dashed',
                }}
              />
            </View>
          );
        }
        const firstInGroupBg = parentRowBg === undefined
          ? TREE_ROW_BG_EVEN
          : parentRowBg === TREE_ROW_BG_EVEN
            ? TREE_ROW_BG_ODD
            : TREE_ROW_BG_EVEN;
        const rowBg = idx % 2 === 0
          ? firstInGroupBg
          : firstInGroupBg === TREE_ROW_BG_EVEN
            ? TREE_ROW_BG_ODD
            : TREE_ROW_BG_EVEN;
        const hasChildren = node.children.length > 0;
        const isCollapsed = collapsed.has(node.id);
        const isTask = node.itemKind === 'task';
        // task 相比同级 section 再整体右移一段距离，明显区分层级
        const indent = baseIndent + (isTask ? 24 : 0);
        const filesExpanded = taskFilesExpanded.has(node.id);
        const files = taskFilesMap[node.id] ?? [];

        const wbsCode = depth === 0 && blockIndex !== undefined
          ? String(blockIndex + idx + 1)
          : (wbsPrefix ? `${wbsPrefix}.${idx + 1}` : String(idx + 1));
        const total = taskTotal[node.id] ?? 0;
        const success = taskSuccess[node.id] ?? 0;
        const status = isTask ? node.status : effectiveStatus[node.id];
        const showStatus = isTask ? true : isCollapsed && total > 0;
        const showNm = isCollapsed && total > 0;
        const isCanceled = isTask && node.status === 'canceled';

        // ── 节点锁定：父级锁定时继承，或本节点自身有未完成前置 ──
        const nodeIsBlocked = isBlocked || blockedNodes.has(node.id);
        const isThisRowRenaming = renameInline != null && renameInline.id === node.id;

        // ── 角色权限 + 阶段锁定判断 ──
        const isSelfTodo = node.type === viewerRole;
        const canUpload        = !nodeIsBlocked && (isSelfTodo || viewerRole === 'firm');
        const canCancelRestore = !nodeIsBlocked && (isSelfTodo || viewerRole === 'firm');
        const canAddChild      = !nodeIsBlocked && !isTask;

        const titleStyle =
          depth === 0 ? ts.treeTitleL0 : depth === 1 ? ts.treeTitleL1 : ts.treeTitleL2;
        const titleFontSize = depth === 0 ? 15 : depth === 1 ? 14 : 13;

        // 终止权限：client 仅能终止责任方为 client 的非 completed；firm 可终止所有非 completed
        const canTerminateForRow =
          node.status !== 'completed' &&
          (viewerRole === 'firm' || (viewerRole === 'client' && node.type === 'client'));

        // phase/section 判定（section 用 depth===1 兜底）
        const isPhaseOrSectionRow = node.itemKind === 'phase' || node.itemKind === 'section' || (depth === 1 && !isTask);
        // row-level hover：用于显示 +（section/phase）或 -/restart / Upload / 提交按钮；
        // 任务行在可终止/可重启时也显示；catalog 模式 task 显示删除。只读时全部不显示。
        // 移动端与手机浏览器不需要桌面 Web 的悬停行内工具；仅桌面 Web 启用。
        const enableRowIcons = isDesktopWebTree;
        const showRowIconsOnTouch = enableRowIcons && !hideDepsEditor &&
          (typeof onStartRenameInline === 'function' ||
          ((onStartAddChild && canAddChild) ||
          (isTask && (catalogMode ? !!onCatalogDeleteItem : (canUpload || canCancelRestore || canTerminateForRow || isCanceled || node.status === 'completed'))) ||
          (onRequestDeletePhase != null && isPhaseOrSectionRow)));

        // phase 上 +Section，section 上 +Task；其他非 task 节点兜底为 Child
        const addChildLabel =
          node.itemKind === 'phase'
            ? 'Section'
            : node.itemKind === 'section'
            ? 'Task'
            : 'Child';

        const showAddIcon = onStartAddChild && canAddChild && rowIdShowingAdd === node.id;
        const addChildButton =
          onStartAddChild && canAddChild && showRowIconsOnTouch && showAddIcon ? (
            <TouchableOpacity
              style={ts.addChildPill}
              onPress={() => onStartAddChild(node.id)}
              onPressIn={() => setAddIconHighlightedRowId?.(node.id)}
              onPressOut={() => setAddIconHighlightedRowId?.(null)}
              activeOpacity={0.7}
              hitSlop={8}
            >
              <Ionicons
                name={addIconHighlightedRowId === node.id ? 'add-circle' : 'add-circle-outline'}
                size={14}
                color="#6C5CE7"
              />
              <Text
                style={[
                  ts.addChildPillText,
                  addIconHighlightedRowId === node.id && ts.addChildPillTextActive,
                ]}
                numberOfLines={1}
              >
                {addChildLabel}
              </Text>
            </TouchableOpacity>
          ) : null;

        /** phase / section 行：与 + 同区域触摸出现，带圈 - 用于删除该节点及所有子级 */
        const showDeletePhaseIcon =
          isPhaseOrSectionRow &&
          rowIdShowingAdd === node.id &&
          onRequestDeletePhase != null;
        const deletePhaseIconInline = showDeletePhaseIcon ? (
          <TouchableOpacity
            style={ts.deletePhaseIconWrap}
            onPress={() => onRequestDeletePhase(node.id, node.title)}
            activeOpacity={0.6}
            hitSlop={8}
          >
            <View style={ts.deletePhaseIconBtn}>
              <Ionicons name="remove" size={8} color="#FFF" />
            </View>
          </TouchableOpacity>
        ) : null;

        const showTaskIcons = rowIdShowingAdd === node.id;

        // zone2：文件计数列 + 右侧空白，单独控制 Upload 按钮显示；只读时不显示 Upload 且不响应 hover。
        // 移动端与手机浏览器：触摸热区；桌面 Web：hover 显示 Upload。
        const showUpload = isDesktopWebTree && !hideDepsEditor && rowFileColHoverId === node.id;

        // zone2：文件计数列 + 右侧空白，hover 时点亮 Upload（高度充满整行）；只读时不绑定
        const fileColHoverHandlers = !hideDepsEditor && setRowFileColHoverId
          ? (isDesktopWebTree
              ? {
                  onMouseEnter: () => setRowFileColHoverId(node.id),
                  onMouseLeave: () => setRowFileColHoverId(null),
                }
              : {
                  onTouchStart: () => setRowFileColHoverId(node.id),
                  onTouchEnd: () => setRowFileColHoverId(null),
                })
          : undefined;

        const progressColContent = catalogMode ? (
          <View style={ts.progressFilesCol} />
        ) : !isDesktopWebTree ? (
          // 移动端：icon + 文件计数，与名称、状态标间距紧凑
          <View style={ts.progressFilesColMobile} {...(fileColHoverHandlers as any)}>
            {showNm ? (
              <Text style={ts.nmTextMobile} numberOfLines={1}>{success}/{total}</Text>
            ) : isTask ? (
              <TouchableOpacity
                style={ts.filesToggleMobile}
                onPress={() => {
                  if (files.length === 0) return;
                  onToggleTaskFiles(node.id);
                }}
                activeOpacity={0.7}
              >
                <Ionicons name={filesExpanded ? 'document' : 'document-outline'} size={14} color="#6C5CE7" />
                <Text style={ts.filesToggleText} numberOfLines={1}>{files.length}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          <View style={ts.progressFilesCol} {...(fileColHoverHandlers as any)}>
            {showNm ? (
              <Text style={ts.nmText} numberOfLines={1}>{success}/{total}</Text>
            ) : isTask ? (
              <View style={ts.progressFilesColInner}>
                <TouchableOpacity
                  style={ts.filesToggle}
                  onPress={() => {
                    if (files.length === 0) return;
                    onToggleTaskFiles(node.id);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name={filesExpanded ? 'document' : 'document-outline'} size={14} color="#6C5CE7" />
                  <Text style={ts.filesToggleText} numberOfLines={1}>{files.length}</Text>
                </TouchableOpacity>
                {showUpload && onUploadFile && !isCanceled && !nodeIsBlocked && canUpload && !hideDepsEditor ? (
                  <Pressable style={ts.uploadTaskBtnHotzone} onPress={() => onUploadFile(node.id)}>
                    <View style={ts.uploadTaskBtn}>
                      <Ionicons name="cloud-upload-outline" size={12} color="#FFF" />
                      <Text style={ts.uploadTaskBtnText}>Upload</Text>
                    </View>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        );

        // 状态列：按附图「当前登录者 + 当前状态」决定按钮与流转后状态
        type HandoffButton = { verb: string; toSide: 'client' | 'firm'; newStatus?: ProjectTodoNode['status']; primary?: boolean };
        const handoffButtons: HandoffButton[] = [];

        if (!nodeIsBlocked && isTask && onHandoffTask) {
          if (viewerRole === 'client') {
            switch (status) {
              case 'to_submit':
              case 'missing_info':
                handoffButtons.push({ verb: 'Submit to firm', toSide: 'firm', newStatus: 'reviewing', primary: true });
                break;
              case 'reviewing':
              case 'in_progress':
                handoffButtons.push({ verb: 'Recall', toSide: 'client', newStatus: 'to_submit', primary: true });
                break;
              default:
                break;
            }
          } else {
            // firm 视角
            switch (status) {
              case 'to_submit':
              case 'missing_info':
                handoffButtons.push({ verb: 'Take over', toSide: 'firm', newStatus: 'in_progress', primary: true });
                break;
              case 'reviewing':
              case 'in_progress':
                handoffButtons.push({ verb: 'Confirm', toSide: 'firm', newStatus: 'completed', primary: true });
                handoffButtons.push({ verb: 'Return to client', toSide: 'client', newStatus: 'missing_info', primary: false });
                break;
              default:
                break;
            }
          }
        }

        const showStatusVerb = !hideDepsEditor && rowIdShowingStatusVerb === node.id && handoffButtons.length > 0;

        // catalog 模式不显示状态列
        let statusColContent: React.ReactNode = null;
        if (!catalogMode) {
          // 行内稳定显示提交/召回等按钮（Web 与移动端一致）
          if (showStatusVerb) {
            statusColContent = (
              <View style={ts.statusActionsRow}>
                {handoffButtons.map((btn) => (
                  <TouchableOpacity
                    key={btn.verb}
                    style={btn.primary !== false ? ts.statusActionBtn : ts.statusActionBtnSecondary}
                    onPress={() => {
                      setRowIdShowingStatusVerb?.(null);
                      onHandoffTask?.(node.id, node.type, btn.toSide, btn.verb, btn.newStatus);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={ts.statusPillText}>{btn.verb}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            );
          }
          // 移动端：phase / section / task 行统一用小圆点；Web 保持原有 pill 逻辑
          else if (!isDesktopWebTree && showStatus) {
            const baseStatus = isTask && isCanceled ? 'canceled' : status;
            const dotColor = nodeIsBlocked
              ? '#B2BEC3'
              : getStatusColor(baseStatus, node.type, viewerRole);
            statusColContent = <View style={[ts.statusDot, { backgroundColor: dotColor }]} />;
          } else if (isTask && isCanceled) {
            statusColContent = (
              <View style={[ts.statusPill, { backgroundColor: getStatusColor('canceled', node.type, viewerRole) }]}>
                <Text style={ts.statusPillText} numberOfLines={1}>
                  {getStatusLabel('canceled', node.type, viewerRole)}
                </Text>
              </View>
            );
          }
          // Web 上：被依赖阻塞的 task 行显示 Pending pill；phase/section 无状态 pill
          else if (nodeIsBlocked) {
            statusColContent = isTask ? (
              <View style={[ts.statusPill, ts.statusPillPending]}>
                <Text style={ts.statusPillPendingText}>Pending</Text>
              </View>
            ) : null;
          } else if (showStatus) {
            statusColContent = (
              <View style={[ts.statusPill, { backgroundColor: getStatusColor(status, node.type, viewerRole) }]}>
                <Text style={ts.statusPillText} numberOfLines={1}>
                  {getStatusLabel(status, node.type, viewerRole)}
                </Text>
              </View>
            );
          }
        }

        const onCollapsePress = hasChildren ? () => onToggleCollapse(node.id) : undefined;
        // 行级“显示操作”标记：仅由各自热区控制（Zone1 / Zone2 / Zone3），不再从标题点击透传
        const showRowIconsOnTouchStart = setRowIdShowingAdd
          ? () => {
              if (hideAddTimeoutRef?.current) {
                clearTimeout(hideAddTimeoutRef.current);
                hideAddTimeoutRef.current = null;
              }
              setRowIdShowingAdd(node.id);
            }
          : undefined;
        const showRowIconsOnTouchEnd = setRowIdShowingAdd && hideAddTimeoutRef
          ? () => {
              if (hideAddTimeoutRef.current) clearTimeout(hideAddTimeoutRef.current);
              hideAddTimeoutRef.current = setTimeout(() => setRowIdShowingAdd?.(null), 400);
            }
          : undefined;

        // collapse 行为只挂在 chevron 与 WBS / 标题点击，不再顺带点亮操作按钮；
        // 若当前有其他行在显示状态按钮，则先收起该行按钮，本次点击只用于关闭，不触发折叠/展开。
        const collapseHandlers = onCollapsePress
          ? {
              onPress: () => {
                if (rowIdShowingStatusVerb && rowIdShowingStatusVerb !== node.id) {
                  setRowIdShowingStatusVerb?.(null);
                  return;
                }
                onCollapsePress();
              },
              activeOpacity: 0.85 as const,
            }
          : undefined;

        // 责任方标签放在任务名称前（与标题同一行）；catalog 模式下可点击切换 client/firm；移动端不显示
        const roleBadgeInline = isDesktopWebTree && isTask && !isCanceled ? (
          catalogMode && onCatalogUpdateType ? (
            isThisRowRenaming ? (
              <View
                style={[
                  ts.roleBadgeInlineWrap,
                  ts.roleBadge,
                  node.type === 'firm' ? ts.roleBadgeFirm : ts.roleBadgeClient,
                ]}
              >
                <Text style={ts.roleBadgeText}>{node.type === 'firm' ? 'Firm' : 'Client'}</Text>
              </View>
            ) : (
              <Pressable
                style={[
                  ts.roleBadgeInlineWrap,
                  ts.roleBadge,
                  node.type === 'firm' ? ts.roleBadgeFirm : ts.roleBadgeClient,
                ]}
                onPress={() => onCatalogUpdateType(node.id, node.type === 'client' ? 'firm' : 'client')}
              >
                <Text style={ts.roleBadgeText}>{node.type === 'firm' ? 'Firm' : 'Client'}</Text>
              </Pressable>
            )
          ) : (
            <View
              style={[
                ts.roleBadgeInlineWrap,
                ts.roleBadge,
                nodeIsBlocked ? ts.roleBadgePending : (node.type === 'firm' ? ts.roleBadgeFirm : ts.roleBadgeClient),
              ]}
            >
              <Text style={ts.roleBadgeText}>{node.type === 'firm' ? 'Firm' : 'Client'}</Text>
            </View>
          )
        ) : null;

        const titleContentOnly = (
          <View style={ts.treeTitleWrapAdaptive}>
            {roleBadgeInline}
            {nodeIsBlocked && (depth === 0 || depth === 1) ? (
              <Ionicons name="lock-closed-outline" size={11} color="#B2BEC3" style={{ marginRight: 5, marginTop: 1 }} />
            ) : null}
            <Text
              style={[
                ts.treeTitleAdaptive,
                titleStyle,
                isCanceled && ts.treeTitleCanceled,
                nodeIsBlocked && { color: '#B2BEC3' },
              ]}
              numberOfLines={1}
            >
              {node.title}
            </Text>
          </View>
        );

        const activeInlineRename =
          isDesktopWebTree &&
          renameInline &&
          renameInline.id === node.id &&
          onRenameInlineTitleChange &&
          onCancelRenameInline &&
          onConfirmRenameInline
            ? renameInline
            : null;

        const wbsExtraSpacingForTask = !isDesktopWebTree && isTask ? { marginRight: 6 } : null;
        const WbsCell = collapseHandlers && !activeInlineRename ? (
          <TouchableOpacity style={[ts.wbsHotzone, wbsExtraSpacingForTask]} {...collapseHandlers}>
            <Text
              style={ts.wbsColText}
              {...(isDesktopWebTree ? { numberOfLines: 1 } : {})}
            >
              {wbsCode}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={[ts.wbsHotzone, wbsExtraSpacingForTask]}>
            <Text
              style={ts.wbsColText}
              {...(isDesktopWebTree ? { numberOfLines: 1 } : {})}
            >
              {wbsCode}
            </Text>
          </View>
        );

        const titleCellShowAddHandlers =
          showRowIconsOnTouch && isPhaseOrSectionRow
            ? { onTouchStart: showRowIconsOnTouchStart, onTouchEnd: showRowIconsOnTouchEnd }
            : undefined;
        const clearStatusVerb = () => setRowIdShowingStatusVerb?.(null);

        const renameLockForInline =
          nodeIsBlocked && (depth === 0 || depth === 1) ? (
            <Ionicons
              name="lock-closed-outline"
              size={11}
              color="#B2BEC3"
              style={{ marginRight: 5, marginTop: 1 }}
            />
          ) : null;

        const renameInlineTrailJsx = activeInlineRename ? (
          <View style={ts.renameInlineInputTrail}>
            <TextInput
              style={[
                ts.pendingAddInput,
                {
                  flex: 0,
                  flexGrow: 0,
                  flexShrink: 0,
                  width: renameInlineListInputWidthPx,
                  minWidth: renameInlineListInputWidthPx,
                  maxWidth: renameInlineListInputWidthPx,
                  fontSize: titleFontSize,
                  paddingLeft: isDesktopWebTree ? 6 : 2,
                  ...(isDesktopWebTree
                    ? ({
                        boxSizing: 'border-box',
                        outlineStyle: 'none',
                        outlineWidth: 0,
                        overflowX: 'auto' as const,
                      } as object)
                    : {}),
                },
              ]}
              value={activeInlineRename.title}
              onChangeText={(t) => onRenameInlineTitleChange!(t)}
              placeholder="Item name"
              placeholderTextColor="#95A5A6"
              returnKeyType="done"
              editable={!renameInlineSaving}
              onSubmitEditing={() => {
                void onConfirmRenameInline!();
              }}
              blurOnSubmit
              autoFocus
            />
            <View style={ts.renameInlineActions}>
              <Pressable
                style={ts.cancelAddBtn}
                onPress={onCancelRenameInline}
                hitSlop={8}
                disabled={renameInlineSaving}
                {...(isDesktopWebTree
                  ? ({
                      onMouseDown: (e: { preventDefault?: () => void }) => e.preventDefault?.(),
                    } as object)
                  : {})}
              >
                <Ionicons name="close-outline" size={16} color="#95A5A6" />
              </Pressable>
              <Pressable
                style={ts.confirmAddBtn}
                onPress={() => {
                  void onConfirmRenameInline!();
                }}
                hitSlop={8}
                disabled={renameInlineSaving}
                {...(isDesktopWebTree
                  ? ({
                      onMouseDown: (e: { preventDefault?: () => void }) => e.preventDefault?.(),
                    } as object)
                  : {})}
              >
                {renameInlineSaving ? (
                  <ActivityIndicator size="small" color="#6C5CE7" />
                ) : (
                  <Ionicons name="checkmark-outline" size={16} color="#6C5CE7" />
                )}
              </Pressable>
            </View>
          </View>
        ) : null;

        const TitleCellRename = activeInlineRename ? (
          <View style={[ts.titleHotzone, { flex: 1, minWidth: 0 }]}>
            <View style={[ts.treeTitleWrapAdaptive, ts.renameTitleRow]}>
              <View style={ts.renameLeadCluster}>
                {roleBadgeInline}
                {renameLockForInline}
              </View>
              <View style={ts.renameInlineTitleTrack}>{renameInlineTrailJsx}</View>
            </View>
          </View>
        ) : null;

        const TitleCell = onCollapsePress ? (
          <TouchableOpacity
            style={ts.titleHotzone}
            onPress={() => {
              if (rowIdShowingStatusVerb && rowIdShowingStatusVerb !== node.id) {
                clearStatusVerb();
                return;
              }
              clearStatusVerb();
              (collapseHandlers as any)?.onPress?.();
            }}
            {...titleCellShowAddHandlers}
          >
            {titleContentOnly}
          </TouchableOpacity>
        ) : isTask && files.length > 0 ? (
          <TouchableOpacity
            style={ts.titleHotzone}
            onPress={() => {
              if (rowIdShowingStatusVerb && rowIdShowingStatusVerb !== node.id) {
                clearStatusVerb();
                return;
              }
              clearStatusVerb();
              onToggleTaskFiles(node.id);
            }}
            activeOpacity={0.85}
          >
            {titleContentOnly}
          </TouchableOpacity>
        ) : titleCellShowAddHandlers ? (
          <TouchableOpacity
            style={ts.titleHotzone}
            onPress={clearStatusVerb}
            {...titleCellShowAddHandlers}
            activeOpacity={1}
          >
            {titleContentOnly}
          </TouchableOpacity>
        ) : (
          <View style={ts.titleHotzone}>{titleContentOnly}</View>
        );

        // 任务前置依赖（仅 task 行）：多选列表，每项用该条目的状态色
        const isDepsOpen = depsPanelNodeId === node.id;
        const depIds = isTask ? ((node as any).dependsOnIds ?? (node.dependsOnId ? [node.dependsOnId] : [])) : [];
        const depChipInfos = depIds.map((depId: string) => {
          const item = phaseAndSectionWithWbs.find((p) => p.id === depId);
          const st = effectiveStatus[depId] ?? 'completed';
          return { depId, wbs: item?.wbs ?? '?', title: item?.title ?? '', status: st };
        });

        const showAddHandlers = showRowIconsOnTouch
          ? (isDesktopWebTree
              ? {
                  onMouseEnter: showRowIconsOnTouchStart,
                  onMouseLeave: showRowIconsOnTouchEnd,
                }
              : {
                  onTouchStart: showRowIconsOnTouchStart,
                  onTouchEnd: showRowIconsOnTouchEnd,
                })
          : undefined;

        // Web 端：标题右侧保留 + / - / restart 等操作图标；
        // 移动端：仅保留名称本身，不在名称右侧占位操作位容器。
        const ADD_ICON_SLOT_WIDTH = 24;
        const AddIconSlot = onStartAddChild && !isTask ? (
          <View style={[ts.addIconSlot, { width: ADD_ICON_SLOT_WIDTH }]} pointerEvents="box-none">
            {addChildButton}
          </View>
        ) : null;
        const RemovePhaseIconSlot = showDeletePhaseIcon ? (
          <View style={[ts.addIconSlot, ts.deletePhaseIconSlot]} pointerEvents="box-none">
            {deletePhaseIconInline}
          </View>
        ) : null;
        const CancelTaskSlot = enableRowIcons && !catalogMode && !hideDepsEditor &&
          isTask && !isCanceled && onCancelTask && showTaskIcons && !nodeIsBlocked && canTerminateForRow ? (
            <Pressable style={ts.terminateTaskBtnHotzone} onPress={() => onCancelTask(node.id)}>
              <View style={ts.terminateTaskBtnIcon}>
                <Ionicons name="remove-circle-outline" size={14} color="#E67E22" />
              </View>
            </Pressable>
          ) : null;
        const CatalogDeleteTaskSlot =
          enableRowIcons && catalogMode && isTask && onCatalogDeleteItem && showTaskIcons ? (
            <Pressable style={ts.terminateTaskBtnHotzone} onPress={() => onCatalogDeleteItem(node.id)}>
              <View style={ts.deletePhaseIconBtn}>
                <Ionicons name="remove" size={8} color="#FFF" />
              </View>
            </Pressable>
          ) : null;
        const RestoreTaskSlot = enableRowIcons && !catalogMode && !hideDepsEditor &&
          isTask && isCanceled && onRestoreTask && showTaskIcons ? (
            <Pressable style={ts.restoreTaskBtnHotzone} onPress={() => onRestoreTask(node.id, node.initialResponsibleSide)}>
              <View style={ts.restoreTaskBtnIcon}>
                <Ionicons name="refresh-circle-outline" size={14} color="#7DCEA0" />
              </View>
            </Pressable>
          ) : null;
        const RestartTaskSlot = enableRowIcons && !catalogMode && !hideDepsEditor &&
          isTask && node.status === 'completed' && onRestoreTask && showTaskIcons ? (
            <Pressable style={ts.restoreTaskBtnHotzone} onPress={() => onRestoreTask(node.id, node.initialResponsibleSide)}>
              <View style={ts.restoreTaskBtnIcon}>
                <Ionicons name="refresh-circle-outline" size={14} color="#7DCEA0" />
              </View>
            </Pressable>
          ) : null;

        const showEditTitleIcon =
          enableRowIcons &&
          typeof onStartRenameInline === 'function' &&
          !hideDepsEditor &&
          rowIdShowingAdd === node.id &&
          !(renameInline && renameInline.id === node.id) &&
          (!isTask || (!isCanceled && node.status !== 'completed'));
        const EditTitleSlot = showEditTitleIcon ? (
          <Pressable
            style={ts.terminateTaskBtnHotzone}
            onPress={() => onStartRenameInline(node.id, node.title)}
            hitSlop={6}
          >
            <Ionicons name="create-outline" size={14} color="#6C5CE7" />
          </Pressable>
        ) : null;

        const TitleColumnInner = isDesktopWebTree ? (
          activeInlineRename ? (
            <>{TitleCellRename}</>
          ) : (
            <>
            {TitleCell}
            {EditTitleSlot}
            {RemovePhaseIconSlot}
            {AddIconSlot}
            {CancelTaskSlot}
            {CatalogDeleteTaskSlot}
            {RestoreTaskSlot}
            {RestartTaskSlot}
          </>
          )
        ) : (
          <>{TitleCell}</>
        );

        // 行内重命名时不要挂 mouseLeave 延时清 rowIdShowingAdd，减少与点击/焦点竞争；且此时本行也不展示 +/-
        const titleColumnHoverHandlers =
          showAddHandlers && !activeInlineRename ? showAddHandlers : undefined;
        const TitleColumnWrap = titleColumnHoverHandlers ? (
          <View style={ts.titleColumnWrap} {...titleColumnHoverHandlers}>
            {TitleColumnInner}
          </View>
        ) : (
          <View style={ts.titleColumnWrap}>
            {TitleColumnInner}
          </View>
        );

        // Web 端：chevron 可点击以收起/展开；移动端：仅保留缩进，不显示 chevron
        const chevronBtn = hasChildren && isDesktopWebTree ? (
          onCollapsePress && !activeInlineRename ? (
            <Pressable style={ts.chevronWrap} onPress={onCollapsePress} hitSlop={6}>
              <Ionicons name={isCollapsed ? 'chevron-forward' : 'chevron-down'} size={14} color="#636E72" />
            </Pressable>
          ) : (
            <View style={ts.chevronWrap}>
              <Ionicons name={isCollapsed ? 'chevron-forward' : 'chevron-down'} size={14} color="#636E72" />
            </View>
          )
        ) : (
          <View style={ts.chevronWrap} />
        );

        const IndentChevronShowAddArea = (
          <>
            {/* Web：保留层级缩进；移动端：全部行无缩进，左端对齐 */}
            <View style={{ width: isDesktopWebTree ? 12 + baseIndent : 0 }} />
            {chevronBtn}
          </>
        );

        // RN Web 的 View 不保证转发 HTML5 draggable / drop；手柄必须用原生 div（与 DataTable 列拖放一致）
        // draggingIdRef 在 dragstart 内同步写入，早于 setState，避免重渲染卸掉 draggable 前手柄被误判隐藏
        const showDragHandle =
          isDesktopWebTree &&
          dragCtx?.enabled &&
          (rowIdShowingDragHandle === node.id ||
            dragCtx.draggingId === node.id ||
            dragCtx.draggingIdRef.current === node.id);
        const dragHandleEl =
          isDesktopWebTree && dragCtx?.enabled ? (
            activeInlineRename ? (
              <View style={{ width: TODO_DRAG_HANDLE_SLOT_WIDTH, marginRight: 2, flexShrink: 0 }} />
            ) : showDragHandle ? (
              <div
                style={{
                  width: TODO_DRAG_HANDLE_SLOT_WIDTH,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  alignSelf: 'stretch',
                  marginRight: 2,
                  cursor: 'grab',
                  flexShrink: 0,
                  userSelect: 'none',
                  // Safari：子节点（SVG）会干扰原生 drag；配合内层 WebkitUserDrag:none 使用
                  WebkitUserDrag: 'element',
                }}
                draggable
                onDragStart={(e: WebDragEvent<HTMLDivElement>) => {
                  e.stopPropagation();
                  if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', node.id);
                    setTodoTreeTransparentDragImage(e.dataTransfer);
                  }
                  const rowEl = (e.currentTarget as HTMLElement).closest('[data-todo-row]') as HTMLElement | null;
                  const maps = buildTodoDragWbsMaps(dragCtx.treeRef.current);
                  const ghostRows = collectVisibleTodoGhostRows(
                    findNodeById(dragCtx.treeRef.current, node.id),
                    collapsed,
                    maps,
                    blockedNodes,
                    isBlocked ?? false,
                  );
                  const rows: TodoGhostRow[] =
                    ghostRows.length > 0
                      ? ghostRows
                      : [
                          {
                            title: node.title,
                            itemKind: node.itemKind,
                            wbs: maps.wbsById[node.id] ?? '?',
                            renderDepth: maps.renderDepthById[node.id] ?? 0,
                            nodeIsBlocked: (isBlocked ?? false) || blockedNodes.has(node.id),
                            ...(node.itemKind === 'task'
                              ? { responsibleSide: node.type, status: node.status }
                              : {}),
                          },
                        ];
                  if (rowEl) {
                    dragCtx.startDrag(node.id, {
                      clientX: e.clientX,
                      clientY: e.clientY,
                      rowElement: rowEl,
                      ghostRows: rows,
                    });
                  } else {
                    dragCtx.startDrag(node.id);
                  }
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                    WebkitUserDrag: 'none',
                  }}
                >
                  <Ionicons name="swap-vertical-outline" size={17} color="#95A5A6" />
                </span>
              </div>
            ) : (
              <View style={{ width: TODO_DRAG_HANDLE_SLOT_WIDTH, marginRight: 2, flexShrink: 0 }} />
            )
          ) : null;

        const leftBlockContent = (
          <>
            {dragHandleEl}
            {IndentChevronShowAddArea}
            {WbsCell}
            {TitleColumnWrap}
          </>
        );

        // 状态列：Web 为 hover 显示按钮；移动端为点击切换，行内稳定显示不随抬起消失
        const statusHoverHandlers =
          !activeInlineRename &&
          !hideDepsEditor &&
          handoffButtons.length > 0 &&
          setRowIdShowingStatusVerb
          ? (isDesktopWebTree
              ? {
                  onMouseEnter: () => setRowIdShowingStatusVerb(node.id),
                  onMouseLeave: () => setRowIdShowingStatusVerb(null),
                }
              : {
                  onPress: () => setRowIdShowingStatusVerb(rowIdShowingStatusVerb === node.id ? null : node.id),
                })
          : undefined;

        // Web：使用宽度固定的 progressFilesCol；
        // 移动端：仅使用更窄的 progressFilesColMobile，避免多占名称空间
        const progressColWrapStyle = isDesktopWebTree ? ts.progressFilesCol : ts.progressFilesColMobile;
        const ProgressCell = collapseHandlers && !activeInlineRename ? (
          <TouchableOpacity style={progressColWrapStyle} {...collapseHandlers}>
            {progressColContent}
          </TouchableOpacity>
        ) : (
          <View style={progressColWrapStyle}>{progressColContent}</View>
        );

        const statusColStyle = showStatusVerb && !isDesktopWebTree ? [ts.statusCol, ts.statusColExpanded] : ts.statusCol;
        const StatusCell = (
          <View style={ts.statusColWithGap}>
            {statusHoverHandlers && !isDesktopWebTree ? (
              <TouchableOpacity style={statusColStyle} onPress={statusHoverHandlers.onPress} activeOpacity={0.8}>
                {statusColContent}
              </TouchableOpacity>
            ) : (
              <View style={statusColStyle} {...(statusHoverHandlers as any)}>{statusColContent}</View>
            )}
          </View>
        );

        // 当前登录方负责的 task：左侧 accent 线凸显（锁定 / 取消 状态不显示）
        const crossRoleAccent = !nodeIsBlocked && isSelfTodo && isTask && !isCanceled
          ? { borderLeftColor: node.type === 'firm' ? '#A29BFE' : '#74B9FF' }
          : {};
        const todoDropHighlight =
          isDesktopWebTree &&
          dragCtx?.enabled &&
          dragCtx.draggingId &&
          dragCtx.draggingId !== node.id &&
          dragCtx.dragOver?.targetId === node.id
            ? dragCtx.previewActive
              ? dragCtx.dragOver.position === 'into'
                ? { borderWidth: 2, borderColor: '#6C5CE7' }
                : {}
              : dragCtx.dragOver.position === 'before'
                ? { borderTopWidth: 2, borderTopColor: '#6C5CE7' }
                : dragCtx.dragOver.position === 'after'
                  ? { borderBottomWidth: 2, borderBottomColor: '#6C5CE7' }
                  : { borderWidth: 2, borderColor: '#6C5CE7' }
            : {};
        const rowContainerStyle = [
          ts.treeRow,
          { backgroundColor: rowBg },
          // section 行：标准分割线；task 行：更弱一点的分割线
          node.itemKind === 'section' && { borderTopWidth: 1, borderTopColor: '#E9ECEF' },
          isTask && { borderTopWidth: 1, borderTopColor: '#F3F4F6' },
          crossRoleAccent,
          todoDropHighlight,
        ];

        const dragHandleRevealHandlers =
          isDesktopWebTree && dragCtx?.enabled && setRowIdShowingDragHandle && hideDragHandleTimeoutRef
            ? {
                onMouseEnter: () => {
                  if (hideDragHandleTimeoutRef.current) {
                    clearTimeout(hideDragHandleTimeoutRef.current);
                    hideDragHandleTimeoutRef.current = null;
                  }
                  setRowIdShowingDragHandle(node.id);
                },
                onMouseLeave: () => {
                  if (hideDragHandleTimeoutRef.current) clearTimeout(hideDragHandleTimeoutRef.current);
                  hideDragHandleTimeoutRef.current = setTimeout(() => setRowIdShowingDragHandle(null), 320);
                },
                onTouchStart: () => {
                  if (hideDragHandleTimeoutRef.current) {
                    clearTimeout(hideDragHandleTimeoutRef.current);
                    hideDragHandleTimeoutRef.current = null;
                  }
                  setRowIdShowingDragHandle(node.id);
                },
                onTouchEnd: () => {
                  if (hideDragHandleTimeoutRef.current) clearTimeout(hideDragHandleTimeoutRef.current);
                  hideDragHandleTimeoutRef.current = setTimeout(() => setRowIdShowingDragHandle(null), 700);
                },
              }
            : null;

        // 与 Add 列一致：整行 touchEnd / mouseLeave 时延时收起 Depends on，避免“最后一个不消失”（触摸到其他行再抬起时由该行触发收起）
        const hideDepsOnRowHandlers = !catalogMode && setRowIdShowingDeps && hideDepsTimeoutRef
          ? (isDesktopWebTree
              ? {
                  onMouseLeave: () => {
                    if (hideDepsTimeoutRef.current) clearTimeout(hideDepsTimeoutRef.current);
                    hideDepsTimeoutRef.current = setTimeout(() => setRowIdShowingDeps(null), 280);
                  },
                }
              : {
                  onTouchEnd: () => {
                    if (hideDepsTimeoutRef.current) clearTimeout(hideDepsTimeoutRef.current);
                    hideDepsTimeoutRef.current = setTimeout(() => setRowIdShowingDeps(null), 280);
                  },
                })
          : {};

        // 项目详情：无关联行仅 Depends on 列热区触摸/悬停时显；有关联行常显。SKU 详情（catalogMode）：Depends on 常显。只读时仅显示有值的，空的不显示且不响应触摸
        const hasDeps = depChipInfos.length > 0;
        const showDepsContent = (hasDeps || catalogMode) || (rowIdShowingDeps === node.id && !hideDepsEditor);
        const depsColHotzoneHandlers = !catalogMode && !hideDepsEditor && setRowIdShowingDeps && hideDepsTimeoutRef
          ? (isDesktopWebTree
              ? {
                  onMouseEnter: () => {
                    if (hideDepsTimeoutRef.current) {
                      clearTimeout(hideDepsTimeoutRef.current);
                      hideDepsTimeoutRef.current = null;
                    }
                    setRowIdShowingDeps(node.id);
                  },
                  onMouseLeave: () => {
                    if (hideDepsTimeoutRef.current) clearTimeout(hideDepsTimeoutRef.current);
                    hideDepsTimeoutRef.current = setTimeout(() => setRowIdShowingDeps(null), 280);
                  },
                }
              : {
                  onTouchStart: () => setRowIdShowingDeps(node.id),
                  onTouchEnd: () => setRowIdShowingDeps(null),
                })
          : {};
        // 移动端移除「Depends on」列，仅保留：责任竖条、WBS、名称、文件计数、状态圆点、提交等（点圆点浮层）
        const TaskDepsCol = isTask && isDesktopWebTree ? (
          activeInlineRename ? (
            hideDepsEditor && !hasDeps ? (
              <View style={ts.taskDepsCol} />
            ) : showDepsContent ? (
              hideDepsEditor ? (
                <View style={ts.taskDepsCol}>
                  <Text style={ts.taskDepsLabel}>Depends on</Text>
                  {hasDeps ? (
                    <View style={ts.taskDepsChipsWrap}>
                      {depChipInfos.map((info: { depId: string; wbs: string; title: string; status: string }) => {
                        const { text, bg } = getDepStatusColor(info.status);
                        return (
                          <View
                            key={info.depId}
                            style={[ts.taskDepsChip, { backgroundColor: bg }]}
                          >
                            <Text style={[ts.taskDepsChipText, { color: text }]}>{info.wbs}</Text>
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={ts.taskDepsLabel} numberOfLines={1}>—</Text>
                  )}
                </View>
              ) : (
                <View style={ts.taskDepsCol}>
                  <Text style={ts.taskDepsLabel}>Depends on</Text>
                  {hasDeps ? (
                    <View style={ts.taskDepsChipsWrap}>
                      {depChipInfos.map((info: { depId: string; wbs: string; title: string; status: string }) => {
                        const { text, bg } = getDepStatusColor(info.status);
                        return (
                          <View
                            key={info.depId}
                            style={[ts.taskDepsChip, { backgroundColor: bg }]}
                          >
                            <Text style={[ts.taskDepsChipText, { color: text }]}>{info.wbs}</Text>
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                  {!nodeIsBlocked && (
                    <View style={ts.taskDepsTrigger}>
                      <Ionicons name="add-circle-outline" size={12} color="#B2BEC3" />
                    </View>
                  )}
                </View>
              )
            ) : (
              <View style={[ts.taskDepsCol]} />
            )
          ) : hideDepsEditor && !hasDeps ? (
            <View style={ts.taskDepsCol} />
          ) : showDepsContent ? (
            hideDepsEditor ? (
              <View style={ts.taskDepsCol}>
                <Text style={ts.taskDepsLabel}>Depends on</Text>
                {hasDeps ? (
                  <View style={ts.taskDepsChipsWrap}>
                    {depChipInfos.map((info: { depId: string; wbs: string; title: string; status: string }) => {
                      const { text, bg } = getDepStatusColor(info.status);
                      return (
                        <View
                          key={info.depId}
                          style={[ts.taskDepsChip, { backgroundColor: bg }]}
                        >
                          <Text style={[ts.taskDepsChipText, { color: text }]}>{info.wbs}</Text>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={ts.taskDepsLabel} numberOfLines={1}>—</Text>
                )}
              </View>
            ) : (
              <Pressable
                style={ts.taskDepsCol}
                onPress={() => {
                  setDepsPanelNodeId(isDepsOpen ? null : node.id);
                }}
              >
                <Text style={ts.taskDepsLabel}>Depends on</Text>
                {hasDeps ? (
                  <View style={ts.taskDepsChipsWrap}>
                    {depChipInfos.map((info: { depId: string; wbs: string; title: string; status: string }) => {
                      const { text, bg } = getDepStatusColor(info.status);
                      return (
                        <View
                          key={info.depId}
                          style={[ts.taskDepsChip, { backgroundColor: bg }]}
                        >
                          <Text style={[ts.taskDepsChipText, { color: text }]}>{info.wbs}</Text>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
                {!nodeIsBlocked && (
                  <View style={ts.taskDepsTrigger}>
                    <Ionicons name="add-circle-outline" size={12} color="#B2BEC3" />
                  </View>
                )}
              </Pressable>
            )
          ) : (
            <View style={[ts.taskDepsCol]} {...depsColHotzoneHandlers} />
          )
        ) : null;

        // 移动端：左侧块弹性占满，右侧文件计数+状态圆点紧凑靠右，名称获得更多空间
        // Web 行内重命名：整段左侧叠在 Progress/Status 列之上，避免溢出时按钮被后绘制的右列抢走点击
        const leftBlockStyle = isDesktopWebTree
          ? [
              ts.treeRowLeftBlock,
              { width: maxLeftBlockWidth },
              ...(activeInlineRename
                ? ([{ position: 'relative' as const, zIndex: 2 }] as const)
                : ([] as const)),
            ]
          : [ts.treeRowLeftBlock, ts.treeRowLeftBlockMobile];
        const leftBlockFull = (
          <View style={leftBlockStyle}>
            {leftBlockContent}
          </View>
        );

        // catalogMode（如 onboarding 只读 SKU 树）：移动端不展示文件/状态/依赖列，右侧无内容却曾占位 ~80+32px，挤压标题省略
        const rowRightCols =
          catalogMode && !isDesktopWebTree
            ? null
            : // 移动端：显示提交/召回等按钮时，用按钮覆盖文件计数+状态标区域
            showStatusVerb && !isDesktopWebTree ? (
              <View style={ts.treeRowRightColsWrap}>
                {StatusCell}
              </View>
            ) : (
              // Web 端：无论是否显示提交/召回按钮，都保留 Progress 列 + 状态列 + Depends 列
              <View style={ts.treeRowRightColsWrap}>
                {activeInlineRename ? null : ProgressCell}
                {activeInlineRename ? null : StatusCell}
                {TaskDepsCol}
              </View>
            );

        const rowContent = (
          <>
            {leftBlockFull}
            {rowRightCols}
          </>
        );

        const RowOuter = isDesktopWebTree ? View : Pressable;

        return (
          <RowOuter
            key={node.id}
            style={ts.treeRowWrap}
            {...(isDesktopWebTree
              ? {}
              : {
                  onPress: () => {
                    if (rowIdShowingStatusVerb) {
                      setRowIdShowingStatusVerb?.(null);
                    }
                  },
                })}
          >
            {isDesktopWebTree && dragCtx?.enabled ? (
              <div
                data-todo-row={node.id}
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'stretch',
                  boxSizing: 'border-box',
                  ...(StyleSheet.flatten(rowContainerStyle) as object),
                }}
                {...(activeInlineRename ? {} : (hideDepsOnRowHandlers as object))}
                onMouseEnter={() => {
                  if (activeInlineRename) return;
                  dragHandleRevealHandlers?.onMouseEnter?.();
                }}
                onMouseLeave={() => {
                  if (activeInlineRename) return;
                  (hideDepsOnRowHandlers as { onMouseLeave?: () => void }).onMouseLeave?.();
                  dragHandleRevealHandlers?.onMouseLeave?.();
                }}
                onTouchStart={() => {
                  if (activeInlineRename) return;
                  dragHandleRevealHandlers?.onTouchStart?.();
                }}
                onTouchEnd={() => {
                  if (activeInlineRename) return;
                  (hideDepsOnRowHandlers as { onTouchEnd?: () => void }).onTouchEnd?.();
                  dragHandleRevealHandlers?.onTouchEnd?.();
                }}
              >
                {rowContent}
              </div>
            ) : (
              <View style={rowContainerStyle} {...(activeInlineRename ? {} : hideDepsOnRowHandlers)}>
                {rowContent}
              </View>
            )}
            {hasChildren && !isCollapsed && (
              <TodoTree
                nodes={node.children}
                depth={depth + 1}
                wbsPrefix={wbsCode}
                collapsed={collapsed}
                taskFilesExpanded={taskFilesExpanded}
                taskFilesMap={taskFilesMap}
                nodeStats={nodeStats}
                maxLeftBlockWidth={maxLeftBlockWidth}
                parentRowBg={rowBg}
                viewerRole={viewerRole}
                blockedNodes={blockedNodes}
                isBlocked={nodeIsBlocked}
                allNodesFlat={allNodesFlat}
                depsPanelNodeId={depsPanelNodeId}
                setDepsPanelNodeId={setDepsPanelNodeId}
                onSetDependsOn={onSetDependsOn}
                onToggleCollapse={onToggleCollapse}
                onToggleTaskFiles={onToggleTaskFiles}
                rowIdShowingAdd={rowIdShowingAdd}
                setRowIdShowingAdd={setRowIdShowingAdd}
                rowIdShowingDeps={rowIdShowingDeps}
                setRowIdShowingDeps={setRowIdShowingDeps}
                hideDepsTimeoutRef={hideDepsTimeoutRef}
                addIconHighlightedRowId={addIconHighlightedRowId}
                setAddIconHighlightedRowId={setAddIconHighlightedRowId}
                hideAddTimeoutRef={hideAddTimeoutRef}
                rowIdShowingDragHandle={rowIdShowingDragHandle}
                setRowIdShowingDragHandle={setRowIdShowingDragHandle}
                hideDragHandleTimeoutRef={hideDragHandleTimeoutRef}
                pendingParentId={pendingParentId}
                onStartAddChild={onStartAddChild}
                onConfirmAddChild={onConfirmAddChild}
                onCancelAddChild={onCancelAddChild}
                onCancelTask={onCancelTask}
                onRestoreTask={onRestoreTask}
                onUploadFile={onUploadFile}
                onRemoveFile={onRemoveFile}
                onRequestMoveFile={onRequestMoveFile}
                onRetryRecognizeFile={onRetryRecognizeFile}
                onFileRowPress={onFileRowPress}
                onHandoffTask={onHandoffTask}
                onRequestDeletePhase={onRequestDeletePhase}
                phaseAndSectionWithWbs={phaseAndSectionWithWbs}
                rowFileColHoverId={rowFileColHoverId}
                setRowFileColHoverId={setRowFileColHoverId}
                hideFileColTimeoutRef={hideFileColTimeoutRef}
                rowIdShowingStatusVerb={rowIdShowingStatusVerb}
                setRowIdShowingStatusVerb={setRowIdShowingStatusVerb}
                catalogMode={catalogMode}
                onCatalogDeleteItem={onCatalogDeleteItem}
                onCatalogUpdateType={onCatalogUpdateType}
                hideDepsEditor={hideDepsEditor}
                renameInline={renameInline}
                onRenameInlineTitleChange={onRenameInlineTitleChange}
                onCancelRenameInline={onCancelRenameInline}
                onConfirmRenameInline={onConfirmRenameInline}
                renameInlineSaving={renameInlineSaving}
                onStartRenameInline={onStartRenameInline}
                renameInlineListInputWidthPx={renameInlineListInputWidthPx}
                fileRenameInline={fileRenameInline}
                onFileRenameTitleChange={onFileRenameTitleChange}
                onCancelFileRename={onCancelFileRename}
                onConfirmFileRename={onConfirmFileRename}
                fileRenameSaving={fileRenameSaving}
                onStartFileRename={onStartFileRename}
                fileRowHoverKey={fileRowHoverKey}
                onFileRowHoverIn={onFileRowHoverIn}
                onFileRowHoverOut={onFileRowHoverOut}
              />
            )}
            {pendingParentId === node.id && onConfirmAddChild && onCancelAddChild && (
              <PendingAddRow
                parentId={node.id}
                parentType={node.type}
                nextWbsCode={node.children.length > 0 ? `${wbsCode}.${node.children.length + 1}` : `${wbsCode}.1`}
                depth={depth + 1}
                rowBg={
                  node.children.length % 2 === 0
                    ? (rowBg === TREE_ROW_BG_EVEN ? TREE_ROW_BG_ODD : TREE_ROW_BG_EVEN)
                    : rowBg
                }
                maxLeftBlockWidth={maxLeftBlockWidth}
                onConfirm={(t) => onConfirmAddChild(node.id, node.type, t)}
                onCancel={onCancelAddChild}
              />
            )}
            {isTask && filesExpanded && files.length > 0 && (
              <View
                style={[
                  ts.filesBlock,
                  {
                    // 与任务行相同的左右留白：左 4 + 右 12，背景贯通整个 phase 容器内部宽度
                    marginLeft: 4,
                    marginRight: 12,
                    // 斑马色：行是浅灰时附件区用白色，行为白色时附件区用浅灰
                    backgroundColor: rowBg === TREE_ROW_BG_EVEN ? TREE_ROW_BG_ODD : TREE_ROW_BG_EVEN,
                  },
                ]}
              >
                {files.length === 0 ? null : (
                  <View style={isDesktopWebTree ? { paddingLeft: 12 + indent + 24, paddingRight: 0 } : ts.filesBlockMobile}>
                    <View style={ts.fileTable}>
                      {(files as ProjectTodoReceiptSummary[]).map((f, fileIdx) => {
                        const fileRowBg = fileIdx % 2 === 0 ? TREE_ROW_BG_EVEN : TREE_ROW_BG_ODD;
                        const status = f.status ?? 'PENDING_AI';
                        const canShowRetryIcon = status === 'FAILED_ONCE' || status === 'FAILED_TWICE';
                        const displayName = f.name?.trim() || f.docType || 'Attachment';
                        const fileRowHoverMatchKey = `${node.id}\u001f${f.id}`;
                        const activeFileRename =
                          isDesktopWebTree &&
                          fileRenameInline != null &&
                          fileRenameInline.attachmentId === f.id &&
                          fileRenameInline.todoId === node.id;
                        const showFileRenamePencil =
                          isDesktopWebTree &&
                          !hideDepsEditor &&
                          typeof onStartFileRename === 'function' &&
                          !activeFileRename &&
                          fileRowHoverKey === fileRowHoverMatchKey;
                        const fileRowWebHoverHandlers =
                          isDesktopWebTree &&
                          !hideDepsEditor &&
                          onStartFileRename &&
                          onFileRowHoverIn &&
                          onFileRowHoverOut &&
                          !activeFileRename
                            ? ({
                                onMouseEnter: () => onFileRowHoverIn(node.id, f.id),
                                onMouseLeave: () => onFileRowHoverOut(node.id, f.id),
                              } as object)
                            : null;
                        const fileRenameTrailJsx =
                          activeFileRename && onFileRenameTitleChange && fileRenameInline ? (
                            <View style={ts.fileRenameInlineNameRow}>
                              <TextInput
                                style={ts.fileRenameNameInput}
                                value={fileRenameInline.title}
                                onChangeText={(t) => onFileRenameTitleChange(t)}
                                placeholder="File name"
                                placeholderTextColor="#95A5A6"
                                returnKeyType="done"
                                editable={!fileRenameSaving}
                                onSubmitEditing={() => {
                                  void onConfirmFileRename?.();
                                }}
                                blurOnSubmit
                                autoFocus
                              />
                              <View style={ts.renameInlineActions}>
                                <Pressable
                                  style={ts.cancelAddBtn}
                                  onPress={onCancelFileRename}
                                  hitSlop={8}
                                  disabled={fileRenameSaving}
                                  {...(isDesktopWebTree
                                    ? ({
                                        onMouseDown: (e: { preventDefault?: () => void }) => e.preventDefault?.(),
                                      } as object)
                                    : {})}
                                >
                                  <Ionicons name="close-outline" size={16} color="#95A5A6" />
                                </Pressable>
                                <Pressable
                                  style={ts.confirmAddBtn}
                                  onPress={() => {
                                    void onConfirmFileRename?.();
                                  }}
                                  hitSlop={8}
                                  disabled={fileRenameSaving}
                                  {...(isDesktopWebTree
                                    ? ({
                                        onMouseDown: (e: { preventDefault?: () => void }) => e.preventDefault?.(),
                                      } as object)
                                    : {})}
                                >
                                  {fileRenameSaving ? (
                                    <ActivityIndicator size="small" color="#6C5CE7" />
                                  ) : (
                                    <Ionicons name="checkmark-outline" size={16} color="#6C5CE7" />
                                  )}
                                </Pressable>
                              </View>
                            </View>
                          ) : null;
                        return (
                          <TouchableOpacity
                            key={f.id}
                            style={[
                              ts.fileRow,
                              !isDesktopWebTree && ts.fileRowMobile,
                              { backgroundColor: fileRowBg },
                              fileIdx === (files as ProjectTodoReceiptSummary[]).length - 1 && ts.fileRowLast,
                            ]}
                            {...(fileRowWebHoverHandlers ?? {})}
                            onPress={() => {
                              if (!activeFileRename) onFileRowPress?.(f.id, node.id);
                            }}
                            disabled={!!activeFileRename}
                            activeOpacity={0.8}
                          >
                            <View style={ts.fileColIcon}>
                              <Ionicons name={getFileFormatIcon(f.imageUrl ?? null, f.docType)} size={isDesktopWebTree ? 18 : 16} color="#6C5CE7" />
                            </View>
                            <View style={ts.fileColNameDesc}>
                              {fileRenameTrailJsx ? (
                                fileRenameTrailJsx
                              ) : (
                                <View
                                  style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 4,
                                    flex: 1,
                                    minWidth: 0,
                                  }}
                                >
                                  <Text style={ts.fileRowName} numberOfLines={1}>
                                    {displayName}
                                  </Text>
                                  {isDesktopWebTree && !hideDepsEditor && canShowRetryIcon && (
                                    <Pressable
                                      style={ts.restoreTaskBtnHotzone}
                                      onPress={() => onRetryRecognizeFile?.(f.id)}
                                      hitSlop={8}
                                    >
                                      <View style={ts.restoreTaskBtnIcon}>
                                        <Ionicons name="refresh-circle-outline" size={14} color="#7DCEA0" />
                                      </View>
                                    </Pressable>
                                  )}
                                  {showFileRenamePencil ? (
                                    <Pressable
                                      style={ts.terminateTaskBtnHotzone}
                                      onPress={() => onStartFileRename!(f.id, node.id, displayName)}
                                      hitSlop={6}
                                      accessibilityLabel="Rename attachment"
                                    >
                                      <Ionicons name="create-outline" size={14} color="#6C5CE7" />
                                    </Pressable>
                                  ) : null}
                                </View>
                              )}
                            </View>
                            {isDesktopWebTree && (
                              <View style={ts.fileRowMeta}>
                                <Text style={ts.fileColTime} numberOfLines={1}>
                                  {formatFileDate(f.createdAt)}
                                </Text>
                                <Text style={ts.fileColUploader} numberOfLines={1} ellipsizeMode="tail">
                                  {f.uploaderName?.trim() ? f.uploaderName.trim() : '—'}
                                </Text>
                              </View>
                            )}
                            {!hideDepsEditor && (
                              <View style={ts.fileRowActions}>
                                <TouchableOpacity
                                  style={ts.fileRowActionBtn}
                                  onPress={() => onRemoveFile?.(node.id, f.id)}
                                  hitSlop={8}
                                  disabled={!!activeFileRename}
                                >
                                  <Ionicons name="trash-outline" size={18} color="#E74C3C" />
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={ts.fileRowActionBtn}
                                  onPress={() => onRequestMoveFile?.(f.id, node.id)}
                                  hitSlop={8}
                                  disabled={!!activeFileRename}
                                >
                                  {/* 使用更直观的“移动/重新关联”图标 */}
                                  <Ionicons name="swap-horizontal-outline" size={18} color="#6C5CE7" />
                                </TouchableOpacity>
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}
              </View>
            )}
          </RowOuter>
        );
      })}
    </>
  );
}

// ──────────────────────────────────────────────────
// Public Props & Wrapper
// ──────────────────────────────────────────────────

export interface TaxFilingTodosViewProps {
  /** 当前已加载的 todos 树（父组件持有） */
  tree: ProjectTodoNode[];
  /** 项目订单 id；catalog 模式下可不传（不加载附件、不订阅 Realtime） */
  orderId?: string;
  /** 文件上传时的存储路径 space；catalog 模式下可不传 */
  clientSpaceId?: string;
  /**
   * 当前查看者角色：决定状态文案语义和操作权限。
   *   'client' — client 用户，只有自己归属(type=client)的 todo 可完整操作
   *   'firm'   — firm 用户，可操作全部，client todos 显示等待状态文案
   */
  viewerRole: 'client' | 'firm';
  /** 任何操作后父级刷新树（addChild / cancelTask 等） */
  onRefresh: () => Promise<void>;
  /**
   * 创建 phase/section/task 成功后用本地合并后的树根更新 state，不调用 onRefresh。
   * 可避免 Web 整页重载与滚动丢失，便于连续添加。未传时仍走 onRefresh。
   */
  onMergeProjectTodosTree?: (roots: ProjectTodoNode[]) => void;
  createProjectTodo: (params: {
    orderId: string;
    parentId?: string | null;
    type: 'client' | 'firm';
    title: string;
    description?: string | null;
    sortOrder?: number;
    itemKind?: 'phase' | 'section' | 'task';
  }) => Promise<{ id: string | null; error: Error | null }>;
  /** 可选：点击「Add a phase」时回调，不传则不显示该入口 */
  onAddPhase?: () => void;
  /**
   * Catalog 模式（如 firm SKU 配置）：隐藏状态列与操作按钮、隐藏文件计数与 Upload；
   * Task 的「-」为删除（onCatalogDeleteItem），名称前责任方可点击切换（onCatalogUpdateType）。
   */
  catalogMode?: boolean;
  /** Catalog 模式：删除条目（task/phase/section） */
  onCatalogDeleteItem?: (itemId: string) => void;
  /** Catalog 模式：切换 task 责任方 client ↔ firm */
  onCatalogUpdateType?: (itemId: string, type: 'client' | 'firm') => void;
  /**
   * Catalog 模式（SKU）：写入 sku_item 的 `depends_on_ids`（及首项 `depends_on_id`）；与项目浮窗相同的多选 `dependsOnIds`。
   * 未传时仍走 `updateProjectTodoDependsOn`（仅适用于项目 todos）。
   */
  onCatalogSetDependsOn?: (
    itemId: string,
    dependsOnIds: string[] | null,
  ) => Promise<{ error: Error | null }>;
  /** Catalog 模式：phase/section 行点击删除时由外部处理（确认后递归删 sku_item） */
  onRequestDeletePhase?: (phaseId: string, phaseTitle: string) => void;
  /** Catalog 只读预览（如 engagement 详情）：不展示 + / - / depends on 编辑，仅展示树与依赖 */
  catalogPreviewReadOnly?: boolean;
  /**
   * Web：拖放排序后持久化整棵树（parent_id + 同级 sort_order）。
   * 传入时启用左侧拖动手柄与行上放置（项目 todos 用 applyProjectTodosTreeOrder，SKU catalog 用 applySkuItemsTreeOrder）。
   */
  persistTodoTreeOrder?: (roots: ProjectTodoNode[]) => Promise<{ error: Error | null }>;
  /**
   * After a successful drag-reorder save: apply the reordered tree locally (renumbered sort_order) without onRefresh.
   * Use e.g. `(roots) => setTree(roots)` on engagement. SKU may pass a no-op `() => {}` when persistTodoTreeOrder already updates items.
   * If omitted, falls back to onRefresh() (full reload).
   */
  onTodoTreeOrderSaved?: (roots: ProjectTodoNode[]) => void;
  /**
   * Web only: persist edited row title (project todo or SKU template item).
   * When set, an edit icon appears after the name (same reveal as +/-); row switches to in-place input + cancel/confirm like PendingAddRow.
   */
  onPersistTodoTitle?: (todoId: string, title: string) => Promise<{ error: Error | null }>;
  /** Hide tasks with no attachments (non-catalog project todos). */
  hideTasksWithNoFiles?: boolean;
  /** Hide tasks in canceled status. */
  hideCanceledTasks?: boolean;
}

export function TaxFilingTodosView({
  tree,
  orderId = '',
  clientSpaceId = '',
  viewerRole,
  onRefresh,
  createProjectTodo,
  onAddPhase,
  catalogMode = false,
  onCatalogDeleteItem,
  onCatalogUpdateType,
  onCatalogSetDependsOn,
  onRequestDeletePhase: onRequestDeletePhaseProp,
  catalogPreviewReadOnly = false,
  persistTodoTreeOrder,
  onTodoTreeOrderSaved,
  onPersistTodoTitle,
  onMergeProjectTodosTree,
  hideTasksWithNoFiles = false,
  hideCanceledTasks = false,
}: TaxFilingTodosViewProps) {
  const { width: todoLayoutWidth } = useWindowDimensions();
  const isDesktopWebTodoLayout = Platform.OS === 'web' && !isMobileWebWidth(todoLayoutWidth);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [taskFilesExpanded, setTaskFilesExpanded] = useState<Set<string>>(new Set());
  const [taskFilesMap, setTaskFilesMap] = useState<Record<string, ProjectTodoReceiptSummary[]>>({});

  const [rowIdShowingAdd, setRowIdShowingAdd] = useState<string | null>(null);
  /** Depends on 列独立热区：仅该列触摸/悬停时显示无关联行的 Depends on+ 入口 */
  const [rowIdShowingDeps, setRowIdShowingDeps] = useState<string | null>(null);
  const [addIconHighlightedRowId, setAddIconHighlightedRowId] = useState<string | null>(null);
  const [pendingParentId, setPendingParentId] = useState<string | null>(null);
  const hideAddTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Web 拖放：悬停/触摸行后短暂显示拖动手柄 */
  const [rowIdShowingDragHandle, setRowIdShowingDragHandle] = useState<string | null>(null);
  const hideDragHandleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 鼠标移出 Depends on 热区后延时隐藏 */
  const hideDepsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // zone2：文件计数列 hover/触摸时显示 Upload 按钮
  const [rowFileColHoverId, setRowFileColHoverId] = useState<string | null>(null);
  const hideFileColTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Web：附件行悬停显示改名铅笔（与任务行 rowIdShowingAdd 同款延时） */
  const hideFileRowHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fileRowHoverKey, setFileRowHoverKey] = useState<string | null>(null);
  // zone3：状态标签点击后，状态 pill 变为动词按钮
  const [rowIdShowingStatusVerb, setRowIdShowingStatusVerb] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<{ id: string; title: string } | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);
  const [fileRenameDraft, setFileRenameDraft] = useState<{
    attachmentId: string;
    todoId: string;
    title: string;
  } | null>(null);
  const [fileRenameSaving, setFileRenameSaving] = useState(false);
  const [depsPanelNodeId, setDepsPanelNodeId] = useState<string | null>(null);
  /** 前置多选浮窗内勾选的前置 ID 列表（None 外可多选；持久化仍用首项） */
  const [depsPickerSelectedIds, setDepsPickerSelectedIds] = useState<string[]>([]);
  const [handoffDraft, setHandoffDraft] = useState<{
    todoId: string;
    fromSide: 'client' | 'firm';
    toSide: 'client' | 'firm';
    verb: string;
    note: string;
    newStatus?: ProjectTodoNode['status'];
  } | null>(null);
  /** 长按文件行「移动到其他 task」：attachmentId + 当前所属 todoId */
  const [moveFileContext, setMoveFileContext] = useState<{ attachmentId: string; fromTodoId: string } | null>(null);
  /** Move-file 浮窗内当前选中的目标 task id（仅 task 可选） */
  const [moveFileTargetTodoId, setMoveFileTargetTodoId] = useState<string | null>(null);
  const [selectedFileForModal, setSelectedFileForModal] = useState<{ attachmentId: string; todoId: string } | null>(null);
  const [attachmentPreviewFromLogs, setAttachmentPreviewFromLogs] = useState<Record<string, AttachmentPreviewField[] | null>>({});

  // 当前树引用：供 Realtime 回调中使用，避免闭包拿到旧值
  const treeRef = useRef<ProjectTodoNode[]>(tree);
  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  /** 父级整树 onRefresh 后 ScrollView / Web 文档滚动常被重置；记录并在 tree 更新后写回 */
  const todosScrollRef = useRef<ScrollView | null>(null);
  const todosScrollYRef = useRef(0);
  const pendingTodosScrollRestoreRef = useRef<TodosScrollRestorePayload | null>(null);

  const refreshTodosPreservingScroll = useCallback(async () => {
    pendingTodosScrollRestoreRef.current = captureTodosScrollPositions(todosScrollRef, todosScrollYRef.current);
    await onRefresh();
  }, [onRefresh]);

  useLayoutEffect(() => {
    const p = pendingTodosScrollRestoreRef.current;
    if (!p) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applyTodosScrollRestore(todosScrollRef, p);
      });
    });
  }, [tree]);

  useEffect(() => {
    const p = pendingTodosScrollRestoreRef.current;
    if (!p) return;
    const t0 = setTimeout(() => applyTodosScrollRestore(todosScrollRef, p), 0);
    const t1 = setTimeout(() => applyTodosScrollRestore(todosScrollRef, p), 50);
    const t2 = setTimeout(() => {
      applyTodosScrollRestore(todosScrollRef, p);
      pendingTodosScrollRestoreRef.current = null;
    }, 120);
    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [tree]);

  const [todoDraggingId, setTodoDraggingId] = useState<string | null>(null);
  const todoDraggingIdRef = useRef<string | null>(null);
  const [todoDragOver, setTodoDragOver] = useState<{ targetId: string; position: TodoDropPosition } | null>(null);
  const todoDragOverRef = useRef<{ targetId: string; position: TodoDropPosition } | null>(null);
  todoDragOverRef.current = todoDragOver;
  const [todoDragGhost, setTodoDragGhost] = useState<{
    pointerX: number;
    pointerY: number;
    offsetX: number;
    offsetY: number;
    width: number;
    rows: TodoGhostRow[];
  } | null>(null);
  /** 推迟 dragstart 后的 setState，取消时清掉避免误开幽灵层 */
  const todoDragDeferredPaintRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** drop 后异步写库期间为 true，避免 dragend 抢先清空 ref 导致提交被跳过 */
  const todoDragDropCommittingRef = useRef(false);

  const todoTreeDragEnabled =
    isDesktopWebTodoLayout && !catalogPreviewReadOnly && typeof persistTodoTreeOrder === 'function';

  const todoDragPreview = useMemo(() => {
    if (!todoTreeDragEnabled || !todoDraggingId || !todoDragOver) {
      return { tree, active: false } as { tree: ProjectTodoNode[]; active: boolean };
    }
    const next = moveProjectTodoInTree(tree, todoDraggingId, todoDragOver.targetId, todoDragOver.position);
    if (!next) return { tree, active: false };
    return { tree: next, active: true };
  }, [tree, todoTreeDragEnabled, todoDraggingId, todoDragOver]);

  const displayListTree = useMemo(() => {
    const sourceTree = todoDragPreview.active ? todoDragPreview.tree : tree;
    if (
      catalogMode ||
      catalogPreviewReadOnly ||
      (!hideTasksWithNoFiles && !hideCanceledTasks)
    ) {
      return sourceTree;
    }
    return filterProjectTodoTreeForListDisplay(
      sourceTree,
      { hideTasksWithNoFiles, hideCanceledTasks },
      taskFilesMap,
    );
  }, [
    tree,
    catalogMode,
    catalogPreviewReadOnly,
    hideTasksWithNoFiles,
    hideCanceledTasks,
    taskFilesMap,
    todoDragPreview.active,
    todoDragPreview.tree,
  ]);

  const todoDragEndAll = useCallback(() => {
    if (todoDragDeferredPaintRef.current) {
      clearTimeout(todoDragDeferredPaintRef.current);
      todoDragDeferredPaintRef.current = null;
    }
    todoDraggingIdRef.current = null;
    todoDragOverRef.current = null;
    setTodoDraggingId(null);
    setTodoDragOver(null);
    setTodoDragGhost(null);
    setRowIdShowingDragHandle(null);
    if (hideDragHandleTimeoutRef.current) {
      clearTimeout(hideDragHandleTimeoutRef.current);
      hideDragHandleTimeoutRef.current = null;
    }
  }, []);

  const commitTodoTreeDrop = useCallback(
    async (targetId: string, position: TodoDropPosition) => {
      const tid = todoDraggingIdRef.current;
      if (!tid || !persistTodoTreeOrder) return;
      const current = treeRef.current;
      const next = moveProjectTodoInTree(current, tid, targetId, position);
      if (!next) {
        if (Platform.OS === 'web') window.alert('Cannot move this item here.');
        else Alert.alert('Reorder', 'Cannot move this item here.');
        return;
      }
      const { error } = await persistTodoTreeOrder(next);
      if (error) {
        if (Platform.OS === 'web') window.alert(error.message ?? 'Failed to save order');
        else Alert.alert('Reorder failed', error.message ?? '');
        return;
      }
      const ordered = renumberTodoTreeSortOrders(next) as ProjectTodoNode[];
      if (onTodoTreeOrderSaved) {
        if (Platform.OS === 'web') {
          flushSync(() => {
            onTodoTreeOrderSaved(ordered);
          });
        } else {
          onTodoTreeOrderSaved(ordered);
        }
        treeRef.current = ordered;
      } else {
        await refreshTodosPreservingScroll();
      }
    },
    [persistTodoTreeOrder, refreshTodosPreservingScroll, onTodoTreeOrderSaved],
  );

  const todoDragContextValue = useMemo<TodoDragContextValue | null>(() => {
    if (!todoTreeDragEnabled) return null;
    return {
      enabled: true,
      draggingId: todoDraggingId,
      draggingIdRef: todoDraggingIdRef,
      dragOver: todoDragOver,
      dragOverRef: todoDragOverRef,
      previewActive: todoDragPreview.active,
      placeholderRowCount: todoDragGhost?.rows.length ?? 1,
      treeRef,
      startDrag: (id, anchor) => {
        todoDraggingIdRef.current = id;
        // 勿在 dragstart 同步 setState：会立刻重渲染并可能卸载原生 draggable，浏览器会取消拖放并触发 dragend，幽灵层不会出现
        if (todoDragDeferredPaintRef.current) {
          clearTimeout(todoDragDeferredPaintRef.current);
          todoDragDeferredPaintRef.current = null;
        }
        let ghostPayload: {
          pointerX: number;
          pointerY: number;
          offsetX: number;
          offsetY: number;
          width: number;
          rows: TodoGhostRow[];
        } | null = null;
        if (anchor) {
          const r = anchor.rowElement.getBoundingClientRect();
          ghostPayload = {
            pointerX: anchor.clientX,
            pointerY: anchor.clientY,
            offsetX: anchor.clientX - r.left,
            offsetY: anchor.clientY - r.top,
            width: Math.max(280, r.width),
            rows: anchor.ghostRows,
          };
        }
        if (typeof window !== 'undefined') {
          todoDragDeferredPaintRef.current = window.setTimeout(() => {
            todoDragDeferredPaintRef.current = null;
            if (todoDraggingIdRef.current !== id) return;
            setTodoDraggingId(id);
            setTodoDragGhost(ghostPayload);
          }, 0);
        } else {
          setTodoDraggingId(id);
          setTodoDragGhost(ghostPayload);
        }
      },
      endDrag: todoDragEndAll,
      setDragOver: setTodoDragOver,
      commitDrop: commitTodoTreeDrop,
    };
  }, [
    todoTreeDragEnabled,
    todoDraggingId,
    todoDragOver,
    todoDragPreview.active,
    todoDragGhost?.rows.length,
    commitTodoTreeDrop,
    todoDragEndAll,
  ]);

  /**
   * 预览树会重排 DOM，行级 onDrop 不可靠：在 window 捕获阶段统一处理 dragover/drop，
   * 用 elementFromPoint + data-todo-row 解析目标，与视觉顺序一致。
   */
  useEffect(() => {
    if (Platform.OS !== 'web' || !todoTreeDragEnabled) return;

    const onMove = (e: DragEvent) => {
      if (!todoDraggingIdRef.current) return;
      e.preventDefault();
      // Safari / Firefox：必须与 dragstart 的 effectAllowed 一致，否则 drop 不触发或光标错误
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }
      setTodoDragGhost((g) => (g ? { ...g, pointerX: e.clientX, pointerY: e.clientY } : g));

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const row = el?.closest?.('[data-todo-row]') as HTMLElement | null;
      if (!row) return;
      const targetId = row.getAttribute('data-todo-row');
      if (!targetId) return;
      const tid = todoDraggingIdRef.current;
      if (targetId === tid) return;
      const dn = findTodoNodeById(treeRef.current, tid);
      const tn = findTodoNodeById(treeRef.current, targetId);
      if (!dn || !tn) return;
      const rect = row.getBoundingClientRect();
      const pos = pickTodoDropBand(e.clientY, rect.top, rect.height, dn.itemKind, tn.itemKind);
      setTodoDragOver({ targetId, position: pos });
    };

    const onDrop = (e: DragEvent) => {
      if (!todoDraggingIdRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const tid = todoDraggingIdRef.current;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const row = el?.closest?.('[data-todo-row]') as HTMLElement | null;
      let targetId: string | null = row?.getAttribute('data-todo-row') ?? null;

      const dn = findTodoNodeById(treeRef.current, tid);
      if (!dn) {
        todoDragEndAll();
        return;
      }

      let pos: TodoDropPosition;
      if (targetId && targetId !== tid) {
        const tn = findTodoNodeById(treeRef.current, targetId);
        if (!tn) {
          todoDragEndAll();
          return;
        }
        const rect = row!.getBoundingClientRect();
        const over = todoDragOverRef.current;
        pos =
          over && over.targetId === targetId
            ? over.position
            : pickTodoDropBand(e.clientY, rect.top, rect.height, dn.itemKind, tn.itemKind);
      } else {
        const over = todoDragOverRef.current;
        if (!over || over.targetId === tid) {
          todoDragEndAll();
          return;
        }
        targetId = over.targetId;
        pos = over.position;
      }

      if (!targetId) {
        todoDragEndAll();
        return;
      }

      todoDragDropCommittingRef.current = true;
      void (async () => {
        try {
          await commitTodoTreeDrop(targetId, pos);
        } finally {
          todoDragDropCommittingRef.current = false;
          todoDragEndAll();
        }
      })();
    };

    const onDragEnterWindow = (e: DragEvent) => {
      if (!todoDraggingIdRef.current) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }
    };

    window.addEventListener('dragenter', onDragEnterWindow, true);
    window.addEventListener('dragover', onMove, true);
    window.addEventListener('drop', onDrop, true);
    return () => {
      window.removeEventListener('dragenter', onDragEnterWindow, true);
      window.removeEventListener('dragover', onMove, true);
      window.removeEventListener('drop', onDrop, true);
    };
  }, [todoTreeDragEnabled, commitTodoTreeDrop, todoDragEndAll]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !todoTreeDragEnabled) return;
    const clear = () => {
      if (todoDragDropCommittingRef.current) return;
      if (!todoDraggingIdRef.current) return;
      todoDragEndAll();
    };
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, [todoTreeDragEnabled, todoDragEndAll]);

  // 初始化/树变化时加载附件（catalog 模式不加载）
  useEffect(() => {
    if (catalogMode) { setTaskFilesMap({}); return; }
    const taskIds = collectTaskIds(tree);
    if (taskIds.length === 0) { setTaskFilesMap({}); return; }
    getAttachmentsByProjectTodoIds(taskIds).then(setTaskFilesMap).catch(() => {});
  }, [tree, catalogMode]);

  // Supabase Realtime：project_todos / project_todo_attachments 变更时局部自动刷新（catalog 模式不订阅；含 Web）
  useEffect(() => {
    if (catalogMode || !orderId) return;
    let todosChannel: ReturnType<typeof supabase.channel> | null = null;
    let attachmentsChannel: ReturnType<typeof supabase.channel> | null = null;
    let refreshTreeTimeout: ReturnType<typeof setTimeout> | null = null;
    let refreshFilesTimeout: ReturnType<typeof setTimeout> | null = null;

    const setupRealtime = async () => {
      try {
        const project = await getProjectByOrderId(orderId);
        if (!project) return;
        const projectId = project.id;

        const debouncedRefreshTree = () => {
          if (refreshTreeTimeout) clearTimeout(refreshTreeTimeout);
          refreshTreeTimeout = setTimeout(() => {
            refreshTodosPreservingScroll().catch(() => {});
          }, 300);
        };

        const debouncedRefreshFiles = () => {
          if (refreshFilesTimeout) clearTimeout(refreshFilesTimeout);
          refreshFilesTimeout = setTimeout(() => {
            const currentTree = treeRef.current;
            const taskIds = collectTaskIds(currentTree);
            if (taskIds.length === 0) {
              setTaskFilesMap({});
              return;
            }
            getAttachmentsByProjectTodoIds(taskIds).then(setTaskFilesMap).catch(() => {});
          }, 300);
        };

        todosChannel = supabase
          .channel(`project-todos-${projectId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'project_todos', filter: `project_id=eq.${projectId}` },
            () => debouncedRefreshTree()
          )
          .subscribe();

        attachmentsChannel = supabase
          .channel(`project-todo-attachments-${projectId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'project_todo_attachments' },
            () => debouncedRefreshFiles()
          )
          .subscribe();
      } catch (e) {
        console.warn('TaxFilingTodosView Realtime setup failed', e);
      }
    };

    setupRealtime();

    return () => {
      if (refreshTreeTimeout) clearTimeout(refreshTreeTimeout);
      if (refreshFilesTimeout) clearTimeout(refreshFilesTimeout);
      if (todosChannel) supabase.removeChannel(todosChannel);
      if (attachmentsChannel) supabase.removeChannel(attachmentsChannel);
    };
  }, [orderId, refreshTodosPreservingScroll]);

  const nodeStats = useNodeStats(tree);

  /** 扁平化全树节点，供状态计算 / 阻塞判断使用 */
  const allNodesFlat = useMemo<ProjectTodoNode[]>(() => {
    const result: ProjectTodoNode[] = [];
    const walk = (nodes: ProjectTodoNode[]) => {
      nodes.forEach((n) => { result.push(n); walk(n.children); });
    };
    walk(tree);
    return result;
  }, [tree]);

  /** 全树节点 id → WBS 编号（与表格列展示一致），供依赖浮窗标题等使用 */
  const allNodesWbsMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    tree.forEach((root, phaseIndex) => {
      const rootWbs = String(phaseIndex + 1);
      map[root.id] = rootWbs;
      const walk = (nodes: ProjectTodoNode[], prefix: string) => {
        nodes.forEach((node, idx) => {
          const wbs = `${prefix}.${idx + 1}`;
          map[node.id] = wbs;
          walk(node.children, wbs);
        });
      };
      walk(root.children, rootWbs);
    });
    return map;
  }, [tree]);

  /** 所有 phase / section 节点及其 WBS 编号，供任务前置依赖选单使用 */
  const phaseAndSectionWithWbs = useMemo<{ id: string; wbs: string; title: string }[]>(() => {
    const result: { id: string; wbs: string; title: string }[] = [];
    tree.forEach((phase, pi) => {
      const phaseWbs = String(pi + 1);
      result.push({ id: phase.id, wbs: phaseWbs, title: phase.title });
      phase.children.forEach((section, si) => {
        result.push({ id: section.id, wbs: `${phaseWbs}.${si + 1}`, title: section.title });
      });
    });
    return result;
  }, [tree]);

  /** 按 phase 分组的列表（浮窗内 section 缩进展示） */
  const depsPickerGrouped = useMemo(() => {
    const groups: { phase: { id: string; wbs: string; title: string }; sections: { id: string; wbs: string; title: string }[] }[] = [];
    phaseAndSectionWithWbs.forEach((item) => {
      if (item.wbs.indexOf('.') === -1) {
        groups.push({ phase: item, sections: [] });
      } else {
        if (groups.length > 0) groups[groups.length - 1].sections.push(item);
      }
    });
    return groups;
  }, [phaseAndSectionWithWbs]);

  // 打开前置浮窗时同步勾选状态（多选）；关闭时清空
  useEffect(() => {
    if (depsPanelNodeId) {
      const node = allNodesFlat.find((n) => n.id === depsPanelNodeId);
      const ids = (node as any)?.dependsOnIds ?? (node?.dependsOnId ? [node.dependsOnId] : []);
      setDepsPickerSelectedIds(Array.isArray(ids) ? ids : []);
    } else {
      setDepsPickerSelectedIds([]);
    }
  }, [depsPanelNodeId, allNodesFlat]);

  /**
   * 依赖锁定：当存在前置且任一前置的 effectiveStatus 非 completed/canceled 时为阻塞。
   * 被依赖项都 completed 或 canceled 则取消 pending，显示正常状态。
   */
  const blockedNodes = useMemo<Set<string>>(() => {
    const blocked = new Set<string>();
    const { effectiveStatus } = nodeStats;

    const allNodes = new Map<string, ProjectTodoNode>();
    function flattenAll(nodes: ProjectTodoNode[]) {
      nodes.forEach((n) => {
        allNodes.set(n.id, n);
        flattenAll(n.children);
      });
    }
    flattenAll(tree);

    const isBlocked = (nodeId: string, visited = new Set<string>()): boolean => {
      if (visited.has(nodeId)) return false;
      visited.add(nodeId);
      const node = allNodes.get(nodeId);
      const depIds = (node as any)?.dependsOnIds ?? (node?.dependsOnId != null ? [node.dependsOnId!] : []);
      if (!depIds.length) return false;
      for (const depId of depIds) {
        const depStatus = effectiveStatus[depId];
        if (depStatus !== 'completed' && depStatus !== 'canceled') return true;
        if (isBlocked(depId, visited)) return true;
      }
      return false;
    };

    allNodes.forEach((_, id) => {
      if (isBlocked(id)) blocked.add(id);
    });

    return blocked;
  }, [tree, nodeStats]);

  // 被锁定的节点默认折叠（仅 phase/section 层）
  useEffect(() => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      tree.forEach((phase) => {
        if (blockedNodes.has(phase.id)) next.add(phase.id);
        phase.children.forEach((section) => {
          if (blockedNodes.has(section.id)) next.add(section.id);
        });
      });
      return next;
    });
  }, [blockedNodes, tree]);

  const maxLeftBlockWidth = useMemo(() => {
    const winW = Dimensions.get('window').width;
    let maxW = 0;
    const desktopLayout = isDesktopWebTodoLayout;
    function walk(nodes: ProjectTodoNode[], d: number) {
      nodes.forEach((n) => {
        const indent = 12 + d * 14;
        const titleLen = (n.title ?? '').length;
        // 预留：chevron(28) + WBS(36) + 责任方标签(≈60) + 标题 + 行尾图标(edit / - / + 等，桌面 Web)
        const trailingIcons = desktopLayout ? 72 : 24;
        const w = indent + 28 + 36 + 60 + titleLen * 8 + trailingIcons;
        if (w > maxW) maxW = w;
        walk(n.children, d + 1);
      });
    }
    walk(tree, 0);
    const minW = 190;
    // 右侧需要预留的宽度：进度列(icon+数字) + 与状态圆点之间的间距 + 状态列本身 + 一点安全空白
    const rightReserve = desktopLayout ? 80 + 16 + 120 + 24 + 18 : 48 + 6 + 28 + 12;
    const cap = Math.floor(winW - 32 - rightReserve);
    return Math.min(Math.max(maxW, minW), cap);
  }, [tree, isDesktopWebTodoLayout]);

  const renameInlineListInputWidthPx = useMemo(
    () => maxTodoRenameInputWidthAcrossProjectTree(tree),
    [tree],
  );

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleTaskFiles = useCallback((id: string) => {
    setTaskFilesExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSetDependsOn = useCallback(
    async (nodeId: string, dependsOnIds: string[] | null) => {
      const ids = dependsOnIds?.length ? dependsOnIds : null;
      const { error } = onCatalogSetDependsOn
        ? await onCatalogSetDependsOn(nodeId, ids)
        : await updateProjectTodoDependsOn(nodeId, ids);
      if (error) {
        if (Platform.OS === 'web') window.alert('Failed to update dependency: ' + error.message);
        else Alert.alert('Error', error.message);
        return;
      }
      setDepsPanelNodeId(null);
      await refreshTodosPreservingScroll();
    },
    [refreshTodosPreservingScroll, onCatalogSetDependsOn],
  );

  const refreshFiles = useCallback(async (currentTree: ProjectTodoNode[]) => {
    const taskIds = collectTaskIds(currentTree);
    if (taskIds.length > 0) {
      const filesMap = await getAttachmentsByProjectTodoIds(taskIds);
      setTaskFilesMap(filesMap);
    }
  }, []);

  const onRetryRecognizeFile = useCallback(
    async (attachmentId: string) => {
      try {
        const ctx = await getProjectTodoAttachmentWithContext(attachmentId);
        if (!ctx) {
          if (Platform.OS === 'web') window.alert('Could not load attachment context.');
          else Alert.alert('Retry failed', 'Could not load attachment context.');
          return;
        }
        const { attachment, project, todoContext } = ctx;
        const latest = await getProjectTodoAttachmentById(attachmentId);
        const currentStatus = latest?.status ?? attachment.status;
        const currentFailCount =
          latest?.recognition_fail_count != null ? Number(latest.recognition_fail_count) || 0 : 0;

        if (currentStatus === 'PROCESSED' || currentStatus === 'VERIFIED') {
          if (Platform.OS === 'web') window.alert('Recognition already completed for this file.');
          else Alert.alert('Retry not needed', 'Recognition already completed for this file.');
          return;
        }
        if (currentFailCount >= 3 || currentStatus === 'FAILED_FINAL') {
          if (Platform.OS === 'web') window.alert('Recognition has already failed 3 times.');
          else Alert.alert('Retry not allowed', 'Recognition has already failed 3 times.');
          return;
        }

        const classificationLabels = classificationLabelsForTaxFilingPrompt(project);
        const projectContext = {
          country: (project.taxCountry === 'USA' ? 'USA' : 'CANADA') as 'CANADA' | 'USA',
          taxScenario: project.taxScenario ?? '',
          ...(classificationLabels.length > 0 ? { classificationLabels } : {}),
        };

        const quotaSpaceId = ctx.project.clientSpaceId ?? '';
        const gate = await assertClientRecognitionAllowed(quotaSpaceId);
        if (!gate.allowed) {
          alertClientRecognitionQuotaBlocked(
            { push: (href) => void router.push(href as '/management') },
            { allowed: false, message: gate.message },
          );
          return;
        }

        // 标记为处理中
        await updateProjectTodoAttachment(attachmentId, { status: 'PROCESSING' });

        try {
          const recognition = await runTaxFilingRecognition(
            attachment.attachment_url,
            projectContext,
            todoContext,
          );
          const displayName = buildTaxFilingAttachmentDefaultDisplayName({
            summary: recognition.summary,
            docType: recognition.doc_type,
            sourceFileName: latest?.source_file_name ?? null,
          });
          const result = await updateProjectTodoAttachment(attachmentId, {
            summary: recognition.summary,
            doc_type: recognition.doc_type,
            extracted_data: recognition.extracted_data,
            status: 'PROCESSED',
            recognition_fail_count: 0,
            display_name: displayName,
          });
          if ('error' in result) {
            const msg = result.error.message ?? 'Could not update attachment.';
            if (Platform.OS === 'web') window.alert('Retry failed: ' + msg);
            else Alert.alert('Retry failed', msg);
            return;
          }
          await recordClientRecognitionSuccessIfEnforced(quotaSpaceId);
        } catch (e) {
          const failCount = Math.min(currentFailCount + 1, 3);
          const failStatus =
            failCount >= 3 ? 'FAILED_FINAL' : failCount === 2 ? 'FAILED_TWICE' : 'FAILED_ONCE';
          await updateProjectTodoAttachment(attachmentId, {
            status: failStatus,
            recognition_fail_count: failCount,
          });
          const msg = e instanceof Error ? e.message : String(e);
          if (Platform.OS === 'web') window.alert('Retry failed: ' + msg);
          else Alert.alert('Retry failed', msg);
          return;
        }

        await refreshFiles(tree);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (Platform.OS === 'web') window.alert('Retry failed: ' + msg);
        else Alert.alert('Retry failed', msg);
      } finally {
      }
    },
    [tree, refreshFiles]
  );

  const onStartAddChild = useCallback((parentId: string) => {
    if (hideAddTimeoutRef.current) { clearTimeout(hideAddTimeoutRef.current); hideAddTimeoutRef.current = null; }
    if (hideDragHandleTimeoutRef.current) {
      clearTimeout(hideDragHandleTimeoutRef.current);
      hideDragHandleTimeoutRef.current = null;
    }
    setRowIdShowingAdd(null);
    setAddIconHighlightedRowId(null);
    setRowIdShowingDragHandle(null);
    setPendingParentId(parentId);
  }, []);

  const onConfirmAddChild = useCallback(async (parentId: string, _parentResponsibleSide: ProjectTodoNode['type'], title: string) => {
    const trimmed = (title ?? '').trim();
    if (!trimmed) { setPendingParentId(null); return; }
    try {
      const creatorSide: ProjectTodoNode['type'] = viewerRole;
      const parentNode = allNodesFlat.find((n) => n.id === parentId);
      // phase 下 +Section → itemKind section；section 下 +Task → task（此前缺省 task 导致 phase 下误建 task）
      let childItemKind: 'phase' | 'section' | 'task' = 'task';
      if (parentNode?.itemKind === 'phase') {
        childItemKind = 'section';
      } else if (parentNode?.itemKind === 'section') {
        childItemKind = 'task';
      } else if (parentNode && tree.some((p) => p.id === parentId)) {
        childItemKind = 'section';
      }
      const { id: newId, error: err } = await createProjectTodo({
        orderId,
        parentId,
        type: creatorSide,
        title: trimmed,
        itemKind: childItemKind,
      });
      if (err) {
        const msg = err.message ?? 'Could not create item.';
        if (Platform.OS === 'web') window.alert('Save failed: ' + msg);
        else Alert.alert('Save failed', msg);
        return;
      }
      if (!newId) {
        if (Platform.OS === 'web') window.alert('Save failed: No item id returned.');
        else Alert.alert('Save failed', 'No item id returned.');
        return;
      }
      setPendingParentId(null);
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
      // 模板/SKU catalog：父级 createProjectTodo 内已 setItems，勿再 onRefresh(load)，否则整页重载、滚动回顶
      if (catalogMode) {
        return;
      }
      const resolvedOrderId = parentNode?.orderId ?? tree[0]?.orderId ?? orderId;
      const depth = parentNode ? parentNode.depth + 1 : 1;
      const siblings = parentNode?.children ?? [];
      const sortOrder = nextProjectTodoSiblingSortOrder(siblings);
      const childNode = buildInsertedProjectTodoNode({
        id: newId,
        orderId: resolvedOrderId,
        parentId,
        title: trimmed,
        itemKind: childItemKind,
        type: creatorSide,
        sortOrder,
        depth,
      });
      if (onMergeProjectTodosTree) {
        onMergeProjectTodosTree(insertProjectTodoInTreeRoots(tree, parentId, childNode));
      } else {
        await refreshTodosPreservingScroll();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (Platform.OS === 'web') window.alert('Save failed: ' + msg);
      else Alert.alert('Save failed', msg);
    }
  }, [
    orderId,
    createProjectTodo,
    refreshTodosPreservingScroll,
    viewerRole,
    allNodesFlat,
    tree,
    onMergeProjectTodosTree,
    catalogMode,
  ]);

  const onCancelAddChild = useCallback(() => setPendingParentId(null), []);

  const [pendingAddPhase, setPendingAddPhase] = useState(false);

  /** 确认新 phase 名称后创建根级 phase 并刷新树 */
  const handleConfirmAddPhase = useCallback(async (title: string) => {
    const trimmed = (title ?? '').trim();
    if (!trimmed) {
      setPendingAddPhase(false);
      return;
    }
    setPendingAddPhase(false);
    try {
      const { id: newId, error: err } = await createProjectTodo({
        orderId,
        parentId: null,
        type: 'firm',
        title: trimmed,
        itemKind: 'phase',
      });
      if (err) {
        const msg = err.message ?? 'Could not create phase.';
        if (Platform.OS === 'web') window.alert('Save failed: ' + msg);
        else Alert.alert('Save failed', msg);
        return;
      }
      if (!newId) {
        if (Platform.OS === 'web') window.alert('Save failed: No phase id returned.');
        else Alert.alert('Save failed', 'No phase id returned.');
        return;
      }
      if (catalogMode) {
        return;
      }
      const sortOrder = nextProjectTodoSiblingSortOrder(tree);
      const phaseNode = buildInsertedProjectTodoNode({
        id: newId,
        orderId,
        parentId: null,
        title: trimmed,
        itemKind: 'phase',
        type: 'firm',
        sortOrder,
        depth: 0,
      });
      if (onMergeProjectTodosTree) {
        onMergeProjectTodosTree(insertProjectTodoInTreeRoots(tree, null, phaseNode));
      } else {
        await refreshTodosPreservingScroll();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (Platform.OS === 'web') window.alert('Save failed: ' + msg);
      else Alert.alert('Save failed', msg);
    }
  }, [orderId, createProjectTodo, refreshTodosPreservingScroll, tree, onMergeProjectTodosTree, catalogMode]);

  /** 删除 phase 及所有子级并刷新 */
  const handleConfirmDeletePhase = useCallback(async (phaseId: string) => {
    try {
      const { error: err } = await deleteProjectTodoWithChildren(phaseId);
      if (err) {
        const msg = err.message ?? 'Could not delete phase.';
        if (Platform.OS === 'web') window.alert('Delete failed: ' + msg);
        else Alert.alert('Delete failed', msg);
        return;
      }
      await refreshTodosPreservingScroll();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (Platform.OS === 'web') window.alert('Delete failed: ' + msg);
      else Alert.alert('Delete failed', msg);
    }
  }, [refreshTodosPreservingScroll]);

  /** 请求删除 phase：弹出统一二次确认浮窗（ConfirmModalHost），确认后执行删除 */
  const handleRequestDeletePhase = useCallback(
    (phaseId: string, _phaseTitle: string) => {
      showConfirmDestructiveDialog(
        'Delete phase',
        'Are you sure you want to delete this phase and all its sections and tasks? This cannot be undone.',
        () => handleConfirmDeletePhase(phaseId),
        { confirmLabel: 'Delete' }
      );
    },
    [handleConfirmDeletePhase]
  );

  const onCancelTask = useCallback(
    (todoId: string) => {
      if (!onMergeProjectTodosTree) {
        void (async () => {
          const { error: err } = await updateProjectTodo(todoId, { status: 'canceled' });
          if (err) {
            if (Platform.OS === 'web') window.alert('Cancel failed: ' + (err.message ?? ''));
            else Alert.alert('Cancel failed', err.message ?? '');
            return;
          }
          await refreshTodosPreservingScroll();
        })();
        return;
      }
      const snapshot = cloneProjectTodoTree(tree);
      onMergeProjectTodosTree(patchProjectTodoInTree(tree, todoId, { status: 'canceled' }));
      void (async () => {
        const { error: err } = await updateProjectTodo(todoId, { status: 'canceled' });
        if (err) {
          onMergeProjectTodosTree(snapshot);
          if (Platform.OS === 'web') window.alert('Cancel failed: ' + (err.message ?? ''));
          else Alert.alert('Cancel failed', err.message ?? '');
        }
      })();
    },
    [tree, onMergeProjectTodosTree, refreshTodosPreservingScroll],
  );

  const onRestoreTask = useCallback(
    (todoId: string, initialResponsibleSide: 'client' | 'firm') => {
      const patch = { status: 'to_submit' as const, type: initialResponsibleSide };
      if (!onMergeProjectTodosTree) {
        void (async () => {
          const { error: err } = await updateProjectTodo(todoId, patch);
          if (err) {
            if (Platform.OS === 'web') window.alert('Restore failed: ' + (err.message ?? ''));
            else Alert.alert('Restore failed', err.message ?? '');
            return;
          }
          await refreshTodosPreservingScroll();
        })();
        return;
      }
      const snapshot = cloneProjectTodoTree(tree);
      onMergeProjectTodosTree(patchProjectTodoInTree(tree, todoId, patch));
      void (async () => {
        const { error: err } = await updateProjectTodo(todoId, patch);
        if (err) {
          onMergeProjectTodosTree(snapshot);
          if (Platform.OS === 'web') window.alert('Restore failed: ' + (err.message ?? ''));
          else Alert.alert('Restore failed', err.message ?? '');
        }
      })();
    },
    [tree, onMergeProjectTodosTree, refreshTodosPreservingScroll],
  );

  /** 单任务责任人流转：按附图改责任方 + 状态；先弹浮窗收集可选 note */
  const onHandoffTask = useCallback(
    (todoId: string, fromSide: 'client' | 'firm', toSide: 'client' | 'firm', verb: string, newStatus?: ProjectTodoNode['status']) => {
      setHandoffDraft({
        todoId,
        fromSide,
        toSide,
        verb,
        note: '',
        newStatus,
      });
    },
    [],
  );

  const onUploadFile = useCallback(
    async (todoId: string) => {
      try {
        const result = await pickTaxFilingDocument({
          type: '*/*',
          copyToCacheDirectory: true,
          multiple: false,
          ...(Platform.OS === 'web' ? { base64: false } : {}),
        });
        if (result.canceled || !result.assets?.[0]?.uri) return;
        const asset = result.assets[0];
        const fileUri = asset.uri;
        const displayName = asset.name?.trim() || `File-${Date.now()}`;
        const mimeType = asset.mimeType;
        const fileUrl = await uploadTaxFilingFile(fileUri, `order-task-${Date.now()}`, clientSpaceId, {
          fileName: displayName,
          mimeType,
        });

        const uploaderName = await resolveUploaderNameForTaxFilingAttachment();

        const createResult = await createProjectTodoAttachment(todoId, fileUrl, {
          status: 'PENDING_AI',
          uploader_name: uploaderName,
          source_file_name: displayName,
        });
        if ('error' in createResult) {
          const errMsg =
            createResult.error instanceof Error
              ? createResult.error.message
              : String(createResult.error);
          if (Platform.OS === 'web') window.alert('Link failed: ' + errMsg);
          else Alert.alert('Link failed', errMsg);
          return;
        }

        const attachmentId = createResult.id;

        const follow = await processTaxFilingAttachmentAfterCreate({
          attachmentId,
          todoId,
          fileName: displayName,
          isImage: taxFilingTodoUploadIsImageKind(displayName, mimeType),
        });
        if (!follow.ok) {
          showAlertDialog('Recognition failed', follow.alertMessage);
        }

        // 刷新树与文件列表：确保文件计数 / 状态行内即时更新
        await refreshTodosPreservingScroll();
        setTaskFilesExpanded((prev) => new Set(prev).add(todoId));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (Platform.OS === 'web') window.alert('Upload failed: ' + msg);
        else Alert.alert('Upload failed', msg);
      }
    },
    [clientSpaceId, refreshTodosPreservingScroll]
  );

  const onRemoveFile = useCallback(async (todoId: string, attachmentId: string) => {
    const { error } = await deleteProjectTodoAttachment(attachmentId);
    if (error) {
      if (Platform.OS === 'web') window.alert('Remove failed: ' + (error.message ?? ''));
      else Alert.alert('Remove failed', error.message ?? '');
      return;
    }
    await refreshFiles(tree);
  }, [tree, refreshFiles]);

  const onRequestMoveFile = useCallback((attachmentId: string, fromTodoId: string) => {
    setMoveFileContext({ attachmentId, fromTodoId });
  }, []);

  const onFileRowPress = useCallback((attachmentId: string, todoId: string) => {
    setSelectedFileForModal({ attachmentId, todoId });
    // 懒加载：首次点击附件时，从 ai_chat_logs 拉取最新识别结果兜底展示
    if (!attachmentPreviewFromLogs[attachmentId]) {
      getLatestTaxFilingAttachmentPreviewByAttachmentId(attachmentId).then((preview) => {
        if (!preview) return;
        const fields = buildExtractedPreview((preview as any).extracted_data);
        setAttachmentPreviewFromLogs((prev) => ({
          ...prev,
          [attachmentId]: fields,
        }));
      }).catch(() => {});
    }
  }, [attachmentPreviewFromLogs]);

  const onConfirmMoveFile = useCallback(async (targetTodoId: string) => {
    if (!moveFileContext) return;
    const attachmentId = moveFileContext.attachmentId;
    setMoveFileContext(null);
    const result = await updateProjectTodoAttachment(attachmentId, { project_todo_id: targetTodoId });
    if ('error' in result) {
      if (Platform.OS === 'web') window.alert('Move failed: ' + (result.error.message ?? ''));
      else Alert.alert('Move failed', result.error.message ?? '');
      return;
    }
    await refreshFiles(tree);
    setTaskFilesExpanded((prev) => new Set(prev).add(targetTodoId));
  }, [moveFileContext, tree, refreshFiles]);

  const handleStartRenameInline = useCallback((id: string, title: string) => {
    if (hideAddTimeoutRef.current) {
      clearTimeout(hideAddTimeoutRef.current);
      hideAddTimeoutRef.current = null;
    }
    if (hideFileRowHoverTimeoutRef.current) {
      clearTimeout(hideFileRowHoverTimeoutRef.current);
      hideFileRowHoverTimeoutRef.current = null;
    }
    setFileRowHoverKey(null);
    setRowIdShowingAdd(null);
    setFileRenameDraft(null);
    setRenameDraft({ id, title });
  }, []);

  const handleRenameInlineTitleChange = useCallback((text: string) => {
    setRenameDraft((prev) => (prev ? { ...prev, title: text } : prev));
  }, []);

  const handleCancelRenameInline = useCallback(() => {
    if (renameSaving) return;
    setRenameDraft(null);
  }, [renameSaving]);

  const handleConfirmRenameInline = useCallback(async () => {
    if (!renameDraft || !onPersistTodoTitle) return;
    const t = renameDraft.title.trim();
    if (!t) {
      if (Platform.OS === 'web') window.alert('Name cannot be empty.');
      return;
    }
    setRenameSaving(true);
    const { error } = await onPersistTodoTitle(renameDraft.id, t);
    setRenameSaving(false);
    if (error) {
      if (Platform.OS === 'web') window.alert(error.message ?? 'Failed to save');
      return;
    }
    setRenameDraft(null);
    await refreshTodosPreservingScroll();
  }, [renameDraft, onPersistTodoTitle, refreshTodosPreservingScroll]);

  const fileRowHoverKeyFor = useCallback((todoId: string, attachmentId: string) => `${todoId}\u001f${attachmentId}`, []);

  const handleFileRowHoverIn = useCallback((todoId: string, attachmentId: string) => {
    if (hideFileRowHoverTimeoutRef.current) {
      clearTimeout(hideFileRowHoverTimeoutRef.current);
      hideFileRowHoverTimeoutRef.current = null;
    }
    setFileRowHoverKey(fileRowHoverKeyFor(todoId, attachmentId));
  }, [fileRowHoverKeyFor]);

  const handleFileRowHoverOut = useCallback(
    (todoId: string, attachmentId: string) => {
      const key = fileRowHoverKeyFor(todoId, attachmentId);
      hideFileRowHoverTimeoutRef.current = setTimeout(() => {
        setFileRowHoverKey((k) => (k === key ? null : k));
        hideFileRowHoverTimeoutRef.current = null;
      }, 400);
    },
    [fileRowHoverKeyFor],
  );

  const handleStartFileRename = useCallback((attachmentId: string, todoId: string, currentTitle: string) => {
    if (hideFileRowHoverTimeoutRef.current) {
      clearTimeout(hideFileRowHoverTimeoutRef.current);
      hideFileRowHoverTimeoutRef.current = null;
    }
    setRenameDraft(null);
    setFileRenameDraft({ attachmentId, todoId, title: currentTitle });
  }, []);

  const handleFileRenameTitleChange = useCallback((text: string) => {
    setFileRenameDraft((prev) => (prev ? { ...prev, title: text } : prev));
  }, []);

  const handleCancelFileRename = useCallback(() => {
    if (fileRenameSaving) return;
    setFileRenameDraft(null);
  }, [fileRenameSaving]);

  const handleConfirmFileRename = useCallback(async () => {
    if (!fileRenameDraft) return;
    const t = fileRenameDraft.title.trim();
    if (!t) {
      if (Platform.OS === 'web') window.alert('Name cannot be empty.');
      else Alert.alert('Invalid name', 'Name cannot be empty.');
      return;
    }
    setFileRenameSaving(true);
    const res = await updateProjectTodoAttachment(fileRenameDraft.attachmentId, { display_name: t });
    setFileRenameSaving(false);
    if ('error' in res) {
      if (Platform.OS === 'web') window.alert(res.error.message ?? 'Could not save.');
      else Alert.alert('Save failed', res.error.message ?? '');
      return;
    }
    setFileRenameDraft(null);
    await refreshFiles(tree);
  }, [fileRenameDraft, tree, refreshFiles]);

  if (tree.length === 0) {
    return (
      <View style={ts.root}>
        <ScrollView style={ts.scroll} contentContainerStyle={ts.scrollContent}>
          <View style={ts.emptyWrap}>
            <Text style={ts.emptyText}>No tasks yet</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  const todoMainView = (
    <View style={ts.root}>
      <ScrollView
        ref={todosScrollRef}
        style={ts.scroll}
        contentContainerStyle={ts.scrollContent}
        onScroll={(e) => {
          todosScrollYRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        <View style={ts.phaseBlocksWrap}>
          {displayListTree.length === 0 &&
          tree.length > 0 &&
          !catalogMode &&
          (hideTasksWithNoFiles || hideCanceledTasks) ? (
            <View style={ts.filterEmptyWrap}>
              <Text style={ts.filterEmptyText}>No tasks match the current filters.</Text>
            </View>
          ) : null}
          {displayListTree.map((phaseNode, phaseIndex) => (
            <View
              key={phaseNode.id}
              style={[
                ts.phaseBlock,
                isDesktopWebTodoLayout && (renameDraft || fileRenameDraft) ? ts.phaseBlockWhileRenaming : null,
              ]}
            >
              <TodoTree
                nodes={[phaseNode]}
                depth={0}
                wbsPrefix=""
                blockIndex={phaseIndex}
                collapsed={collapsed}
                taskFilesExpanded={taskFilesExpanded}
                taskFilesMap={taskFilesMap}
                nodeStats={nodeStats}
                maxLeftBlockWidth={maxLeftBlockWidth}
                viewerRole={viewerRole}
                blockedNodes={blockedNodes}
                isBlocked={blockedNodes.has(phaseNode.id)}
                allNodesFlat={allNodesFlat}
                depsPanelNodeId={depsPanelNodeId}
                setDepsPanelNodeId={setDepsPanelNodeId}
                onSetDependsOn={handleSetDependsOn}
                onToggleCollapse={toggleCollapse}
                onToggleTaskFiles={toggleTaskFiles}
                rowIdShowingAdd={rowIdShowingAdd}
                setRowIdShowingAdd={setRowIdShowingAdd}
                rowIdShowingDeps={rowIdShowingDeps}
                setRowIdShowingDeps={setRowIdShowingDeps}
                hideDepsTimeoutRef={hideDepsTimeoutRef}
                addIconHighlightedRowId={addIconHighlightedRowId}
                setAddIconHighlightedRowId={setAddIconHighlightedRowId}
                hideAddTimeoutRef={hideAddTimeoutRef}
                rowIdShowingDragHandle={rowIdShowingDragHandle}
                setRowIdShowingDragHandle={setRowIdShowingDragHandle}
                hideDragHandleTimeoutRef={hideDragHandleTimeoutRef}
                pendingParentId={pendingParentId}
                onStartAddChild={catalogPreviewReadOnly ? undefined : onStartAddChild}
                onConfirmAddChild={catalogPreviewReadOnly ? undefined : onConfirmAddChild}
                onCancelAddChild={catalogPreviewReadOnly ? undefined : onCancelAddChild}
                onCancelTask={onCancelTask}
                onRestoreTask={onRestoreTask}
                onUploadFile={onUploadFile}
                onRemoveFile={onRemoveFile}
                onRequestMoveFile={onRequestMoveFile}
                onFileRowPress={onFileRowPress}
                onHandoffTask={onHandoffTask}
                onRequestDeletePhase={catalogPreviewReadOnly ? undefined : (onRequestDeletePhaseProp ?? handleRequestDeletePhase)}
                phaseAndSectionWithWbs={phaseAndSectionWithWbs}
                rowFileColHoverId={rowFileColHoverId}
                setRowFileColHoverId={setRowFileColHoverId}
                hideFileColTimeoutRef={hideFileColTimeoutRef}
                rowIdShowingStatusVerb={rowIdShowingStatusVerb}
                setRowIdShowingStatusVerb={setRowIdShowingStatusVerb}
                catalogMode={catalogMode}
                onCatalogDeleteItem={catalogPreviewReadOnly ? undefined : onCatalogDeleteItem}
                onCatalogUpdateType={catalogPreviewReadOnly ? undefined : onCatalogUpdateType}
                hideDepsEditor={catalogPreviewReadOnly}
                renameInline={isDesktopWebTodoLayout && onPersistTodoTitle ? renameDraft : null}
                onRenameInlineTitleChange={
                  isDesktopWebTodoLayout && onPersistTodoTitle ? handleRenameInlineTitleChange : undefined
                }
                onCancelRenameInline={
                  isDesktopWebTodoLayout && onPersistTodoTitle ? handleCancelRenameInline : undefined
                }
                onConfirmRenameInline={
                  isDesktopWebTodoLayout && onPersistTodoTitle ? handleConfirmRenameInline : undefined
                }
                renameInlineSaving={renameSaving}
                onStartRenameInline={
                  isDesktopWebTodoLayout && onPersistTodoTitle ? handleStartRenameInline : undefined
                }
                renameInlineListInputWidthPx={renameInlineListInputWidthPx}
                fileRenameInline={isDesktopWebTodoLayout && !catalogPreviewReadOnly ? fileRenameDraft : null}
                onFileRenameTitleChange={
                  isDesktopWebTodoLayout && !catalogPreviewReadOnly ? handleFileRenameTitleChange : undefined
                }
                onCancelFileRename={isDesktopWebTodoLayout && !catalogPreviewReadOnly ? handleCancelFileRename : undefined}
                onConfirmFileRename={isDesktopWebTodoLayout && !catalogPreviewReadOnly ? handleConfirmFileRename : undefined}
                fileRenameSaving={fileRenameSaving}
                onStartFileRename={isDesktopWebTodoLayout && !catalogPreviewReadOnly ? handleStartFileRename : undefined}
                fileRowHoverKey={isDesktopWebTodoLayout && !catalogPreviewReadOnly ? fileRowHoverKey : null}
                onFileRowHoverIn={isDesktopWebTodoLayout && !catalogPreviewReadOnly ? handleFileRowHoverIn : undefined}
                onFileRowHoverOut={isDesktopWebTodoLayout && !catalogPreviewReadOnly ? handleFileRowHoverOut : undefined}
              />
            </View>
          ))}
          {!catalogPreviewReadOnly && isDesktopWebTodoLayout && (
            <View style={ts.phaseBlock}>
              {pendingAddPhase ? (
                <AddPhaseInputRow
                  onConfirm={handleConfirmAddPhase}
                  onCancel={() => setPendingAddPhase(false)}
                  contentMaxWidth={maxLeftBlockWidth + 4 - 62}
                />
              ) : (
                <Pressable
                  style={ts.addPhaseRow}
                  onPress={() => (onAddPhase ? onAddPhase() : setPendingAddPhase(true))}
                  accessibilityLabel="Add a phase"
                >
                  <View style={ts.addPhaseIconWrap}>
                    <Ionicons name="add-circle" size={20} color="#6C5CE7" />
                  </View>
                  <Text style={ts.addPhaseText}>Add a phase</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {isDesktopWebTodoLayout &&
        todoDragGhost &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: 0,
              top: 0,
              width: todoDragGhost.width,
              zIndex: 10050,
              pointerEvents: 'none',
              transform: `translate(${todoDragGhost.pointerX - todoDragGhost.offsetX}px, ${todoDragGhost.pointerY - todoDragGhost.offsetY}px)`,
              boxShadow: '0 14px 32px rgba(0,0,0,0.2)',
              borderRadius: 10,
              overflow: 'hidden',
              background: '#fff',
              border: '1px solid rgba(0,0,0,0.1)',
              boxSizing: 'border-box',
              paddingLeft: 4,
              paddingRight: 12,
            }}
          >
            {todoDragGhost.rows.map((row, i) => (
              <div
                key={`${row.wbs}-${row.title}-${i}`}
                style={{
                  height: TODO_DRAG_GHOST_ROW_HEIGHT,
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  boxSizing: 'border-box',
                  background: i % 2 === 0 ? '#FFFFFF' : '#F8F9FA',
                  borderTop: i > 0 ? '1px solid #F3F4F6' : undefined,
                }}
              >
                <div
                  style={{
                    width: TODO_DRAG_HANDLE_SLOT_WIDTH,
                    marginRight: 2,
                    flexShrink: 0,
                  }}
                />
                <div
                  style={{
                    width: TODO_DRAG_GHOST_SPINE_BASE + row.renderDepth * TODO_DRAG_GHOST_INDENT_UNIT,
                    flexShrink: 0,
                  }}
                />
                <div style={{ width: TODO_DRAG_GHOST_CHEVRON_COL_W, flexShrink: 0 }} />
                <div
                  style={{
                    width: TODO_DRAG_GHOST_WBS_COL_W,
                    marginRight: TODO_DRAG_GHOST_WBS_COL_MR,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    alignSelf: 'stretch',
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: '#95A5A6',
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '100%',
                      fontFamily:
                        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
                    }}
                  >
                    {row.wbs}
                  </span>
                </div>
                {(() => {
                  const titleTierStyle =
                    row.renderDepth === 0
                      ? ts.treeTitleL0
                      : row.renderDepth === 1
                        ? ts.treeTitleL1
                        : ts.treeTitleL2;
                  const titleFlat = StyleSheet.flatten([
                    ts.treeTitleAdaptive,
                    titleTierStyle,
                    row.itemKind === 'task' && row.status === 'canceled' && ts.treeTitleCanceled,
                    row.nodeIsBlocked && { color: '#B2BEC3' },
                  ]) as Record<string, string | number | undefined>;
                  const showRoleBadge =
                    row.itemKind === 'task' && row.status !== 'canceled' && row.responsibleSide != null;
                  const showLock =
                    row.nodeIsBlocked && (row.renderDepth === 0 || row.renderDepth === 1);
                  return (
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                      }}
                    >
                      {showRoleBadge ? (
                        <span
                          style={{
                            alignSelf: 'center',
                            minWidth: 52,
                            height: 20,
                            paddingLeft: 8,
                            paddingRight: 8,
                            boxSizing: 'border-box',
                            borderRadius: 10,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginRight: 4,
                            flexShrink: 0,
                            backgroundColor: row.nodeIsBlocked
                              ? 'rgba(149, 165, 166, 0.35)'
                              : row.responsibleSide === 'firm'
                                ? 'rgba(162, 155, 254, 0.2)'
                                : 'rgba(116, 185, 255, 0.25)',
                          }}
                        >
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              color: '#636E72',
                              letterSpacing: 0.3,
                              textTransform: 'uppercase',
                              textAlign: 'center',
                              fontFamily:
                                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
                            }}
                          >
                            {row.responsibleSide === 'firm' ? 'Firm' : 'Client'}
                          </span>
                        </span>
                      ) : null}
                      {showLock ? (
                        <Ionicons
                          name="lock-closed-outline"
                          size={11}
                          color="#B2BEC3"
                          style={{ marginRight: 5, marginTop: 1 }}
                        />
                      ) : null}
                      <span
                        style={{
                          ...titleFlat,
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontFamily:
                            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
                        }}
                      >
                        {row.title}
                      </span>
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>,
          document.body,
        )}

      {/* 点击文件行：大浮窗展示文件（左侧缩略图，右侧识别内容） */}
      {selectedFileForModal && (() => {
        const list = taskFilesMap[selectedFileForModal.todoId] ?? [];
        const file = list.find((x) => x.id === selectedFileForModal.attachmentId);
        if (!file) return null;
        const enrichedFile = attachmentPreviewFromLogs[file.id]
          ? { ...file, extractedPreview: attachmentPreviewFromLogs[file.id] || file.extractedPreview }
          : file;
        return (
          <FileDetailModal
            file={enrichedFile}
            onClose={() => setSelectedFileForModal(null)}
          />
        );
      })()}

      {/* 移动文件到其他 task：复用「Depends on」浮窗的分组 + 缩进样式，仅 task 可选，选择后点 Done 执行 */}
      {moveFileContext && (() => {
        const renderMoveTargets = (nodes: ProjectTodoNode[], depth: number): React.ReactNode[] => {
          return nodes.flatMap((node) => {
            const isTask = node.itemKind === 'task';
            const isSource = node.id === moveFileContext.fromTodoId;
            const selectable = isTask && !isSource;
            const selected = moveFileTargetTodoId === node.id;
            const rowKey = node.id;

            // phase 行左对齐；section 稍微缩进；task 在 section 基础上再多缩进一档
            const rowIndentStyle =
              depth === 0
                ? null
                : isTask
                ? { marginLeft: 32 }
                : { marginLeft: 16 };

            const row = (
              <Pressable
                key={rowKey}
                style={[
                  ts.depsPickerRow,
                  depth === 0 ? ts.depsPickerPhaseRow : ts.depsPickerSectionRow,
                  rowIndentStyle,
                  selectable ? ts.movePickerSelectableRow : ts.movePickerDisabledRow,
                  selected && ts.depsPickerRowActive,
                ]}
                onPress={
                  selectable
                    ? () => setMoveFileTargetTodoId((prev) => (prev === node.id ? null : node.id))
                    : undefined
                }
                disabled={!selectable}
              >
                <Text
                  style={[
                    depth === 0 ? ts.depsPickerPhaseText : ts.depsPickerRowText,
                    selectable && !selected && ts.movePickerSelectableText,
                    !selectable && ts.movePickerDisabledText,
                    selected && ts.depsPickerRowTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {allNodesWbsMap[node.id] ?? ''}  {node.title}
                </Text>
                {selectable && selected ? (
                  <Ionicons name="checkmark-circle" size={16} color="#6C5CE7" />
                ) : null}
              </Pressable>
            );

            const children = node.children.length > 0 ? renderMoveTargets(node.children, depth + 1) : [];
            return [row, ...children];
          });
        };

        const handleDone = () => {
          if (!moveFileTargetTodoId) return;
          onConfirmMoveFile(moveFileTargetTodoId);
        };

        return (
          <View style={ts.depsPickerOverlay} pointerEvents="box-none">
            <Pressable
              style={ts.depsPickerBackdrop}
              onPress={() => {
                setMoveFileContext(null);
                setMoveFileTargetTodoId(null);
              }}
            />
            <View style={ts.depsPickerCard}>
              <Text style={ts.depsPickerTitle}>Move file to another task</Text>
              <Text style={ts.depsPickerSubtitle}>Select a task to associate with:</Text>
              <ScrollView style={ts.depsPickerList} nestedScrollEnabled>
                {renderMoveTargets(tree, 0)}
              </ScrollView>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
                <TouchableOpacity
                  style={ts.depsPickerSecondaryBtn}
                  onPress={() => {
                    setMoveFileContext(null);
                    setMoveFileTargetTodoId(null);
                  }}
                >
                  <Text style={ts.depsPickerSecondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[ts.depsPickerDoneBtn, !moveFileTargetTodoId && { opacity: 0.5 }]}
                  onPress={handleDone}
                  disabled={!moveFileTargetTodoId}
                >
                  <Text style={ts.depsPickerDoneText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        );
      })()}

      {/* 前置依赖选单浮窗：section 缩进列表，None 外可多选；项目 / SKU 均持久化完整 id 列表 */}
      {depsPanelNodeId && (() => {
        const currentNode = allNodesFlat.find((n) => n.id === depsPanelNodeId);
        if (!currentNode) return null;
        const byId = new Map(allNodesFlat.map((n) => [n.id, n]));
        const childrenById = new Map<string, string[]>();
        allNodesFlat.forEach((n) => {
          if (!n.parentId) return;
          const arr = childrenById.get(n.parentId) ?? [];
          arr.push(n.id);
          childrenById.set(n.parentId, arr);
        });
        // 当前任务的上级 phase / section 不允许作为前置
        const blockedAncestorIds = new Set<string>();
        let parentId: string | null | undefined = currentNode.parentId;
        while (parentId) {
          blockedAncestorIds.add(parentId);
          const parentNode = byId.get(parentId);
          parentId = parentNode?.parentId ?? null;
        }
        // 若某节点已通过「显式 depends_on 链路 + WBS 层级（上级天然依赖下级）」能到达 currentNode，则将其设为前置会产生循环，需禁用
        const canReachCurrentFrom = (startId: string): boolean => {
          const visited = new Set<string>();
          const stack: string[] = [startId];
          while (stack.length > 0) {
            const id = stack.pop()!;
            if (!visited.add(id)) continue;
            if (id === currentNode.id) return true;
            const node = byId.get(id);
            if (!node) continue;
            const deps: string[] =
              ((node as any).dependsOnIds as string[] | undefined) ??
              ((node as any).dependsOnId ? [(node as any).dependsOnId as string] : []);
            deps.forEach((d) => stack.push(d));
            // 上级天然 depends on 下级：在循环检测里视为 parent -> children 的隐式依赖
            const children = childrenById.get(id);
            children?.forEach((childId) => stack.push(childId));
          }
          return false;
        };
        const isDisabledCandidate = (id: string): boolean =>
          blockedAncestorIds.has(id) || canReachCurrentFrom(id);

        const toggleSection = (id: string) => {
          setDepsPickerSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
          );
        };
        const togglePhase = (phaseId: string, sectionIds: string[]) => {
          setDepsPickerSelectedIds((prev) => {
            const hasPhase = prev.includes(phaseId);
            let next = prev.filter((x) => x !== phaseId && !sectionIds.includes(x));
            if (!hasPhase) next = [...next, phaseId];
            return next;
          });
        };
        const onConfirmDeps = () => {
          handleSetDependsOn(depsPanelNodeId, depsPickerSelectedIds.length > 0 ? depsPickerSelectedIds : null);
        };
        return (
          <View style={ts.depsPickerOverlay} pointerEvents="box-none">
            <Pressable
              style={ts.depsPickerBackdrop}
              onPress={() => setDepsPanelNodeId(null)}
            />
            <View style={ts.depsPickerCard}>
              <Text style={ts.depsPickerTitle} numberOfLines={2}>{allNodesWbsMap[currentNode.id] ?? ''}  {currentNode.title}</Text>
              <Text style={ts.depsPickerSubtitle} numberOfLines={2}>
                needs to depend on the completion of following sections:
              </Text>
              <Pressable
                style={[ts.depsPickerRow, ts.depsPickerNoneRow, depsPickerSelectedIds.length === 0 && ts.depsPickerRowActive]}
                onPress={() => {
                  // 仅更新本地选择，为空表示「None」，实际提交仍走 Done 按钮
                  setDepsPickerSelectedIds([]);
                }}
              >
                <Text style={[ts.depsPickerRowText, ts.movePickerSelectableText, depsPickerSelectedIds.length === 0 && ts.depsPickerRowTextActive]}>None</Text>
              </Pressable>
              <ScrollView style={ts.depsPickerList} nestedScrollEnabled>
                {depsPickerGrouped.map((group) => {
                  const phaseSelected = depsPickerSelectedIds.includes(group.phase.id);
                  const sectionIds = group.sections.map((s) => s.id);
                  const phaseDisabled = isDisabledCandidate(group.phase.id);
                  return (
                  <View key={group.phase.id} style={ts.depsPickerGroup}>
                    <Pressable
                      style={[
                        ts.depsPickerRow,
                        ts.depsPickerPhaseRow,
                        phaseDisabled ? ts.movePickerDisabledRow : ts.movePickerSelectableRow,
                        phaseSelected && ts.depsPickerRowActive,
                      ]}
                      onPress={phaseDisabled ? undefined : () => togglePhase(group.phase.id, sectionIds)}
                      disabled={phaseDisabled}
                    >
                      <Text
                        style={[
                          ts.depsPickerPhaseText,
                          phaseDisabled ? ts.movePickerDisabledText : ts.movePickerSelectableText,
                          phaseSelected && ts.depsPickerRowTextActive,
                        ]}
                      >
                        {group.phase.wbs}  {group.phase.title}
                      </Text>
                      {phaseSelected ? <Ionicons name="checkmark-circle" size={16} color="#6C5CE7" /> : null}
                    </Pressable>
                    {group.sections.map((sec) => {
                      const selected = depsPickerSelectedIds.includes(sec.id);
                      const disabled = isDisabledCandidate(sec.id);
                      return (
                        <Pressable
                          key={sec.id}
                          style={[
                            ts.depsPickerRow,
                            ts.depsPickerSectionRow,
                            disabled ? ts.movePickerDisabledRow : ts.movePickerSelectableRow,
                            selected && ts.depsPickerRowActive,
                          ]}
                          onPress={disabled ? undefined : () => toggleSection(sec.id)}
                          disabled={disabled}
                        >
                          <Text
                            style={[
                              ts.depsPickerRowText,
                              disabled ? ts.movePickerDisabledText : ts.movePickerSelectableText,
                              selected && ts.depsPickerRowTextActive,
                            ]}
                            numberOfLines={1}
                          >
                            {sec.wbs}  {sec.title}
                          </Text>
                          {selected ? <Ionicons name="checkmark-circle" size={16} color="#6C5CE7" /> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                  );
                })}
              </ScrollView>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
                <TouchableOpacity
                  style={ts.depsPickerSecondaryBtn}
                  onPress={() => setDepsPanelNodeId(null)}
                >
                  <Text style={ts.depsPickerSecondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={ts.depsPickerDoneBtn} onPress={onConfirmDeps}>
                  <Text style={ts.depsPickerDoneText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        );
      })()}

      {handoffDraft && (
        <View style={ts.handoffOverlay} pointerEvents="box-none">
          <Pressable
            style={ts.handoffOverlayBackdrop}
            onPress={() => setHandoffDraft(null)}
          />
          <View style={ts.handoffCard}>
            <Text style={ts.handoffTitle}>{handoffDraft.verb}</Text>
            <Text style={ts.handoffSubtitle}>Add a note (optional)</Text>
            <TextInput
              style={ts.handoffInput}
              value={handoffDraft.note}
              onChangeText={(text) =>
                setHandoffDraft((prev) => (prev ? { ...prev, note: text } : prev))
              }
              multiline
              placeholder="Say something..."
              placeholderTextColor="#B2BEC3"
            />
            <View style={ts.handoffActions}>
              <TouchableOpacity
                style={ts.handoffSecondaryBtn}
                onPress={() => setHandoffDraft(null)}
              >
                <Text style={ts.handoffSecondaryText}>Not now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={ts.handoffPrimaryBtn}
                onPress={() => {
                  if (!handoffDraft) return;
                  const draft = handoffDraft;
                  setHandoffDraft(null);

                  const patch: Partial<Pick<ProjectTodoNode, 'status' | 'type'>> = {};
                  if (draft.fromSide !== draft.toSide) patch.type = draft.toSide;
                  if (draft.newStatus != null) patch.status = draft.newStatus;
                  const runApi = () =>
                    changeProjectTodoResponsibleSide({
                      todoId: draft.todoId,
                      fromSide: draft.fromSide,
                      toSide: draft.toSide,
                      note: draft.note,
                      newStatus: draft.newStatus,
                    });

                  const canOptimistic =
                    onMergeProjectTodosTree && (patch.type !== undefined || patch.status !== undefined);
                  if (canOptimistic) {
                    const snapshot = cloneProjectTodoTree(tree);
                    onMergeProjectTodosTree(patchProjectTodoInTree(tree, draft.todoId, patch));
                    void (async () => {
                      const { error } = await runApi();
                      if (error) {
                        onMergeProjectTodosTree(snapshot);
                        if (Platform.OS === 'web') window.alert(error.message ?? 'Update failed');
                        else Alert.alert('Update failed', error.message ?? '');
                      }
                    })();
                    return;
                  }

                  void (async () => {
                    const { error } = await runApi();
                    if (error) {
                      if (Platform.OS === 'web') window.alert(error.message ?? 'Update failed');
                      else Alert.alert('Update failed', error.message ?? '');
                      return;
                    }
                    await refreshTodosPreservingScroll();
                  })();
                }}
              >
                <Text style={ts.handoffPrimaryText}>Confirm submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );

  const wrappedMain = (
    <TaxFilingTodoDesktopWebLayoutContext.Provider value={isDesktopWebTodoLayout}>
      {todoMainView}
    </TaxFilingTodoDesktopWebLayoutContext.Provider>
  );

  if (todoDragContextValue) {
    return <TodoDragContext.Provider value={todoDragContextValue}>{wrappedMain}</TodoDragContext.Provider>;
  }
  return wrappedMain;
}

// ──────────────────────────────────────────────────
// Styles（以 client 端 project-todos 为基准：tax-filing/project/[projectId]，与 index 完全一致）
// ──────────────────────────────────────────────────

const ts = StyleSheet.create({
  root: { flex: 1, position: 'relative' },
  scroll: { flex: 1 },
  // 与 engagement 详情底部浮层按钮高度匹配，保证最后一行可完全滚动到按钮上方
  scrollContent: { padding: 16, paddingBottom: 120 },
  phaseBlocksWrap: { gap: 12, backgroundColor: '#F8F9FA' },
  phaseBlock: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DEE2E6',
    overflow: 'hidden',
  },
  /** Web 行内重命名：避免圆角卡片裁切输入框左缘/描边 */
  phaseBlockWhileRenaming: {
    overflow: 'visible',
  } as const,
  /** 与 phase 标题左端对齐：左留白(62) + icon(20) + gap(6) = 88，与 phase 标题起点一致 */
  addPhaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingRight: 12,
    paddingLeft: 62,
    minHeight: 40,
  },
  addPhaseIconWrap: { marginRight: 6 },
  addPhaseText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6C5CE7',
  },
  addPhaseInputRow: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0, gap: 6 },
  addPhaseInput: {
    flex: 1,
    fontSize: 15,
    color: '#2D3436',
    paddingVertical: 2,
    paddingLeft: 10,
    paddingRight: 0,
    minHeight: 24,
    minWidth: 60,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: 4,
  },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { fontSize: 15, color: '#636E72' },
  filterEmptyWrap: {
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterEmptyText: { fontSize: 14, color: '#636E72', textAlign: 'center' },
  treeRowWrap: {},
  treeRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 4,
    // 移动端右侧留白减小，让状态标更贴近屏幕右缘
    paddingRight: Platform.OS === 'web' ? 12 : 4,
    paddingLeft: Platform.OS === 'web' ? 4 : 0,
    // 提高手指点击区域高度：移动端行高略大于 Web
    minHeight: Platform.OS === 'web' ? 40 : 48,
    flexWrap: 'nowrap',
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  rowShowAddWrap: { flex: 1, flexDirection: 'row', alignItems: 'stretch', minWidth: 0, cursor: 'pointer' } as any,
  rowShowAddInner: { flex: 1, flexDirection: 'row', alignItems: 'stretch', minWidth: 0 },
  treeRowLeftBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    minWidth: 0,
    // Web：预留右侧间距给文件计数 / 状态列（含 edit / - 等行尾图标，避免与计数重叠）
    marginRight: Platform.OS === 'web' ? 40 : 0,
  },
  /** 移动端：左侧块弹性占满，与文件计数间距紧凑 */
  treeRowLeftBlockMobile: {
    flex: 1,
    minWidth: 0,
    // 移动端：尽量贴近文件计数列，为名称腾出更多空间
    marginRight: 2,
  },
  treeRowRightColsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Platform.OS === 'web' ? 32 : 2,
    // Web：右侧列可占一定宽度；移动端：右侧列只按内容宽度排布，并整体靠右
    ...(Platform.OS === 'web'
      ? { flexShrink: 0 }
      : { flexShrink: 0, flexGrow: 0, justifyContent: 'flex-end' }),
  },
  statusColWithGap: {
    marginLeft: Platform.OS === 'web' ? 12 : 2,
    marginRight: Platform.OS === 'web' ? 20 : 4,
    alignItems: 'flex-start',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  showAddTouchArea: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', cursor: 'pointer' } as any,
  chevronWrap: {
    // Web 端预留 28 宽度给 chevron；移动端不显示 chevron，不占宽度，方便 phase 顶格
    width: Platform.OS === 'web' ? 28 : 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wbsHotzone: {
    // WBS 列整体靠左对齐，编号与标题共享同一左起点（垂直方向仍居中）
    // Web：固定列宽；移动端：用 minWidth + flexShrink:0，避免大字体/长编号被压成省略号
    ...(Platform.OS === 'web'
      ? { width: 36, marginRight: 8 }
      : { minWidth: 48, marginRight: 6, flexShrink: 0 }),
    alignItems: 'flex-start',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  titleColumnWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    // 移动端：允许整列收紧，不额外保留右侧“安全空档”
    ...(Platform.OS === 'web' ? {} : { justifyContent: 'flex-start' }),
  },
  titleColumnTrailing: { flex: 1, minWidth: 0, cursor: 'pointer' } as any,
  titleHotzone: { alignSelf: 'stretch', justifyContent: 'center', flexShrink: 0 },
  treeTitleWrapAdaptive: { flexDirection: 'row', alignItems: 'center' },
  /** 原生行内重命名：层叠上下文 */
  renameTitleRow: Platform.OS === 'web'
    ? ({ position: 'relative' as const, isolation: 'isolate' as const } as object)
    : {},
  /** 徽章+锁：与只读行同一行内顺序；标签自带 marginRight，此处不再额外拉大与标题/输入的间距 */
  renameLeadCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    zIndex: 0,
    ...(Platform.OS === 'web' ? ({ position: 'relative' as const } as object) : {}),
  },
  /** 标题/输入轨：与只读 Text 同一水平起点（紧随徽章+锁） */
  renameInlineTitleTrack: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingLeft: 0,
    ...(Platform.OS === 'web'
      ? ({
          position: 'relative' as const,
          zIndex: 25,
        } as object)
      : {}),
  },
  /** 固定宽输入 + 框外取消/确认；宽度由整树最长标题统一算出，避免随输入变化引起布局抖动 */
  renameInlineInputTrail: {
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: 8,
    ...(Platform.OS === 'web' ? ({ overflow: 'visible' } as object) : {}),
  },
  /** 附件行内改名：输入框占据原文件名的 flex 槽位 */
  fileRenameInlineNameRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fileRenameNameInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: '500',
    color: '#636E72',
    paddingVertical: 2,
    paddingHorizontal: 6,
    minHeight: 22,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
    ...(Platform.OS === 'web'
      ? ({
          outlineStyle: 'none',
          outlineWidth: 0,
          boxSizing: 'border-box',
        } as object)
      : {}),
  } as any,
  /** 取消/确认：在输入框右缘外侧；整行左块在重命名时会 zIndex 抬高，避免 Web 点穿到右列 */
  renameInlineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  treeTitleAdaptive: { fontSize: 15, color: '#2D3436' },
  treeTitleCanceled: { textDecorationLine: 'line-through', color: '#95A5A6' },
  terminateTaskBtnHotzone: { alignSelf: 'stretch', justifyContent: 'center', marginLeft: 2, cursor: 'pointer', minWidth: 20 } as any,
  restoreTaskBtnHotzone: { alignSelf: 'stretch', justifyContent: 'center', marginLeft: 2, cursor: 'pointer', minWidth: 20 } as any,
  terminateTaskBtnIcon: { height: 20, width: 20, justifyContent: 'center', alignItems: 'center', transform: [{ translateY: 1 }] },
  restoreTaskBtnIcon: { height: 20, width: 20, justifyContent: 'center', alignItems: 'center', transform: [{ translateY: 1 }] },
  addIconSlot: { width: 96, height: 20, justifyContent: 'center', alignItems: 'flex-start', marginLeft: 8 },
  wbsColText: {
    fontSize: 11,
    color: '#95A5A6',
    fontWeight: '500',
    ...(Platform.OS === 'web' ? {} : { flexShrink: 0 }),
  },
  titleColumnTrailingInner: { flex: 1, minWidth: 0 },
  addChildBtn: { padding: 0, marginLeft: 0, marginTop: 2 },
  addChildPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 0,
    paddingVertical: 0,
    marginTop: 3,
  },
  addChildPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6C5CE7',
  },
  addChildPillTextActive: {
    color: '#4C33C7',
  },
  pendingAddRow: { minHeight: 40 },
  pendingAddInputRow: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0, gap: 6 },
  pendingAddInput: {
    flex: 1,
    fontSize: 14,
    color: '#2D3436',
    paddingVertical: 2,
    paddingLeft: 10,
    paddingRight: 0,
    minHeight: 24,
    minWidth: 60,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: 4,
  },
  cancelAddBtn: { padding: 2, marginRight: 2, minWidth: 28, minHeight: 28, justifyContent: 'center', alignItems: 'center', cursor: 'pointer' } as any,
  confirmAddBtn: { padding: 2, minWidth: 28, minHeight: 28, justifyContent: 'center', alignItems: 'center', cursor: 'pointer' } as any,
  treeTitleL0: { fontWeight: '700', fontSize: 15, color: '#2D3436' },
  treeTitleL1: { fontWeight: '600', fontSize: 14, color: '#2D3436' },
  treeTitleL2: { fontWeight: '500', fontSize: 13, color: '#636E72' },
  progressFilesCol: {
    width: 80,
    minWidth: 80,
    flexShrink: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
    alignSelf: 'stretch',
    ...(Platform.OS === 'web' ? { paddingLeft: 14, marginLeft: 4 } : {}),
  },
  /** 移动端：文件计数列紧凑（icon + 数字） */
  progressFilesColMobile: {
    minWidth: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  nmTextMobile: { fontSize: 11, color: '#636E72' },
  // icon 与数字间距进一步减小
  filesToggleMobile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    paddingVertical: 2,
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  progressFilesColInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 4 },
  uploadTaskBtnHotzone: { alignSelf: 'stretch', justifyContent: 'center', cursor: 'pointer' } as any,
  uploadTaskBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 20, maxHeight: 20, paddingVertical: 0, paddingHorizontal: 5, backgroundColor: '#6C5CE7', borderRadius: 4, justifyContent: 'center' },
  uploadTaskBtnText: { fontSize: 10, color: '#FFF', fontWeight: '600' },
  nmText: { fontSize: 12, color: '#636E72' },
  statusCol: {
    // Web：固定宽度 pill；移动端：圆点列宽稍大，方便点按
    ...(Platform.OS === 'web' ? { width: 120, minWidth: 120 } : { minWidth: 32, width: 32 }),
    flexShrink: 0,
    alignItems: Platform.OS === 'web' ? 'flex-start' : 'flex-end',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  // 显示状态动词按钮时：让按钮占据右侧更大空间，文案可以完整展示
  statusColExpanded: {
    width: '100%',
    minWidth: 0,
    alignItems: 'flex-end',
  },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14 },
  statusPillText: { fontSize: 11, color: '#FFF', fontWeight: '600' },
  // 移动端简化状态圆点（略放大以便可见）
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  statusPillPending: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, backgroundColor: 'rgba(99,110,114,0.58)' },
  statusPillPendingText: { fontSize: 11, color: '#FFF', fontWeight: '700' },
  statusActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
  },
  statusActionBtn: {
    height: 30,
    paddingHorizontal: 12,
    paddingVertical: 0,
    borderRadius: 6,
    backgroundColor: '#6C5CE7',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.32,
    shadowRadius: 4,
    elevation: 4,
  },
  statusActionBtnSecondary: {
    height: 30,
    paddingHorizontal: 12,
    paddingVertical: 0,
    borderRadius: 6,
    backgroundColor: 'rgba(108, 92, 231, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.26,
    shadowRadius: 4,
    elevation: 4,
  },
  /** 移动端：点击状态圆点从右端切出的浮层 */
  statusPanelBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 0,
  },
  statusPanelSheet: {
    width: 280,
    maxWidth: '85%',
    backgroundColor: '#FFF',
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
    paddingTop: 12,
    paddingBottom: 24,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  statusPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingRight: 8,
  },
  statusPanelTitle: { fontSize: 15, fontWeight: '600', color: '#2D3436', flex: 1 },
  statusPanelCloseBtn: { padding: 4 },
  statusPanelBtn: {
    height: 44,
    borderRadius: 8,
    backgroundColor: '#6C5CE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  statusPanelBtnSecondary: {
    height: 44,
    borderRadius: 8,
    backgroundColor: 'rgba(108, 92, 231, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  filesToggle: { flexDirection: 'row', alignItems: 'center' },
  filesToggleText: { fontSize: 12, color: '#6C5CE7', marginLeft: 2 },
  filesBlock: {
    paddingTop: 0,
    paddingBottom: 6,
    paddingRight: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  /** 移动端：文件块左端缩进减小，多留空间给名称 */
  filesBlockMobile: { paddingLeft: 8, paddingRight: 0 },
  filesEmpty: { fontSize: 13, color: '#95A5A6', fontStyle: 'italic' },
  fileTable: { borderWidth: 1, borderColor: '#E9ECEF', borderRadius: 8, overflow: 'hidden' },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 8,
    minHeight: 36,
  },
  /** 移动端：文件行紧凑，仅 icon+名称+删除+move */
  fileRowMobile: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 6,
    minHeight: 40,
  },
  fileColIcon: { width: 24, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  fileColNameDesc: { flex: 1, minWidth: 0, marginRight: 8 },
  // 文件名称弱化：字号略小、颜色略灰、权重降低
  fileRowName: { fontSize: 12, fontWeight: '500', color: '#636E72' },
  fileRowDesc: { fontSize: 11, color: '#636E72', marginTop: 2 },
  /** Date + uploader sit in a non-shrinking group so the filename column flexes first */
  fileRowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 10,
    marginLeft: 4,
  },
  fileColTime: {
    fontSize: 11,
    color: '#636E72',
    minWidth: 112,
    maxWidth: 124,
    flexShrink: 0,
    textAlign: 'right',
  },
  fileColUploader: {
    fontSize: 11,
    color: '#636E72',
    minWidth: 88,
    maxWidth: 200,
    flexShrink: 0,
    textAlign: 'right',
  },
  fileRowActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  fileRowActionBtn: { padding: 4, justifyContent: 'center', alignItems: 'center' },
  fileRowLast: { borderBottomWidth: 0 },
  attachmentCardsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  attachmentCard: {
    minWidth: 200,
    width: '48%',
    maxWidth: 320,
    backgroundColor: '#FFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    padding: 10,
  },
  attachmentCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  attachmentCardThumb: { width: 52, height: 52, borderRadius: 8, backgroundColor: '#F1F5F9' },
  attachmentCardThumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  attachmentCardBody: { flex: 1, minWidth: 0 },
  attachmentCardDocType: {
    alignSelf: 'flex-start',
    backgroundColor: '#F0EEFF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 4,
  },
  attachmentCardDocTypeText: { fontSize: 10, color: '#6C5CE7', fontWeight: '600' },
  attachmentCardPending: { fontSize: 11, color: '#95A5A6', fontStyle: 'italic', marginBottom: 2 },
  attachmentCardSummary: { fontSize: 12, color: '#2D3436', marginBottom: 4 },
  attachmentCardPreview: { gap: 2 },
  attachmentCardPreviewLine: { fontSize: 10, color: '#636E72', marginBottom: 0 },
  attachmentCardTrailing: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fileRowRemoveBtn: { width: 20, height: 20, justifyContent: 'center', alignItems: 'center', cursor: 'pointer' } as any,
  // ── task 行前置依赖列（状态标签之后，行内 WBS 标签 + 浮窗触发器）──
  depsIconBtn: { width: 20, height: 16, alignItems: 'center', justifyContent: 'center' },
  taskDepsCol: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 6,
    marginLeft: 20,
    minWidth: 100,
    alignSelf: 'stretch',
    justifyContent: 'flex-start',
  },
  taskDepsLabel: {
    fontSize: 10,
    color: '#95A5A6',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },
  taskDepsChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 4,
  },
  taskDepsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(108,92,231,0.09)',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 3,
    position: 'relative',
  },
  taskDepsChipText: {
    fontSize: 10,
    color: '#6C5CE7',
    fontWeight: '700',
    minWidth: 26, // ≈ 3 个字符宽度
    textAlign: 'center',
  },
  taskDepsChipRemoveBadge: {
    position: 'absolute',
    right: 1,
    top: '50%',
    marginTop: -7.5, // 让 14px 高度的圆形垂直居中
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#E0E4EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskDepsTrigger: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },

  // ── 前置依赖浮窗选单 ──
  depsPickerOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  depsPickerBackdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  depsPickerCard: {
    maxWidth: 420,
    width: '85%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  depsPickerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2D3436',
    marginTop: 4,
    marginBottom: 10,
    lineHeight: 22,
  },
  depsPickerSubtitle: {
    fontSize: 12,
    color: '#95A5A6',
    fontWeight: '400',
    marginBottom: 14,
  },
  depsPickerList: { maxHeight: 460, marginBottom: 12 },
  depsPickerGroup: { marginBottom: 4 },
  // 统一 phase 行与普通行的高度和左右内距
  depsPickerPhaseRow: { paddingVertical: 6, paddingHorizontal: 10 },
  depsPickerPhaseText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: '#2D3436',
  },
  depsPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: '#F8F9FA',
    marginBottom: 2,
  },
  depsPickerNoneRow: { marginTop: 2, marginBottom: 4 },
  depsPickerSectionRow: { marginLeft: 16 },
  depsPickerRowActive: { borderColor: '#6C5CE7', backgroundColor: 'rgba(108,92,231,0.08)' },
  depsPickerRowText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#636E72',
    fontWeight: '500',
    flex: 1,
  },
  // 选中时仅改变颜色，不改变字号和行高
  depsPickerRowTextActive: {
    color: '#6C5CE7',
  },
  // Move-file 浮窗：可选项行（task）更亮、更突出
  movePickerSelectableRow: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7FF',
  },
  movePickerSelectableText: {
    color: '#2D3436',
  },
  // Move-file 浮窗：不可选项（phase、源 task）整体弱化
  movePickerDisabledRow: {
    // 只做轻微弱化，避免影响可读性
    opacity: 0.75,
  },
  movePickerDisabledText: {
    color: '#2D3436',
  },
  depsPickerDoneBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#6C5CE7',
    borderRadius: 8,
  },
  depsPickerDoneText: { fontSize: 13, color: '#FFF', fontWeight: '600' },
  depsPickerSecondaryBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#F1F3F5',
  },
  depsPickerSecondaryText: { fontSize: 13, color: '#636E72', fontWeight: '500' },
  /** Phase 行删除图标：红底白标，与 + 同 marginTop 对齐；名称与 -、- 与 + 的间距略增 */
  deletePhaseIconSlot: { width: 14, marginLeft: 8 },
  deletePhaseIconWrap: { padding: 0, marginLeft: 0, marginTop: 2 },
  deletePhaseIconBtn: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E74C3C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  depsPickerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  depsPickerChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#C9B9F9',
    backgroundColor: '#fff',
    maxWidth: 240,
  },
  depsPickerChipActive: { borderColor: '#6C5CE7', backgroundColor: '#6C5CE7' },
  depsPickerChipText: { fontSize: 12, color: '#636E72', fontWeight: '500' },
  depsPickerChipTextActive: { color: '#fff', fontWeight: '700' },

  // ── 责任方标签（现放在任务名称前，与标题同行） ──
  roleBadgeInlineWrap: { marginRight: 4 },
  roleCol: {
    width: 80,
    minWidth: 80,
    flexShrink: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  roleBadgeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexWrap: 'nowrap',
    gap: 12,
  },
  roleBadge: {
    minWidth: 52,
    height: 20,
    paddingHorizontal: 8,
    paddingVertical: 0,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBadgeFirm:   { backgroundColor: 'rgba(162, 155, 254, 0.2)' },  // 紫色系（firm task）
  roleBadgeClient: { backgroundColor: 'rgba(116, 185, 255, 0.25)' }, // 蓝色系（client task）
  roleBadgePending: { backgroundColor: 'rgba(149, 165, 166, 0.35)' }, // 灰色系（pending 被依赖锁定）
  roleBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#636E72',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  handoffBtn: { paddingVertical: 6, paddingHorizontal: 8, minWidth: 44 },
  handoffBtnText: { fontSize: 10, color: '#6C5CE7', fontWeight: '600' },

  // ── 责任流转浮窗（收集可选 note） ──
  handoffOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  handoffOverlayBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  handoffCard: {
    maxWidth: 360,
    width: '80%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  handoffTitle: { fontSize: 15, fontWeight: '600', color: '#2D3436', marginBottom: 6 },
  handoffSubtitle: { fontSize: 12, color: '#636E72', marginBottom: 10 },
  handoffInput: {
    minHeight: 72,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E4F0',
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 13,
    color: '#2D3436',
    marginBottom: 12,
  },
  handoffActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },
  handoffSecondaryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  handoffSecondaryText: {
    fontSize: 13,
    color: '#636E72',
  },
  handoffPrimaryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#6C5CE7',
  },
  handoffPrimaryText: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
