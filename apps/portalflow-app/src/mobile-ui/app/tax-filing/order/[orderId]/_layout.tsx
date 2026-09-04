/**
 * 订单/项目详情：Stack 内两页
 * - index: 顶栏为页面顶栏（由 index 内 setOptions 设为项目名），避免显示路径 "tax-filing/order/[orderId]"
 * - info: 项目信息
 * 附件详情已改为大浮窗（FileDetailModal），不再单独路由。
 *
 * iOS：须与 tax-filing/project/[projectId]/_layout 一致关闭过渡与 freeze，否则嵌套 RNSScreen 易 SIGABRT
 * （client 经本路由进入时无 projectId；firm 侧 firm/engagement 为根 Stack 单屏，不经过此嵌套 Stack）。
 */
import { Stack } from 'expo-router';
import { Platform } from 'react-native';
import { getWebStackHeaderLeftScreenOptions } from '../../../../lib/web-stack-header-left';

const orderStackIosSafe =
  Platform.OS === 'ios'
    ? {
        animation: 'none' as any,
        freezeOnBlur: false as any,
      }
    : {};

export default function OrderDetailLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackButtonVisible: true,
        ...orderStackIosSafe,
        ...getWebStackHeaderLeftScreenOptions(),
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: '', headerTitle: '' }}
      />
      <Stack.Screen name="info" />
    </Stack>
  );
}
