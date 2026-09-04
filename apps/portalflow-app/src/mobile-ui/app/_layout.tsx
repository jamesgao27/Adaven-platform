import { Stack, usePathname } from 'expo-router';
import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, Platform, Text } from 'react-native';
import * as Font from 'expo-font';
import '@/lib/portalflow-space-bootstrap';
import { validateSupabaseConfig } from '@/lib/supabase';
import { getCurrentSpace } from '@/lib/auth';
import { ToastHost } from '@/components/ToastHost';
import { ConfirmModalHost } from '@/components/ConfirmModalHost';
import WebSidebar, { shouldShowWebSidebar } from '@/components/WebSidebar';
import { FirmPendingOverlay } from '@/components/FirmPendingOverlay';
import WebChatFab from '@/components/WebChatFab';
import WebChatPanel from '@/components/WebChatPanel';
import { ChatPanelErrorBoundary } from '@/components/ChatPanelErrorBoundary';
import { ChatPanelProvider, useChatPanel, type ChatPanelType } from '../contexts/ChatPanelContext';
import { getWebStackHeaderLeftScreenOptions } from '../lib/web-stack-header-left';
import { useWebViewportKind } from '../lib/web-viewport';

/** 基础数据设置页：这些页不显示 chat-to-log 气泡（已打开的右栏保留） */
function isSettingsPage(pathname: string): boolean {
  const base = pathname?.replace(/^\//, '').split('/')[0] || '';
  return [
    'entities-manage',
    'accounts-manage',
    'categories-manage',
    'purposes-manage',
    'attributions-manage',
    'skus-manage',
    'warehouse-manage',
    'management',
    'space-manage',
    'space-orders',
    'expense-settings',
    'income-settings',
  ].includes(base) || pathname?.startsWith('/firm/permissions') === true;
}

/** 某些页面完全不显示 chat-to-log（右栏 + 气泡都关掉） */
function isChatDisabledPath(pathname: string | null): boolean {
  if (!pathname) return false;
  // Dashboard（首页）
  if (pathname === '/' || pathname === '/index') return true;
  // 报税项目列表页：仅浏览，不支持 chat-to-log
  if (pathname === '/tax-filing' || pathname.startsWith('/tax-filing/service-catalog')) return true;
  return false;
}

function chatTypeFromPathname(pathname: string | null): ChatPanelType | null {
  if (!pathname) return null;
  // 报税相关路径：firm 订单列表 / 详情 以及 tax-filing 项目路由，统一映射为 tax-filing
  if (pathname === '/firm/todos' || pathname.startsWith('/firm/todos/')) return 'tax-filing';
  if (pathname === '/firm/engagements' || pathname.startsWith('/firm/engagement/')) return 'tax-filing';
  if (pathname.startsWith('/tax-filing')) return 'tax-filing';
  // Clients 模块：Cody (Client Assistant)
  if (pathname === '/firm/clients' || pathname.startsWith('/firm/clients/') || pathname.startsWith('/firm/client/')) return 'client';
  if (pathname === '/receipts' || pathname.startsWith('/receipts/') || pathname.startsWith('/receipt-details/')) return 'receipt';
  if (pathname === '/receipt-items' || pathname.startsWith('/receipt-items/')) return 'receipt';
  if (pathname === '/invoices' || pathname.startsWith('/invoices/') || pathname.startsWith('/invoice-details/')) return 'invoice';
  if (pathname === '/inbound' || pathname.startsWith('/inbound/') || pathname.startsWith('/inbound-details/')) return 'inbound';
  if (pathname === '/outbound' || pathname.startsWith('/outbound/') || pathname.startsWith('/outbound-details/')) return 'outbound';
  return null;
}

// Web 部署后 bundled 字体 URL 易 404，用 CDN 预加载保证图标显示（与 @expo/vector-icons 同源字体）
const IONICONS_FONT_URL =
  'https://cdn.jsdelivr.net/npm/@expo/vector-icons@15.0.3/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf';

/** Web：侧栏品牌字用 Google Fonts（与 Ionicons CDN 一致）；bundled TTF + loadAsync 在 dev 下常因字体 URL 失效回退系统字体 */
const POPPINS_WEB_CSS =
  'https://fonts.googleapis.com/css2?family=Poppins:wght@700;900&display=swap';

async function ensurePoppinsWebFontLoaded(): Promise<void> {
  if (typeof document === 'undefined') return;
  const id = 'portalflow-google-font-poppins';
  let link = document.getElementById(id) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = POPPINS_WEB_CSS;
    document.head.appendChild(link);
  }
  await new Promise<void>((resolve) => {
    if (link!.sheet) {
      resolve();
      return;
    }
    const done = () => resolve();
    link!.addEventListener('load', done, { once: true });
    link!.addEventListener('error', done, { once: true });
  });
  try {
    await document.fonts.load('700 16px Poppins');
    await document.fonts.load('900 25px Poppins');
  } catch {
    /* ignore */
  }
}

/**
 * iOS Release/TestFlight: react-native-screens 在过渡/冻结或快照阶段可能触发原生断言，
 * 表现为 TurboModule performVoidMethodInvocation → SIGABRT。仅对 iOS 收窄影响面。
 * @see tax-filing/project/[projectId] 历史注释
 */
const iosRnScreensProductionSafe =
  Platform.OS === 'ios'
    ? {
        animation: 'none' as any,
        freezeOnBlur: false as any,
      }
    : {};

/** 全栈默认：iOS 上统一关闭过渡动画与 off-screen 冻结，避免遗漏路由仍触发 RNSScreen SIGABRT */
const stackScreenOptions = {
  contentStyle: { flex: 1 },
  ...(Platform.OS === 'ios' ? iosRnScreensProductionSafe : {}),
  ...getWebStackHeaderLeftScreenOptions(),
};

/** 不同页面的默认 chat 开关策略 */
function defaultChatOpen(pathname: string | null): boolean {
  if (!pathname) return false;
  // 完全关闭 chat 的页面
  if (isChatDisabledPath(pathname)) return false;
  // 报税项目详情页：每次进入都默认打开右栏
  if (pathname.startsWith('/tax-filing/project/')) return true;
  if (pathname.startsWith('/firm/engagement/')) return true;
  // 费用、收入、库存列表页：默认打开右栏（Line items 除外：表格占宽，默认关闭右栏）
  if (pathname === '/receipts' || pathname.startsWith('/receipts/')) return true;
  if (pathname === '/invoices' || pathname.startsWith('/invoices/')) return true;
  if (pathname === '/inbound' || pathname.startsWith('/inbound/')) return true;
  if (pathname === '/outbound' || pathname.startsWith('/outbound/')) return true;
  // Clients 模块：默认打开右栏（Cody）
  if (pathname === '/firm/clients' || pathname.startsWith('/firm/clients/') || pathname.startsWith('/firm/client/')) return true;
  // 其他页面默认关闭
  return false;
}

function LayoutContent() {
  const pathname = usePathname();
  const { isDesktopWeb } = useWebViewportKind();
  // 首帧 pathname 可能未就绪（路由水合），用 URL 兜底，避免 Clients 页先显示 Eric 再闪成 Cody
  const pathnameForType =
    pathname ??
    (Platform.OS === 'web' && typeof window !== 'undefined' ? (window as any).location?.pathname ?? null : null);
  const showSidebar = isDesktopWeb && shouldShowWebSidebar(pathname ?? '/');
  const chatPanelCtx = useChatPanel();
  const chatOpen = chatPanelCtx?.open ?? false;
  const setChatOpen = chatPanelCtx?.setOpen;
  const setChatType = chatPanelCtx?.setType;
  const chatType = chatPanelCtx?.type;
  const [currentSpace, setCurrentSpace] = useState<{ kind?: string; firmStatus?: string } | null>(null);

  const loadSpace = useCallback(async () => {
    try {
      const space = await getCurrentSpace();
      setCurrentSpace(space ?? null);
    } catch {
      setCurrentSpace(null);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || !showSidebar) return;
    loadSpace();
  }, [loadSpace, showSidebar, pathname]);

  const isFirmPending =
    Platform.OS === 'web' &&
    showSidebar &&
    currentSpace?.kind === 'provider' &&
    currentSpace?.firmStatus !== 'approved';
  const showFirmPendingOverlay = isFirmPending && (pathname === '/' || pathname === '/index' || (pathname?.startsWith('/firm')));

  // Web：根据不同页面应用默认的 chat 开关策略
  useEffect(() => {
    if (!isDesktopWeb) return;
    const openDefault = defaultChatOpen(pathname ?? null);
    setChatOpen?.(openDefault);
  }, [isDesktopWeb, pathname, setChatOpen]);

  // Web：主区切换到不同列表时，chat-to-log 提交类别跟随切换
  useEffect(() => {
    if (!isDesktopWeb) return;
    const type = chatTypeFromPathname(pathname ?? null);
    if (type) setChatType?.(type);
  }, [isDesktopWeb, pathname, setChatType]);

  // Web：Google Fonts（Poppins 700/900）+ Ionicons（CDN）就绪后再渲染主界面
  const [webFontReady, setWebFontReady] = React.useState(() => Platform.OS !== 'web');
  useEffect(() => {
    if (Platform.OS !== 'web') {
      setWebFontReady(true);
      return;
    }
    (async () => {
      try {
        await ensurePoppinsWebFontLoaded();
        await Font.loadAsync({ ionicons: IONICONS_FONT_URL });
      } catch (e) {
        console.warn('Web font load (Ionicons / Poppins) failed:', e);
      } finally {
        setWebFontReady(true);
      }
    })();
  }, []);

  /** RN Web: remove default browser focus ring on all TextInput (input/textarea). */
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const id = 'portalflow-rn-web-textinput-no-focus-ring';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
input:focus,
input:focus-visible,
input:focus-within,
textarea:focus,
textarea:focus-visible,
textarea:focus-within {
  outline: none !important;
  box-shadow: none !important;
}
`.trim();
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    const config = validateSupabaseConfig();
    if (!config.valid) {
      console.warn('⚠️ Supabase配置警告:', config.error);
      console.warn('应用可能无法正常连接Supabase。请在构建时设置正确的环境变量。');
    }
  }, []);

  if (!webFontReady) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  const mainAreaStyle = [
    styles.mainArea,
  ];

  const chatDisabled = isDesktopWeb && isChatDisabledPath(pathname ?? '/');

  return (
    <View style={[styles.root, showSidebar && styles.webRow]}>
      {showSidebar && <WebSidebar />}
      <View style={mainAreaStyle}>
      {showFirmPendingOverlay ? (
        <FirmPendingOverlay />
      ) : (
      <Stack screenOptions={stackScreenOptions}>
        <Stack.Screen 
          name="index" 
          options={{ 
            headerShown: false 
          }} 
        />
        <Stack.Screen 
          name="receipts" 
          options={{ 
            title: 'Expenses',
            headerBackTitle: 'Home'
          }} 
        />
        <Stack.Screen
          name="receipt-items"
          options={{
            title: 'Line items',
            headerBackTitle: 'Expenses',
          }}
        />
        <Stack.Screen 
          name="ai-inventory" 
          options={{ 
            title: 'AI Inventory',
            headerBackTitle: 'Home'
          }} 
        />
        <Stack.Screen 
          name="tax-filing/index" 
          options={{ 
            title: 'Tax Filing',
            headerBackTitle: 'Home'
          }} 
        />
        <Stack.Screen
          name="tax-filing/service-catalog"
          options={{
            title: 'Service Marketplace',
            headerBackTitle: 'Tax Filing',
          }}
        />
        <Stack.Screen 
          name="tax-filing/order/[orderId]" 
          options={{ headerShown: false }} 
        />
        <Stack.Screen 
          name="tax-filing/project/[projectId]" 
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen 
          name="firm/clients" 
          options={{ title: 'Clients', headerBackTitle: 'Back' }} 
        />
        <Stack.Screen 
          name="firm/client/[clientSpaceId]" 
          options={{ title: '', headerBackTitle: 'Back', headerBackButtonVisible: true }} 
        />
        <Stack.Screen 
          name="firm/clients/add" 
          options={{ headerShown: false }} 
        />
        <Stack.Screen 
          name="firm/clients/open-invite" 
          options={{ headerShown: false }} 
        />
        <Stack.Screen 
          name="firm/clients/invite-new" 
          options={{ headerShown: false }} 
        />
        <Stack.Screen 
          name="firm/assignments" 
          options={{ title: 'Assignment', headerBackTitle: 'Back' }} 
        />
        <Stack.Screen 
          name="firm/engagements" 
          options={{ title: 'Engagements', headerBackTitle: 'Back' }} 
        />
        <Stack.Screen 
          name="firm/engagement/[id]" 
          options={{
            title: '',
            headerBackTitle: 'Back',
            headerBackButtonVisible: true,
          }} 
        />
        <Stack.Screen 
          name="firm/sku/[skuId]" 
          options={{ headerShown: false }} 
        />
        <Stack.Screen 
          name="firm/service-catalog" 
          options={{ title: 'Service Catalog', headerBackTitle: 'Back' }} 
        />
        <Stack.Screen
          name="firm/permissions"
          options={{ title: 'Permission Roles', headerBackTitle: 'Back' }}
        />
        <Stack.Screen 
          name="invoices" 
          options={{ 
            title: 'Income',
            headerBackTitle: 'Back'
          }} 
        />
        <Stack.Screen 
          name="inbound" 
          options={{ 
            title: 'Inbound lists',
            headerBackTitle: 'Back'
          }} 
        />
        <Stack.Screen 
          name="outbound" 
          options={{ 
            title: 'Outbound lists',
            headerBackTitle: 'Back'
          }} 
        />
        <Stack.Screen 
          name="skus-manage" 
          options={{ 
            title: 'SKU Management',
            headerBackTitle: 'Back'
          }} 
        />
        <Stack.Screen 
          name="warehouse-manage" 
          options={{ 
            title: 'Warehouse Management',
            headerBackTitle: 'Back'
          }} 
        />
        <Stack.Screen 
          name="entities-manage" 
          options={{ 
            title: 'Entities',
            headerBackTitle: 'Back',
            headerBackButtonVisible: true,
          }} 
        />
        <Stack.Screen 
          name="receipt-details/[id]" 
          options={{ 
            title: 'Expenses Details'
          }} 
        />
        <Stack.Screen 
          name="invoice-details/[id]" 
          options={{ 
            title: 'Income Details'
          }} 
        />
        <Stack.Screen 
          name="inbound-details/[id]" 
          options={{ 
            title: 'Inbound Details'
          }} 
        />
        <Stack.Screen 
          name="outbound-details/[id]" 
          options={{ 
            title: 'Outbound Details'
          }} 
        />
        <Stack.Screen 
          name="login" 
          options={{ 
            headerShown: false
          }} 
        />
        <Stack.Screen 
          name="register" 
          options={{ 
            headerShown: false
          }} 
        />
        <Stack.Screen 
          name="reset-password" 
          options={{ 
            headerShown: false
          }} 
        />
        <Stack.Screen 
          name="set-password" 
          options={{ 
            headerShown: false
          }} 
        />
        <Stack.Screen 
          name="categories-manage" 
          options={{ 
            title: 'Categories',
            headerBackTitle: 'Back',
            headerBackButtonVisible: true,
          }} 
        />
        <Stack.Screen 
          name="attributions-manage" 
          options={{ 
            title: 'Attributions',
            headerBackTitle: 'Back',
            headerBackButtonVisible: true,
          }} 
        />
        <Stack.Screen 
          name="purposes-manage" 
          options={{ 
            title: 'Attributions',
            headerBackTitle: 'Back',
            headerBackButtonVisible: true,
          }} 
        />
        <Stack.Screen
          name="expense-settings"
          options={{
            title: 'Expense Settings',
            headerBackTitle: 'Back',
            headerBackButtonVisible: true,
          }}
        />
        <Stack.Screen
          name="income-settings"
          options={{
            title: 'Income Settings',
            headerBackTitle: 'Back',
            headerBackButtonVisible: true,
          }}
        />
        <Stack.Screen 
          name="accounts-manage" 
          options={{ 
            title: 'Manage Accounts',
            headerBackTitle: 'Back',
            headerBackButtonVisible: true,
          }} 
        />
        <Stack.Screen 
          name="space-members" 
          options={{ 
            title: 'Space Members',
            headerBackTitle: 'Back',
            headerBackButtonVisible: true,
            presentation: 'card', // 确保使用 card 模式，避免导航问题
          }} 
        />
        <Stack.Screen 
          name="management" 
          options={{ 
            title: 'Management',
            headerBackTitle: 'Home'
          }} 
        />
        <Stack.Screen 
          name="space-manage" 
          options={{ 
            title: 'Space Information'
          }} 
        />
        <Stack.Screen
          name="space-orders"
          options={{
            title: 'Subscription and billing',
            headerBackTitle: 'Back',
            headerBackButtonVisible: true,
          }}
        />
        <Stack.Screen 
          name="chat-to-log" 
          options={{ 
            title: 'Assistant',
            presentation: 'modal'
          }} 
        />
        <Stack.Screen 
          name="manual-entry" 
          options={{ 
            title: 'Add Expense',
            presentation: 'modal'
          }} 
        />
        <Stack.Screen 
          name="profile" 
          options={{ 
            title: 'Personal Information'
          }} 
        />
        <Stack.Screen 
          name="auth/confirm" 
          options={{ 
            headerShown: false
          }} 
        />
        <Stack.Screen 
          name="auth/setup" 
          options={{ 
            headerShown: false
          }} 
        />
        <Stack.Screen 
          name="auth/setup-sku-preview" 
          options={{ 
            title: 'Service preview',
            presentation: 'modal',
            headerBackTitle: 'Back',
          }} 
        />
        <Stack.Screen 
          name="invite/[id]" 
          options={{ 
            headerShown: false
          }} 
        />
        <Stack.Screen 
          name="handle-invitations" 
          options={{ 
            headerShown: false
          }} 
        />
        <Stack.Screen 
          name="setup-space" 
          options={{ 
            headerShown: false
          }} 
        />
      </Stack>
      )}
      </View>
      {showSidebar && !chatDisabled && chatOpen && (
        <ChatPanelErrorBoundary
          resetKey={`${pathnameForType ?? ''}:${chatTypeFromPathname(pathnameForType) ?? chatType ?? 'receipt'}`}
        >
          <WebChatPanel effectiveType={chatTypeFromPathname(pathnameForType) ?? chatType ?? 'receipt'} />
        </ChatPanelErrorBoundary>
      )}
      {showSidebar && !chatDisabled && !chatOpen && isDesktopWeb && pathname !== '/chat-to-log' && !pathname?.startsWith('/receipts') && !pathname?.startsWith('/receipt-items') && !pathname?.startsWith('/invoices') && !pathname?.startsWith('/receipt-details') && !pathname?.startsWith('/invoice-details') && !pathname?.startsWith('/inbound-details') && !pathname?.startsWith('/outbound-details') && !isSettingsPage(pathname ?? '') && (
        <WebChatFab type={chatTypeFromPathname(pathnameForType) ?? 'receipt'} />
      )}
      <ToastHost />
      <ConfirmModalHost />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  webRow: {
    flexDirection: 'row',
  },
  mainArea: {
    flex: 1,
    minWidth: 0,
  },
});

export default function RootLayout() {
  return (
    <ChatPanelProvider>
      <LayoutContent />
    </ChatPanelProvider>
  );
}