/**
 * Firm – Engagement（订单/项目）详情页
 *
 * 布局与 client 侧 tax-filing/project/[projectId]/index.tsx 对齐：
 *   - 顶行：返回 + 订单标题 + 客户名
 *   - 操作行：Tabs (Todos | Info) + 操作按钮
 *   - onboarding 态：展示 SKU WBS 预览 + 确认按钮
 *   - 已确认态：Todos tab（树形任务）+ Info tab（ProjectInfoTab）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getCurrentSpace } from '@/lib/auth';
import {
  getOrderById,
  getProjectDetail,
  getProjectTodosTree,
  getProjectById,
  createProjectTodo,
  getSkuById,
  getSkuItems,
  getClientDisplayName,
  getOrderHeaderForClient,
  updateOrderStatus,
  confirmOrderAndCreateProjectTodos,
  applyProjectTodosTreeOrder,
  updateProjectTodo,
  type ProjectTodoNode,
  type FirmOrderById,
} from '@/lib/firm';
import { preflightFirmEngagementConfirmOrAlert } from '@/lib/firm-engagement-preflight-ui';
import type { FirmSkuItem } from '@/types';
import { withWbsCodes, type ProjectSkuInfo, type TodoRow } from '@/components/ProjectSkuDetail';
import { ProjectDetailView, type ProjectDetailHeader } from '@/components/ProjectDetailView';
import { ProjectInfoTab, type ProjectInfoTabHandle } from '../../tax-filing/project/[projectId]/info';
import { useChatPanel } from '../../../contexts/ChatPanelContext';
import { useWebViewportKind } from '../../../lib/web-viewport';
import { showToast } from '@/lib/toast';
import EngagementConsentModal from '@/components/EngagementConsentModal';
import { showConfirmDestructiveDialog } from '@/lib/confirmDialog';
import { deriveTaxSeasonYear } from '@/lib/tax-season-colors';
import { useEngagementOrderProjectRealtime } from '../../../lib/engagement-realtime';

// ── 订单状态：与 firm.orders.status（4 态）及类型 FirmOrderStatus 一致；深底色 + 白字色 ──
const ORDER_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  onboarding:  { label: 'Onboarding',  color: '#FFFFFF', bg: '#E67E22' },
  processing:  { label: 'Processing',  color: '#FFFFFF', bg: '#29B6F7' },
  completed:   { label: 'Completed',   color: '#FFFFFF', bg: '#00B894' },
  cancelled:   { label: 'Cancelled',   color: '#FFFFFF', bg: '#636E72' },
};

/** Status where Firm can show Terminate + Complete (active, not onboarding/cancelled/completed). */
const ACTIVE_ORDER_STATUSES = ['processing'] as const;

export default function FirmEngagementDetailScreen() {
  const { id: orderIdParam, tab, edit } = useLocalSearchParams<{
    id: string;
    tab?: string | string[];
    edit?: string | string[];
  }>();
  const orderId =
    typeof orderIdParam === 'string' ? orderIdParam : Array.isArray(orderIdParam) ? orderIdParam[0] : undefined;
  const router = useRouter();
  const { isDesktopWeb } = useWebViewportKind();
  const chatPanel = useChatPanel();

  /** 与 tax-filing 列表进入方式一致：client 空间为 client，firm 空间为 firm */
  const [viewerRole, setViewerRole] = useState<'client' | 'firm'>('firm');
  const [clientHeaderForDetail, setClientHeaderForDetail] =
    useState<Awaited<ReturnType<typeof getOrderHeaderForClient>>>(null);

  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [order, setOrder]               = useState<FirmOrderById | null>(null);
  const [projectId, setProjectId]       = useState<string | null>(null);
  const [clientName, setClientName]     = useState('');
  const [clientSpaceId, setClientSpaceId] = useState<string>('');
  const [skuInfo, setSkuInfo]           = useState<ProjectSkuInfo | null>(null);
  const [skuTodos, setSkuTodos]         = useState<TodoRow[]>([]);
  const [skuItems, setSkuItems]         = useState<FirmSkuItem[]>([]);
  const [tree, setTree]                 = useState<ProjectTodoNode[]>([]);
  const [skuDetailForInfo, setSkuDetailForInfo] = useState<{ taxCountry?: string | null; taxScenario?: string | null } | null>(null);

  // Tabs
  const [activeTab, setActiveTab]       = useState<'todos' | 'info'>('todos');
  const [infoEditing, setInfoEditing]   = useState(false);
  const infoTabRef                      = useRef<ProjectInfoTabHandle>(null);
  // Onboarding: Terminal / Start
  const [rejectLoading, setRejectLoading] = useState(false);
  const [acceptLoading, setAcceptLoading] = useState(false);
  const [abortLoading, setAbortLoading] = useState(false);
  const [completeLoading, setCompleteLoading] = useState(false);
  const [restartLoading, setRestartLoading] = useState(false);
  const [showTinaFab, setShowTinaFab]   = useState(false);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [secondaryLoading, setSecondaryLoading] = useState(false);
  const loadSeqRef = useRef(0);

  const loadData = useCallback(async () => {
    if (!orderId) return;
    const seq = ++loadSeqRef.current;
    const isStale = () => loadSeqRef.current !== seq;
    setLoading(true);
    setSecondaryLoading(false);
    setError(null);
    setProjectId(null);
    setTree([]);
    setSkuInfo(null);
    setSkuTodos([]);
    setSkuItems([]);
    setSkuDetailForInfo(null);
    setClientName('');
    setClientHeaderForDetail(null);
    try {
      const [space, ord] = await Promise.all([
        getCurrentSpace(true),
        getOrderById(orderId),
      ]);
      if (isStale()) return;
      const role: 'client' | 'firm' = space?.kind === 'provider' ? 'firm' : 'client';
      setViewerRole(role);

      if (!ord) {
        setError('Engagement not found');
        setLoading(false);
        return;
      }
      setOrder(ord);
      setClientSpaceId(ord.clientSpaceId ?? '');
      // 第一阶段：只要拿到 order 就先渲染页面，避免整页阻塞。
      setLoading(false);
      setSecondaryLoading(true);

      void (async () => {
        try {
          const [clientHdr] = await Promise.all([
            role === 'client'
              ? getOrderHeaderForClient(orderId, { preloadedOrder: ord })
              : Promise.resolve(null),
          ]);
          if (isStale()) return;
          setClientHeaderForDetail(clientHdr);

          if (ord.status === 'onboarding') {
            const [sku, items, clientDisplayName] = await Promise.all([
              getSkuById(ord.skuId, orderId),
              getSkuItems(ord.skuId, orderId),
              role === 'firm' && ord.clientSpaceId && ord.firmSpaceId
                ? getClientDisplayName(ord.clientSpaceId, ord.firmSpaceId)
                : Promise.resolve(null),
            ]);
            if (isStale()) return;
            setSkuInfo(sku ? { name: sku.name, description: sku.description, imageUrl: sku.imageUrl } : { name: 'Service' });
            setSkuDetailForInfo(sku ? { taxCountry: sku.taxCountry ?? null, taxScenario: sku.taxScenario ?? null } : null);
            setSkuTodos(withWbsCodes(items));
            setSkuItems(items);
            setClientName(clientDisplayName ?? '');
          } else {
            const [detail, todosTree] = await Promise.all([
              getProjectDetail(orderId, { order: ord }),
              getProjectTodosTree(orderId),
            ]);
            if (isStale()) return;
            if (detail) {
              if (role === 'firm') {
                setClientName(detail.clientName ?? '');
              } else {
                setClientName('');
              }
              if (detail.project) {
                setProjectId(detail.project.id);
                setTree(todosTree);
              }
            }
          }
        } catch (e) {
          if (!isStale()) {
            showToast(e instanceof Error ? e.message : 'Failed to load details', 'error');
          }
        } finally {
          if (!isStale()) setSecondaryLoading(false);
        }
      })();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { loadData(); }, [loadData]);

  const refreshEngagementChrome = useCallback(async () => {
    if (!orderId) return;
    try {
      const ord = await getOrderById(orderId);
      if (!ord) return;
      setOrder(ord);
      if (viewerRole === 'client') {
        const h = await getOrderHeaderForClient(orderId, { preloadedOrder: ord });
        setClientHeaderForDetail(h);
      }
    } catch {
      /* keep existing */
    }
  }, [orderId, viewerRole]);

  useEngagementOrderProjectRealtime(orderId ?? null, projectId, loadData, Boolean(orderId));

  /** Web：从 tax-filing 列表「Info」入口带入 tab=info&edit=1 */
  useEffect(() => {
    const tabStr = typeof tab === 'string' ? tab : Array.isArray(tab) ? tab[0] : undefined;
    const editStr = typeof edit === 'string' ? edit : Array.isArray(edit) ? edit[0] : undefined;
    if (tabStr === 'info') setActiveTab('info');
    if (editStr === '1' || editStr === 'true') setInfoEditing(true);
  }, [tab, edit]);

  const handleTerminal = useCallback(async () => {
    if (!orderId) return;
    setRejectLoading(true);
    try {
      const { error } = await updateOrderStatus(orderId, 'cancelled');
      if (error) return;
      await loadData();
    } finally {
      setRejectLoading(false);
    }
  }, [orderId, loadData]);

  const doStart = useCallback(async () => {
    if (!orderId) return;
    setAcceptLoading(true);
    try {
      const pre = await preflightFirmEngagementConfirmOrAlert(orderId, router);
      if (!pre) return;
      const { error } = await confirmOrderAndCreateProjectTodos(orderId);
      if (error) return;
      if (viewerRole === 'client') showToast('Request submitted', 'success');
      await loadData();
    } finally {
      setAcceptLoading(false);
    }
  }, [orderId, viewerRole, loadData, router]);

  const handleStart = useCallback(async () => {
    if (viewerRole === 'client') {
      setShowConsentModal(true);
      return;
    }
    await doStart();
  }, [viewerRole, doStart]);

  const handleClientReject = useCallback(() => {
    if (!orderId) return;
    const run = async () => {
      setRejectLoading(true);
      try {
        const { error } = await updateOrderStatus(orderId, 'cancelled');
        if (error) {
          showToast(error.message ?? 'Failed to reject', 'error');
          return;
        }
        showToast('Engagement rejected', 'success');
        router.back();
      } finally {
        setRejectLoading(false);
      }
    };
    if (isDesktopWeb) {
      if (typeof window !== 'undefined' && !window.confirm('Reject this engagement? You can\'t undo this.')) return;
      void run();
      return;
    }
    Alert.alert('Reject engagement', 'Reject this engagement? You can\'t undo this.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reject', style: 'destructive', onPress: () => void run() },
    ]);
  }, [orderId, router, isDesktopWeb]);

  const handleClientAbort = useCallback(() => {
    if (!orderId) return;
    const run = async () => {
      setAbortLoading(true);
      try {
        const { error } = await updateOrderStatus(orderId, 'cancelled');
        if (error) {
          showToast(error.message ?? 'Failed to terminate', 'error');
          return;
        }
        showToast('Engagement terminated', 'success');
        router.back();
      } finally {
        setAbortLoading(false);
      }
    };
    showConfirmDestructiveDialog(
      'Terminate engagement',
      'Terminate this engagement? You can\'t undo this.',
      () => void run(),
      { confirmLabel: 'Terminate' }
    );
  }, [orderId, router]);

  const handleAbort = useCallback(async () => {
    if (!orderId) return;
    setAbortLoading(true);
    try {
      const { error } = await updateOrderStatus(orderId, 'cancelled');
      if (error) return;
      await loadData();
    } finally {
      setAbortLoading(false);
    }
  }, [orderId, loadData]);
  const handleComplete = useCallback(async () => {
    if (!orderId) return;
    setCompleteLoading(true);
    try {
      const { error } = await updateOrderStatus(orderId, 'completed');
      if (error) {
        showToast(error.message, 'error');
        return;
      }
      await loadData();
    } finally {
      setCompleteLoading(false);
    }
  }, [orderId, loadData]);
  const handleRestart = useCallback(async () => {
    if (!orderId) return;
    setRestartLoading(true);
    try {
      const nextStatus = projectId ? 'processing' : 'onboarding';
      const { error } = await updateOrderStatus(orderId, nextStatus);
      if (error) return;
      await loadData();
    } finally {
      setRestartLoading(false);
    }
  }, [orderId, projectId, loadData]);

  // ── 进入订单详情：自动打开 chat-to-log（tax-filing 类型），onboarding 与已确认态统一体验 ──
  const openPanel = chatPanel?.openPanel;
  const setType = chatPanel?.setType;
  const setAttachmentContext = chatPanel?.setAttachmentContext;
  const closePanel = chatPanel?.closePanel;

  useEffect(() => {
    // 仅桌面 Web 有固定 WebChatPanel；移动 Web / 原生走全屏 chat 路由
    if (!isDesktopWeb) return;
    if (!orderId || !openPanel || !setType || !setAttachmentContext) return;
    setType('tax-filing');
    setAttachmentContext({
      ...(projectId ? { projectId } : {}),
      clientSpaceId: clientSpaceId || undefined,
    });
    openPanel('tax-filing');
    return () => {
      setAttachmentContext({});
      closePanel?.();
    };
  }, [orderId, projectId, clientSpaceId, openPanel, setType, setAttachmentContext, closePanel, isDesktopWeb]);

  // 移动端 Todos tab 且已有 todos 且状态为进行中/已完成时显示 Tina 浮层（onboarding/cancelled 均不显示）
  useEffect(() => {
    if (isDesktopWeb) {
      setShowTinaFab(false);
      return;
    }
    const hasTodos = tree.length > 0 && !tree.every((n) => n.children.length === 0 && !n.title);
    const isActiveForTina = order?.status === 'processing' || order?.status === 'completed';
    setShowTinaFab(activeTab === 'todos' && isActiveForTina && hasTodos);
  }, [activeTab, order?.status, tree.length, tree, isDesktopWeb]);

  const handleTinaChat = useCallback(() => {
    if (!projectId) return;
    router.push({
      pathname: '/chat-to-log',
      params: { type: 'tax-filing', projectId, clientSpaceId },
    } as any);
  }, [projectId, clientSpaceId, router]);

  // 同步 infoEditing → child forwardRef
  useEffect(() => {
    if (activeTab === 'info' && infoEditing) {
      const timer = setTimeout(() => infoTabRef.current?.startEditing(), 80);
      return () => clearTimeout(timer);
    }
  }, [activeTab, infoEditing]);

  // ── Loading / Error ──
  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator size="large" color="#6C5CE7" />
      </View>
    );
  }
  if (!order) {
    return (
      <View style={s.centered}>
        <Text style={s.errorText}>{error ?? 'Not found'}</Text>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color="#6C5CE7" />
          <Text style={s.backBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isOnboarding = order.status === 'onboarding';
  const isClientMarketplaceOnboarding =
    viewerRole === 'client' &&
    isOnboarding &&
    String((order as any).requestOrigin ?? 'firm_manual') === 'client_marketplace';
  const statusCfg = ORDER_STATUS_CONFIG[order.status] ?? ORDER_STATUS_CONFIG.onboarding;
  const dateForYear = order.dueAt || order.createdAt;
  const explicitTaxSeasonYear = (order as any).taxSeasonYear ?? null;
  const taxYear = explicitTaxSeasonYear != null
    ? explicitTaxSeasonYear
    : deriveTaxSeasonYear(dateForYear);

  const detailHeader: ProjectDetailHeader =
    viewerRole === 'client' && clientHeaderForDetail
      ? (() => {
          const h = clientHeaderForDetail;
          const d = h.dueAt || h.createdAt;
          const ty =
            h.taxSeasonYear ??
            explicitTaxSeasonYear ??
            deriveTaxSeasonYear(d);
          const title =
            order.status === 'onboarding' && (order.skuName ?? '').trim()
              ? (order.skuName as string)
              : (h.projectName ?? '');
          return {
            title,
            subtitle: h.firmName ? `by ${h.firmName}` : '',
            taxSeasonYear: ty,
            status: ORDER_STATUS_CONFIG[h.status] ?? ORDER_STATUS_CONFIG.onboarding,
          };
        })()
      : {
          title: order.skuName ?? 'Engagement',
          subtitle: clientName ? `for ${clientName}` : '',
          taxSeasonYear: taxYear,
          status: statusCfg,
        };

  return (
    <View style={s.root}>
      <ProjectDetailView
        viewerRole={viewerRole}
        header={detailHeader}
        isOnboarding={isOnboarding}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        infoEditing={infoEditing}
        setInfoEditing={setInfoEditing}
        infoTabRef={infoTabRef}
        onReject={
          isOnboarding && !isClientMarketplaceOnboarding
            ? (viewerRole === 'firm' ? handleTerminal : handleClientReject)
            : undefined
        }
        rejectLoading={rejectLoading}
        onAcceptAndStart={isOnboarding && !isClientMarketplaceOnboarding ? handleStart : undefined}
        acceptAndStartLoading={acceptLoading}
        headerRejectLabel={viewerRole === 'firm' || isClientMarketplaceOnboarding ? 'Terminate' : 'Reject'}
        headerAcceptLabel={viewerRole === 'firm' ? 'Start service' : 'Accept and Start'}
        orderStatus={order.status}
        onAbort={
          ACTIVE_ORDER_STATUSES.includes(order.status) || isClientMarketplaceOnboarding
            ? (viewerRole === 'firm' ? handleAbort : handleClientAbort)
            : undefined
        }
        abortLoading={abortLoading}
        onComplete={
          viewerRole === 'firm' && ACTIVE_ORDER_STATUSES.includes(order.status) ? handleComplete : undefined
        }
        completeLoading={completeLoading}
        onRestart={viewerRole === 'firm' && order.status === 'cancelled' ? handleRestart : undefined}
        restartLoading={restartLoading}
        tree={tree}
        orderId={orderId!}
        projectId={projectId}
        clientSpaceId={clientSpaceId}
        onRefresh={async () => {
          const todosTree = await getProjectTodosTree(orderId!);
          setTree(todosTree);
        }}
        onMergeProjectTodosTree={(roots) => setTree(roots)}
        onTodoTreeOrderSaved={(roots) => setTree(roots)}
        createProjectTodo={createProjectTodo}
        skuInfo={skuInfo}
        skuTodos={skuTodos}
        skuItems={skuItems}
        skuDetailForInfo={skuDetailForInfo}
        persistTodoTreeOrder={
          isDesktopWeb &&
          viewerRole === 'firm' &&
          order.status === 'processing' &&
          orderId
            ? (roots) => applyProjectTodosTreeOrder(orderId, roots)
            : undefined
        }
        persistTodoTitle={
          isDesktopWeb && order.status === 'processing' && orderId
            ? (todoId, title) => updateProjectTodo(todoId, { title })
            : undefined
        }
        onProjectInfoSaved={refreshEngagementChrome}
      />
      <EngagementConsentModal
        visible={showConsentModal}
        loading={acceptLoading}
        onClose={() => {
          if (!acceptLoading) setShowConsentModal(false);
        }}
        onConfirm={() => {
          setShowConsentModal(false);
          void doStart();
        }}
      />
      {secondaryLoading ? (
        <View style={s.secondaryLoadingBadge}>
          <ActivityIndicator size="small" color="#6C5CE7" />
          <Text style={s.secondaryLoadingText}>Syncing details...</Text>
        </View>
      ) : null}
      {showTinaFab && (
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={handleTinaChat}
          style={s.tinaFab}
        >
          <Image
            // 相对路径：app/firm/engagement/[id].tsx → 回到 src/mobile-ui → assets/assistants
            source={require('../../../assets/assistants/Tina-Tax_Assistant.png')}
            style={s.tinaFabImage}
            resizeMode="cover"
          />
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:      { flex: 1 },
  centered:   { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { fontSize: 15, color: '#636E72', marginBottom: 16 },
  backBtn:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 16 },
  backBtnText: { fontSize: 16, color: '#6C5CE7', fontWeight: '500' },
  secondaryLoadingBadge: {
    position: 'absolute',
    right: 16,
    top: 12,
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  secondaryLoadingText: {
    fontSize: 12,
    color: '#636E72',
    fontWeight: '600',
  },
  tinaFab: {
    position: 'absolute',
    right: 24,
    bottom: 32,
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  tinaFabImage: {
    width: '100%',
    height: '100%',
  },
});
