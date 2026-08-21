import type { ProjectTodoNode } from './firm';

/** Deep clone for optimistic UI rollback (JSON is sufficient for todo nodes). */
export function cloneProjectTodoTree(roots: ProjectTodoNode[]): ProjectTodoNode[] {
  return JSON.parse(JSON.stringify(roots)) as ProjectTodoNode[];
}

/** Immutable patch of one task node by id (status / 责任方). */
export function patchProjectTodoInTree(
  roots: ProjectTodoNode[],
  todoId: string,
  patch: Partial<Pick<ProjectTodoNode, 'status' | 'type'>>,
): ProjectTodoNode[] {
  function walk(nodes: ProjectTodoNode[]): ProjectTodoNode[] {
    return nodes.map((n) => {
      if (n.id === todoId) {
        return { ...n, ...patch, children: n.children };
      }
      if (n.children.length === 0) return n;
      return { ...n, children: walk(n.children) };
    });
  }
  return walk(roots);
}
