import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { showToast, confirmDestructive } from '@adaven/platform-ui';
import {
  deleteSku,
  getSku,
  requireProviderSpace,
  updateSku,
  type ProviderSku,
} from '@/lib/provider';

const COVER_H = 88;

export default function SkuDetailScreen() {
  const { skuId, edit, isNew } = useLocalSearchParams<{ skuId: string; edit?: string; isNew?: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(edit === '1');
  const [sku, setSku] = useState<ProviderSku | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [published, setPublished] = useState(false);

  const load = useCallback(async () => {
    const space = await requireProviderSpace();
    if (!space) {
      router.replace('/');
      return;
    }
    const row = await getSku(skuId);
    if (!row) {
      showToast('SKU not found', 'error');
      router.replace('/catalog');
      return;
    }
    setSku(row);
    setName(row.name);
    setDescription(row.description ?? '');
    setPublished(row.isPublished);
  }, [skuId, router]);

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

  const save = async () => {
    if (!sku) return;
    setSaving(true);
    try {
      await updateSku(sku.id, {
        name: name.trim() || 'Untitled SKU',
        description: description.trim() || null,
        isPublished: published,
      });
      setEditing(false);
      await load();
      showToast('SKU saved', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!sku) return;
    confirmDestructive('Delete SKU', 'This SKU will be removed from the catalog.', async () => {
      await deleteSku(sku.id);
      router.replace('/catalog');
    });
  };

  if (loading || !sku) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6C5CE7" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.back} onPress={() => router.push('/catalog')}>
        <Ionicons name="chevron-back" size={20} color="#6C5CE7" />
        <Text style={styles.backText}>Catalog</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Info</Text>
        <View style={styles.heroRow}>
          <View style={styles.coverWrap}>
            <View style={styles.coverPlaceholder}>
              <Ionicons name="cube-outline" size={28} color="#95A5A6" />
            </View>
          </View>
          <View style={styles.heroMeta}>
            {editing ? (
              <TextInput style={styles.nameInput} value={name} onChangeText={setName} placeholder="SKU name" />
            ) : (
              <Text style={styles.nameText}>{sku.name}</Text>
            )}
            {editing ? (
              <TextInput
                style={styles.descInput}
                value={description}
                onChangeText={setDescription}
                placeholder="Description"
                multiline
              />
            ) : sku.description ? (
              <Text style={styles.descText}>{sku.description}</Text>
            ) : (
              <Text style={styles.descEmpty}>No description</Text>
            )}
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Publishing</Text>
        <TouchableOpacity
          style={styles.optChip}
          onPress={() => (editing ? setPublished(!published) : undefined)}
          disabled={!editing}
        >
          <Text style={[styles.optChipText, published && styles.optChipTextActive]}>
            {published ? 'Published' : 'Draft'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.hint}>Draft SKUs stay in the factory catalog. Published SKUs can be added to orders.</Text>
      </View>

      <View style={styles.actions}>
        {editing ? (
          <TouchableOpacity style={styles.primary} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save</Text>}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.primary} onPress={() => setEditing(true)}>
            <Text style={styles.primaryText}>Edit</Text>
          </TouchableOpacity>
        )}
        {isNew === '1' || editing ? (
          <TouchableOpacity style={styles.danger} onPress={remove}>
            <Text style={styles.dangerText}>Delete</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F9FA' },
  page: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { padding: 20, paddingBottom: 48, maxWidth: 720 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backText: { fontSize: 15, fontWeight: '600', color: '#6C5CE7' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DEE2E6',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#95A5A6',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 10,
  },
  heroRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  coverWrap: {
    width: COVER_H,
    height: COVER_H,
    borderRadius: 10,
    backgroundColor: '#E9ECEF',
    overflow: 'hidden',
  },
  coverPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heroMeta: { flex: 1, gap: 6, paddingTop: 2 },
  nameText: { fontSize: 17, fontWeight: '700', color: '#2D3436', lineHeight: 23 },
  nameInput: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
    borderWidth: 1,
    borderColor: '#6C5CE7',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#fff',
  },
  descText: { fontSize: 13, color: '#636E72', lineHeight: 19 },
  descEmpty: { fontSize: 13, color: '#B2BEC3', fontStyle: 'italic' },
  descInput: {
    fontSize: 13,
    color: '#2D3436',
    borderWidth: 1,
    borderColor: '#6C5CE7',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#fff',
    minHeight: 60,
  },
  optChip: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#6C5CE7',
    backgroundColor: '#EDE9FD',
  },
  optChipText: { fontSize: 12, color: '#636E72', fontWeight: '500' },
  optChipTextActive: { color: '#6C5CE7', fontWeight: '700' },
  hint: { fontSize: 12, color: '#636E72', marginTop: 10 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  primary: {
    backgroundColor: '#6C5CE7',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryText: { color: '#fff', fontWeight: '700' },
  danger: { paddingHorizontal: 18, paddingVertical: 12 },
  dangerText: { color: '#E74C3C', fontWeight: '600' },
});
