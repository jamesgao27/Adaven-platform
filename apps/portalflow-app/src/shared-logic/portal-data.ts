import { supabase, TAX_FILING_BUCKET, uploadTaxFilingFileBytes } from './supabase';
import { getProjectTodosTree, updateProjectTodo, createProjectTodoAttachment, type ProjectTodoNode } from './firm';
import { evaluateChecklistAgainstFile, type ChecklistItemInput } from './portal-checklist';

export type PortalChecklistItem = ChecklistItemInput & {
  satisfied: boolean;
  gap: string | null;
};

export type PortalFile = {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  owned: boolean;
};

export type PortalMessage = {
  id: string;
  kind: 'urge' | 'message' | 'reply';
  body: string;
  createdAt: string;
  mine: boolean;
};

function flattenClientTasks(nodes: ProjectTodoNode[]): ProjectTodoNode[] {
  const out: ProjectTodoNode[] = [];
  const walk = (list: ProjectTodoNode[]) => {
    for (const node of list) {
      const side = node.initialResponsibleSide || node.type;
      if (node.itemKind === 'task' && side === 'client') out.push(node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export async function loadPortalChecklist(orderId: string): Promise<PortalChecklistItem[]> {
  const tree = await getProjectTodosTree(orderId);
  const tasks = flattenClientTasks(tree);
  const { data } = await supabase
    .from('engagement_checklist_state')
    .select('todo_id, satisfied, gap')
    .eq('order_id', orderId);
  const state = new Map((data || []).map((row) => [row.todo_id as string, row]));
  return tasks.map((task) => {
    const row = state.get(task.id);
    const satisfied = row?.satisfied === true || task.status === 'completed';
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      satisfied,
      gap: satisfied ? null : (row?.gap as string | null) ?? null,
    };
  });
}

export async function loadPortalFiles(orderId: string, userId: string): Promise<PortalFile[]> {
  const [{ data: folder }, tree] = await Promise.all([
    supabase
      .from('engagement_files')
      .select('id, file_name, file_url, created_at, uploaded_by')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false }),
    getProjectTodosTree(orderId),
  ]);
  const files: PortalFile[] = (folder || []).map((row) => ({
    id: String(row.id),
    name: String(row.file_name),
    url: String(row.file_url),
    createdAt: String(row.created_at),
    owned: row.uploaded_by === userId,
  }));
  const todoIds = flattenClientTasks(tree).map((task) => task.id);
  if (todoIds.length) {
    const { data: older } = await supabase
      .from('project_todo_attachments')
      .select('id, attachment_url, source_file_name, display_name, created_at')
      .in('project_todo_id', todoIds);
    const seen = new Set(files.map((file) => file.url));
    for (const row of older || []) {
      const url = String(row.attachment_url || '');
      if (!url || seen.has(url)) continue;
      seen.add(url);
      files.push({
        id: `legacy-${row.id}`,
        name: String(row.display_name || row.source_file_name || 'File'),
        url,
        createdAt: String(row.created_at || ''),
        owned: false,
      });
    }
  }
  return files;
}

export async function uploadPortalFile(params: {
  orderId: string;
  clientSpaceId: string;
  userId: string;
  fileName: string;
  bytes: ArrayBuffer;
  mimeType: string;
}): Promise<void> {
  const safe = params.fileName.replace(/[^\w.\- ()]+/g, '_').slice(0, 120) || 'file';
  const storedName = `portal/${params.orderId}/${Date.now()}-${safe}`;
  const url = await uploadTaxFilingFileBytes(params.clientSpaceId, storedName, params.bytes, params.mimeType);
  const { error } = await supabase.from('engagement_files').insert({
    order_id: params.orderId,
    file_url: url,
    file_name: params.fileName,
    storage_path: `${params.clientSpaceId}/${storedName}`,
    uploaded_by: params.userId,
  });
  if (error) throw new Error(error.message);

  const checklist = await loadPortalChecklist(params.orderId);
  const open = checklist.filter((item) => !item.satisfied);
  if (!open.length) return;
  const verdicts = await evaluateChecklistAgainstFile(url, params.fileName, open, params.mimeType);
  for (const verdict of verdicts) {
    if (verdict.satisfied) {
      await updateProjectTodo(verdict.id, { status: 'completed' });
      await createProjectTodoAttachment(verdict.id, url, {
        status: 'PROCESSED',
        source_file_name: params.fileName,
        display_name: params.fileName,
        summary: 'Matched from the client folder',
      });
    }
    await supabase.from('engagement_checklist_state').upsert({
      order_id: params.orderId,
      todo_id: verdict.id,
      satisfied: verdict.satisfied,
      gap: verdict.gap,
      updated_at: new Date().toISOString(),
    });
  }
}

export async function deletePortalFile(fileId: string): Promise<void> {
  const { data } = await supabase.from('engagement_files').select('storage_path').eq('id', fileId).maybeSingle();
  if (data?.storage_path) {
    await supabase.storage.from(TAX_FILING_BUCKET).remove([String(data.storage_path)]);
  }
  const { error } = await supabase.from('engagement_files').delete().eq('id', fileId);
  if (error) throw new Error(error.message);
}

export async function loadPortalMessages(orderId: string, userId: string): Promise<PortalMessage[]> {
  const { data, error } = await supabase
    .from('engagement_messages')
    .select('id, kind, body, created_at, author_user_id')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    id: String(row.id),
    kind: row.kind as PortalMessage['kind'],
    body: String(row.body || ''),
    createdAt: String(row.created_at),
    mine: row.author_user_id === userId,
  }));
}

export async function sendPortalMessage(params: {
  orderId: string;
  userId: string;
  kind: 'urge' | 'message' | 'reply';
  body: string;
}): Promise<void> {
  const body = params.body.trim();
  if (params.kind !== 'urge' && !body) throw new Error('Write a message first.');
  const { error } = await supabase.from('engagement_messages').insert({
    order_id: params.orderId,
    author_user_id: params.userId,
    kind: params.kind,
    body: params.kind === 'urge' && !body ? 'Please review this engagement.' : body,
  });
  if (error) throw new Error(error.message);
}
