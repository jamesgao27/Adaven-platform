/**
 * WBS 树拖放：在内存中调整 phase / section / task 的父子与同级顺序（与 sku_items / project_todos 兄弟 sort_order 语义一致）。
 * 结构与 ProjectTodoNode 兼容，避免从 firm 导入造成循环依赖。
 */
export interface TodoReorderNode {
  id: string;
  itemKind: 'phase' | 'section' | 'task';
  sortOrder: number;
  children: TodoReorderNode[];
  [key: string]: unknown;
}

export type TodoDropPosition = 'before' | 'after' | 'into';

function deepCloneNodes<T extends TodoReorderNode>(nodes: T[]): T[] {
  return nodes.map((n) => ({ ...n, children: deepCloneNodes(n.children) })) as T[];
}

export function findTodoNodeById<T extends TodoReorderNode>(nodes: T[], id: string): T | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const c = findTodoNodeById(n.children as T[], id);
    if (c) return c;
  }
  return null;
}

function collectDescendantIds(root: TodoReorderNode): Set<string> {
  const s = new Set<string>();
  const walk = (n: TodoReorderNode) => {
    s.add(n.id);
    n.children.forEach(walk);
  };
  walk(root);
  return s;
}

function extractSubtree<T extends TodoReorderNode>(
  nodes: T[],
  id: string,
): { next: T[]; subtree: T | null } {
  const i = nodes.findIndex((n) => n.id === id);
  if (i >= 0) {
    const subtree = nodes[i];
    return { next: [...nodes.slice(0, i), ...nodes.slice(i + 1)] as T[], subtree };
  }
  for (let j = 0; j < nodes.length; j++) {
    const { next: chNext, subtree } = extractSubtree(nodes[j].children as T[], id);
    if (subtree) {
      const next = [...nodes] as T[];
      next[j] = { ...nodes[j], children: chNext } as T;
      return { next, subtree };
    }
  }
  return { next: nodes, subtree: null };
}

function insertAt<T extends TodoReorderNode>(
  nodes: T[],
  parentId: string | null,
  index: number,
  subtree: T,
): T[] | null {
  if (parentId == null) {
    if (index < 0 || index > nodes.length) return null;
    return [...nodes.slice(0, index), subtree, ...nodes.slice(index)] as T[];
  }
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === parentId) {
      const ch = nodes[i].children as T[];
      if (index < 0 || index > ch.length) return null;
      const nextCh = [...ch.slice(0, index), subtree, ...ch.slice(index)];
      const next = [...nodes] as T[];
      next[i] = { ...nodes[i], children: nextCh } as T;
      return next;
    }
    const sub = insertAt(nodes[i].children as T[], parentId, index, subtree);
    if (sub) {
      const next = [...nodes] as T[];
      next[i] = { ...nodes[i], children: sub } as T;
      return next;
    }
  }
  return null;
}

/** 返回 childId 的直接父 id；根节点返回 null；未找到返回 undefined */
function findParentId<T extends TodoReorderNode>(
  nodes: T[],
  childId: string,
  parent: string | null = null,
): string | null | undefined {
  for (const n of nodes) {
    if (n.id === childId) return parent;
    const r = findParentId(n.children as T[], childId, n.id);
    if (r !== undefined) return r;
  }
  return undefined;
}

function getSiblingList<T extends TodoReorderNode>(nodes: T[], parentId: string | null): { list: T[] } | null {
  if (parentId == null) return { list: nodes };
  const p = findTodoNodeById(nodes, parentId);
  if (!p) return null;
  return { list: p.children as T[] };
}

/**
 * 将 draggedId 对应子树移动到 targetId 指定位置；成功返回新根列表，失败返回 null。
 */
export function moveProjectTodoInTree<T extends TodoReorderNode>(
  roots: T[],
  draggedId: string,
  targetId: string,
  position: TodoDropPosition,
): T[] | null {
  if (draggedId === targetId) return null;
  const tree = deepCloneNodes(roots);
  const dragRoot = findTodoNodeById(tree, draggedId);
  const targetNode = findTodoNodeById(tree, targetId);
  if (!dragRoot || !targetNode) return null;
  if (collectDescendantIds(dragRoot).has(targetId)) return null;

  let newParentId: string | null;
  let insertIndex: number;

  if (position === 'into') {
    const tk = targetNode.itemKind;
    const dk = dragRoot.itemKind;
    if (tk === 'phase' && dk === 'section') {
      newParentId = targetNode.id;
      insertIndex = targetNode.children.length;
    } else if (tk === 'section' && dk === 'task') {
      newParentId = targetNode.id;
      insertIndex = targetNode.children.length;
    } else {
      return null;
    }
  } else {
    if (dragRoot.itemKind !== targetNode.itemKind) return null;
    const p = findParentId(tree, targetId);
    if (p === undefined) return null;
    newParentId = p;
    const sib = getSiblingList(tree, newParentId);
    if (!sib) return null;
    const idx = sib.list.findIndex((n) => n.id === targetId);
    if (idx < 0) return null;
    insertIndex = position === 'before' ? idx : idx + 1;
  }

  const dragParentBefore = findParentId(tree, draggedId);
  if (dragParentBefore === undefined) return null;

  const sibForOldIdx = getSiblingList(tree, newParentId);
  const oldIdx =
    dragParentBefore === newParentId
      ? sibForOldIdx?.list.findIndex((n) => n.id === draggedId) ?? -1
      : -1;

  const { next: without, subtree } = extractSubtree(tree, draggedId);
  if (!subtree) return null;

  let adjustedIndex = insertIndex;
  if (dragParentBefore === newParentId && oldIdx >= 0 && oldIdx < insertIndex) {
    adjustedIndex = insertIndex - 1;
  }

  const inserted = insertAt(without, newParentId, adjustedIndex, subtree);
  return inserted;
}

/** 按当前树结构重写每层的 sortOrder（1..n），用于写回 DB */
export function renumberTodoTreeSortOrders<T extends TodoReorderNode>(nodes: T[]): T[] {
  return nodes.map((n, i) => ({
    ...n,
    sortOrder: i + 1,
    children: renumberTodoTreeSortOrders(n.children as T[]),
  })) as T[];
}
