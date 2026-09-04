/**
 * 项目详情（client 侧以 project 为主体）：Stack 内两页
 * - index: 顶栏为页面顶栏（由 index 内 setOptions 设为项目名），避免显示路径 "tax-filing/project/[projectId]"
 * - info: 项目信息
 * 附件详情已改为大浮窗（FileDetailModal），不再单独路由。
 */
import { Stack } from 'expo-router';
import { getWebStackHeaderLeftScreenOptions } from '../../../../lib/web-stack-header-left';

export default function ProjectDetailLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackButtonVisible: true,
        // 避免 iOS 生产环境下 RNSScreen 冻结/快照阶段触发原生 SIGABRT
        animation: 'none' as any,
        freezeOnBlur: false as any,
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
