"use client";

import { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

/** https://portalflow.pages.dev/client-join?token=... lands on the engagement setup. */
export default function ClientJoinScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = (typeof params.token === 'string' ? params.token : '').trim();

  useEffect(() => {
    if (token) {
      router.replace({ pathname: '/auth/setup', params: { token } });
    } else {
      router.replace('/');
    }
  }, [token, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#6C5CE7" />
      <Text style={styles.text}>Opening invite…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F8FC' },
  text: { marginTop: 12, color: '#636E72' },
});
