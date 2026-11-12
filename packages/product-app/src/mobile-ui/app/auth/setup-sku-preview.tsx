"use client";

import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { resolveSkuForPreview } from '../../../shared-logic/firm';
import type { FirmSku } from '@/types';
import SkuPreview from '../../components/SkuPreview';

/**
 * Standalone SKU preview page (same form as Chat-to-log: modal, full-screen).
 * Used from "Link your space with" header tap on mobile.
 */
export default function SetupSkuPreviewScreen() {
  const params = useLocalSearchParams<{
    skuId?: string;
    firmSpaceId?: string;
    firmClientId?: string;
    token?: string;
    orderId?: string;
  }>();
  const skuId = (params.skuId ?? '').trim();
  const firmSpaceId = (params.firmSpaceId ?? '').trim();
  const firmClientId = (params.firmClientId ?? '').trim();
  const inviteToken = (params.token ?? '').trim();
  const previewOrderId = (params.orderId ?? '').trim();

  const [sku, setSku] = useState<FirmSku | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!skuId) {
      setError('Missing service');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await resolveSkuForPreview(skuId, {
        firmClientId: firmClientId || null,
        inviteToken: inviteToken || null,
        orderId: previewOrderId || null,
      });
      if (data) {
        const skuObj: FirmSku = {
          id: skuId,
          firmSpaceId: firmSpaceId || undefined,
          name: data.name,
          description: data.description ?? undefined,
          imageUrl: data.imageUrl ?? null,
          isPublished: data.isPublished ?? false,
          templateStatus: data.templateStatus ?? undefined,
          itemsCount: undefined,
          taxCountry: data.taxCountry ?? null,
          taxScenario: data.taxScenario ?? null,
          createdAt: undefined,
          updatedAt: undefined,
        };
        setSku(skuObj);
      } else {
        setSku(null);
        setError('Service not found');
      }
    } catch {
      setError('Failed to load service');
      setSku(null);
    } finally {
      setLoading(false);
    }
  }, [skuId, firmSpaceId, firmClientId, inviteToken, previewOrderId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#6C5CE7" />
          <Text style={styles.loadingText}>Loading service…</Text>
        </View>
      </View>
    );
  }

  if (error || !sku) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error ?? 'Service not found'}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, Platform.OS !== 'web' && styles.containerMobile]}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          Platform.OS !== 'web' && styles.scrollContentMobile,
        ]}
        showsVerticalScrollIndicator={true}
      >
        <SkuPreview
          sku={sku}
          variant={Platform.OS === 'web' ? 'card' : 'mobile-full'}
          clientPreviewAuth={{
            firmClientId: firmClientId || undefined,
            inviteToken: inviteToken || undefined,
            orderId: previewOrderId || undefined,
          }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F1F5F9',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#636E72',
  },
  errorText: {
    fontSize: 15,
    color: '#636E72',
    textAlign: 'center',
  },
  containerMobile: {
    backgroundColor: '#FFFFFF',
  },
  scrollContentMobile: {
    paddingHorizontal: 0,
  },
});
