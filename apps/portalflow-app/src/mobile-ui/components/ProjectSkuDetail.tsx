/**
 * 项目/SKU 详情：同一套 UI。
 * 1) 项目信息：封面图、名称、说明
 * 2) Todos：WBS 树形任务表格（SKU 为 phase/section/task 树，Project 为扁平任务表）
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import type { FirmSkuItem, FirmProject } from '@/types';
import { TODO_STATUS_LABEL } from '@/lib/constants/project-todo-status';

export interface ProjectSkuInfo {
  name: string;
  description?: string | null;
  imageUrl?: string | null;
}

export type TodoRow = 
  | (FirmSkuItem & { wbsCode: string })
  | (FirmProject & { wbsCode: string });

/** 项目/SKU 信息卡片（可单独用于项目详情页） */
export function ProjectInfoCard({
  info,
  sectionTitle = 'Project info',
}: {
  info: ProjectSkuInfo;
  sectionTitle?: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{sectionTitle}</Text>
      <View style={styles.infoCard}>
        <View style={styles.coverWrap}>
          {info.imageUrl ? (
            <Image source={{ uri: info.imageUrl }} style={styles.cover} resizeMode="cover" />
          ) : (
            <View style={styles.coverPlaceholder}>
              <Text style={styles.coverPlaceholderText}>Cover</Text>
            </View>
          )}
        </View>
        <Text style={styles.name}>{info.name}</Text>
        {info.description ? (
          <Text style={styles.description}>{info.description}</Text>
        ) : null}
      </View>
    </View>
  );
}

interface ProjectSkuDetailProps {
  info: ProjectSkuInfo;
  /** SKU 模式：树形 WBS（phase/section/task）；Project 模式：扁平任务带 status */
  mode: 'sku' | 'project';
  todos: TodoRow[];
  /** 可选：section 标题覆盖 */
  infoSectionTitle?: string;
  todosSectionTitle?: string;
}

export function ProjectSkuDetail({
  info,
  mode,
  todos,
  infoSectionTitle = 'Project info',
  todosSectionTitle = 'Work breakdown (WBS)',
}: ProjectSkuDetailProps) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ProjectInfoCard info={info} sectionTitle={infoSectionTitle} />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{todosSectionTitle}</Text>
        <View style={styles.tableWrap}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.colWbs]}>{mode === 'sku' ? 'WBS' : '#'}</Text>
            {mode === 'sku' ? <Text style={[styles.th, styles.colKind]}>Kind</Text> : null}
            <Text style={[styles.th, styles.colType]}>Type</Text>
            <Text style={[styles.th, styles.colTitle]}>Title</Text>
            <Text style={[styles.th, styles.colDesc]}>Description</Text>
            {mode === 'project' ? <Text style={[styles.th, styles.colStatus]}>Status</Text> : null}
          </View>
          {todos.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>No items</Text>
            </View>
          ) : (
            todos.map((row) => (
              <View key={row.id} style={styles.tr}>
                <Text style={[styles.td, styles.colWbs]} numberOfLines={1}>{row.wbsCode}</Text>
                {mode === 'sku' ? (
                  <Text style={[styles.td, styles.colKind]} numberOfLines={1}>
                    {'itemKind' in row ? row.itemKind : ''}
                  </Text>
                ) : null}
                <Text style={[styles.td, styles.colType]} numberOfLines={1}>{row.type}</Text>
                <Text style={[styles.td, styles.colTitle]} numberOfLines={2}>{row.title}</Text>
                <Text style={[styles.td, styles.colDesc]} numberOfLines={2}>
                  {row.description ?? '—'}
                </Text>
                {mode === 'project' && 'status' in row ? (
                  <Text style={[styles.td, styles.colStatus]} numberOfLines={1}>
                    {TODO_STATUS_LABEL[row.status] ?? row.status}
                  </Text>
                ) : null}
              </View>
            ))
          )}
        </View>
      </View>
    </ScrollView>
  );
}

/** 为深度优先排序的 sku_items 计算 WBS 编码（1, 1.1, 1.2, 2, 2.1...） */
export function withWbsCodes(items: FirmSkuItem[]): (FirmSkuItem & { wbsCode: string })[] {
  if (items.length === 0) return [];
  const depth = new Map<string, number>();
  const parentMap = new Map<string, string | null>();
  items.forEach((item) => parentMap.set(item.id, item.parentId ?? null));
  const getDepth = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    const p = parentMap.get(id);
    const d = p == null ? 0 : getDepth(p) + 1;
    depth.set(id, d);
    return d;
  };
  items.forEach((item) => getDepth(item.id));
  const counter: number[] = [];
  return items.map((item) => {
    const d = depth.get(item.id) ?? 0;
    counter[d] = (counter[d] ?? 0) + 1;
    for (let i = d + 1; i < counter.length; i++) counter[i] = 0;
    const wbsCode = counter
      .slice(0, d + 1)
      .filter((_, i) => i <= d)
      .join('.');
    return { ...item, wbsCode };
  });
}

/** 为扁平的 project_todos 生成 WBS 序号（1, 2, 3...） */
export function projectTodosWithWbs(items: FirmProject[]): (FirmProject & { wbsCode: string })[] {
  return items.map((item, index) => ({ ...item, wbsCode: String(index + 1) }));
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { padding: 20, paddingBottom: 40 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#2D3436', marginBottom: 12 },
  infoCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  coverWrap: { width: '100%', aspectRatio: 3 / 2, backgroundColor: '#E9ECEF' },
  cover: { width: '100%', height: '100%' },
  coverPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coverPlaceholderText: { fontSize: 14, color: '#95A5A6' },
  name: { fontSize: 18, fontWeight: '600', color: '#2D3436', padding: 16, paddingBottom: 8 },
  description: { fontSize: 14, color: '#636E72', lineHeight: 20, paddingHorizontal: 16, paddingBottom: 16 },
  tableWrap: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    overflow: 'hidden',
  },
  tableHeader: { flexDirection: 'row', backgroundColor: '#F1F3F5', paddingVertical: 10, paddingHorizontal: 12 },
  th: { fontSize: 12, fontWeight: '600', color: '#495057' },
  tr: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  td: { fontSize: 13, color: '#2D3436' },
  colWbs: { width: 40 },
  colKind: { width: 52 },
  colType: { width: 52 },
  colTitle: { flex: 1, marginLeft: 6, maxWidth: 120 },
  colDesc: { flex: 1, marginLeft: 6, maxWidth: 140 },
  colStatus: { width: 68 },
  emptyRow: { padding: 24, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#95A5A6' },
});
