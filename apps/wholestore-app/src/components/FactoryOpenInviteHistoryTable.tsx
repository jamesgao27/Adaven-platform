import React from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import type { DealerInviteToken } from '@/lib/dealer-invites';
import type { ProviderPoster } from '@/lib/posters';

type Props = {
  invites: DealerInviteToken[];
  invitePosters: ProviderPoster[];
  loading: boolean;
  error: string | null;
  updatingInviteId: string | null;
  deletingInviteId: string | null;
  onRowPress: (row: DealerInviteToken) => void;
  onToggleActive: (row: DealerInviteToken) => void;
  onDelete: (row: DealerInviteToken) => void;
  onCreateNewFromHistory?: () => void;
};

export default function FactoryOpenInviteHistoryTable({
  invites,
  invitePosters,
  loading,
  error,
  updatingInviteId,
  deletingInviteId,
  onRowPress,
  onToggleActive,
  onDelete,
  onCreateNewFromHistory,
}: Props) {
  const isWeb = Platform.OS === 'web';

  const renderRow = (row: DealerInviteToken, compact: boolean) => {
    const createdAt = row.createdAt ? new Date(row.createdAt) : null;
    const expiresAt = row.expiresAt ? new Date(row.expiresAt) : null;
    const expired = !!expiresAt && expiresAt <= new Date();
    const reachedMax = row.maxDealers != null && row.currentDealers >= row.maxDealers;
    const isValid = row.isActive && !expired && !reachedMax;
    const inviterDisplay =
      row.inviterName?.trim() || row.inviterEmail || (row.inviterUserId ? `${row.inviterUserId.slice(0, 6)}…` : '—');
    const posterName = invitePosters.find((p) => p.id === row.posterId)?.name ?? '—';
    return (
      <TouchableOpacity
        key={row.id}
        style={[styles.inviteSkuRow, styles.inviteHistoryRow]}
        activeOpacity={0.7}
        onPress={() => onRowPress(row)}
      >
        <View style={compact ? styles.inviteHistoryColServiceMobile : styles.inviteHistoryColService}>
          <Text style={styles.inviteHistoryCellText} numberOfLines={1}>
            {posterName}
          </Text>
        </View>
        {!compact ? (
          <View style={styles.inviteHistoryColExpiry}>
            <Text style={styles.inviteHistoryCellText} numberOfLines={1}>
              {expiresAt ? format(expiresAt, 'MMM dd, yyyy') : 'No expiry'}
            </Text>
          </View>
        ) : null}
        <View style={compact ? styles.inviteHistoryColActiveMobile : styles.inviteHistoryColActive}>
          <TouchableOpacity
            style={[styles.inviteHistoryActivePill, !isValid && styles.inviteHistoryActivePillInactive]}
            activeOpacity={0.7}
            onPress={(e) => {
              // @ts-expect-error RN web
              e?.stopPropagation?.();
              onToggleActive(row);
            }}
          >
            <Text style={styles.inviteHistoryActiveText}>{isValid ? 'Active' : 'Inactive'}</Text>
            {updatingInviteId === row.id ? (
              <View style={styles.inviteHistoryActiveSpinner}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            ) : null}
          </TouchableOpacity>
        </View>
        {!compact ? (
          <View style={styles.inviteHistoryColJoined}>
            <Text style={[styles.inviteHistoryCellText, { textAlign: 'right' }]} numberOfLines={1}>
              {row.currentDealers}
              {row.maxDealers ? ` / ${row.maxDealers}` : ''}
            </Text>
          </View>
        ) : null}
        <View style={compact ? styles.inviteHistoryColInitiatorMobile : styles.inviteHistoryColInitiator}>
          <Text style={[styles.inviteHistoryCellText, styles.inviteHistoryCellTextRight]} numberOfLines={1}>
            {inviterDisplay}
          </Text>
        </View>
        {!compact ? (
          <View style={styles.inviteHistoryColCreated}>
            <Text style={[styles.inviteHistoryCellText, { textAlign: 'right' }]} numberOfLines={1}>
              {createdAt ? format(createdAt, 'MMM dd, yyyy') : '—'}
            </Text>
          </View>
        ) : null}
        <View style={styles.inviteHistoryColAction}>
          <TouchableOpacity
            style={styles.inviteHistoryDeleteBtn}
            onPress={(e) => {
              // @ts-expect-error RN web
              e?.stopPropagation?.();
              onDelete(row);
            }}
            disabled={deletingInviteId === row.id}
            activeOpacity={0.7}
          >
            {deletingInviteId === row.id ? (
              <ActivityIndicator size="small" color="#E17055" />
            ) : (
              <Ionicons name="trash-outline" size={18} color="#E17055" />
            )}
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.inviteHistoryContainer}>
      <View style={styles.inviteHeader}>
        <Text style={styles.inviteSubtitle}>
          Review all open invites sent by this factory, including initiator, poster, expiry and how many
          dealer spaces joined.
        </Text>
      </View>
      {loading ? (
        <View style={{ paddingVertical: 24, alignItems: 'center' }}>
          <ActivityIndicator size="small" color="#6C5CE7" />
        </View>
      ) : (
        <View style={styles.inviteHistoryBodyWrap}>
          <View style={[styles.inviteHistoryTable, styles.inviteHistoryTableOuter]}>
            <View style={[styles.inviteSkuHeaderRow, styles.inviteHistoryHeaderRow]}>
              <View style={isWeb ? styles.inviteHistoryColService : styles.inviteHistoryColServiceMobile}>
                <Text style={styles.inviteSkuHeaderText}>Poster</Text>
              </View>
              {isWeb ? (
                <View style={styles.inviteHistoryColExpiry}>
                  <Text style={styles.inviteSkuHeaderText}>Expiry</Text>
                </View>
              ) : null}
              <View style={isWeb ? styles.inviteHistoryColActive : styles.inviteHistoryColActiveMobile}>
                <Text style={[styles.inviteSkuHeaderText, { textAlign: 'center' }]}>Active</Text>
              </View>
              {isWeb ? (
                <View style={styles.inviteHistoryColJoined}>
                  <Text style={[styles.inviteSkuHeaderText, { textAlign: 'right' }]}>Joined</Text>
                </View>
              ) : null}
              <View style={isWeb ? styles.inviteHistoryColInitiator : styles.inviteHistoryColInitiatorMobile}>
                <Text style={[styles.inviteSkuHeaderText, { textAlign: 'right' }]}>Initiator</Text>
              </View>
              {isWeb ? (
                <View style={styles.inviteHistoryColCreated}>
                  <Text style={[styles.inviteSkuHeaderText, { textAlign: 'right' }]}>Created at</Text>
                </View>
              ) : null}
              <View style={styles.inviteHistoryColAction}>
                <Text style={[styles.inviteSkuHeaderText, { textAlign: 'center' }]} />
              </View>
            </View>
            <ScrollView
              style={styles.inviteHistoryTableBodyScroll}
              contentContainerStyle={styles.inviteHistoryTableBodyContent}
              showsVerticalScrollIndicator
            >
              {invites.map((row) => renderRow(row, !isWeb))}
            </ScrollView>
            {!loading && invites.length === 0 && !error ? (
              <View style={styles.inviteHistoryEmptyWrap}>
                <Text style={styles.inviteHintText}>No invite history yet.</Text>
              </View>
            ) : null}
          </View>
          {error ? <Text style={[styles.inviteErrorText, { marginTop: 8 }]}>{error}</Text> : null}
          {onCreateNewFromHistory ? (
            <View style={styles.inviteHistoryFooter}>
              <TouchableOpacity style={styles.inviteButton} onPress={onCreateNewFromHistory} activeOpacity={0.7}>
                <Ionicons name="add-circle-outline" size={18} color="#6C5CE7" style={{ marginRight: 4 }} />
                <Text style={styles.inviteButtonText}>Generate a new invite</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inviteHistoryContainer: { flex: 1, paddingVertical: 12 },
  inviteHeader: { marginBottom: 12 },
  inviteSubtitle: { fontSize: 13, color: '#636E72' },
  inviteHistoryBodyWrap: {},
  inviteHistoryTable: {
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#DFE6E9',
  },
  inviteHistoryTableOuter: { maxHeight: 720 },
  inviteSkuHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DFE6E9',
    backgroundColor: '#F8F9FA',
  },
  inviteHistoryHeaderRow: {},
  inviteHistoryColService: { flex: 2.4, paddingRight: 8 },
  inviteHistoryColExpiry: { flex: 1.4, paddingRight: 8 },
  inviteHistoryColActive: { width: 96, alignItems: 'center' },
  inviteHistoryColJoined: { width: 96, alignItems: 'flex-end' },
  inviteHistoryColInitiator: { flex: 1.6, alignItems: 'flex-end', paddingLeft: 8 },
  inviteHistoryColCreated: { flex: 1.4, alignItems: 'flex-end', paddingLeft: 8 },
  inviteHistoryColAction: { width: 40, alignItems: 'flex-end' },
  inviteSkuHeaderText: { fontSize: 12, fontWeight: '600', color: '#636E72' },
  inviteHistoryTableBodyScroll: {},
  inviteHistoryTableBodyContent: { paddingBottom: 0 },
  inviteSkuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ECF0F1',
  },
  inviteHistoryRow: { backgroundColor: '#fff' },
  inviteHistoryCellText: { fontSize: 13, color: '#2D3436' },
  inviteHistoryCellTextRight: { textAlign: 'right' },
  inviteHistoryActivePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#00C9A7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteHistoryActivePillInactive: { backgroundColor: '#E67E4A' },
  inviteHistoryActiveText: { fontSize: 11, fontWeight: '500', color: '#FFFFFF' },
  inviteHistoryActiveSpinner: { marginLeft: 6 },
  inviteHistoryDeleteBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FDEDEC',
  },
  inviteHistoryEmptyWrap: { paddingVertical: 24, alignItems: 'center' },
  inviteHintText: { fontSize: 13, color: '#95A5A6' },
  inviteErrorText: { fontSize: 13, color: '#E17055' },
  inviteHistoryFooter: { marginTop: 8, alignItems: 'flex-start' },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#EAEAFF',
  },
  inviteButtonText: { fontSize: 13, fontWeight: '500', color: '#6C5CE7' },
  inviteHistoryColServiceMobile: { flex: 1, paddingRight: 4 },
  inviteHistoryColActiveMobile: { width: 64, alignItems: 'flex-end' },
  inviteHistoryColInitiatorMobile: { width: 64, alignItems: 'flex-end', paddingLeft: 0 },
});
