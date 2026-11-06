/**
 * Portalflow client home. Bookkeeping stays on the Receiptap web app.
 * Tax filing opens the existing history. Other services stay as placeholders
 * until those histories are designed.
 */
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function ClientServicesHome() {
  const router = useRouter();

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
      <Text style={styles.title}>Service history</Text>
      <Text style={styles.lead}>
        Tax, legal, and other work your firm has handled for this space.
      </Text>

      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push('/tax-filing')}
        activeOpacity={0.85}
      >
        <View style={styles.iconWrap}>
          <Ionicons name="document-text-outline" size={22} color="#6C5CE7" />
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>Tax filing</Text>
          <Text style={styles.cardBody}>Returns, engagements, and filing history.</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#B2BEC3" />
      </TouchableOpacity>

      <View style={styles.cardMuted}>
        <View style={styles.iconWrapMuted}>
          <Ionicons name="briefcase-outline" size={22} color="#636E72" />
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>Legal</Text>
          <Text style={styles.cardBody}>Legal service history will appear here.</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#F7F8FC' },
  page: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 40,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#2D3436',
    marginBottom: 8,
  },
  lead: {
    fontSize: 15,
    lineHeight: 22,
    color: '#636E72',
    marginBottom: 24,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E6E8F0',
  },
  cardMuted: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E6E8F0',
    opacity: 0.85,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F3F0FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  iconWrapMuted: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F1F2F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  cardCopy: { flex: 1 },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 4,
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 18,
    color: '#636E72',
  },
});
