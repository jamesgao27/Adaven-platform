/**
 * Firm - Assignment (legacy route): placeholder; assignments use firm.order_managers per order.
 */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { getCurrentSpace } from '@/lib/auth';

export default function FirmAssignmentsScreen() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const space = await getCurrentSpace(true);
      if (!space?.id || space.kind !== 'provider') {
        router.replace('/');
        return;
      }
      setReady(true);
    })();
  }, []);

  if (!ready) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Assignment</Text>
      <Text style={styles.subtitle}>Service owners are set per order (firm.order_managers)</Text>
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>Coming soon: list and edit member–client assignments</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#2D3436', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#636E72', marginBottom: 24 },
  placeholder: { marginTop: 24, padding: 16, backgroundColor: '#FFF', borderRadius: 12 },
  placeholderText: { fontSize: 14, color: '#95A5A6' },
});
