import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { DataTable, type DataTableColumn, showToast, useWebViewportKind } from '@adaven/platform-ui';
import { StatusPill } from '@/components/StatusPill';
import { listPageStyles } from '@/lib/list-page-styles';
import {
  addDealerFollowUp,
  computeDealerDisplayStatus,
  getDealer,
  getDealerFollowUps,
  listOrdersForDealer,
  requireProviderSpace,
  skuSummary,
  updateDealer,
  updateDealerLabels,
  DEALER_DISPLAY_STATUS_LABELS,
  type DealerFollowUp,
  type ProviderDealer,
  type ProviderOrder,
} from '@/lib/provider';

const cellText = { fontSize: 14, color: '#2D3436' };

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'MMM dd, yyyy');
  } catch {
    return '—';
  }
}

export default function DealerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isDesktopWeb } = useWebViewportKind();
  const [loading, setLoading] = useState(true);
  const [dealer, setDealer] = useState<ProviderDealer | null>(null);
  const [orders, setOrders] = useState<ProviderOrder[]>([]);
  const [followUps, setFollowUps] = useState<DealerFollowUp[]>([]);
  const [activeTab, setActiveTab] = useState<'info' | 'orders'>('info');
  const [newTagInput, setNewTagInput] = useState('');
  const [savingLabels, setSavingLabels] = useState(false);
  const [followUpContent, setFollowUpContent] = useState('');
  const [addingFollowUp, setAddingFollowUp] = useState(false);
  const [approving, setApproving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const load = useCallback(async () => {
    const space = await requireProviderSpace();
    if (!space) {
      router.replace('/');
      return;
    }
    const row = await getDealer(id);
    if (!row) {
      showToast('Dealer not found', 'error');
      router.replace('/dealers');
      return;
    }
    setDealer(row);
    setName(row.name);
    setContactName(row.contactName ?? '');
    setContactEmail(row.contactEmail ?? '');
    const [dealerOrders, notes] = await Promise.all([listOrdersForDealer(row.id), getDealerFollowUps(row.id)]);
    setOrders(dealerOrders);
    setFollowUps(notes);
  }, [id, router]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const displayStatus = dealer ? computeDealerDisplayStatus(dealer, orders) : 'new';
  const isPendingInvite = !dealer?.consumerSpaceId;
  const isPendingApplication = !!dealer?.consumerSpaceId && dealer.status === 'pending';

  const handleApprove = async () => {
    if (!dealer) return;
    setApproving(true);
    try {
      await updateDealer(dealer.id, { status: 'approved' });
      showToast('Dealer approved. They can order from your store.', 'success');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to approve', 'error');
    } finally {
      setApproving(false);
    }
  };

  const handleAddTag = async () => {
    if (!dealer) return;
    const tag = newTagInput.trim();
    if (!tag) return;
    setSavingLabels(true);
    try {
      const next = [...(dealer.labels ?? []), tag];
      await updateDealerLabels(dealer.id, next);
      setNewTagInput('');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to add tag', 'error');
    } finally {
      setSavingLabels(false);
    }
  };

  const handleRemoveTag = async (index: number) => {
    if (!dealer) return;
    setSavingLabels(true);
    try {
      const next = (dealer.labels ?? []).filter((_, i) => i !== index);
      await updateDealerLabels(dealer.id, next);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to remove tag', 'error');
    } finally {
      setSavingLabels(false);
    }
  };

  const handleAddFollowUp = async () => {
    if (!dealer || !followUpContent.trim()) return;
    setAddingFollowUp(true);
    try {
      await addDealerFollowUp(dealer.providerSpaceId, dealer.id, followUpContent, dealer.consumerSpaceId);
      setFollowUpContent('');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to add follow-up', 'error');
    } finally {
      setAddingFollowUp(false);
    }
  };

  const saveInfo = async () => {
    if (!dealer) return;
    await updateDealer(dealer.id, { name, contactName, contactEmail });
    setEditing(false);
    await load();
  };

  const columns: DataTableColumn<ProviderOrder>[] = [
    {
      id: 'skus',
      label: 'SKUs',
      minWidth: 200,
      getValue: (r) => <Text style={cellText}>{skuSummary(r)}</Text>,
    },
    {
      id: 'status',
      label: 'Status',
      minWidth: 100,
      getValue: (r) => <StatusPill status={r.status} />,
    },
    {
      id: 'createdAt',
      label: 'Created date',
      minWidth: 110,
      getValue: (r) => <Text style={cellText}>{format(new Date(r.createdAt), 'MMM dd, yyyy')}</Text>,
    },
  ];

  if (loading || !dealer) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6C5CE7" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.operationBar}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity style={styles.back} onPress={() => router.push('/dealers')}>
            <Ionicons name="chevron-back" size={18} color="#6C5CE7" />
            <Text style={styles.backText}>{dealer.name}</Text>
          </TouchableOpacity>
          <View style={styles.tabGroup}>
            <TouchableOpacity
              style={[styles.tabChip, activeTab === 'info' && styles.tabChipActive]}
              onPress={() => setActiveTab('info')}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabChipText, activeTab === 'info' && styles.tabChipTextActive]}>Info</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabChip, activeTab === 'orders' && styles.tabChipActive]}
              onPress={() => setActiveTab('orders')}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabChipText, activeTab === 'orders' && styles.tabChipTextActive]}>Orders</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {activeTab === 'info' ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.infoCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.infoCardTitle}>Basic information</Text>
              <TouchableOpacity onPress={() => (editing ? saveInfo() : setEditing(true))}>
                <Text style={styles.link}>{editing ? 'Save' : 'Edit'}</Text>
              </TouchableOpacity>
            </View>
            {editing ? (
              <>
                <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Dealer name" />
                <TextInput style={styles.input} value={contactName} onChangeText={setContactName} placeholder="Contact" />
                <TextInput style={styles.input} value={contactEmail} onChangeText={setContactEmail} placeholder="Email" />
              </>
            ) : (
              <View style={styles.infoGrid}>
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>Contact</Text>
                  <Text style={styles.infoValue}>{dealer.contactName ?? '—'}</Text>
                </View>
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>Email</Text>
                  <Text style={styles.infoValue}>{dealer.contactEmail ?? '—'}</Text>
                </View>
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>Status</Text>
                  <View style={styles.infoValueTouch}>
                    {dealer.labels?.length ? (
                      <View style={[styles.labelBadge, { backgroundColor: '#6C5CE7' }]}>
                        <Text style={styles.labelBadgeText}>{dealer.labels[0]}</Text>
                      </View>
                    ) : (
                      <Text style={styles.infoValue}>{DEALER_DISPLAY_STATUS_LABELS[displayStatus]}</Text>
                    )}
                  </View>
                </View>
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>Labels</Text>
                  <View style={styles.labelsRow}>
                    {(dealer.labels ?? []).map((tag, i) => (
                      <View key={`${tag}-${i}`} style={styles.tagChipWrap}>
                        <View style={[styles.labelBadge, { backgroundColor: '#6C5CE7' }]}>
                          <Text style={styles.labelBadgeText}>{tag}</Text>
                        </View>
                        <TouchableOpacity onPress={() => handleRemoveTag(i)} hitSlop={8} style={styles.tagRemove}>
                          <Ionicons name="close-circle" size={18} color="#636E72" />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <View style={styles.tagAddRow}>
                      <TextInput
                        style={styles.tagInput}
                        placeholder="Add tag"
                        placeholderTextColor="#95A5A6"
                        value={newTagInput}
                        onChangeText={setNewTagInput}
                        onSubmitEditing={handleAddTag}
                        returnKeyType="done"
                      />
                      <TouchableOpacity
                        style={[styles.tagAddBtn, (!newTagInput.trim() || savingLabels) && styles.followUpBtnDisabled]}
                        onPress={handleAddTag}
                        disabled={!newTagInput.trim() || savingLabels}
                      >
                        {savingLabels ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.tagAddBtnText}>Add</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
                {isPendingInvite ? (
                  <Text style={styles.pendingHint}>
                    Pending invite — the dealer has not linked a space yet. They claim this record with the contact email.
                  </Text>
                ) : null}
                {isPendingApplication ? (
                  <View style={{ marginTop: 12, gap: 8 }}>
                    <Text style={styles.pendingHint}>
                      This dealer applied from your showcase. Approve them to open your store for orders.
                    </Text>
                    <TouchableOpacity
                      style={[styles.approveBtn, approving && { opacity: 0.6 }]}
                      onPress={handleApprove}
                      disabled={approving}
                    >
                      {approving ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.approveBtnText}>Approve dealer</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            )}
            <View style={styles.statsRow}>
              <TouchableOpacity style={styles.statPill} activeOpacity={0.8} onPress={() => setActiveTab('orders')}>
                <Text style={styles.statNumber}>{orders.length}</Text>
                <Text style={styles.statLabel}>Orders</Text>
              </TouchableOpacity>
              <View style={styles.statPill}>
                <Text style={styles.statNumber}>{followUps.length}</Text>
                <Text style={styles.statLabel}>Follow-ups</Text>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Follow-up history</Text>
            <View style={styles.followUpInputBox}>
              <TextInput
                style={styles.followUpInput}
                placeholder="Add a follow-up note"
                placeholderTextColor="#95A5A6"
                value={followUpContent}
                onChangeText={setFollowUpContent}
                multiline
              />
              <TouchableOpacity
                style={[styles.followUpBtn, (addingFollowUp || !followUpContent.trim()) && styles.followUpBtnDisabled]}
                onPress={handleAddFollowUp}
                disabled={addingFollowUp || !followUpContent.trim()}
              >
                {addingFollowUp ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.followUpBtnText}>Add follow-up</Text>
                )}
              </TouchableOpacity>
            </View>
            {followUps.length === 0 ? (
              <Text style={styles.emptyText}>No follow-up records yet.</Text>
            ) : (
              followUps.map((f) => {
                const isOrderEvent = f.kind !== 'note' && f.referenceId;
                const iconName =
                  f.kind === 'order_created'
                    ? 'document-text-outline'
                    : f.kind === 'order_started'
                      ? 'play-circle-outline'
                      : f.kind === 'order_completed'
                        ? 'checkmark-done-outline'
                        : f.kind === 'order_cancelled'
                          ? 'close-circle-outline'
                          : null;
                const rowContent = (
                  <>
                    {iconName ? (
                      <Ionicons name={iconName as any} size={18} color="#6C5CE7" style={styles.followUpRowIcon} />
                    ) : null}
                    <View style={styles.followUpRowText}>
                      <Text style={styles.followUpContent}>{f.content}</Text>
                      <Text style={styles.followUpMeta}>{formatDate(f.createdAt)}</Text>
                    </View>
                  </>
                );
                return isOrderEvent ? (
                  <TouchableOpacity
                    key={f.id}
                    style={styles.followUpRow}
                    onPress={() => router.push(`/orders/${f.referenceId}`)}
                    activeOpacity={0.7}
                  >
                    {rowContent}
                  </TouchableOpacity>
                ) : (
                  <View key={f.id} style={styles.followUpRow}>
                    {rowContent}
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      ) : isDesktopWeb ? (
        <View style={{ flex: 1, padding: 16 }}>
          <DataTable
            columns={columns}
            data={orders}
            keyExtractor={(r) => r.id}
            storageKey="wholestore-dealer-orders"
            onRowPress={(r) => router.push(`/orders/${r.id}`)}
            emptyMessage="No orders yet. Dealers place orders from your store or by accepting an open invite."
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {orders.map((r) => (
            <TouchableOpacity key={r.id} style={listPageStyles.card} onPress={() => router.push(`/orders/${r.id}`)}>
              <Text style={listPageStyles.cardTitle}>{skuSummary(r)}</Text>
              <StatusPill status={r.status} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ECEFF1' },
  operationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  back: { flexDirection: 'row', alignItems: 'center' },
  backText: { fontSize: 15, fontWeight: '600', color: '#6C5CE7' },
  link: { color: '#6C5CE7', fontWeight: '600' },
  tabGroup: { flexDirection: 'row', backgroundColor: '#F0F2F5', borderRadius: 8, padding: 3, gap: 2 },
  tabChip: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 6 },
  tabChipActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  tabChipText: { fontSize: 13, fontWeight: '600', color: '#95A5A6' },
  tabChipTextActive: { color: '#2D3436' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    padding: 20,
    marginBottom: 20,
  },
  infoCardTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#95A5A6',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 14,
  },
  infoGrid: { gap: 16 },
  infoItem: { gap: 4 },
  infoLabel: { fontSize: 12, color: '#95A5A6' },
  infoValue: { fontSize: 14, color: '#2D3436', fontWeight: '500' },
  pendingHint: { fontSize: 13, color: '#F39C12', lineHeight: 18 },
  approveBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#6C5CE7',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  approveBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: '#F8F9FA',
  },
  statsRow: { flexDirection: 'row', gap: 16, marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#E9ECEF' },
  statPill: {
    minWidth: 80,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    alignItems: 'center',
  },
  statNumber: { fontSize: 20, fontWeight: '700', color: '#2D3436' },
  statLabel: { fontSize: 12, color: '#636E72', marginTop: 2 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#636E72', marginBottom: 12 },
  followUpInputBox: { marginBottom: 12, gap: 8 },
  followUpInput: {
    minHeight: 60,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#2D3436',
  },
  followUpBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#6C5CE7',
  },
  followUpBtnDisabled: { opacity: 0.6 },
  followUpBtnText: { fontSize: 13, color: '#fff', fontWeight: '600' },
  emptyText: { fontSize: 13, color: '#95A5A6' },
  infoValueTouch: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  labelBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  labelBadgeText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  labelsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  tagChipWrap: { flexDirection: 'row', alignItems: 'center' },
  tagRemove: { marginLeft: 2 },
  tagAddRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tagInput: {
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    minWidth: 100,
    flex: 1,
  },
  tagAddBtn: { backgroundColor: '#6C5CE7', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  tagAddBtnText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  followUpRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  followUpRowIcon: { marginRight: 8, marginTop: 2 },
  followUpRowText: { flex: 1 },
  followUpContent: { fontSize: 13, color: '#2D3436', marginBottom: 2 },
  followUpMeta: { fontSize: 12, color: '#95A5A6' },
});
