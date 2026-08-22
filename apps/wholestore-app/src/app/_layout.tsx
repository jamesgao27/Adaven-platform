import { Stack, usePathname } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import '../bootstrap';
import { ToastHost } from '@/components/ToastHost';
import { ConfirmModalHost } from '@/components/ConfirmModalHost';
import WebSidebar, { shouldShowWebSidebar } from '@/components/WebSidebar';

export default function RootLayout() {
  const pathname = usePathname() ?? '/';
  const showSidebar = Platform.OS === 'web' && shouldShowWebSidebar(pathname);

  return (
    <View style={[styles.root, showSidebar && styles.webRow]}>
      {showSidebar ? <WebSidebar /> : null}
      <View style={styles.main}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
          <Stack.Screen name="reset-password" />
          <Stack.Screen name="setup-space" />
          <Stack.Screen name="management" />
          <Stack.Screen
            name="space-members"
            options={{
              headerShown: Platform.OS !== 'web',
              title: 'Space Members',
              headerBackTitle: 'Back',
            }}
          />
          <Stack.Screen name="members" />
          <Stack.Screen
            name="permissions"
            options={{
              headerShown: Platform.OS !== 'web',
              title: 'Space roles',
              headerBackTitle: 'Back',
            }}
          />
          <Stack.Screen name="handle-invitations" />
          <Stack.Screen name="invite/[id]" />
          <Stack.Screen name="dealers/index" />
          <Stack.Screen name="dealers/[id]" />
          <Stack.Screen name="orders/index" />
          <Stack.Screen name="orders/[id]" />
          <Stack.Screen name="catalog/index" />
          <Stack.Screen name="catalog/[skuId]" />
        </Stack>
      </View>
      <ToastHost />
      <ConfirmModalHost />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  webRow: {
    flexDirection: 'row',
  },
  main: {
    flex: 1,
    minWidth: 0,
  },
});
