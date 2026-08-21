/**
 * 项目/订单详情统一界面：client 的 project 详情与 firm 的 order 详情共用。
 * 同一套布局与样式，仅根据 viewerRole 做少量差异（header 副标题/状态 pill、操作栏右侧按钮、onboarding 内容）。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Image,
  Platform,
  Modal,
  Dimensions,
} from 'react-native';
import { useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { TaxFilingTodosView } from '@/components/TaxFilingTodosView';
import { ProjectInfoTab, type ProjectInfoTabHandle } from '../app/tax-filing/project/[projectId]/info';
import { getOrderById, type ProjectTodoNode } from '@/lib/firm';
import type { FirmSkuItem } from '@/types';
import type { ProjectSkuInfo, TodoRow } from '@/components/ProjectSkuDetail';
import { getTaxSeasonColor, getTaxSeasonBgColor } from '@/lib/tax-season-colors';
import { useWebViewportKind } from '../lib/web-viewport';

const TAG_PALETTE: [string, string][] = [
  ['#EDE9FD', '#6C5CE7'], // violet
  ['#E3F2FD', '#1E88E5'], // blue
  ['#E8F5E9', '#2ECC71'], // green
  ['#FFF3E0', '#E67E22'], // amber
  ['#FCE4EC', '#E91E63'], // rose
  ['#E0F7FA', '#00ACC1'], // teal
  ['#FFF8E1', '#F9A825'], // yellow
  ['#F3E5F5', '#9C27B0'], // purple
];

function getTagColor(tag: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) & 0xffff;
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}

const TODO_FILTER_MENU_WIDTH = 232;

/** 将 sku_items 转为 TaxFilingTodosView 所需的 ProjectTodoNode 树（与 firm/sku/[skuId] 一致） */
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
    return list.map((it) => ({
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
      dependsOnId: it.dependsOnId ?? null,
      children: build(it.id, depth + 1),
    }));
  }
  return build(null, 0);
}

export interface ProjectDetailHeader {
  title: string;
  subtitle: string;
  taxSeasonYear: number | null;
  status?: { label: string; color: string; bg: string };
}

/** 订单状态配置（client/firm 顶栏状态标签共用）：深底色 + 白字色 */
export const ORDER_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  onboarding:  { label: 'Onboarding',  color: '#FFFFFF', bg: '#E67E22' },
  processing:  { label: 'Processing',  color: '#FFFFFF', bg: '#29B6F7' },
  completed:   { label: 'Completed',   color: '#FFFFFF', bg: '#00B894' },
  cancelled:   { label: 'Cancelled',   color: '#FFFFFF', bg: '#636E72' },
};

/** 统一顶栏标题：税季 pill | 标题+副标题 | 状态 pill（样式与税季一致，放大占两行，与税季对齐） */
export function ProjectDetailHeaderTitle({
  header,
}: {
  header: ProjectDetailHeader;
}) {
  const { title, subtitle, taxSeasonYear, status } = header;
  const { isMobileWeb } = useWebViewportKind();
  const useCompactHeader = Platform.OS !== 'web' || isMobileWeb;
  if (useCompactHeader) {
    return (
      <View style={headerStyles.wrapMobile}>
        <View style={headerStyles.mobileLine}>
          {taxSeasonYear != null ? (
            <View style={[headerStyles.pillCompact, { backgroundColor: getTaxSeasonBgColor(taxSeasonYear) }]}>
              <Text style={[headerStyles.pillTextCompact, { color: getTaxSeasonColor(taxSeasonYear) }]}>
                {taxSeasonYear}
              </Text>
            </View>
          ) : (
            <View style={headerStyles.mobilePillPlaceholder} />
          )}
          <Text style={headerStyles.title} numberOfLines={1} ellipsizeMode="tail">{title}</Text>
        </View>
        <View style={headerStyles.mobileLine}>
          {status ? (
            <View style={[headerStyles.statusPillCompact, { backgroundColor: status.bg }]}>
              <Text style={[headerStyles.statusPillCompactText, { color: status.color }]} numberOfLines={1}>
                {status.label}
              </Text>
            </View>
          ) : (
            <View style={headerStyles.mobilePillPlaceholder} />
          )}
          {subtitle ? (
            <Text style={headerStyles.subInline} numberOfLines={1} ellipsizeMode="tail">{subtitle}</Text>
          ) : (
            <View style={headerStyles.mobileSubPlaceholder} />
          )}
        </View>
      </View>
    );
  }
  return (
    <View style={headerStyles.wrap}>
      {taxSeasonYear != null ? (
        <View
          style={[
            headerStyles.pill,
            { backgroundColor: getTaxSeasonBgColor(taxSeasonYear) },
          ]}
        >
          <Text
            style={[
              headerStyles.pillText,
              { color: getTaxSeasonColor(taxSeasonYear) },
            ]}
          >
            {taxSeasonYear}
          </Text>
        </View>
      ) : null}
      <View style={headerStyles.textCol}>
        <Text style={headerStyles.title} numberOfLines={1} ellipsizeMode="tail">{title}</Text>
        {subtitle ? (
          <Text style={headerStyles.sub} numberOfLines={1} ellipsizeMode="tail">{subtitle}</Text>
        ) : null}
      </View>
      {status ? (
        <View style={[headerStyles.pill, { backgroundColor: status.bg }]}>
          <Text style={[headerStyles.pillText, { color: status.color }]}>
            {status.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const headerStyles = StyleSheet.create({
  wrapMobile: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    paddingVertical: 8,
    paddingRight: 8,
    gap: 3,
    minHeight: 56,
  },
  mobileLine: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    gap: 6,
  },
  wrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingRight: 8,
    overflow: 'visible',
    gap: 8,
    minHeight: 56,
  },
  /** 税季 / 状态 pill：高度略小、圆角略大，与顶栏按钮（minHeight 40, borderRadius 10）区分 */
  pill: {
    minWidth: 56,
    maxHeight: 32,
    borderRadius: 16,
    paddingVertical: 4, 
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillText: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  pillCompact: {
    minWidth: 44,
    maxHeight: 24,
    borderRadius: 12,
    paddingVertical: 2,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillTextCompact: { fontSize: 12, fontWeight: '700', lineHeight: 14 },
  mobilePillPlaceholder: {
    minHeight: 24,
  },
  mobileSubPlaceholder: {
    minHeight: 16,
  },
  textCol: { flex: 1, minWidth: 0, justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '600', color: '#2D3436', lineHeight: 20 },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    marginTop: 2,
    gap: 6,
  },
  statusPillCompact: {
    minWidth: 50,
    maxWidth: 130,
    borderRadius: 11,
    paddingVertical: 2,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusPillCompactText: { fontSize: 11, fontWeight: '700', lineHeight: 14 },
  sub: { fontSize: 12, color: '#95A5A6', lineHeight: 16, marginTop: 4 },
  subInline: { flex: 1, minWidth: 0, fontSize: 12, color: '#95A5A6', lineHeight: 16 },
});

/** Firm onboarding：WBS 预览表格 */
function SkuWbsPreview({ todos }: { todos: TodoRow[] }) {
  return (
    <View style={sharedStyles.skuTable}>
      <View style={sharedStyles.skuTableHeader}>
        <Text style={[sharedStyles.skuTh, sharedStyles.colWbs]}>#</Text>
        <Text style={[sharedStyles.skuTh, sharedStyles.colKind]}>Kind</Text>
        <Text style={[sharedStyles.skuTh, { flex: 1 }]}>Task</Text>
      </View>
      {todos.map((row) => (
        <View key={row.id} style={sharedStyles.skuTr}>
          <Text style={[sharedStyles.skuTd, sharedStyles.colWbs]}>{row.wbsCode}</Text>
          <Text style={[sharedStyles.skuTd, sharedStyles.colKind]} numberOfLines={1}>
            {'itemKind' in row ? row.itemKind : ''}
          </Text>
          <Text style={[sharedStyles.skuTd, { flex: 1 }]} numberOfLines={2}>{row.title}</Text>
        </View>
      ))}
      {todos.length === 0 && (
        <View style={sharedStyles.skuEmpty}>
          <Text style={sharedStyles.emptyText}>No work items defined for this service.</Text>
        </View>
      )}
    </View>
  );
}

function formatDateForOrderCard(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return format(d, 'MMM dd, yyyy');
}

export interface ProjectDetailViewProps {
  viewerRole: 'client' | 'firm';
  header: ProjectDetailHeader;
  isOnboarding: boolean;
  activeTab: 'todos' | 'info';
  setActiveTab: (t: 'todos' | 'info') => void;
  infoEditing: boolean;
  setInfoEditing: (v: boolean) => void;
  infoTabRef: React.RefObject<ProjectInfoTabHandle | null>;
  /** Client/Firm onboarding 时顶栏右端显示左侧按钮 + 右侧主按钮；Firm 侧文案为 Terminal / Start */
  onReject?: () => Promise<void>;
  rejectLoading?: boolean;
  onAcceptAndStart?: () => Promise<void>;
  acceptAndStartLoading?: boolean;
  /** 左侧按钮文案，默认 Reject；Firm onboarding 传 "Terminal" */
  headerRejectLabel?: string;
  /** 右侧主按钮文案，默认 Accept and Start；Firm onboarding 传 "Start" */
  headerAcceptLabel?: string;
  /** 进行中态（processing）：Terminate + 可选 Complete */
  orderStatus?: 'onboarding' | 'processing' | 'completed' | 'cancelled';
  onAbort?: () => Promise<void>;
  abortLoading?: boolean;
  onComplete?: () => Promise<void>;
  completeLoading?: boolean;
  /** Cancelled 态：重启（主色） */
  onRestart?: () => Promise<void>;
  restartLoading?: boolean;
  /** 内容：Todos */
  tree: ProjectTodoNode[];
  orderId: string;
  projectId: string | null;
  clientSpaceId: string;
  onRefresh: () => Promise<void>;
  createProjectTodo: typeof import('@/lib/firm').createProjectTodo;
  /** Firm onboarding */
  skuInfo?: ProjectSkuInfo | null;
  skuTodos?: TodoRow[];
  /** Firm onboarding：SKU 项树，用于与 SKU 详情一致的树形展示（优先于 skuTodos 表格） */
  skuItems?: FirmSkuItem[];
  /** Firm onboarding Info 页只读：Classification 用（与 SKU 详情一致） */
  skuDetailForInfo?: { taxCountry?: string | null; taxScenario?: string | null } | null;
  /** Web：Todos 树拖放排序后持久化（如 applyProjectTodosTreeOrder / applySkuItemsTreeOrder） */
  persistTodoTreeOrder?: (roots: ProjectTodoNode[]) => Promise<{ error: Error | null }>;
  /** Web：拖放排序成功后本地更新树，避免整表 onRefresh */
  onTodoTreeOrderSaved?: (roots: ProjectTodoNode[]) => void;
  /** Web：行标题重命名（与 TaxFilingTodosView 内编辑图标联动） */
  persistTodoTitle?: (todoId: string, title: string) => Promise<{ error: Error | null }>;
  /** 新建 phase/section/task 后本地合并树，避免整表 onRefresh（连续添加时不丢滚动） */
  onMergeProjectTodosTree?: (roots: ProjectTodoNode[]) => void;
  /** Info 保存成功后刷新父级顶栏（税季、名称等），不依赖 Realtime */
  onProjectInfoSaved?: () => void | Promise<void>;
}

export function ProjectDetailView({
  viewerRole,
  header,
  isOnboarding,
  activeTab,
  setActiveTab,
  infoEditing,
  setInfoEditing,
  infoTabRef,
  onReject,
  rejectLoading = false,
  onAcceptAndStart,
  acceptAndStartLoading = false,
  headerRejectLabel = 'Reject',
  headerAcceptLabel = 'Accept and Start',
  orderStatus,
  onAbort,
  abortLoading = false,
  onComplete,
  completeLoading = false,
  onRestart,
  restartLoading = false,
  tree,
  orderId,
  projectId,
  clientSpaceId,
  onRefresh,
  createProjectTodo,
  skuInfo,
  skuTodos = [],
  skuItems,
  skuDetailForInfo,
  persistTodoTreeOrder,
  onTodoTreeOrderSaved,
  persistTodoTitle,
  onMergeProjectTodosTree,
  onProjectInfoSaved,
}: ProjectDetailViewProps) {
  const navigation = useNavigation();

  const { isMobileWeb } = useWebViewportKind();
  const isWeb = Platform.OS === 'web';
  const isDesktopWeb = isWeb && !isMobileWeb;
  /** Native app + mobile browser share the same engagement chrome (header / bottom actions / filter menu). */
  const useMobileEngagementChrome = !isWeb || isMobileWeb;
  const [onboardingOrderInfo, setOnboardingOrderInfo] = useState<Awaited<ReturnType<typeof getOrderById>>>(null);
  const [hideTodoTasksWithNoFiles, setHideTodoTasksWithNoFiles] = useState(false);
  const [hideTodoCanceled, setHideTodoCanceled] = useState(false);
  const [showTodoFilterModal, setShowTodoFilterModal] = useState(false);
  const [todoFilterPopover, setTodoFilterPopover] = useState<{ top: number; left: number } | null>(null);
  const filterIconRef = useRef<View | null>(null);

  const openTodoFilterPopover = useCallback(() => {
    filterIconRef.current?.measureInWindow((x, y, width, height) => {
      const winW = Dimensions.get('window').width;
      let left = x + width - TODO_FILTER_MENU_WIDTH;
      left = Math.max(8, Math.min(left, winW - TODO_FILTER_MENU_WIDTH - 8));
      setTodoFilterPopover({ top: y + height + 4, left });
      setShowTodoFilterModal(true);
    });
  }, []);

  const closeTodoFilterPopover = useCallback(() => {
    setShowTodoFilterModal(false);
    setTodoFilterPopover(null);
  }, []);

  const showTodoToolbarFilters =
    activeTab === 'todos' &&
    tree.length > 0 &&
    !(isOnboarding && (skuItems?.length ?? 0) > 0);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerBackButtonVisible: true,
      // Web 保持原设计：税季 + 标题 + 状态 pill 都在导航栏
      // 移动端：状态 + firm 名在顶栏第二行（与列表卡片布局一致）
      headerTitle: () => (
        <ProjectDetailHeaderTitle
          header={header}
        />
      ),
    });
  }, [navigation, header.title, header.subtitle, header.taxSeasonYear, header.status?.label, isMobileWeb]);

  useEffect(() => {
    if (!isOnboarding || activeTab !== 'info' || projectId || !orderId) return;
    let cancelled = false;
    getOrderById(orderId)
      .then((ord) => {
        if (!cancelled) setOnboardingOrderInfo(ord);
      })
      .catch(() => {
        if (!cancelled) setOnboardingOrderInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isOnboarding, activeTab, projectId, orderId]);

  const showOnboardingActions = Boolean(isOnboarding && onAcceptAndStart && (viewerRole === 'client' || viewerRole === 'firm'));
  const showOnboardingTerminateOnly = Boolean(isOnboarding && !onAcceptAndStart && onAbort);
  /** Detail content (Todos + Info) is read-only when onboarding, cancelled, or completed — same as onboarding. */
  const isDetailReadOnly = isOnboarding || orderStatus === 'cancelled' || orderStatus === 'completed';
  const firmNameFromHeader = (() => {
    const sub = (header.subtitle ?? '').trim();
    if (!sub) return '';
    return sub.toLowerCase().startsWith('by ') ? sub.slice(3).trim() : sub;
  })();
  const mobileFooterActions = useMobileEngagementChrome ? (
    showOnboardingActions && onAcceptAndStart ? (
      <View style={sharedStyles.bottomActionBar}>
        <View style={sharedStyles.bottomActionRow}>
          {onReject ? (
            <TouchableOpacity
              onPress={onReject}
              disabled={rejectLoading || acceptAndStartLoading}
              style={sharedStyles.bottomRejectBtn}
              activeOpacity={0.85}
            >
              {rejectLoading ? (
                <ActivityIndicator size="small" color="#C0392B" />
              ) : (
                <Text style={sharedStyles.bottomRejectBtnText}>{headerRejectLabel}</Text>
              )}
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={onAcceptAndStart}
            disabled={acceptAndStartLoading || rejectLoading}
            style={sharedStyles.bottomAcceptBtn}
            activeOpacity={0.85}
          >
            {acceptAndStartLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
                <Text style={sharedStyles.bottomAcceptBtnText}>{headerAcceptLabel}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    ) : showOnboardingTerminateOnly && onAbort ? (
      <View style={sharedStyles.bottomActionBar}>
        <View style={sharedStyles.bottomActionRow}>
          <TouchableOpacity
            onPress={onAbort}
            disabled={abortLoading || completeLoading}
            style={sharedStyles.bottomAbortBtn}
            activeOpacity={0.85}
          >
            {abortLoading ? (
              <ActivityIndicator size="small" color="#D35400" />
            ) : (
              <Text style={sharedStyles.bottomAbortBtnText}>Terminate</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    ) : orderStatus === 'processing' && (onAbort || onComplete) ? (
      <View style={sharedStyles.bottomActionBar}>
        <View style={sharedStyles.bottomActionRow}>
          {onAbort ? (
            <TouchableOpacity
              onPress={onAbort}
              disabled={abortLoading || completeLoading}
              style={sharedStyles.bottomAbortBtn}
              activeOpacity={0.85}
            >
              {abortLoading ? (
                <ActivityIndicator size="small" color="#C0392B" />
              ) : (
                <Text style={sharedStyles.bottomAbortBtnText}>Terminate</Text>
              )}
            </TouchableOpacity>
          ) : null}
          {onComplete ? (
            <TouchableOpacity
              onPress={onComplete}
              disabled={completeLoading || abortLoading}
              style={sharedStyles.bottomCompleteBtn}
              activeOpacity={0.85}
            >
              {completeLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={sharedStyles.bottomCompleteBtnText}>Complete</Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    ) : orderStatus === 'cancelled' && onRestart ? (
      <View style={sharedStyles.bottomActionBar}>
        <View style={sharedStyles.bottomActionRow}>
          <TouchableOpacity
            onPress={onRestart}
            disabled={restartLoading}
            style={sharedStyles.bottomRestartBtn}
            activeOpacity={0.85}
          >
            {restartLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="play-circle" size={18} color="#fff" />
                <Text style={sharedStyles.bottomRestartBtnText}>Restart</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    ) : null
  ) : null;

  return (
    <View style={sharedStyles.container}>
      {/* 操作行：Firm onboarding 与已确认态一致，仅 Todos | Info 双 tab，无 Confirm/Edit */}
      <View style={sharedStyles.operationBar}>
        <View style={sharedStyles.operationBarTabsWrap}>
          <View style={sharedStyles.tabGroup}>
            <TouchableOpacity
              style={[sharedStyles.tabChip, activeTab === 'todos' && sharedStyles.tabChipActive]}
              onPress={() => { setActiveTab('todos'); setInfoEditing(false); }}
              activeOpacity={0.8}
            >
              <Text style={[sharedStyles.tabChipText, activeTab === 'todos' && sharedStyles.tabChipTextActive]}>Todos</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[sharedStyles.tabChip, activeTab === 'info' && sharedStyles.tabChipActive]}
              onPress={() => setActiveTab('info')}
              activeOpacity={0.8}
            >
              <Text style={[sharedStyles.tabChipText, activeTab === 'info' && sharedStyles.tabChipTextActive]}>Info</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={sharedStyles.todoFilterCenterSlot} pointerEvents="box-none">
          {isDesktopWeb && showTodoToolbarFilters ? (
            <View style={sharedStyles.todoFilterCheckRow}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: hideTodoTasksWithNoFiles }}
                onPress={() => setHideTodoTasksWithNoFiles((v) => !v)}
                style={sharedStyles.todoFilterCheck}
              >
                <Ionicons
                  name={hideTodoTasksWithNoFiles ? 'checkbox' : 'square-outline'}
                  size={18}
                  color={hideTodoTasksWithNoFiles ? '#6C5CE7' : '#95A5A6'}
                />
                <Text style={sharedStyles.todoFilterCheckText}>Hide 0-file</Text>
              </Pressable>
              <View style={sharedStyles.todoFilterBetween} />
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: hideTodoCanceled }}
                onPress={() => setHideTodoCanceled((v) => !v)}
                style={sharedStyles.todoFilterCheck}
              >
                <Ionicons
                  name={hideTodoCanceled ? 'checkbox' : 'square-outline'}
                  size={18}
                  color={hideTodoCanceled ? '#6C5CE7' : '#95A5A6'}
                />
                <Text style={sharedStyles.todoFilterCheckText}>Hide Canceled</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {showTodoToolbarFilters && useMobileEngagementChrome ? (
          <View ref={filterIconRef} collapsable={false} style={sharedStyles.filterIconWrap}>
            <TouchableOpacity
              style={sharedStyles.filterIconBtn}
              activeOpacity={0.85}
              onPress={() => {
                if (showTodoFilterModal) closeTodoFilterPopover();
                else openTodoFilterPopover();
              }}
              accessibilityRole="button"
              accessibilityLabel="Open todo filters"
            >
              <Ionicons
                name={(hideTodoTasksWithNoFiles || hideTodoCanceled) ? 'filter' : 'filter-outline'}
                size={18}
                color={(hideTodoTasksWithNoFiles || hideTodoCanceled) ? '#6C5CE7' : '#636E72'}
              />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Web 保持顶栏右侧按钮；移动端改为底部浮层按钮，不在这里渲染操作 */}
        {isDesktopWeb && (
          <View style={sharedStyles.operationRight}>
            {showOnboardingActions ? (
              <View style={sharedStyles.headerActionsWrap}>
                {onReject ? (
                  <TouchableOpacity
                    onPress={onReject}
                    disabled={rejectLoading || acceptAndStartLoading}
                    style={sharedStyles.headerRejectBtn}
                    activeOpacity={0.85}
                  >
                    {rejectLoading ? (
                      <ActivityIndicator size="small" color="#C0392B" />
                    ) : (
                      <Text style={sharedStyles.headerRejectBtnText}>{headerRejectLabel}</Text>
                    )}
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  onPress={onAcceptAndStart}
                  disabled={acceptAndStartLoading || rejectLoading}
                  style={sharedStyles.headerAcceptBtn}
                  activeOpacity={0.85}
                >
                  {acceptAndStartLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={18} color="#fff" />
                      <Text style={sharedStyles.headerAcceptBtnText}>{headerAcceptLabel}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : showOnboardingTerminateOnly && onAbort ? (
              <View style={sharedStyles.headerActionsWrap}>
                <TouchableOpacity
                  onPress={onAbort}
                  disabled={abortLoading || completeLoading}
                  style={sharedStyles.headerAbortBtn}
                  activeOpacity={0.85}
                >
                  {abortLoading ? (
                    <ActivityIndicator size="small" color="#D35400" />
                  ) : (
                    <Text style={sharedStyles.headerAbortBtnText}>Terminate</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : orderStatus === 'processing' && onAbort ? (
              <View style={sharedStyles.headerActionsWrap}>
                <TouchableOpacity
                  onPress={onAbort}
                  disabled={abortLoading || completeLoading}
                  style={sharedStyles.headerAbortBtn}
                  activeOpacity={0.85}
                >
                  {abortLoading ? (
                    <ActivityIndicator size="small" color="#D35400" />
                  ) : (
                    <Text style={sharedStyles.headerAbortBtnText}>Terminate</Text>
                  )}
                </TouchableOpacity>
                {onComplete ? (
                  <TouchableOpacity
                    onPress={onComplete}
                    disabled={completeLoading || abortLoading}
                    style={sharedStyles.headerCompleteBtn}
                    activeOpacity={0.85}
                  >
                    {completeLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="checkmark-circle" size={18} color="#fff" />
                        <Text style={sharedStyles.headerCompleteBtnText}>Complete</Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : orderStatus === 'cancelled' && onRestart ? (
              <View style={sharedStyles.headerActionsWrap}>
                <TouchableOpacity
                  onPress={onRestart}
                  disabled={restartLoading}
                  style={sharedStyles.headerRestartBtn}
                  activeOpacity={0.85}
                >
                  {restartLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="play-circle" size={18} color="#fff" />
                      <Text style={sharedStyles.headerRestartBtnText}>Restart</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        )}
      </View>
      <Modal
        visible={showTodoFilterModal && useMobileEngagementChrome}
        transparent
        animationType="fade"
        onRequestClose={closeTodoFilterPopover}
      >
        <View style={sharedStyles.todoFilterModalRoot} pointerEvents="box-none">
          <Pressable style={StyleSheet.absoluteFill} onPress={closeTodoFilterPopover} accessibilityRole="button" accessibilityLabel="Dismiss filters" />
          {todoFilterPopover ? (
            <View
              style={[
                sharedStyles.todoFilterPopover,
                {
                  top: todoFilterPopover.top,
                  left: todoFilterPopover.left,
                  width: TODO_FILTER_MENU_WIDTH,
                },
              ]}
              pointerEvents="box-none"
            >
              <View style={sharedStyles.todoFilterPopoverInner}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: hideTodoTasksWithNoFiles }}
                  onPress={() => setHideTodoTasksWithNoFiles((v) => !v)}
                  style={sharedStyles.todoFilterModalCheck}
                >
                  <Ionicons
                    name={hideTodoTasksWithNoFiles ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={hideTodoTasksWithNoFiles ? '#6C5CE7' : '#95A5A6'}
                  />
                  <Text style={sharedStyles.todoFilterModalCheckText}>Hide 0-file</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: hideTodoCanceled }}
                  onPress={() => setHideTodoCanceled((v) => !v)}
                  style={sharedStyles.todoFilterModalCheck}
                >
                  <Ionicons
                    name={hideTodoCanceled ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={hideTodoCanceled ? '#6C5CE7' : '#95A5A6'}
                  />
                  <Text style={sharedStyles.todoFilterModalCheckText}>Hide Canceled</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>

      {/* 内容区：client onboarding 无 sku 数据时仅提示接受订单；有 sku 或 firm onboarding 时展示只读 Todos + Info */}
      {isOnboarding && viewerRole === 'client' && !(skuItems && skuItems.length > 0) ? (
        <View style={sharedStyles.emptyWrap}>
          <Text style={sharedStyles.emptyText}>Accept the order to see checklist</Text>
        </View>
      ) : isOnboarding && (viewerRole === 'firm' || (viewerRole === 'client' && (skuItems?.length ?? 0) > 0)) ? (
        activeTab === 'todos' ? (
          skuItems && skuItems.length > 0 ? (
            <TaxFilingTodosView
              tree={skuItemsToProjectTodoTree(skuItems)}
              orderId=""
              clientSpaceId=""
              viewerRole={viewerRole}
              onRefresh={async () => {}}
              createProjectTodo={async () => ({ id: null, error: null })}
              catalogMode
              catalogPreviewReadOnly
            />
          ) : (
            <ScrollView style={sharedStyles.scroll} contentContainerStyle={sharedStyles.scrollContent}>
              <Text style={sharedStyles.sectionTitle}>Work breakdown (WBS)</Text>
              <SkuWbsPreview todos={skuTodos} />
            </ScrollView>
          )
        ) : projectId ? (
          <ProjectInfoTab
            ref={infoTabRef}
            projectId={projectId}
            mode={viewerRole === 'firm' ? 'firm' : undefined}
            footer={mobileFooterActions}
            onSaved={onProjectInfoSaved}
          />
        ) : (
          <ScrollView style={sharedStyles.scroll} contentContainerStyle={sharedStyles.scrollContent}>
            {skuInfo && (
              <View style={sharedStyles.skuInfoCard}>
                <View style={sharedStyles.skuInfoHeroRow}>
                  {skuInfo.imageUrl ? (
                    <Image source={{ uri: skuInfo.imageUrl }} style={sharedStyles.skuInfoCover} resizeMode="cover" />
                  ) : (
                    <View style={sharedStyles.skuInfoCoverPlaceholder}>
                      <Ionicons name="image-outline" size={30} color="#BDC3C7" />
                    </View>
                  )}
                  <View style={sharedStyles.skuInfoHeroMeta}>
                    <Text style={sharedStyles.skuInfoName} numberOfLines={3}>{skuInfo.name}</Text>
                    {skuInfo.description ? (
                      <Text style={sharedStyles.skuInfoDesc} numberOfLines={5}>{skuInfo.description}</Text>
                    ) : (
                      <Text style={sharedStyles.skuInfoDescEmpty}>No description</Text>
                    )}
                  </View>
                </View>
              </View>
            )}
            <View style={sharedStyles.skuInfoCard}>
              <Text style={sharedStyles.skuInfoCardTitle}>Classification</Text>
              <View style={sharedStyles.skuInfoCfRow}>
                <View style={sharedStyles.skuInfoCfTagCol}><Text style={sharedStyles.skuInfoCfLabel}>Tax season</Text></View>
                <View style={sharedStyles.skuInfoCfValueCol}>
                  {((onboardingOrderInfo?.taxSeasonYear ?? header.taxSeasonYear) != null) ? (
                    <View
                      style={[
                        sharedStyles.skuInfoTaxSeasonPill,
                        {
                          backgroundColor: getTaxSeasonBgColor(
                            onboardingOrderInfo?.taxSeasonYear ?? (header.taxSeasonYear as number),
                          ),
                        },
                      ]}
                    >
                      <Text
                        style={[
                          sharedStyles.skuInfoTaxSeasonPillText,
                          {
                            color: getTaxSeasonColor(
                              onboardingOrderInfo?.taxSeasonYear ?? (header.taxSeasonYear as number),
                            ),
                          },
                        ]}
                      >
                        {String(onboardingOrderInfo?.taxSeasonYear ?? header.taxSeasonYear)}
                      </Text>
                    </View>
                  ) : <Text style={sharedStyles.skuInfoCfEmpty}>—</Text>}
                </View>
              </View>
              <View style={sharedStyles.skuInfoDivider} />
              <View style={sharedStyles.skuInfoCfRow}>
                <View style={sharedStyles.skuInfoCfTagCol}><Text style={sharedStyles.skuInfoCfLabel}>Jurisdiction</Text></View>
                <View style={sharedStyles.skuInfoCfValueCol}>
                  {skuDetailForInfo?.taxCountry ? (
                    (() => {
                      const [bg, fg] = getTagColor(skuDetailForInfo.taxCountry);
                      return (
                        <View style={[sharedStyles.skuInfoValuePill, { backgroundColor: bg }]}>
                          <Text style={[sharedStyles.skuInfoValuePillText, { color: fg }]}>{skuDetailForInfo.taxCountry}</Text>
                        </View>
                      );
                    })()
                  ) : <Text style={sharedStyles.skuInfoCfEmpty}>—</Text>}
                </View>
              </View>
              <View style={sharedStyles.skuInfoDivider} />
              <View style={sharedStyles.skuInfoCfRow}>
                <View style={sharedStyles.skuInfoCfTagCol}><Text style={sharedStyles.skuInfoCfLabel}>Scenario</Text></View>
                <View style={sharedStyles.skuInfoCfValueCol}>
                  {skuDetailForInfo?.taxScenario ? (
                    (() => {
                      const [bg, fg] = getTagColor(skuDetailForInfo.taxScenario);
                      return (
                        <View style={[sharedStyles.skuInfoValuePill, { backgroundColor: bg }]}>
                          <Text style={[sharedStyles.skuInfoValuePillText, { color: fg }]}>{skuDetailForInfo.taxScenario}</Text>
                        </View>
                      );
                    })()
                  ) : <Text style={sharedStyles.skuInfoCfEmpty}>—</Text>}
                </View>
              </View>
            </View>
            {onboardingOrderInfo ? (
              <View style={sharedStyles.skuInfoCard}>
                <Text style={sharedStyles.skuInfoCardTitle}>Order</Text>
                <View style={sharedStyles.orderTableRow}>
                  <View style={sharedStyles.orderTableCellFull}>
                    <Text style={sharedStyles.orderTableLabel}>Firm</Text>
                    <Text style={sharedStyles.orderTableValue}>{firmNameFromHeader || '—'}</Text>
                  </View>
                </View>
                <View style={sharedStyles.orderTableRowBorder} />
                <View style={sharedStyles.orderTableRow}>
                  <View style={sharedStyles.orderTableCell}>
                    <Text style={sharedStyles.orderTableLabel}>No.</Text>
                    <Text style={sharedStyles.orderTableValueMono} numberOfLines={1}>
                      {onboardingOrderInfo.id.slice(0, 8).toUpperCase()}
                    </Text>
                  </View>
                  <View style={[sharedStyles.orderTableCell, sharedStyles.orderTableCellBorderLeft]}>
                    <Text style={sharedStyles.orderTableLabel}>Status</Text>
                    <View style={[sharedStyles.orderStatusBadge, { backgroundColor: header.status?.bg ?? '#F0F2F5' }]}>
                      <Text style={[sharedStyles.orderStatusBadgeText, { color: header.status?.color ?? '#636E72' }]}>
                        {header.status?.label ?? onboardingOrderInfo.status}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={[sharedStyles.orderTableRow, sharedStyles.orderTableRowBorder]}>
                  <View style={sharedStyles.orderTableCell}>
                    <Text style={sharedStyles.orderTableLabel}>Created</Text>
                    <Text style={sharedStyles.orderTableValue}>
                      {formatDateForOrderCard(onboardingOrderInfo.createdAt)}
                    </Text>
                  </View>
                  <View style={[sharedStyles.orderTableCell, sharedStyles.orderTableCellBorderLeft]}>
                    <Text style={sharedStyles.orderTableLabel}>Last updated</Text>
                    <Text style={sharedStyles.orderTableValue}>
                      {formatDateForOrderCard(onboardingOrderInfo.updatedAt)}
                    </Text>
                  </View>
                </View>
                <View style={[sharedStyles.orderTableRow, sharedStyles.orderTableRowBorder]}>
                  <View style={sharedStyles.orderTableCellFull}>
                    <Text style={sharedStyles.orderTableLabel}>Manager</Text>
                    <Text style={sharedStyles.orderTableValue}>{onboardingOrderInfo.managerName ?? '—'}</Text>
                  </View>
                </View>
              </View>
            ) : null}
            {mobileFooterActions ? <View style={{ marginTop: 12 }}>{mobileFooterActions}</View> : null}
          </ScrollView>
        )
      ) : activeTab === 'info' ? (
        projectId ? (
          <ProjectInfoTab
            ref={infoTabRef}
            projectId={projectId}
            mode={viewerRole === 'firm' ? 'firm' : undefined}
            footer={mobileFooterActions}
            onSaved={onProjectInfoSaved}
          />
        ) : (
          <View style={sharedStyles.centered}>
            <Text style={sharedStyles.emptyText}>Project not yet created.</Text>
          </View>
        )
      ) : (
        <TaxFilingTodosView
          tree={tree}
          orderId={orderId}
          clientSpaceId={clientSpaceId}
          viewerRole={viewerRole}
          onRefresh={onRefresh}
          createProjectTodo={createProjectTodo}
          catalogPreviewReadOnly={isDetailReadOnly}
          persistTodoTreeOrder={persistTodoTreeOrder}
          onTodoTreeOrderSaved={onTodoTreeOrderSaved}
          onPersistTodoTitle={isDesktopWeb && !isDetailReadOnly && persistTodoTitle ? persistTodoTitle : undefined}
          onMergeProjectTodosTree={onMergeProjectTodosTree}
          hideTasksWithNoFiles={hideTodoTasksWithNoFiles}
          hideCanceledTasks={hideTodoCanceled}
        />
      )}
    </View>
  );
}

const sharedStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { fontSize: 15, color: '#636E72' },

  operationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  operationBarTabsWrap: {
    flexShrink: 0,
  },
  todoFilterCenterSlot: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterIconWrap: {
    marginLeft: 10,
  },
  filterIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  todoFilterCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    maxWidth: '100%',
  },
  todoFilterBetween: {
    width: Platform.OS === 'web' ? 16 : 10,
  },
  todoFilterCheck: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    flexShrink: 1,
    minWidth: 0,
    paddingHorizontal: 2,
  },
  todoFilterCheckText: {
    fontSize: Platform.OS === 'web' ? 10 : 8,
    color: '#636E72',
    fontWeight: '500',
    flexShrink: 1,
    minWidth: 0,
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
  /** 移动端 Todos/Info 行中的状态 pill（高度、圆角与 header pill 一致） */
  inlineStatusPill: {
    marginLeft: 12,
    minWidth: 56,
    maxHeight: 32,
    borderRadius: 16,
    paddingVertical: 4,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    maxWidth: 140,
  },
  inlineStatusText: {
    fontSize: 15,
    fontWeight: '700',
  },
  todoFilterModalRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  todoFilterPopover: {
    position: 'absolute',
    zIndex: 10,
  },
  todoFilterPopoverInner: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
  },
  todoFilterModalCheck: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
  },
  todoFilterModalCheckText: {
    fontSize: 14,
    color: '#2D3436',
    fontWeight: '500',
  },
  /** Web：Todos/Info 行右侧 Terminate / Complete 等 */
  operationRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  operationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F8F9FA',
    gap: 5,
  },
  operationBtnText: { fontSize: 13, color: '#6C5CE7', fontWeight: '500' },
  operationEditGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  operationBtnSmall: { paddingHorizontal: 10, paddingVertical: 6 },
  operationBtnPrimary: { backgroundColor: '#6C5CE7' },
  /** 顶栏操作区：Reject 次按钮 + Accept 主按钮，右端留白 */
  headerActionsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 14,
  },
  /** 顶栏 Reject 次按钮：规范次按钮 + 阴影 */
  headerRejectBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#FFE5E5',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' || Platform.OS === 'ios'
      ? {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.12,
          shadowRadius: 3,
        }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 2 } : {}),
  },
  headerRejectBtnText: { color: '#C0392B', fontWeight: '600', fontSize: 15 },
  /** 顶栏 Abort（收集态）：警告色 */
  headerAbortBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#FFF3E0',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' || Platform.OS === 'ios'
      ? { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.12, shadowRadius: 3 }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 2 } : {}),
  },
  headerAbortBtnText: { color: '#D35400', fontWeight: '600', fontSize: 15 },
  /** 顶栏 Complete（收集态 firm）：绿色 */
  headerCompleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#00B894',
    ...(Platform.OS === 'web' || Platform.OS === 'ios'
      ? { shadowColor: '#00B894', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 4 } : {}),
  },
  headerCompleteBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  /** 顶栏 Restart（取消态）：主按钮色 */
  headerRestartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#6C5CE7',
    ...(Platform.OS === 'web' || Platform.OS === 'ios'
      ? { shadowColor: '#6C5CE7', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 4 } : {}),
  },
  headerRestartBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  /** 顶栏「Accept and Start」主按钮：规范主按钮样式 + 阴影 */
  headerAcceptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#6C5CE7',
    ...(Platform.OS === 'web' || Platform.OS === 'ios'
      ? {
          shadowColor: '#6C5CE7',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.3,
          shadowRadius: 4,
        }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 4 } : {}),
  },
  headerAcceptBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  opBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F0F2F5',
  },
  opBtnText: { fontSize: 13, fontWeight: '500', color: '#636E72' },
  opBtnPrimary: { backgroundColor: '#6C5CE7' },
  opBtnPrimaryText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  opBtnSecondary: { backgroundColor: '#EDE9FD' },
  opBtnSecondaryText: { fontSize: 13, fontWeight: '600', color: '#6C5CE7' },
  opBtnDisabled: { opacity: 0.6 },

  scroll: { flex: 1 },
  scrollContent: { padding: 10, paddingBottom: 8 },
  skuInfoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    marginBottom: 8,
  },
  skuInfoName: { fontSize: 18, fontWeight: '700', color: '#2D3436', marginBottom: 6 },
  skuInfoDesc: { fontSize: 14, color: '#636E72', lineHeight: 20 },
  skuInfoHeroRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginBottom: 8 },
  skuInfoCover: { width: 88, height: 88, borderRadius: 10, backgroundColor: '#E9ECEF' },
  skuInfoCoverPlaceholder: { width: 88, height: 88, borderRadius: 10, backgroundColor: '#E9ECEF', justifyContent: 'center', alignItems: 'center' },
  skuInfoHeroMeta: { flex: 1, gap: 6, paddingTop: 2 },
  skuInfoDescEmpty: { fontSize: 13, color: '#B2BEC3', fontStyle: 'italic' },
  skuInfoCardTitle: { fontSize: 11, fontWeight: '700', color: '#95A5A6', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 10 },
  skuInfoCfRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 4, gap: 16 },
  skuInfoCfTagCol: { width: 90, alignItems: 'flex-end', justifyContent: 'center', flexShrink: 0 },
  skuInfoCfLabel: { fontSize: 13, fontWeight: '500', color: '#636E72' },
  skuInfoCfValueCol: { flex: 1, alignItems: 'flex-start', justifyContent: 'center' },
  skuInfoTaxSeasonPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  skuInfoTaxSeasonPillText: { fontSize: 12, fontWeight: '700' },
  skuInfoValuePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  skuInfoValuePillText: { fontSize: 12, fontWeight: '600' },
  skuInfoCfEmpty: { fontSize: 13, color: '#B2BEC3' },
  skuInfoDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E9ECEF' },
  orderTableRow: {
    flexDirection: 'row',
    paddingVertical: 10,
  },
  orderTableRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E9ECEF',
  },
  orderTableCell: {
    flex: 1,
    gap: 4,
    paddingRight: 8,
  },
  orderTableCellBorderLeft: {
    paddingRight: 0,
    paddingLeft: 12,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#E9ECEF',
  },
  orderTableCellFull: { flex: 1, paddingRight: 0, gap: 4 },
  orderTableLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#95A5A6',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  orderTableValue: { fontSize: 13, fontWeight: '600', color: '#2D3436', lineHeight: 18 },
  orderTableValueMono: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2D3436',
    lineHeight: 18,
    letterSpacing: 0.8,
    fontVariant: ['tabular-nums'],
  },
  orderStatusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, alignSelf: 'flex-start' },
  orderStatusBadgeText: { fontSize: 12, fontWeight: '700' },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#636E72', marginBottom: 10 },
  skuTable: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    overflow: 'hidden',
  },
  skuTableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F1F3F5',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  skuTh: { fontSize: 12, fontWeight: '600', color: '#495057' },
  skuTr: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  skuTd: { fontSize: 13, color: '#2D3436' },
  colWbs: { width: 36 },
  colKind: { width: 60 },
  skuEmpty: { padding: 24, alignItems: 'center' },
  confirmNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 20,
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  confirmNoteText: { flex: 1, fontSize: 13, color: '#636E72', lineHeight: 18 },
  /** 移动端 Info 页底部按钮区域（固定在内容之后，而非悬浮覆盖） */
  bottomActionBar: {
    paddingHorizontal: 0,
    paddingVertical: 4,
  },
  bottomActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  /** 移动端底部 Reject（client & firm onboarding）：浅红底，阴影与凭证 Cancel 一致 */
  bottomRejectBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#FFE5E5',
    borderWidth: 1,
    borderColor: '#FFE5E5',
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 140,
    maxWidth: 220,
    ...(Platform.OS === 'ios'
      ? {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 6,
        }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 2 } : {}),
  },
  bottomRejectBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#C0392B',
  },
  /** 移动端底部主按钮（Accept / Start）：主紫色，阴影与凭证 Confirm 一致 */
  bottomAcceptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#6C5CE7',
    ...(Platform.OS === 'ios'
      ? {
          shadowColor: '#6C5CE7',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 6,
        }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 3 } : {}),
    minWidth: 140,
    maxWidth: 220,
  },
  bottomAcceptBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  bottomAbortBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 48,
    borderRadius: 12,
    // 与 web 端 Terminate 按钮配色保持一致：浅橙底 + 深橙字
    backgroundColor: '#FFF3E0',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'ios'
      ? {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.12,
          shadowRadius: 3,
        }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 2 } : {}),
    minWidth: 140,
    maxWidth: 220,
  },
  bottomAbortBtnText: {
    color: '#D35400',
    fontWeight: '600',
    fontSize: 15,
  },
  bottomCompleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#00B894',
    ...(Platform.OS === 'ios'
      ? { shadowColor: '#00B894', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 4 } : {}),
    minWidth: 140,
    maxWidth: 220,
  },
  bottomCompleteBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  /** 移动端底部 Restart（取消态）：主紫色主按钮 */
  bottomRestartBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 18,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#6C5CE7',
    ...(Platform.OS === 'ios'
      ? { shadowColor: '#6C5CE7', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 6 }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 3 } : {}),
  },
  bottomRestartBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  /** 单按钮（浅色副按钮），宽度收窄并靠左 */
  bottomSingleBtn: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#FFE5E5',
    borderWidth: 1,
    borderColor: '#FFE5E5',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'ios'
      ? {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.12,
          shadowRadius: 4,
        }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 3 } : {}),
    minWidth: 140,
    maxWidth: 220,
  },
  /** 单按钮（主按钮），宽度收窄并靠左 */
  bottomSingleBtnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#6C5CE7',
    ...(Platform.OS === 'ios'
      ? {
          shadowColor: '#6C5CE7',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 6,
        }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 3 } : {}),
    minWidth: 140,
    maxWidth: 220,
  },
});
