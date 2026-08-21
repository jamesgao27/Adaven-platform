import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { format } from 'date-fns';
import { getCurrentUser } from '@/lib/auth';
import { listSpaceOrdersForMember, type SpaceOrderRow } from '@/lib/space-orders';
import { fetchSpaceEntitlements, type SpaceEntitlements } from '@/lib/space-entitlements';
import { showToast } from '@/lib/toast';

function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'MMM d, yyyy');
  } catch {
    return iso;
  }
}

function metadataSummary(meta: Record<string, unknown> | null): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const keys = Object.keys(meta);
  if (keys.length === 0) return null;
  return keys
    .slice(0, 6)
    .map((k) => {
      const v = meta[k];
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${k}: ${s}`;
    })
    .join(' · ');
}

export default function SpaceOrdersScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [orders, setOrders] = useState<SpaceOrderRow[]>([]);
  const [entitlements, setEntitlements] = useState<SpaceEntitlements | null>(null);

  const load = useCallback(async () => {
    const user = await getCurrentUser(true);
    const spaceId = user?.currentSpaceId || user?.spaceId;
    if (!spaceId) {
      setOrders([]);
      setEntitlements(null);
      return;
    }
    const [rows, ent] = await Promise.all([
      listSpaceOrdersForMember(spaceId),
      fetchSpaceEntitlements(spaceId),
    ]);
    setOrders(rows);
    setEntitlements(ent);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await load();
      } catch (e) {
        console.error(e);
        if (!cancelled) showToast('Failed to load orders', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const onRefresh = async () => {
    try {
      setRefreshing(true);
      await load();
    } catch (e) {
      console.error(e);
      showToast('Failed to refresh orders', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color="#6C5CE7" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {entitlements?.ok ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Current plan</Text>
            {entitlements.active_subscription ? (
              <>
                <Text style={styles.summaryLine}>
                  {entitlements.active_subscription.sku_code}
                  {entitlements.active_subscription.is_trial ? ' · Trial' : ''}
                </Text>
                <Text style={styles.summaryMuted}>
                  Valid through {formatTs(entitlements.active_subscription.expires_at)}
                </Text>
              </>
            ) : (
              <Text style={styles.summaryWarn}>No active subscription. Recognition and firm engagements may be blocked.</Text>
            )}
            {entitlements.warnings?.some((w) => w.code === 'TRIAL_ENDING') ? (
              <Text style={styles.summaryWarn}>
                Trial ending soon (
                {entitlements.warnings.find((w) => w.code === 'TRIAL_ENDING')?.days_left ?? '—'} days left).
              </Text>
            ) : null}
            {entitlements.space_kind === 'firm' && entitlements.firm_engagement?.has_subscription ? (
              <Text style={styles.summaryMuted}>
                Engagements this subscription period: {entitlements.firm_engagement.used_in_period} /{' '}
                {entitlements.firm_engagement.max_creates}
              </Text>
            ) : null}
            {entitlements.space_kind === 'client' && entitlements.client_recognition ? (
              <Text style={styles.summaryMuted}>
                AI recognitions this month: {entitlements.client_recognition.used_this_month}
                {entitlements.client_recognition.monthly_cap != null
                  ? ` / cap ${entitlements.client_recognition.monthly_cap}`
                  : ` / ${entitlements.client_recognition.included_per_month} included`}
                {' · '}Credits: {entitlements.client_recognition.credits_balance}
              </Text>
            ) : null}
          </View>
        ) : null}
        {orders.length === 0 ? (
          <Text style={styles.empty}>No orders for this space yet.</Text>
        ) : (
          orders.map((o) => {
            const extra = metadataSummary(o.metadata);
            return (
              <View key={o.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={styles.skuName} numberOfLines={2}>
                    {o.sku_name}
                  </Text>
                  <View style={[styles.badge, statusBadgeStyle(o.status)]}>
                    <Text style={styles.badgeText}>{o.status}</Text>
                  </View>
                </View>
                <Text style={styles.skuCode}>{o.sku_code}</Text>
                <View style={styles.row}>
                  <Text style={styles.label}>Source</Text>
                  <Text style={styles.value}>{o.source}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.label}>Started</Text>
                  <Text style={styles.value}>{formatTs(o.started_at)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.label}>Expires</Text>
                  <Text style={styles.value}>{o.expires_at ? formatTs(o.expires_at) : 'No expiry'}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.label}>Created</Text>
                  <Text style={styles.value}>{formatTs(o.created_at)}</Text>
                </View>
                {extra ? <Text style={styles.meta}>{extra}</Text> : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function statusBadgeStyle(status: string) {
  const s = status?.toLowerCase();
  if (s === 'active') return { backgroundColor: '#E8F5E9' };
  if (s === 'pending') return { backgroundColor: '#FFF8E1' };
  if (s === 'expired' || s === 'cancelled') return { backgroundColor: '#FFEBEE' };
  return { backgroundColor: '#ECEFF1' };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2D3436',
    marginBottom: 8,
  },
  summaryLine: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3436',
  },
  summaryMuted: {
    fontSize: 13,
    color: '#636E72',
    marginTop: 6,
    lineHeight: 18,
  },
  summaryWarn: {
    fontSize: 13,
    color: '#C27C0E',
    marginTop: 6,
    lineHeight: 18,
  },
  empty: {
    fontSize: 15,
    color: '#636E72',
    textAlign: 'center',
    marginTop: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  skuName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
  },
  skuCode: {
    fontSize: 13,
    color: '#636E72',
    marginTop: 4,
    marginBottom: 10,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2D3436',
    textTransform: 'capitalize',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  label: {
    fontSize: 13,
    color: '#95A5A6',
  },
  value: {
    fontSize: 13,
    color: '#2D3436',
    fontWeight: '500',
    marginLeft: 12,
    flex: 1,
    textAlign: 'right',
  },
  meta: {
    marginTop: 10,
    fontSize: 12,
    color: '#636E72',
    lineHeight: 18,
  },
});
