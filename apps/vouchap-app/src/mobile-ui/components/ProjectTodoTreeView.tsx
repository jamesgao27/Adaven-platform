/**
 * 项目内树形任务列表（参考 aim.link tasklist）：WBS 编号、展开/折叠、元信息、快捷添加
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ProjectTodoNode } from '@/lib/firm';
import { TODO_STATUS_LABEL, TODO_STATUS_COLOR } from '@/lib/constants/project-todo-status';

export interface ProjectTodoTreeViewProps {
  orderId: string;
  tree: ProjectTodoNode[];
  onRefresh: () => void | Promise<void>;
  createProjectTodo: (params: {
    orderId: string;
    parentId?: string | null;
    type: 'client' | 'firm';
    title: string;
    description?: string | null;
    sortOrder?: number;
  }) => Promise<{ id: string | null; error: Error | null }>;
  /** 默认全部展开；传入 false 则仅根级展开 */
  defaultExpandAll?: boolean;
}

function collectIds(nodes: ProjectTodoNode[]): Set<string> {
  const set = new Set<string>();
  function walk(list: ProjectTodoNode[]) {
    list.forEach((n) => {
      set.add(n.id);
      walk(n.children);
    });
  }
  walk(nodes);
  return set;
}

export function ProjectTodoTreeView({
  orderId,
  tree,
  onRefresh,
  createProjectTodo,
  defaultExpandAll = true,
}: ProjectTodoTreeViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    defaultExpandAll ? collectIds(tree) : new Set()
  );
  const [addInput, setAddInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleAddTask = useCallback(async () => {
    const title = addInput.trim();
    if (!title) return;
    setAdding(true);
    setError(null);
    const { id, error: err } = await createProjectTodo({
      orderId,
      parentId: null,
      type: 'client',
      title,
    });
    setAdding(false);
    setAddInput('');
    if (err) {
      setError(err.message);
      return;
    }
    if (id) await onRefresh();
  }, [orderId, addInput, createProjectTodo, onRefresh]);

  const renderNode = (node: ProjectTodoNode, wbsParts: number[], depth: number) => {
    const wbs = wbsParts.join('.');
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(node.id);
    const indent = depth * 16;
    const childCompleted = node.children.filter((c) => c.status === 'success').length;
    const childTotal = node.children.length;
    const subtaskLabel = childTotal > 0 ? `${childCompleted}/${childTotal}` : '0';

    return (
      <View key={node.id} style={styles.nodeBlock}>
        <View style={[styles.row, { paddingLeft: 12 + indent }]}>
          <TouchableOpacity
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => hasChildren && toggle(node.id)}
            style={styles.chevronWrap}
          >
            {hasChildren ? (
              <Ionicons
                name={isExpanded ? 'chevron-down' : 'chevron-forward'}
                size={18}
                color="#636E72"
              />
            ) : (
              <View style={styles.chevronPlaceholder} />
            )}
          </TouchableOpacity>
          <Text style={styles.wbs} numberOfLines={1}>
            {wbs}
          </Text>
          <Text style={styles.title} numberOfLines={1}>
            {node.title}
          </Text>
        </View>
        <View style={[styles.metaRow, { paddingLeft: 12 + indent + 18 + 8 + 4 }]}>
          <View style={[styles.statusPill, { backgroundColor: TODO_STATUS_COLOR[node.status] ?? '#95A5A6' }]}>
            <Text style={styles.statusPillText}>{TODO_STATUS_LABEL[node.status] ?? node.status}</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="document-text-outline" size={12} color="#95A5A6" />
            <Text style={styles.metaText}>{subtaskLabel}</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="chatbubble-outline" size={12} color="#95A5A6" />
            <Text style={styles.metaText}>0</Text>
          </View>
        </View>
        {hasChildren && isExpanded && (
          <View style={styles.children}>
            {node.children.map((child, idx) =>
              renderNode(child, [...wbsParts, idx + 1], depth + 1)
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>Checklist</Text>
        <View style={styles.pills}>
          <View style={styles.pill}>
            <Ionicons name="swap-vertical" size={14} color="#636E72" />
            <Text style={styles.pillText}>WBS</Text>
          </View>
          <View style={styles.pill}>
            <Ionicons name="layers-outline" size={14} color="#636E72" />
            <Text style={styles.pillText}>No grouping</Text>
          </View>
        </View>
      </View>

      <View style={styles.addRow}>
        <Ionicons name="add-circle-outline" size={22} color="#6C5CE7" />
        <TextInput
          style={styles.addInput}
          placeholder="Task title, ENTER to create"
          placeholderTextColor="#95A5A6"
          value={addInput}
          onChangeText={setAddInput}
          onSubmitEditing={handleAddTask}
          returnKeyType="done"
          editable={!adding}
        />
        {adding && <ActivityIndicator size="small" color="#6C5CE7" style={styles.addSpinner} />}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <ScrollView style={styles.treeScroll} contentContainerStyle={styles.treeContent} keyboardShouldPersistTaps="handled">
        {tree.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No tasks yet. Add one above.</Text>
          </View>
        ) : (
          tree.map((node, idx) => renderNode(node, [idx + 1], 0))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    overflow: 'hidden',
    minHeight: 200,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#2D3436' },
  pills: { flexDirection: 'row', gap: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F8F9FA',
  },
  pillText: { fontSize: 12, color: '#636E72' },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  addInput: {
    flex: 1,
    fontSize: 14,
    color: '#2D3436',
    paddingVertical: Platform.OS === 'web' ? 8 : 6,
    paddingHorizontal: 0,
  },
  addSpinner: { marginLeft: 4 },
  errorText: { fontSize: 12, color: '#E17055', paddingHorizontal: 16, paddingTop: 4 },
  treeScroll: { maxHeight: 420 },
  treeContent: { paddingVertical: 8, paddingBottom: 24 },
  nodeBlock: { marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingRight: 12,
    gap: 4,
  },
  chevronWrap: { width: 22, alignItems: 'center', justifyContent: 'center' },
  chevronPlaceholder: { width: 18, height: 18 },
  wbs: { fontSize: 13, color: '#636E72', minWidth: 28 },
  title: { flex: 1, fontSize: 14, color: '#2D3436', fontWeight: '500' },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
    paddingRight: 12,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  statusPillText: { fontSize: 11, color: '#FFF', fontWeight: '600' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, color: '#95A5A6' },
  children: { marginLeft: 0 },
  empty: { padding: 24, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#95A5A6' },
});
