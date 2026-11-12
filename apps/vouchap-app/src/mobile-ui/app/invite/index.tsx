"use client";

import { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, InteractionManager } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';

/**
 * Handles deep link: portalflow://invite?token=xxx (from client-join QR / "Open App").
 * Redirects to /auth/setup with the same token so the "Link your space with" flow runs.
 */
export default function InviteIndexScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = (params.token ?? '').trim();

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      if (token) {
        router.replace({ pathname: '/auth/setup', params: { token } });
      } else {
        router.replace('/');
      }
    });

    return () => {
      task.cancel();
    };
  }, [token, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#6C5CE7" />
      <Text style={styles.text}>Opening invite…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    gap: 12,
  },
  text: {
    fontSize: 15,
    color: '#636E72',
  },
});
