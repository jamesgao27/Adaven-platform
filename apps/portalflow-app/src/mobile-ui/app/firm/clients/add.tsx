import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { getCurrentSpace } from '@/lib/auth';
import { getFirmSkus, createPendingOrderForInvitee, createInviteeOnly } from '@/lib/firm';
import type { FirmSku } from '@/lib/firm';

export default function FirmAddClientScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [firmSpaceId, setFirmSpaceId] = useState<string | null>(null);
  const [skus, setSkus] = useState<FirmSku[]>([]);
  const [clientName, setClientName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [selectedSkuId, setSelectedSkuId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const space = await getCurrentSpace(true);
        if (!space?.id || space.kind !== 'provider') {
          router.replace('/');
          return;
        }
        setFirmSpaceId(space.id);
        const all = await getFirmSkus(space.id);
        const filtered = all.filter((s) =>
          s.templateStatus != null
            ? s.templateStatus !== 'draft'
            : s.isPublished === true || !!s.taxCountry || !!s.taxScenario
        );
        setSkus(filtered);
        setSelectedSkuId(filtered.length ? filtered[0].id : null);
      } catch (e) {
        console.error('FirmAddClientScreen load error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const handleBack = () => {
    router.back();
  };

  const handleSubmit = useCallback(async () => {
    if (!firmSpaceId) return;
    const email = (contactEmail || '').trim().toLowerCase();
    if (!email) {
      Alert.alert(
        'Contact email required',
        'Contact email is required so the client can claim this engagement later.'
      );
      return;
    }

    setSubmitting(true);
    let error: Error | null = null;
    try {
      if (selectedSkuId) {
        const { error: err } = await createPendingOrderForInvitee(firmSpaceId, {
          clientName: clientName.trim(),
          contactName: contactName.trim(),
          contactEmail: email,
          skuId: selectedSkuId,
        });
        error = err;
      } else {
        const { error: err } = await createInviteeOnly(firmSpaceId, {
          clientName: clientName.trim(),
          contactName: contactName.trim(),
          contactEmail: email,
        });
        error = err;
      }
    } catch (e: any) {
      error = e;
    }
    setSubmitting(false);

    if (error) {
      Alert.alert('Failed to add client', error.message);
      return;
    }

    Alert.alert(
      'Client saved',
      selectedSkuId
        ? 'Pending engagement created.'
        : 'Client saved. They can link their space when they sign in.',
      [{ text: 'OK', onPress: () => router.back() }]
    );
  }, [firmSpaceId, selectedSkuId, clientName, contactName, contactEmail, router]);

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color="#6C5CE7" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={24} color="#2D3436" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add client</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.field}>
          <Text style={styles.label}>Client name</Text>
          <TextInput
            style={styles.input}
            placeholder="Company or client name"
            placeholderTextColor="#95A5A6"
            value={clientName}
            onChangeText={setClientName}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Contact name</Text>
          <TextInput
            style={styles.input}
            placeholder="Contact person name"
            placeholderTextColor="#95A5A6"
            value={contactName}
            onChangeText={setContactName}
            autoCapitalize="words"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Contact email *</Text>
          <TextInput
            style={styles.input}
            placeholder="email@example.com"
            placeholderTextColor="#95A5A6"
            value={contactEmail}
            onChangeText={setContactEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.field}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={styles.label}>Service template</Text>
            {selectedSkuId ? (
              <TouchableOpacity
                style={styles.previewPill}
                onPress={() =>
                  router.push({
                    pathname: '/auth/setup-sku-preview',
                    params: { skuId: selectedSkuId },
                  } as any)
                }
                activeOpacity={0.7}
              >
                <Ionicons name="eye-outline" size={14} color="#6C5CE7" />
                <Text style={styles.previewPillText}>Preview</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {skus.length === 0 ? (
            <View style={[styles.select, styles.selectDisabled]}>
              <Text style={styles.selectPlaceholder}>
                Configure Service Catalog in the Firm module first.
              </Text>
            </View>
          ) : (
            <View style={styles.selectWrapper}>
              {skus.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[
                    styles.selectOption,
                    selectedSkuId === s.id && styles.selectOptionSelected,
                  ]}
                  onPress={() => setSelectedSkuId(s.id)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.selectOptionText,
                      selectedSkuId === s.id && styles.selectOptionTextSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {s.name}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[
                  styles.selectOption,
                  !selectedSkuId && styles.selectOptionSelected,
                ]}
                onPress={() => setSelectedSkuId(null)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.selectOptionText,
                    !selectedSkuId && styles.selectOptionTextSelected,
                  ]}
                  numberOfLines={1}
                >
                  Create client only (no template)
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.cancelButton} onPress={handleBack} activeOpacity={0.7}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmButton, submitting && { opacity: 0.7 }]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.8}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark" size={24} color="#fff" />
              <Text style={styles.confirmButtonText}>Confirm</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F1F3F5',
    ...(Platform.OS !== 'web' && {
      paddingTop: (Constants.statusBarHeight ?? 20) + 8,
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 52 : 24,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '600',
    color: '#2D3436',
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 120,
  },
  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: { marginTop: 8, fontSize: 14, color: '#636E72' },
  subtitle: {
    fontSize: 14,
    color: '#636E72',
    marginBottom: 16,
  },
  field: { marginBottom: 16 },
  label: { fontSize: 13, color: '#636E72', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#2D3436',
    backgroundColor: '#FFFFFF',
  },
  selectWrapper: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  select: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  selectDisabled: {
    backgroundColor: '#F5F5F5',
  },
  selectPlaceholder: {
    fontSize: 13,
    color: '#95A5A6',
  },
  selectOption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectOptionSelected: {
    backgroundColor: '#F3F4FF',
  },
  selectOptionText: {
    fontSize: 14,
    color: '#2D3436',
  },
  selectOptionTextSelected: {
    color: '#6C5CE7',
    fontWeight: '600',
  },
  previewPill: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#F3F4FF',
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewPillText: {
    marginLeft: 4,
    fontSize: 11,
    fontWeight: '500',
    color: '#6C5CE7',
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 8,
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.11,
    shadowRadius: 10,
    ...(Platform.OS === 'android'
      ? { elevation: 0, borderWidth: 1, borderColor: 'rgba(0,0,0,0.14)' }
      : { elevation: 3 }),
  },
  cancelButtonText: {
    fontSize: 16,
    color: '#636E72',
    fontWeight: '600',
  },
  confirmButton: {
    flex: 1,
    backgroundColor: '#6C5CE7',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    ...(Platform.OS === 'android'
      ? { elevation: 0, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' }
      : { elevation: 4 }),
  },
  confirmButtonText: {
    marginLeft: 8,
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
});

