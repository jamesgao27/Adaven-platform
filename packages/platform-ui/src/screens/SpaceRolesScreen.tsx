import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import {
  getCurrentUser,
  getSpaceMembers,
  leaveSpace,
  setSpaceMemberAdmin,
  type SpaceMember,
} from '@adaven/platform-core';
import { showToast } from '../lib/toast';
import { confirmDestructive } from '../lib/alertWeb';

export default function PermissionsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(async () => {
    const user = await getCurrentUser(true);
    if (!user) {
      router.replace('/login');
      return;
    }
    setCurrentUserId(user.id);
    const list = await getSpaceMembers();
    setMembers(list);
    setIsAdmin(list.find((m) => m.userId === user.id)?.isAdmin === true);
  }, [router]);

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Failed to load roles', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const onToggle = (member: SpaceMember, nextAdmin: boolean) => {
    confirmDestructive(
      nextAdmin ? 'Make Admin' : 'Make Member',
      nextAdmin
        ? `${member.name || member.email} will be able to invite, remove, and change roles.`
        : `${member.name || member.email} will lose admin access.`,
      async () => {
        const { error: roleError } = await setSpaceMemberAdmin(member.userId, nextAdmin);
        if (roleError) showToast(roleError.message, 'error');
        else await load();
      },
      { confirmLabel: 'Confirm' }
    );
  };

  const onLeave = () => {
    confirmDestructive(
      'Leave Space',
      'You will lose access to this space until invited again.',
      async () => {
        const { error } = await leaveSpace();
        if (error) {
          showToast(error.message, 'error');
          return;
        }
        router.replace('/setup-space');
      },
      { confirmLabel: 'Leave' }
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionTitle}>Roles</Text>
        <View style={styles.compactList}>
          <View style={styles.compactItem}>
            <View style={styles.compactNameEmail}>
              <Text style={styles.compactName}>Admin</Text>
              <Text style={styles.compactEmail}>
                Invite, cancel, remove members, change roles, and edit space profile.
              </Text>
            </View>
          </View>
          <View style={[styles.compactItem, styles.compactItemLast]}>
            <View style={styles.compactNameEmail}>
              <Text style={styles.compactName}>Member</Text>
              <Text style={styles.compactEmail}>
                View the team and leave the space. Cannot invite or change roles.
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>People</Text>
        {loading ? (
          <View style={styles.compactList}>
            <View style={[styles.compactItem, styles.compactItemLast]}>
              <ActivityIndicator size="small" color="#6C5CE7" />
              <Text style={styles.compactEmail}> Loading...</Text>
            </View>
          </View>
        ) : (
          <View style={styles.compactList}>
            {members.map((member, index) => {
              const isCurrentUser = member.userId === currentUserId;
              const isLast = index === members.length - 1;
              return (
                <View key={member.userId} style={[styles.compactItem, isLast && styles.compactItemLast]}>
                  <View style={styles.compactItemContent}>
                    <View style={styles.compactNameEmail}>
                      <Text style={styles.compactName}>{member.name || member.email.split('@')[0]}</Text>
                      <Text style={styles.compactEmail}>{member.email}</Text>
                    </View>
                    <View style={styles.compactBadges}>
                      {isCurrentUser ? (
                        <View style={styles.compactBadge}>
                          <Text style={styles.compactBadgeText}>You</Text>
                        </View>
                      ) : null}
                      {member.isAdmin ? (
                        <View style={[styles.compactBadge, styles.adminBadge]}>
                          <Text style={[styles.compactBadgeText, styles.adminBadgeText]}>Admin</Text>
                        </View>
                      ) : (
                        <View style={styles.compactBadge}>
                          <Text style={styles.compactBadgeText}>Member</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  {isAdmin && !isCurrentUser ? (
                    <TouchableOpacity
                      style={styles.compactActionButton}
                      onPress={() => onToggle(member, !member.isAdmin)}
                    >
                      <Ionicons
                        name={member.isAdmin ? 'person-outline' : 'shield-checkmark-outline'}
                        size={20}
                        color="#6C5CE7"
                      />
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        <TouchableOpacity style={styles.leaveButton} onPress={onLeave} activeOpacity={0.7}>
          <Ionicons name="exit-outline" size={20} color="#E74C3C" />
          <Text style={styles.leaveButtonText}>Leave Space</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#636E72',
    marginBottom: 4,
    marginTop: 8,
  },
  compactList: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    overflow: 'hidden',
    marginBottom: 16,
  },
  compactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  compactItemLast: { borderBottomWidth: 0 },
  compactItemContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  compactNameEmail: { flex: 1, marginRight: 12 },
  compactName: { fontSize: 15, fontWeight: '600', color: '#2D3436', marginBottom: 2 },
  compactEmail: { fontSize: 13, color: '#636E72' },
  compactBadges: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 12 },
  compactBadge: {
    backgroundColor: '#F0F4FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  compactBadgeText: { fontSize: 11, fontWeight: '600', color: '#6C5CE7' },
  adminBadge: { backgroundColor: '#FFF3E0' },
  adminBadgeText: { color: '#FF9800' },
  compactActionButton: { padding: 4, marginLeft: 8 },
  leaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#FFF5F5',
  },
  leaveButtonText: { fontSize: 16, fontWeight: '600', color: '#E74C3C' },
});
