import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  showToast,
  confirmDestructive,
  uploadShowcaseBandImage,
} from '@adaven/platform-ui';
import { listDealers, listSkus, requireProviderSpace, type ProviderDealer, type ProviderSku } from '@/lib/provider';
import {
  SHOWCASE_ACCENT_PRESETS,
  assignShowcaseToConsumer,
  deletePoster,
  getPoster,
  setPosterSkus,
  updatePoster,
  type ProviderPoster,
} from '@/lib/posters';
import { getPlatformClient } from '@adaven/platform-core';

export default function PosterDetailScreen() {
  const { posterId, edit, isNew } = useLocalSearchParams<{
    posterId: string;
    edit?: string;
    isNew?: string;
  }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'top' | 'bottom' | null>(null);
  const [editing, setEditing] = useState(edit === '1');
  const [poster, setPoster] = useState<ProviderPoster | null>(null);
  const [skus, setSkus] = useState<ProviderSku[]>([]);
  const [dealers, setDealers] = useState<ProviderDealer[]>([]);
  const [dealerPosterMap, setDealerPosterMap] = useState<Record<string, string | null>>({});
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [published, setPublished] = useState(false);
  const [featured, setFeatured] = useState(false);
  const [accent, setAccent] = useState('#6C5CE7');
  const [topImageUrl, setTopImageUrl] = useState<string | null>(null);
  const [bottomImageUrl, setBottomImageUrl] = useState<string | null>(null);
  const [selectedSkuIds, setSelectedSkuIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    const space = await requireProviderSpace();
    if (!space) {
      router.replace('/');
      return;
    }
    const [row, catalog, dealerRows] = await Promise.all([
      getPoster(posterId),
      listSkus(space.id),
      listDealers(space.id),
    ]);
    if (!row) {
      showToast('Showcase not found', 'error');
      router.replace('/marketing');
      return;
    }
    setPoster(row);
    setSkus(catalog);
    setDealers(dealerRows.filter((d) => d.status === 'approved'));
    setName(row.name);
    setDescription(row.description ?? '');
    setPublished(row.isPublished);
    setFeatured(row.isMarketplaceFeatured);
    setAccent(row.accentColor || '#6C5CE7');
    setTopImageUrl(row.topImageUrl);
    setBottomImageUrl(row.bottomImageUrl);
    setSelectedSkuIds(row.skuIds);

    const map: Record<string, string | null> = {};
    const { data } = await getPlatformClient()
      .schema('provider')
      .from('consumers')
      .select('id, poster_id')
      .eq('provider_space_id', space.id);
    for (const r of data ?? []) map[r.id] = r.poster_id ?? null;
    setDealerPosterMap(map);
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

  const moveSku = (id: string, dir: -1 | 1) => {
    if (!editing || poster?.isSystemDefault) return;
    setSelectedSkuIds((prev) => {
      const idx = prev.indexOf(id);
      if (idx < 0) return prev;
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const pickBand = async (band: 'top' | 'bottom') => {
    if (!poster || !editing) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setUploading(band);
    try {
      const url = await uploadShowcaseBandImage(result.assets[0].uri, poster.id, band);
      if (band === 'top') setTopImageUrl(url);
      else setBottomImageUrl(url);
      await updatePoster(poster.id, band === 'top' ? { topImageUrl: url } : { bottomImageUrl: url });
      showToast(`${band === 'top' ? 'Top' : 'Bottom'} image uploaded`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Upload failed', 'error');
    } finally {
      setUploading(null);
    }
  };

  const clearBand = async (band: 'top' | 'bottom') => {
    if (!poster || !editing) return;
    if (band === 'top') setTopImageUrl(null);
    else setBottomImageUrl(null);
    await updatePoster(poster.id, band === 'top' ? { topImageUrl: null } : { bottomImageUrl: null });
  };

  const save = async () => {
    if (!poster) return;
    setSaving(true);
    try {
      await updatePoster(poster.id, {
        name: name.trim() || 'Untitled showcase',
        description: description.trim() || null,
        accentColor: accent.trim() || '#6C5CE7',
        topImageUrl,
        bottomImageUrl,
        isPublished: published,
        isMarketplaceFeatured: featured && published,
      });
      if (!poster.isSystemDefault) {
        await setPosterSkus(poster.id, selectedSkuIds);
      }
      setEditing(false);
      await load();
      showToast('Showcase saved', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!poster || poster.isSystemDefault) return;
    confirmDestructive('Delete showcase', 'Catalog SKUs stay in the catalog.', async () => {
      await deletePoster(poster.id);
      router.replace('/marketing');
    });
  };

  const assignDealer = async (dealerId: string, on: boolean) => {
    if (!poster) return;
    try {
      await assignShowcaseToConsumer(dealerId, on ? poster.id : null);
      showToast(on ? 'Showcase assigned' : 'Assignment cleared', 'success');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Assign failed', 'error');
    }
  };

  if (loading || !poster) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6C5CE7" />
      </View>
    );
  }

  const publishedSkus = skus.filter((s) => s.isPublished);
  const orderedSelected = selectedSkuIds
    .map((id) => publishedSkus.find((s) => s.id === id))
    .filter((s): s is ProviderSku => !!s);
  const unselected = publishedSkus.filter((s) => !selectedSkuIds.includes(s.id));

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.back} onPress={() => router.push('/marketing')}>
        <Ionicons name="chevron-back" size={20} color={accent || '#6C5CE7'} />
        <Text style={[styles.backText, { color: accent || '#6C5CE7' }]}>Marketing</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Showcase</Text>
        {editing ? (
          <TextInput style={styles.nameInput} value={name} onChangeText={setName} placeholder="Showcase name" />
        ) : (
          <Text style={styles.nameText}>{poster.name}</Text>
        )}
        {editing ? (
          <TextInput
            style={styles.descInput}
            value={description}
            onChangeText={setDescription}
            placeholder="Short introduction"
            multiline
          />
        ) : poster.description ? (
          <Text style={styles.descText}>{poster.description}</Text>
        ) : (
          <Text style={styles.descEmpty}>No introduction</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Accent color</Text>
        <View style={styles.chipRow}>
          {SHOWCASE_ACCENT_PRESETS.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.swatch, { backgroundColor: c }, accent === c && styles.swatchOn]}
              onPress={() => editing && setAccent(c)}
              disabled={!editing}
            />
          ))}
        </View>
        {editing ? (
          <TextInput
            style={[styles.nameInput, { marginTop: 8 }]}
            value={accent}
            onChangeText={setAccent}
            placeholder="#6C5CE7"
            autoCapitalize="none"
          />
        ) : (
          <Text style={styles.hint}>{accent}</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Top band image</Text>
        {topImageUrl ? (
          <Image source={{ uri: topImageUrl }} style={styles.bandImage} resizeMode="cover" />
        ) : (
          <View style={styles.bandPlaceholder}>
            <Ionicons name="image-outline" size={28} color="#95A5A6" />
          </View>
        )}
        {editing ? (
          <View style={styles.chipRow}>
            <TouchableOpacity style={styles.optChip} onPress={() => pickBand('top')} disabled={!!uploading}>
              <Text style={styles.optChipTextActive}>
                {uploading === 'top' ? 'Uploading…' : Platform.OS === 'web' ? 'Upload top' : 'Upload top'}
              </Text>
            </TouchableOpacity>
            {topImageUrl ? (
              <TouchableOpacity style={styles.optChip} onPress={() => clearBand('top')}>
                <Text style={styles.optChipText}>Clear</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Bottom band image</Text>
        {bottomImageUrl ? (
          <Image source={{ uri: bottomImageUrl }} style={styles.bandImage} resizeMode="cover" />
        ) : (
          <View style={styles.bandPlaceholder}>
            <Ionicons name="image-outline" size={28} color="#95A5A6" />
          </View>
        )}
        {editing ? (
          <View style={styles.chipRow}>
            <TouchableOpacity style={styles.optChip} onPress={() => pickBand('bottom')} disabled={!!uploading}>
              <Text style={styles.optChipTextActive}>{uploading === 'bottom' ? 'Uploading…' : 'Upload bottom'}</Text>
            </TouchableOpacity>
            {bottomImageUrl ? (
              <TouchableOpacity style={styles.optChip} onPress={() => clearBand('bottom')}>
                <Text style={styles.optChipText}>Clear</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Publishing</Text>
        <View style={styles.chipRow}>
          <TouchableOpacity
            style={styles.optChip}
            onPress={() => editing && setPublished(!published)}
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
              if (!published) {
                setPublished(true);
                setFeatured(true);
                return;
              }
              setFeatured(!featured);
            }}
            disabled={!editing}
          >
            <Text style={[styles.optChipText, featured && published && styles.optChipTextActive]}>
              {featured && published ? 'Featured (Discover)' : 'Set as featured'}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>
          Featured showcase is what Discover visitors see. Assigned dealers see their own showcase.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>SKUs (middle band)</Text>
        {poster.isSystemDefault ? (
          <Text style={styles.hint}>Default showcase auto-lists every published catalog SKU.</Text>
        ) : (
          <Text style={styles.hint}>Select published SKUs and reorder for the storefront middle band.</Text>
        )}
        {orderedSelected.map((sku, i) => (
          <View key={sku.id} style={[styles.skuRow, styles.skuRowOn]}>
            <TouchableOpacity onPress={() => toggleSku(sku.id)} disabled={!editing || poster.isSystemDefault}>
              <Ionicons name="checkbox" size={20} color={accent || '#6C5CE7'} />
            </TouchableOpacity>
            <View style={styles.skuMeta}>
              <Text style={styles.skuName}>{sku.name}</Text>
              {sku.category ? <Text style={styles.skuDesc}>{sku.category}</Text> : null}
            </View>
            {editing && !poster.isSystemDefault ? (
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <TouchableOpacity onPress={() => moveSku(sku.id, -1)} disabled={i === 0}>
                  <Ionicons name="arrow-up" size={18} color={i === 0 ? '#DFE6E9' : '#2D3436'} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => moveSku(sku.id, 1)}
                  disabled={i === orderedSelected.length - 1}
                >
                  <Ionicons
                    name="arrow-down"
                    size={18}
                    color={i === orderedSelected.length - 1 ? '#DFE6E9' : '#2D3436'}
                  />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ))}
        {!poster.isSystemDefault
          ? unselected.map((sku) => (
              <TouchableOpacity
                key={sku.id}
                style={styles.skuRow}
                onPress={() => toggleSku(sku.id)}
                disabled={!editing}
              >
                <Ionicons name="square-outline" size={20} color="#B2BEC3" />
                <View style={styles.skuMeta}>
                  <Text style={styles.skuName}>{sku.name}</Text>
                  {sku.category ? <Text style={styles.skuDesc}>{sku.category}</Text> : null}
                </View>
              </TouchableOpacity>
            ))
          : null}
        {!publishedSkus.length ? (
          <Text style={styles.descEmpty}>No published SKUs yet. Publish SKUs in Catalog.</Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Assign to dealers</Text>
        <Text style={styles.hint}>Each dealer can have only one showcase at a time.</Text>
        {!dealers.length ? <Text style={styles.descEmpty}>No approved dealers yet.</Text> : null}
        {dealers.map((d) => {
          const on = dealerPosterMap[d.id] === poster.id;
          return (
            <TouchableOpacity
              key={d.id}
              style={[styles.skuRow, on && styles.skuRowOn]}
              onPress={() => assignDealer(d.id, !on)}
            >
              <Ionicons
                name={on ? 'checkbox' : 'square-outline'}
                size={20}
                color={on ? accent || '#6C5CE7' : '#B2BEC3'}
              />
              <View style={styles.skuMeta}>
                <Text style={styles.skuName}>{d.name}</Text>
                <Text style={styles.skuDesc}>
                  {on ? 'Assigned to this showcase' : dealerPosterMap[d.id] ? 'Assigned to another showcase' : 'Using featured/default'}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.actions}>
        {editing ? (
          <TouchableOpacity style={[styles.primary, { backgroundColor: accent || '#6C5CE7' }]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save</Text>}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.primary, { backgroundColor: accent || '#6C5CE7' }]} onPress={() => setEditing(true)}>
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
  backText: { fontSize: 15, fontWeight: '600' },
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
  nameText: { fontSize: 17, fontWeight: '700', color: '#2D3436', lineHeight: 23 },
  nameInput: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
    borderWidth: 1,
    borderColor: '#DFE6E9',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#fff',
  },
  descText: { fontSize: 13, color: '#636E72', lineHeight: 19, marginTop: 6 },
  descEmpty: { fontSize: 13, color: '#B2BEC3', fontStyle: 'italic', marginTop: 8 },
  descInput: {
    marginTop: 8,
    fontSize: 13,
    color: '#2D3436',
    borderWidth: 1,
    borderColor: '#DFE6E9',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#fff',
    minHeight: 72,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  swatch: { width: 28, height: 28, borderRadius: 14 },
  swatchOn: { borderWidth: 2, borderColor: '#2D3436' },
  optChip: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DFE6E9',
    backgroundColor: '#F8F9FA',
  },
  optChipText: { fontSize: 12, color: '#636E72', fontWeight: '500' },
  optChipTextActive: { fontSize: 12, color: '#2D3436', fontWeight: '700' },
  hint: { fontSize: 12, color: '#636E72', marginTop: 10, lineHeight: 18 },
  bandImage: { width: '100%', height: 120, borderRadius: 10, backgroundColor: '#E9ECEF' },
  bandPlaceholder: {
    height: 88,
    borderRadius: 10,
    backgroundColor: '#E9ECEF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skuRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
  primary: { borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12 },
  primaryText: { color: '#fff', fontWeight: '700' },
  danger: { paddingHorizontal: 18, paddingVertical: 12 },
  dangerText: { color: '#E74C3C', fontWeight: '600' },
});
