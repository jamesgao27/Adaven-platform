'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { getCurrentUser } from '@/lib/auth';
import { getPendingInviteesForEmail, type PendingInviteeForClaim } from '@/lib/firm-clients';

export default function ClaimEngagementScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [list, setList] = useState<PendingInviteeForClaim[]>([]);
  const [errorMessage, setErrorMessage] = useState('');

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    if (!user?.email) {
      setStatus('error');
      setErrorMessage('Please sign in to claim engagements.');
      return;
    }
    const { list: pending, error } = await getPendingInviteesForEmail(user.email);
    if (error) {
      setStatus('error');
      setErrorMessage(error.message);
      return;
    }
    setList(pending);
    setStatus('ready');
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Single pending: go straight to setup (reuse full page)
  useEffect(() => {
    if (status !== 'ready' || list.length !== 1) return;
    router.replace({ pathname: '/auth/setup', params: { firmClientId: list[0].firmClientId } });
  }, [status, list, router]);

  if (status === 'loading') {
    return (
      <View style={[styles.center, Platform.OS === 'web' && styles.centerWeb]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color="#6C5CE7" />
        <Text style={styles.message}>Checking for pending engagements...</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={[styles.container, Platform.OS === 'web' && styles.containerWebCenter]}>
        <StatusBar style="dark" />
        <View style={Platform.OS === 'web' ? styles.cardWrapWeb : undefined}>
          <Text style={styles.error}>{errorMessage}</Text>
          <TouchableOpacity style={styles.button} onPress={() => router.replace('/')}>
            <Text style={styles.buttonText}>Go to Home</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Single: redirect runs in useEffect; show short message to avoid list flash
  if (list.length === 1) {
    return (
      <View style={[styles.center, Platform.OS === 'web' && styles.centerWeb]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color="#6C5CE7" />
        <Text style={styles.message}>Redirecting...</Text>
      </View>
    );
  }

  if (list.length === 0) {
    return (
      <View style={[styles.container, Platform.OS === 'web' && styles.containerWebCenter]}>
        <StatusBar style="dark" />
        <View style={Platform.OS === 'web' ? styles.cardWrapWeb : styles.cardWrap}>
          <Text style={styles.empty}>No pending engagements for your email.</Text>
          <TouchableOpacity style={styles.button} onPress={() => router.replace('/')}>
            <Text style={styles.buttonText}>Go to Home</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Multiple: show list; tap → /auth/setup?firmClientId=...
  const listContent = (
    <>
      <Text style={styles.title}>Claim your engagement</Text>
      <Text style={styles.subtitle}>
        You have pending engagement(s) from firms. Select one to link your space and start.
      </Text>
      {list.map((inv) => (
        <TouchableOpacity
          key={inv.firmClientId}
          style={styles.card}
          onPress={() =>
            router.replace({ pathname: '/auth/setup', params: { firmClientId: inv.firmClientId } })
          }
        >
          <Text style={styles.cardTitle}>{inv.firmName || 'Firm'}</Text>
          {(inv.inviteeClientName || inv.inviteeContactEmail) && (
            <Text style={styles.cardSub}>{inv.inviteeClientName || inv.inviteeContactEmail}</Text>
          )}
          <Text style={styles.claimCta}>Tap to link your space →</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={styles.backButton} onPress={() => router.replace('/')}>
        <Text style={styles.backButtonText}>Back to Home</Text>
      </TouchableOpacity>
    </>
  );

  return (
    <View style={[styles.container, Platform.OS === 'web' && styles.containerWeb]}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={[styles.scroll, Platform.OS === 'web' && styles.scrollWeb]}
        keyboardShouldPersistTaps="handled"
      >
        {Platform.OS === 'web' ? <View style={styles.cardWrapWeb}>{listContent}</View> : listContent}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F5F9', padding: 20 },
  containerWeb: { flex: 1, backgroundColor: '#F1F5F9' },
  containerWebCenter: { flex: 1, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', padding: 20 },
  centerWeb: { backgroundColor: '#F1F5F9' },
  scroll: { paddingBottom: 40 },
  scrollWeb: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48, alignItems: 'center' },
  message: { marginTop: 16, fontSize: 16, color: '#666' },
  error: { fontSize: 16, color: '#c0392b', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#2D3436', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#636E72', marginBottom: 24 },
  empty: { fontSize: 15, color: '#636E72', marginBottom: 20 },
  card: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  cardTitle: { fontSize: 17, fontWeight: '600', color: '#2D3436' },
  cardSub: { fontSize: 14, color: '#636E72', marginTop: 4 },
  claimCta: { fontSize: 14, color: '#6C5CE7', marginTop: 8, fontWeight: '500' },
  button: { backgroundColor: '#6C5CE7', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  backButton: { marginTop: 24, alignItems: 'center' },
  backButtonText: { fontSize: 15, color: '#6C5CE7' },
  cardWrap: { padding: 20 },
  cardWrapWeb: { width: '100%', maxWidth: 448, alignSelf: 'center' },
});
