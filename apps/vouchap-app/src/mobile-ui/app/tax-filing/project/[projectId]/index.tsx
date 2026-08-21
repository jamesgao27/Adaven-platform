/**
 * 项目 - Todos 树形列表页（client 侧以 project 为主体的详情页）
 * 顶行用页面 Stack 顶栏（税季+项目名+Services from firm、设置）；展示区顶栏隐藏。状态/(n/m)/资料数跟随名称左对齐。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useChatPanel } from '../../../../contexts/ChatPanelContext';
import {
  getOrderById,
  getOrderHeaderForClient,
  getProjectTodosTree,
  getProjectById,
  createProjectTodo,
  getSkuItems,
  getSkuById,
  confirmOrderAndCreateProjectTodos,
  updateOrderStatus,
  updateProjectTodo,
  type ProjectTodoNode,
} from '@/lib/firm';
import { preflightFirmEngagementConfirmOrAlert } from '@/lib/firm-engagement-preflight-ui';
import { showToast } from '@/lib/toast';
import { showConfirmDestructiveDialog } from '@/lib/confirmDialog';
import { ProjectInfoTab, type ProjectInfoTabHandle } from './info';
import type { FirmSkuItem } from '@/types';
import type { ProjectSkuInfo } from '@/components/ProjectSkuDetail';
import { ProjectDetailView, type ProjectDetailHeader, ORDER_STATUS_CONFIG } from '@/components/ProjectDetailView';
import EngagementConsentModal from '@/components/EngagementConsentModal';
import { deriveTaxSeasonYear } from '@/lib/tax-season-colors';
import { useEngagementOrderProjectRealtime } from '../../../../lib/engagement-realtime';
import { useWebViewportKind } from '../../../../lib/web-viewport';

export default function ProjectTodosScreen() {
  const { isDesktopWeb } = useWebViewportKind();
  const { projectId, tab, edit } = useLocalSearchParams<{
    projectId?: string | string[];
    tab?: string | string[];
    edit?: string | string[];
  }>();
  const normalizedProjectId = typeof projectId === 'string' ? projectId : Array.isArray(projectId) ? projectId[0] : undefined;
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 由 project 解析出的 orderId，用于 API（getProjectTodosTree 等） */
  const [orderId, setOrderId] = useState<string | null>(null);
  const [header, setHeader] = useState<{ projectName: string; firmName: string; dueAt: string | null; createdAt: string | null; status: string } | null>(null);
  /** 当前订单的 client space_id，用于税表上传路径 tax-filing/{clientSpaceId}/... */
  const [clientSpaceId, setClientSpaceId] = useState<string>('');
  const [tree, setTree] = useState<ProjectTodoNode[]>([]);
  /** Client onboarding 时展示只读 checklist/Info 用 */
  const [skuItems, setSkuItems] = useState<FirmSkuItem[]>([]);
  const [skuInfo, setSkuInfo] = useState<ProjectSkuInfo | null>(null);
  const [skuDetailForInfo, setSkuDetailForInfo] = useState<{ taxCountry?: string | null; taxScenario?: string | null } | null>(null);

  const load = useCallback(async () => {
    if (!normalizedProjectId) return;
    setLoading(true);
    setError(null);
    try {
      const project = await getProjectById(normalizedProjectId);
      if (!project) {
        setError('Project not found');
        setLoading(false);
        return;
      }
      const orderIdVal = project.orderId;
      setOrderId(orderIdVal);
      const order = await getOrderById(orderIdVal);
      if (!order) {
        setError('Order not found');
        setLoading(false);
        return;
      }
      setClientSpaceId(order.clientSpaceId ?? '');
      const headerData = await getOrderHeaderForClient(orderIdVal, { preloadedOrder: order });
      setHeader(headerData ?? null);
      if (order.status === 'onboarding') {
        setTree([]);
        const [items, sku] = await Promise.all([
          getSkuItems(order.skuId, orderIdVal),
          getSkuById(order.skuId, orderIdVal),
        ]);
        setSkuItems(items);
        if (sku) {
          setSkuInfo({ name: sku.name, description: sku.description ?? null, imageUrl: sku.imageUrl ?? null });
          setSkuDetailForInfo({ taxCountry: sku.taxCountry ?? null, taxScenario: sku.taxScenario ?? null });
        } else {
          setSkuInfo(null);
          setSkuDetailForInfo(null);
        }
        setLoading(false);
        return;
      }
      setSkuItems([]);
      setSkuInfo(null);
      setSkuDetailForInfo(null);
      const todosTree = await getProjectTodosTree(orderIdVal);
      setTree(todosTree);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [normalizedProjectId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Info 保存后立刻刷新顶栏税季/名称（父级 state 不随子组件 load 更新） */
  const refreshEngagementChrome = useCallback(async () => {
    if (!orderId) return;
    try {
      const ord = await getOrderById(orderId);
      if (!ord) return;
      const headerData = await getOrderHeaderForClient(orderId, { preloadedOrder: ord });
      setHeader(headerData ?? null);
    } catch {
      /* keep existing */
    }
  }, [orderId]);

  useEngagementOrderProjectRealtime(orderId, normalizedProjectId ?? null, load, Boolean(normalizedProjectId));

  const chatPanel = useChatPanel();
  // 进入/切换报税项目时：仅更新附件上下文，不再自动打开/关闭 chat-to-log
  // 注意：依赖 setAttachmentContext（稳定的 useState setter）而非整个 chatPanel 对象，
  // 避免因 context value 对象每次渲染都重建而导致 effect 无限重触发（render 死循环）。
  const setAttachmentContext = chatPanel?.setAttachmentContext;
  useEffect(() => {
    if (!normalizedProjectId || !setAttachmentContext) return;
    setAttachmentContext({ projectId: normalizedProjectId, todoId: undefined });
    return () => {
      setAttachmentContext({});
    };
  }, [normalizedProjectId, setAttachmentContext]);

  const [activeTab, setActiveTab] = useState<'todos' | 'info'>('todos');
  const [infoEditing, setInfoEditing] = useState(false);
  const [rejectLoading, setRejectLoading] = useState(false);
  const [acceptLoading, setAcceptLoading] = useState(false);
  const [consentVisible, setConsentVisible] = useState(false);
  const [abortLoading, setAbortLoading] = useState(false);
  const [restartLoading, setRestartLoading] = useState(false);
  const infoTabRef = useRef<ProjectInfoTabHandle>(null);

  const handleReject = useCallback(async () => {
    if (!orderId) return;
    if (isDesktopWeb && !window.confirm('Reject this order? You can\'t undo this.')) return;
    if (Platform.OS !== 'web') {
      Alert.alert('Reject order', 'Reject this order? You can\'t undo this.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reject', style: 'destructive', onPress: () => doReject() },
      ]);
      return;
    }
    await doReject();
    async function doReject() {
      setRejectLoading(true);
      const { error } = await updateOrderStatus(orderId, 'cancelled');
      setRejectLoading(false);
      if (error) {
        showToast(error.message ?? 'Failed to reject', 'error');
        return;
      }
      showToast('Order rejected', 'success');
      router.back();
    }
  }, [orderId, router]);

  const performAcceptAndStart = useCallback(async () => {
    if (!orderId) return;
    setAcceptLoading(true);
    const pre = await preflightFirmEngagementConfirmOrAlert(orderId, router);
    if (!pre) {
      setAcceptLoading(false);
      return;
    }
    const { error } = await confirmOrderAndCreateProjectTodos(orderId);
    setAcceptLoading(false);
    if (error) {
      showToast(error.message ?? 'Failed to accept', 'error');
      return;
    }
    showToast('Order accepted', 'success');
    load();
  }, [orderId, load]);

  const handleAcceptAndStart = useCallback(() => {
    if (acceptLoading) return;
    setConsentVisible(true);
  }, [acceptLoading]);

  const handleAbort = useCallback(async () => {
    if (!orderId) return;
    showConfirmDestructiveDialog(
      'Terminate engagement',
      'Terminate this engagement? You can\'t undo this.',
      () => void doAbort(),
      { confirmLabel: 'Terminate' }
    );
    async function doAbort() {
      setAbortLoading(true);
      const { error } = await updateOrderStatus(orderId, 'cancelled');
      setAbortLoading(false);
      if (error) {
        showToast(error.message ?? 'Failed to terminate', 'error');
        return;
      }
      showToast('Engagement terminated', 'success');
      router.back();
    }
  }, [orderId, router]);

  const handleRestart = useCallback(async () => {
    if (!orderId) return;
    setRestartLoading(true);
    try {
      const nextStatus = projectId ? 'processing' : 'onboarding';
      const { error } = await updateOrderStatus(orderId, nextStatus);
      if (error) {
        showToast(error.message ?? 'Failed to restart', 'error');
        return;
      }
      await load();
    } finally {
      setRestartLoading(false);
    }
  }, [orderId, projectId, load]);

  const [showTinaFab, setShowTinaFab] = useState(false);

  useEffect(() => {
    // 仅移动端 + 已有 todos 且状态为进行中/已完成时显示 Tina 浮层（onboarding/cancelled 均不显示）
    if (isDesktopWeb) {
      setShowTinaFab(false);
      return;
    }
    const hasTodos = tree.length > 0 && !tree.every((n) => n.children.length === 0 && !n.title);
    const isActiveForTina = header?.status === 'processing' || header?.status === 'completed';
    setShowTinaFab(hasTodos && isActiveForTina);
  }, [header?.status, tree.length, tree]);

  const handleTinaChat = () => {
    if (!normalizedProjectId) return;
    router.push({
      pathname: '/chat-to-log',
      params: { type: 'tax-filing', projectId: normalizedProjectId },
    } as any);
  };

  const dateForYear = header?.dueAt || header?.createdAt || null;
  const explicitTaxSeasonYear = header?.taxSeasonYear ?? null;
  const taxSeasonYear = explicitTaxSeasonYear != null
    ? explicitTaxSeasonYear
    : deriveTaxSeasonYear(dateForYear);
  const detailHeader: ProjectDetailHeader = {
    title: header?.projectName ?? '',
    subtitle: header?.firmName ? `by ${header.firmName}` : '',
    taxSeasonYear: taxSeasonYear ?? null,
    status: ORDER_STATUS_CONFIG[header?.status ?? ''] ?? ORDER_STATUS_CONFIG.onboarding,
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6C5CE7" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color="#6C5CE7" />
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const orderStatus = header?.status === 'onboarding' || header?.status === 'processing' || header?.status === 'cancelled'
    ? header.status
    : undefined;

  return (
    <View style={{ flex: 1 }}>
      <EngagementConsentModal
        visible={consentVisible}
        loading={acceptLoading}
        onClose={() => {
          if (!acceptLoading) setConsentVisible(false);
        }}
        onConfirm={() => {
          setConsentVisible(false);
          void performAcceptAndStart();
        }}
      />
      <ProjectDetailView
        viewerRole="client"
        header={detailHeader}
        isOnboarding={header?.status === 'onboarding'}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        infoEditing={infoEditing}
        setInfoEditing={setInfoEditing}
        infoTabRef={infoTabRef}
        onReject={header?.status === 'onboarding' ? handleReject : undefined}
        rejectLoading={rejectLoading}
        onAcceptAndStart={header?.status === 'onboarding' ? handleAcceptAndStart : undefined}
        acceptAndStartLoading={acceptLoading}
        orderStatus={orderStatus}
        onAbort={header?.status === 'processing' ? handleAbort : undefined}
        abortLoading={abortLoading}
        onRestart={header?.status === 'cancelled' ? handleRestart : undefined}
        restartLoading={restartLoading}
        tree={tree}
        orderId={orderId ?? ''}
        projectId={normalizedProjectId ?? null}
        clientSpaceId={clientSpaceId}
        onRefresh={async () => {
          if (!orderId) return;
          const todosTree = await getProjectTodosTree(orderId);
          setTree(todosTree);
        }}
        onMergeProjectTodosTree={(roots) => setTree(roots)}
        createProjectTodo={createProjectTodo}
        skuItems={skuItems}
        skuInfo={skuInfo}
        skuDetailForInfo={skuDetailForInfo}
        persistTodoTitle={
          isDesktopWeb && header?.status === 'processing'
            ? (todoId, title) => updateProjectTodo(todoId, { title })
            : undefined
        }
        onProjectInfoSaved={refreshEngagementChrome}
      />
      {showTinaFab && (
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={handleTinaChat}
          style={styles.tinaFab}
        >
          <Image
            source={require('../../../../assets/assistants/Tina-Tax_Assistant.png')}
            style={styles.tinaFabImage}
            resizeMode="cover"
          />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8F9FA', padding: 20 },
  errorText: { fontSize: 16, color: '#636E72', marginBottom: 16 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 16 },
  backBtnText: { fontSize: 16, color: '#6C5CE7', fontWeight: '500' },
  tinaFab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
    backgroundColor: '#FFFFFF',
  },
  tinaFabImage: {
    width: '100%',
    height: '100%',
  },
});

