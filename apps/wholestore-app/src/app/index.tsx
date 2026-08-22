import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Platform, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import {
  getCurrentSpace,
  getPendingInvitationsForUser,
  isAuthenticated,
} from '@adaven/platform-core';
import { listDealers, listOrders, listSkus } from '@/lib/provider';

export default function IndexScreen() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [kind, setKind] = useState<string>('');
  const [spaceName, setSpaceName] = useState('');
  const [dealerCount, setDealerCount] = useState(0);
  const [orderCount, setOrderCount] = useState(0);
  const [skuCount, setSkuCount] = useState(0);

  useEffect(() => {
    (async () => {
      if (!(await isAuthenticated())) {
        router.replace('/login');
        return;
      }
      const invitations = await getPendingInvitationsForUser();
      const space = await getCurrentSpace(true);
      if (!space) {
        router.replace(invitations.length > 0 ? '/handle-invitations' : '/setup-space');
        return;
      }
      setSpaceName(space.name);
      setKind(space.kind || '');
      if (space.kind === 'provider') {
        const [dealers, orders, skus] = await Promise.all([
          listDealers(space.id),
          listOrders(space.id),
          listSkus(space.id),
        ]);
        setDealerCount(dealers.length);
        setOrderCount(orders.length);
        setSkuCount(skus.length);
      }
      setReady(true);
    })();
  }, [router]);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6C5CE7" />
      </View>
    );
  }

  if (kind === 'provider') {
    const cards = [
      { title: 'Dealers', sub: `${dealerCount} enrolled`, route: '/dealers', icon: 'people-outline' as const },
      { title: 'Orders', sub: `${orderCount} open & closed`, route: '/orders', icon: 'briefcase-outline' as const },
      { title: 'Catalog', sub: `${skuCount} SKUs`, route: '/catalog', icon: 'library-outline' as const },
    ];
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <Text style={styles.kicker}>Insights</Text>
        <Text style={styles.title}>{spaceName}</Text>
        <Text style={styles.body}>Factory (Provider)</Text>
        <View style={styles.grid}>
          {cards.map((card) => (
            <TouchableOpacity key={card.route} style={styles.card} onPress={() => router.push(card.route as any)} activeOpacity={0.8}>
              <View style={styles.cardIcon}>
                <Ionicons name={card.icon} size={22} color="#6C5CE7" />
              </View>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <Text style={styles.cardSub}>{card.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Text style={styles.kicker}>Dashboard</Text>
      <Text style={styles.title}>{spaceName}</Text>
      <Text style={styles.body}>Dealer (Consumer)</Text>
      <Text style={styles.hint}>Shop and dealer orders will appear here.</Text>
      {Platform.OS !== 'web' ? (
        <TouchableOpacity style={styles.mobileManage} onPress={() => router.push('/management')}>
          <Text style={styles.mobileManageText}>Open management</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#F8F9FA', alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, backgroundColor: '#F8F9FA', padding: 24, paddingTop: Platform.OS === 'web' ? 36 : 64 },
  kicker: { fontSize: 13, color: '#6C5CE7', fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: '#2D3436' },
  body: { fontSize: 16, color: '#636E72', marginTop: 6 },
  hint: { fontSize: 15, color: '#95A5A6', marginTop: 24, maxWidth: 520, lineHeight: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    padding: 18,
    minWidth: 220,
    flexGrow: 1,
    maxWidth: 360,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#F0F4FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#2D3436' },
  cardSub: { fontSize: 13, color: '#636E72', marginTop: 4 },
  mobileManage: { marginTop: 28 },
  mobileManageText: { fontSize: 16, fontWeight: '600', color: '#6C5CE7' },
});
