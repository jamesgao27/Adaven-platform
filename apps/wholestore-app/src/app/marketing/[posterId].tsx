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
import { listSkus, requireProviderSpace, type ProviderSku } from '@/lib/provider';
import {
  deletePoster,
  getPoster,
  setPosterSkus,
  updatePoster,
  type ProviderPoster,
} from '@/lib/posters';

const COVER_H = 88;

export default function PosterDetailScreen() {
  const { posterId, edit, isNew } = useLocalSearchParams<{
    posterId: string;
    edit?: string;
    isNew?: string;
  }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(edit === '1');
  const [poster, setPoster] = useState<ProviderPoster | null>(null);
  const [skus, setSkus] = useState<ProviderSku[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [published, setPublished] = useState(false);
  const [featured, setFeatured] = useState(false);
  const [selectedSkuIds, setSelectedSkuIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    const space = await requireProviderSpace();
    if (!space) {
      router.replace('/');
      return;
    }
    const [row, catalog] = await Promise.all([getPoster(posterId), listSkus(space.id)]);
    if (!row) {
      showToast('Poster not found', 'error');
      router.replace('/marketing');
      return;
    }
    setPoster(row);
    setSkus(catalog);
    setName(row.name);
    setDescription(row.description ?? '');
    setPublished(row.isPublished);
    setFeatured(row.isMarketplaceFeatured);
    setSelectedSkuIds(row.skuIds);
  }, [posterId, router]);

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

  const toggleSku = (id: string) => {
    if (!editing || poster?.isSystemDefault) return;
    setSelectedSkuIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const save = async () => {
    if (!poster) return;
    setSaving(true);
    try {
      await updatePoster(poster.id, {
        name: name.trim() || 'Untitled poster',
        description: description.trim() || null,
        isPublished: published,
        isMarketplaceFeatured: featured && published,
      });
      if (!poster.isSystemDefault) {
        await setPosterSkus(poster.id, selectedSkuIds);
      }
      setEditing(false);
      await load();
      showToast('Poster saved', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!poster || poster.isSystemDefault) return;
    confirmDestructive('Delete poster', 'This poster will be removed. Catalog SKUs stay in the catalog.', async () => {
      await deletePoster(poster.id);
      router.replace('/marketing');
    });
  };

  if (loading || !poster) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6C5CE7" />
      </View>
    );
  }

  const publishedSkus = skus.filter((s) => s.isPublished);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.back} onPress={() => router.push('/marketing')}>
        <Ionicons name="chevron-back" size={20} color="#6C5CE7" />
        <Text style={styles.backText}>Marketing</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Poster</Text>
        <View style={styles.heroRow}>
          <View style={styles.coverWrap}>
            <View style={styles.coverPlaceholder}>
              <Ionicons name="image-outline" size={28} color="#95A5A6" />
            </View>
          </View>
          <View style={styles.heroMeta}>
            {editing ? (
              <TextInput style={styles.nameInput} value={name} onChangeText={setName} placeholder="Poster name" />
            ) : (
              <Text style={styles.nameText}>{poster.name}</Text>
            )}
            {editing ? (
              <TextInput
                style={styles.descInput}
                value={description}
                onChangeText={setDescription}
                placeholder="Factory introduction"
                multiline
              />
            ) : poster.description ? (
              <Text style={styles.descText}>{poster.description}</Text>
            ) : (
              <Text style={styles.descEmpty}>No introduction</Text>
            )}
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Publishing</Text>
        <View style={styles.chipRow}>
          <TouchableOpacity
            style={styles.optChip}
            onPress={() => (editing ? setPublished(!published) : undefined)}
            disabled={!editing}
          >
            <Text style={[styles.optChipText, published && styles.optChipTextActive]}>
              {published ? 'Published' : 'Draft'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.optChip}
            onPress={() => {
              if (!editing) return;
              if (!published && !featured) {
                setPublished(true);
                setFeatured(true);
                return;
              }
              setFeatured(!featured);
            }}
            disabled={!editing}
          >
            <Text style={[styles.optChipText, featured && published && styles.optChipTextActive]}>
              {featured && published ? 'Featured storefront' : 'Set as featured poster'}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>
          {poster.isSystemDefault
            ? 'Default poster is created for every factory and lists every published SKU. Dealers see it on the storefront when no other poster is featured.'
            : 'Publish this poster, then set it as the featured storefront to replace the default store view.'}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>SKUs on this poster</Text>
        {poster.isSystemDefault ? (
          <Text style={styles.hint}>
            Attached automatically: every published catalog SKU. Unpublish a SKU in Catalog to remove it here.
          </Text>
        ) : (
          <Text style={styles.hint}>Choose published catalog SKUs to show in this storefront.</Text>
        )}
        {publishedSkus.length === 0 ? (
          <Text style={styles.descEmpty}>No published SKUs yet. Publish SKUs in Catalog.</Text>
        ) : (
          publishedSkus.map((sku) => {
            const on = selectedSkuIds.includes(sku.id);
            return (
              <TouchableOpacity
                key={sku.id}
                style={[styles.skuRow, on && styles.skuRowOn]}
                onPress={() => toggleSku(sku.id)}
                disabled={!editing || poster.isSystemDefault}
                activeOpacity={poster.isSystemDefault ? 1 : 0.7}
              >
                <Ionicons
                  name={on ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={on ? '#6C5CE7' : '#B2BEC3'}
                />
                <View style={styles.skuMeta}>
                  <Text style={styles.skuName}>{sku.name}</Text>
                  {sku.description ? <Text style={styles.skuDesc}>{sku.description}</Text> : null}
                </View>
              </TouchableOpacity>
            );
          })
        )}
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
        {!poster.isSystemDefault && (isNew === '1' || editing) ? (
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
  descEmpty: { fontSize: 13, color: '#B2BEC3', fontStyle: 'italic', marginTop: 8 },
  descInput: {
    fontSize: 13,
    color: '#2D3436',
    borderWidth: 1,
    borderColor: '#6C5CE7',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#fff',
    minHeight: 72,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
  hint: { fontSize: 12, color: '#636E72', marginTop: 10, lineHeight: 18 },
  skuRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEF2F5',
  },
  skuRowOn: { backgroundColor: 'rgba(108, 92, 231, 0.04)' },
  skuMeta: { flex: 1 },
  skuName: { fontSize: 14, fontWeight: '600', color: '#2D3436' },
  skuDesc: { fontSize: 12, color: '#636E72', marginTop: 2 },
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
