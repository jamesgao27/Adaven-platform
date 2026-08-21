import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { getCurrentSpace } from '@/lib/auth';
import {
  getFirmClientInviteHistory,
  setFirmClientInviteActive,
  deleteFirmClientInviteToken,
  buildFirmClientInviteUrl,
  createFirmClientInviteToken,
  type FirmClientInviteToken,
} from '@/lib/firm-clients';
import { getFirmSkus, type FirmSku } from '@/lib/firm';
import Constants from 'expo-constants';
import FirmOpenInviteHistoryTable from './FirmOpenInviteHistoryTable';

export default function FirmOpenInviteScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [firmSpaceId, setFirmSpaceId] = useState<string | null>(null);
  const [invites, setInvites] = useState<FirmClientInviteToken[]>([]);
  const [inviteSkus, setInviteSkus] = useState<FirmSku[]>([]);
  const [inviteHistoryError, setInviteHistoryError] = useState<string | null>(null);
  const [updatingInviteId, setUpdatingInviteId] = useState<string | null>(null);
  const [deletingInviteId, setDeletingInviteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!firmSpaceId) return;
    try {
      setInviteHistoryError(null);
      const [historyRes, allSkus] = await Promise.all([
        getFirmClientInviteHistory(firmSpaceId),
        inviteSkus.length === 0 ? getFirmSkus(firmSpaceId) : Promise.resolve(null),
      ]);
      if (historyRes.error) {
        setInviteHistoryError(historyRes.error.message);
        setInvites([]);
      } else {
        setInvites(historyRes.invites ?? []);
      }
      if (allSkus && Array.isArray(allSkus)) {
        setInviteSkus(allSkus);
      }
    } catch (e: any) {
      console.error('FirmOpenInviteScreen load error:', e);
      Alert.alert('Failed to load invites', e?.message ?? 'Please try again.');
    }
  }, [firmSpaceId, inviteSkus.length]);

  useEffect(() => {
    (async () => {
      try {
        const space = await getCurrentSpace(true);
        if (!space?.id || space.kind !== 'firm') {
          router.replace('/');
          return;
        }
        setFirmSpaceId(space.id);
      } catch (e) {
        console.error('FirmOpenInviteScreen space error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  useEffect(() => {
    if (firmSpaceId) {
      load();
    }
  }, [firmSpaceId, load]);

  const handleBack = () => {
    router.back();
  };

  const handleRefresh = async () => {
    if (!firmSpaceId) return;
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleCopyLink = async (invite: FirmClientInviteToken) => {
    if (!firmSpaceId) return;
    try {
      const url = await buildFirmClientInviteUrl(firmSpaceId, invite);
      Alert.alert('Invite link', url);
    } catch (e: any) {
      Alert.alert('Failed to copy link', e?.message ?? 'Please try again.');
    }
  };

  const handleOpenExistingInvite = (invite: FirmClientInviteToken) => {
    router.push({
      pathname: '/firm/clients/invite-new',
      params: { inviteId: invite.id },
    } as any);
  };

  const handleToggleActive = async (invite: FirmClientInviteToken) => {
    if (!firmSpaceId) return;
    try {
      setUpdatingInviteId(invite.id);
      const next = !invite.isActive;
      const { error } = await setFirmClientInviteActive(firmSpaceId, invite.id, next);
      if (error) throw error;
      setInvites((prev) =>
        prev.map((it) => (it.id === invite.id ? { ...it, isActive: next } : it)),
      );
    } catch (e: any) {
      Alert.alert('Failed to update invite', e?.message ?? 'Please try again.');
    } finally {
      setUpdatingInviteId(null);
    }
  };

  const handleDelete = (invite: FirmClientInviteToken) => {
    if (!firmSpaceId) return;
    Alert.alert(
      'Delete invite?',
      'This invite link will no longer work for clients.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingInviteId(invite.id);
              const { error } = await deleteFirmClientInviteToken(invite.id);
              if (error) throw error;
              setInvites((prev) => prev.filter((it) => it.id !== invite.id));
            } catch (e: any) {
              Alert.alert('Failed to delete invite', e?.message ?? 'Please try again.');
            } finally {
              setDeletingInviteId(null);
            }
          },
        },
      ],
    );
  };

  const handleCreateInviteFromHistory = () => {
    router.push('/firm/clients/invite-new');
  };

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
        <Text style={styles.headerTitle}>Open invite</Text>
        <TouchableOpacity
          onPress={handleRefresh}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color="#6C5CE7" />
          ) : (
            <Ionicons name="refresh" size={20} color="#636E72" />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {invites.length === 0 && !inviteHistoryError ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No invites yet</Text>
            <Text style={styles.emptySubtitle}>
              Create a new invite from the clients page to share with your clients.
            </Text>
          </View>
        ) : (
          <FirmOpenInviteHistoryTable
            invites={invites}
            inviteSkus={inviteSkus}
            loading={refreshing}
            error={inviteHistoryError}
            updatingInviteId={updatingInviteId}
            deletingInviteId={deletingInviteId}
            onRowPress={handleOpenExistingInvite}
            onToggleActive={handleToggleActive}
            onDelete={handleDelete}
            onCreateNewFromHistory={handleCreateInviteFromHistory}
          />
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
  emptyState: {
    marginTop: 48,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#636E72',
    textAlign: 'center',
  },
});

