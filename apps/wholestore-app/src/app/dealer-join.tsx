import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getCurrentSpace, isAuthenticated } from '@adaven/platform-core';
import { showToast } from '@adaven/platform-ui';
import { acceptDealerInvite, getDealerInviteInfo, type DealerInviteInfo } from '@/lib/dealer-invites';

const JOIN_TOKEN_KEY = 'wholestore_dealer_join_token';

export default function DealerJoinScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; factoryName?: string }>();
  const token = (params.token ?? '').trim();
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [info, setInfo] = useState<DealerInviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const t = token || (typeof window !== 'undefined' ? sessionStorage.getItem(JOIN_TOKEN_KEY) : '') || '';
      if (t && typeof window !== 'undefined') sessionStorage.setItem(JOIN_TOKEN_KEY, t);
      if (!t) {
        setError('This invite link is missing a token.');
        setLoading(false);
        return;
      }
      if (!(await isAuthenticated())) {
        router.replace({ pathname: '/login', params: { redirect: '/dealer-join', token: t } });
        return;
      }
      const space = await getCurrentSpace(true);
      if (!space) {
        router.replace('/setup-space');
        return;
      }
      if (space.kind !== 'consumer') {
        setError('Open this invite while signed in to a Dealer space.');
        setLoading(false);
        return;
      }
      const { info: row, error: err } = await getDealerInviteInfo(t);
      if (err) setError(err.message);
      else if (!row) setError('This invite is invalid, expired, or already closed.');
      else setInfo(row);
      setLoading(false);
    })();
  }, [token, router]);

  const handleAccept = async () => {
    const t = token || (typeof window !== 'undefined' ? sessionStorage.getItem(JOIN_TOKEN_KEY) : '') || '';
    const space = await getCurrentSpace(true);
    if (!t || !space?.id) return;
    setAccepting(true);
    const { error: err } = await acceptDealerInvite(t, space.id);
    setAccepting(false);
    if (err) {
      showToast(err.message, 'error');
      return;
    }
    if (typeof window !== 'undefined') sessionStorage.removeItem(JOIN_TOKEN_KEY);
    showToast('You joined this supplier.', 'success');
    router.replace('/suppliers');
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6C5CE7" />
        <Text style={styles.muted}>Opening invite…</Text>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <Text style={styles.kicker}>Supplier invite</Text>
        <Text style={styles.title}>{info?.factoryName || params.factoryName || 'Wholestore supplier'}</Text>
        {info?.posterName ? <Text style={styles.poster}>{info.posterName}</Text> : null}
        {info?.posterDescription ? <Text style={styles.body}>{info.posterDescription}</Text> : null}
        {info?.skuSummary ? <Text style={styles.skus}>Products: {info.skuSummary}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.body}>
          Accepting enrolls your dealer space with this supplier. You can then order from their store.
        </Text>
        <TouchableOpacity
          style={[styles.primary, (!info || accepting) && styles.disabled]}
          onPress={handleAccept}
          disabled={!info || accepting}
          activeOpacity={0.8}
        >
          {accepting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Accept invite</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={() => router.replace('/')} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={16} color="#636E72" />
          <Text style={styles.secondaryText}>Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center', padding: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#F1F5F9' },
  muted: { fontSize: 15, color: '#636E72' },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  kicker: { fontSize: 11, fontWeight: '700', color: '#95A5A6', letterSpacing: 0.7, textTransform: 'uppercase' },
  title: { fontSize: 22, fontWeight: '800', color: '#2D3436', marginTop: 8 },
  poster: { fontSize: 15, color: '#6C5CE7', marginTop: 8, fontWeight: '700' },
  skus: { fontSize: 13, color: '#636E72', marginTop: 8, lineHeight: 18 },
  body: { fontSize: 14, color: '#636E72', lineHeight: 20, marginTop: 12 },
  error: { fontSize: 14, color: '#E17055', marginTop: 12 },
  primary: {
    marginTop: 20,
    backgroundColor: '#6C5CE7',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondary: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  secondaryText: { color: '#636E72', fontWeight: '600' },
});
