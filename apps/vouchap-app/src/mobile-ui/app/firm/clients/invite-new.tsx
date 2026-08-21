import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

import { getCurrentSpace } from '@/lib/auth';
import {
  createFirmClientInviteToken,
  buildFirmClientInviteUrl,
  getFirmClientInviteHistory,
  type FirmClientInviteToken,
} from '@/lib/firm-clients';
import { getFirmSkus, type FirmSku } from '@/lib/firm';

export default function FirmInviteNewClientsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ inviteId?: string | string[] }>();
  const rawInviteId = params.inviteId;
  const existingInviteId =
    typeof rawInviteId === 'string'
      ? rawInviteId
      : Array.isArray(rawInviteId)
      ? rawInviteId[0]
      : undefined;
  const [loading, setLoading] = useState(true);
  const [firmSpaceId, setFirmSpaceId] = useState<string | null>(null);
  const [firmSpaceName, setFirmSpaceName] = useState<string | null>(null);
  const [inviteSkus, setInviteSkus] = useState<FirmSku[]>([]);
  const [inviteSkuId, setInviteSkuId] = useState<string | null>(null);
  const [inviteExpiresInDays, setInviteExpiresInDays] = useState<number | null>(7);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const qrRef = useRef<QRCode | null>(null);
  const [existingInvite, setExistingInvite] = useState<FirmClientInviteToken | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const space = await getCurrentSpace(true);
        if (!space?.id || space.kind !== 'firm') {
          router.replace('/');
          return;
        }
        setFirmSpaceId(space.id);
        // @ts-expect-error: space 通常包含 name
        setFirmSpaceName(space.name ?? null);

        const skus = await getFirmSkus(space.id);
        const filtered = Array.isArray(skus)
          ? skus.filter((s) =>
              s.templateStatus != null
                ? s.templateStatus !== 'draft'
                : s.isPublished === true || !!s.taxCountry || !!s.taxScenario,
            )
          : [];
        setInviteSkus(filtered);

        if (existingInviteId) {
          const historyRes = await getFirmClientInviteHistory(space.id);
          if (!historyRes.error && Array.isArray(historyRes.invites)) {
            const found =
              historyRes.invites.find((it) => it.id === existingInviteId) ?? null;
            if (found) {
              setExistingInvite(found);
              const url = await buildFirmClientInviteUrl(space.id, found);
              setInviteLink(url);
              // 绑定 Step1 / Step2 展示用的选中值
              if (found.skuId) {
                setInviteSkuId(found.skuId);
              }
              // 只用于展示，选择 pill 时不再允许修改
              if (found.expiresAt == null) {
                setInviteExpiresInDays(null);
              }
            }
          }
        } else if (filtered.length > 0) {
          setInviteSkuId(filtered[0].id);
        }
      } catch (e: any) {
        console.error('FirmInviteNewClientsScreen init error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [router, existingInviteId]);

  const handleBack = () => {
    router.back();
  };

  const handleCreateInvite = useCallback(async () => {
    if (!firmSpaceId || !inviteSkuId) return;
    setInviteLoading(true);
    setInviteError(null);
    try {
      const { token, url, error } = await createFirmClientInviteToken(
        firmSpaceId,
        inviteSkuId,
        inviteExpiresInDays ?? undefined,
      );
      setInviteLoading(false);
      if (error || !token) {
        setInviteError(error?.message || 'Failed to create invite. Please try again.');
        return;
      }
      const linkUrl = url || buildFirmClientInviteUrl(token, firmSpaceName ?? undefined);
      setInviteLink(linkUrl);
    } catch (e: any) {
      setInviteLoading(false);
      setInviteError(e?.message ?? 'Failed to create invite. Please try again.');
    }
  }, [firmSpaceId, inviteSkuId, inviteExpiresInDays, firmSpaceName]);

  const handleCopyInviteLink = useCallback(async () => {
    if (!inviteLink) return;
    if (typeof window !== 'undefined' && (navigator as any)?.clipboard) {
      try {
        await (navigator as any).clipboard.writeText(inviteLink);
      } catch {
        // ignore
      }
    }
  }, [inviteLink]);

  const handleDownloadInviteQr = useCallback(() => {
    if (!inviteLink || !qrRef.current) return;
    if (Platform.OS !== 'web') {
      if (typeof window !== 'undefined') {
        window.alert('Download the QR code on desktop, or take a screenshot on mobile.');
      }
      return;
    }
    try {
      qrRef.current.toDataURL((data: string) => {
        const a = document.createElement('a');
        a.href = `data:image/png;base64,${data}`;
        a.download = 'vouchap-client-invite-qr.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
    } catch {
      // ignore
    }
  }, [inviteLink]);

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
        <TouchableOpacity
          onPress={handleBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={24} color="#2D3436" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Invite new clients</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.introBlock}>
          {existingInviteId ? (
            <Text style={styles.subtitle}>
              Review this invite link and share it with your clients.
            </Text>
          ) : (
            <Text style={styles.subtitle}>
              Step 1: choose a Service Template for this engagement.{'\n'}Step 2: configure
              invite expiry and share the link / QR.
            </Text>
          )}
        </View>

        <View>
          <View style={{ marginTop: 24 }}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Step 1 · Select Service Template</Text>
              {inviteSkuId && (
                <TouchableOpacity
                  style={styles.previewPill}
                  onPress={() =>
                    router.push({
                      pathname: '/auth/setup-sku-preview',
                      params: { skuId: inviteSkuId },
                    } as any)
                  }
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="eye-outline"
                    size={14}
                    color="#6C5CE7"
                    style={{ marginRight: 4 }}
                  />
                  <Text style={styles.previewPillText}>Preview</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.skuList}>
              {inviteSkus.map((sku) => (
                <TouchableOpacity
                  key={sku.id}
                  style={[
                    styles.skuRow,
                    inviteSkuId === sku.id && styles.skuRowSelected,
                  ]}
                  onPress={
                    existingInviteId ? undefined : () => setInviteSkuId(sku.id)
                  }
                  activeOpacity={existingInviteId ? 1 : 0.7}
                >
                  <Text
                    style={[
                      styles.skuName,
                      inviteSkuId === sku.id && styles.skuNameSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {sku.name}
                  </Text>
                </TouchableOpacity>
              ))}
              {inviteSkus.length === 0 && (
                <Text style={styles.hintText}>
                  Please configure Service Catalog in the Firm module first.
                </Text>
              )}
            </View>
          </View>

          <View style={{ marginTop: 24 }}>
            <Text style={styles.sectionTitle}>Step 2 · Expiry setting</Text>
            <View style={styles.expiryRow}>
              <View style={styles.expiryPills}>
                {[
                  { label: '7 days', value: 7 },
                  { label: '30 days', value: 30 },
                  { label: 'No expiry', value: null },
                ].map((opt) => (
                  <TouchableOpacity
                    key={String(opt.value ?? 'forever')}
                    style={[
                      styles.pill,
                      inviteExpiresInDays === opt.value && styles.pillSelected,
                    ]}
                    onPress={
                      existingInviteId
                        ? undefined
                        : () => setInviteExpiresInDays(opt.value)
                    }
                    activeOpacity={existingInviteId ? 1 : 0.7}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        inviteExpiresInDays === opt.value && styles.pillTextSelected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {!existingInviteId && (
                <TouchableOpacity
                  style={[
                    styles.primaryBtn,
                    (!inviteSkuId || inviteLoading) && styles.primaryBtnDisabled,
                  ]}
                  onPress={handleCreateInvite}
                  disabled={!inviteSkuId || inviteLoading}
                  activeOpacity={0.8}
                >
                  {inviteLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons
                      name="link-outline"
                      size={18}
                      color="#fff"
                      style={{ marginRight: 8 }}
                    />
                  )}
                  <Text style={styles.primaryBtnText}>
                    {inviteLoading ? 'Generating...' : 'Generate invite link'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {!existingInviteId && inviteError && (
              <Text style={styles.errorText}>{inviteError}</Text>
            )}
          </View>
        </View>

        {inviteLink && (
          <View style={styles.resultBlock}>
            <View style={styles.qrBox}>
              <QRCode
                value={inviteLink}
                size={140}
                getRef={(c) => {
                  // @ts-expect-error: ref 类型兼容
                  qrRef.current = c;
                }}
              />
              {Platform.OS === 'web' && (
                <TouchableOpacity
                  style={[styles.secondaryBtn, { marginTop: 8 }]}
                  onPress={handleDownloadInviteQr}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="download-outline"
                    size={16}
                    color="#6C5CE7"
                    style={{ marginRight: 4 }}
                  />
                  <Text style={styles.secondaryBtnText}>Download QR</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.linkBlock}>
              <Text style={styles.linkLabel}>Invite link</Text>
              <View style={styles.linkBox}>
                <Text style={styles.linkText} numberOfLines={4}>
                  {inviteLink}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.copyBtn}
                onPress={handleCopyInviteLink}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="copy-outline"
                  size={16}
                  color="#6C5CE7"
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.copyBtnText}>Copy link</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
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
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F1F3F5',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2D3436',
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 80,
  },
  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    color: '#636E72',
  },
  introBlock: {
    marginTop: 8,
  },
  subtitle: {
    fontSize: 13,
    color: '#636E72',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  skuList: {
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#DFE6E9',
  },
  skuRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ECF0F1',
  },
  skuRowSelected: {
    backgroundColor: '#EAEAFF',
  },
  skuName: {
    fontSize: 14,
    color: '#2D3436',
  },
  skuNameSelected: {
    fontWeight: '600',
    color: '#6C5CE7',
  },
  hintText: {
    fontSize: 13,
    color: '#95A5A6',
    padding: 12,
    textAlign: 'center',
  },
  expiryRow: {
    marginTop: 8,
  },
  expiryPills: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D0D4D8',
    marginRight: 8,
  },
  pillSelected: {
    backgroundColor: '#6C5CE7',
    borderColor: '#6C5CE7',
  },
  pillText: {
    fontSize: 13,
    color: '#636E72',
  },
  pillTextSelected: {
    color: '#fff',
    fontWeight: '500',
  },
  primaryBtn: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#6C5CE7',
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#fff',
  },
  errorText: {
    marginTop: 8,
    fontSize: 13,
    color: '#E17055',
  },
  resultBlock: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  qrBox: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    marginRight: 12,
  },
  linkBlock: {
    flex: 1,
  },
  linkLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#636E72',
    marginBottom: 4,
  },
  linkBox: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#DFE6E9',
    backgroundColor: '#fff',
    padding: 8,
    marginBottom: 8,
  },
  linkText: {
    fontSize: 13,
    color: '#2D3436',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#EAEAFF',
  },
  copyBtnText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6C5CE7',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#EAEAFF',
  },
  secondaryBtnText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6C5CE7',
  },
  previewPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#EAEAFF',
  },
  previewPillText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6C5CE7',
  },
});

