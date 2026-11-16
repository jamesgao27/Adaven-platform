import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { showToast } from '@adaven/platform-ui';
import { listDealers, listSkus, requireProviderSpace, type ProviderDealer, type ProviderSku } from '@/lib/provider';
import {
  assignPriceListToConsumer,
  clearConsumerPriceList,
  createPriceList,
  getConsumerPriceListId,
  listPriceListItems,
  listPriceLists,
  setDefaultPriceList,
  upsertPriceListItem,
  type PriceList,
  type PriceListItem,
} from '@/lib/pricing';

export default function PricingScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [lists, setLists] = useState<PriceList[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [skus, setSkus] = useState<ProviderSku[]>([]);
  const [dealers, setDealers] = useState<ProviderDealer[]>([]);
  const [dealerListMap, setDealerListMap] = useState<Record<string, string | null>>({});
  const [newListName, setNewListName] = useState('');
  const [addSkuId, setAddSkuId] = useState<string | null>(null);
  const [addPrice, setAddPrice] = useState('6.59');
  const [addMoq, setAddMoq] = useState('1');

  const load = useCallback(async () => {
    const space = await requireProviderSpace();
    if (!space) {
      router.replace('/');
      return;
    }
    setSpaceId(space.id);
    const [pl, catalog, dealerRows] = await Promise.all([
      listPriceLists(space.id),
      listSkus(space.id),
      listDealers(space.id),
    ]);
    setLists(pl);
    setSkus(catalog);
    setDealers(dealerRows.filter((d) => d.status === 'approved'));
    const nextSelected = selectedId && pl.some((l) => l.id === selectedId) ? selectedId : pl[0]?.id ?? null;
    setSelectedId(nextSelected);
    if (nextSelected) setItems(await listPriceListItems(nextSelected));
    else setItems([]);
    const map: Record<string, string | null> = {};
    await Promise.all(
      dealerRows.map(async (d) => {
        map[d.id] = await getConsumerPriceListId(d.id);
      }),
    );
    setDealerListMap(map);
  }, [router, selectedId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Failed to load pricing', 'error');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
    }, [load]),
  );

  const selectList = async (id: string) => {
    setSelectedId(id);
    setItems(await listPriceListItems(id));
  };

  const createList = async () => {
    if (!spaceId) return;
    try {
      const created = await createPriceList(spaceId, newListName || 'Price list');
      setNewListName('');
      showToast('Price list created', 'success');
      await load();
      await selectList(created.id);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to create', 'error');
    }
  };

  const makeDefault = async () => {
    if (!spaceId || !selectedId) return;
    try {
      await setDefaultPriceList(spaceId, selectedId);
      showToast('Default price list updated', 'success');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  };

  const saveItem = async () => {
    if (!selectedId || !addSkuId) {
      showToast('Select a SKU', 'error');
      return;
    }
    const unitPrice = Number(addPrice);
    const moq = Number(addMoq);
    if (!(unitPrice >= 0) || !(moq > 0)) {
      showToast('Enter a valid price and MOQ', 'error');
      return;
    }
    try {
      await upsertPriceListItem(selectedId, addSkuId, unitPrice, moq);
      showToast('Price saved', 'success');
      setItems(await listPriceListItems(selectedId));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to save price', 'error');
    }
  };

  const assignDealer = async (dealerId: string, priceListId: string | null) => {
    try {
      if (priceListId) await assignPriceListToConsumer(dealerId, priceListId);
      else await clearConsumerPriceList(dealerId);
      showToast('Dealer price list updated', 'success');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to assign', 'error');
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6C5CE7" />
      </View>
    );
  }

  const selected = lists.find((l) => l.id === selectedId) ?? null;
  const pricedSkuIds = new Set(items.map((i) => i.skuId));
  const addableSkus = skus.filter((s) => !pricedSkuIds.has(s.id) || s.id === addSkuId);

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <Text style={styles.title}>Pricing</Text>
      <Text style={styles.sub}>Maintain price lists and MOQ. Assign a list to each dealer (or use Default).</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Price lists</Text>
        {lists.map((list) => (
          <TouchableOpacity
            key={list.id}
            style={[styles.listRow, selectedId === list.id && styles.listRowActive]}
            onPress={() => selectList(list.id)}
          >
            <Text style={styles.listName}>
              {list.name}
              {list.isDefault ? ' (Default)' : ''}
            </Text>
            <Ionicons name="chevron-forward" size={16} color="#95A5A6" />
          </TouchableOpacity>
        ))}
        <View style={styles.createRow}>
          <TextInput
            style={styles.input}
            placeholder="New list name"
            value={newListName}
            onChangeText={setNewListName}
          />
          <TouchableOpacity style={styles.btn} onPress={createList}>
            <Text style={styles.btnText}>Add</Text>
          </TouchableOpacity>
        </View>
        {selected ? (
          <TouchableOpacity style={styles.linkBtn} onPress={makeDefault} disabled={selected.isDefault}>
            <Text style={styles.linkText}>{selected.isDefault ? 'This is the default list' : 'Set as default'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {selected ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Items · {selected.name}</Text>
          {items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{item.skuName}</Text>
                <Text style={styles.itemMeta}>
                  {item.skuCode || '—'} · ${item.unitPrice.toFixed(2)} · MOQ {item.moq}
                </Text>
              </View>
            </View>
          ))}
          {!items.length ? <Text style={styles.empty}>No priced SKUs yet. Sync ERP or add a row.</Text> : null}

          <Text style={[styles.cardTitle, { marginTop: 12 }]}>Add / update SKU</Text>
          <ScrollView horizontal style={{ marginBottom: 8 }}>
            {addableSkus.slice(0, 40).map((s) => (
              <TouchableOpacity
                key={s.id}
                style={[styles.chip, addSkuId === s.id && styles.chipOn]}
                onPress={() => setAddSkuId(s.id)}
              >
                <Text style={styles.chipText} numberOfLines={1}>
                  {s.skuCode || s.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.createRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Unit price"
              keyboardType="decimal-pad"
              value={addPrice}
              onChangeText={setAddPrice}
            />
            <TextInput
              style={[styles.input, { width: 80 }]}
              placeholder="MOQ"
              keyboardType="decimal-pad"
              value={addMoq}
              onChangeText={setAddMoq}
            />
            <TouchableOpacity style={styles.btn} onPress={saveItem}>
              <Text style={styles.btnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Assign to dealers</Text>
        {!dealers.length ? <Text style={styles.empty}>No approved dealers yet.</Text> : null}
        {dealers.map((d) => {
          const assigned = dealerListMap[d.id];
          return (
            <View key={d.id} style={styles.dealerBlock}>
              <Text style={styles.itemName}>{d.name}</Text>
              <Text style={styles.itemMeta}>
                {assigned
                  ? `Assigned: ${lists.find((l) => l.id === assigned)?.name || assigned}`
                  : 'Using Default list'}
              </Text>
              <ScrollView horizontal>
                <TouchableOpacity style={styles.chip} onPress={() => assignDealer(d.id, null)}>
                  <Text style={styles.chipText}>Default</Text>
                </TouchableOpacity>
                {lists.map((l) => (
                  <TouchableOpacity
                    key={l.id}
                    style={[styles.chip, assigned === l.id && styles.chipOn]}
                    onPress={() => assignDealer(d.id, l.id)}
                  >
                    <Text style={styles.chipText}>{l.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { padding: 20, paddingBottom: 48, maxWidth: 800 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#2D3436', marginBottom: 6 },
  sub: { fontSize: 14, color: '#636E72', marginBottom: 16, lineHeight: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#2D3436', marginBottom: 10 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ECEFF1',
  },
  listRowActive: { backgroundColor: '#F3F0FF' },
  listName: { fontSize: 14, color: '#2D3436', fontWeight: '500' },
  createRow: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#DFE6E9',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  btn: { backgroundColor: '#6C5CE7', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: '600' },
  linkBtn: { marginTop: 10 },
  linkText: { color: '#6C5CE7', fontWeight: '600' },
  itemRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ECEFF1' },
  itemName: { fontSize: 14, fontWeight: '500', color: '#2D3436' },
  itemMeta: { fontSize: 12, color: '#636E72', marginTop: 2 },
  empty: { fontSize: 13, color: '#95A5A6' },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F1F2F6',
    marginRight: 6,
    maxWidth: 160,
  },
  chipOn: { backgroundColor: '#D6CCFF' },
  chipText: { fontSize: 12, color: '#2D3436' },
  dealerBlock: { marginBottom: 14 },
});
