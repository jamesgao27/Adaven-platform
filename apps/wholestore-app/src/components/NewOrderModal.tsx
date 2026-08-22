import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CenterModal, showToast } from '@adaven/platform-ui';
import {
  createOrder,
  listDealers,
  listSkus,
  type ProviderDealer,
  type ProviderSku,
} from '@/lib/provider';

type LineDraft = { skuId: string; quantity: string };

export function NewOrderModal({
  visible,
  providerSpaceId,
  presetDealerId,
  onClose,
  onCreated,
}: {
  visible: boolean;
  providerSpaceId: string;
  presetDealerId?: string;
  onClose: () => void;
  onCreated: (orderId: string) => void;
}) {
  const [dealers, setDealers] = useState<ProviderDealer[]>([]);
  const [skus, setSkus] = useState<ProviderSku[]>([]);
  const [dealerId, setDealerId] = useState<string | null>(presetDealerId ?? null);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDealerId(presetDealerId ?? null);
    setLines([]);
    (async () => {
      try {
        const [d, s] = await Promise.all([listDealers(providerSpaceId), listSkus(providerSpaceId)]);
        setDealers(d);
        setSkus(s.filter((x) => x.isPublished || x.name));
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Failed to load', 'error');
      }
    })();
  }, [visible, providerSpaceId, presetDealerId]);

  const toggleSku = (skuId: string) => {
    setLines((prev) => {
      if (prev.some((l) => l.skuId === skuId)) return prev.filter((l) => l.skuId !== skuId);
      return [...prev, { skuId, quantity: '1' }];
    });
  };

  const setQty = (skuId: string, quantity: string) => {
    setLines((prev) => prev.map((l) => (l.skuId === skuId ? { ...l, quantity } : l)));
  };

  const submit = async () => {
    if (!dealerId) {
      showToast('Select a dealer', 'error');
      return;
    }
    const parsed = lines
      .map((l) => ({ skuId: l.skuId, quantity: Number(l.quantity) }))
      .filter((l) => l.skuId && l.quantity > 0);
    if (!parsed.length) {
      showToast('Add at least one SKU', 'error');
      return;
    }
    setSaving(true);
    try {
      const id = await createOrder({ providerSpaceId, consumerId: dealerId, lines: parsed });
      onCreated(id);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to create order', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <CenterModal visible={visible} title="Add order" onClose={onClose} maxWidth={560} cardHeight={560}>
      <Text style={s.label}>Dealer</Text>
      <ScrollView style={{ maxHeight: 140 }} nestedScrollEnabled>
        {dealers.map((d) => (
          <TouchableOpacity
            key={d.id}
            style={[s.row, dealerId === d.id && s.rowOn]}
            onPress={() => setDealerId(d.id)}
          >
            <Text style={[s.rowText, dealerId === d.id && s.rowTextOn]}>{d.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Text style={[s.label, { marginTop: 14 }]}>SKUs</Text>
      <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
        {skus.map((sku) => {
          const line = lines.find((l) => l.skuId === sku.id);
          return (
            <View key={sku.id} style={s.skuRow}>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => toggleSku(sku.id)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons
                    name={line ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={line ? '#6C5CE7' : '#B2BEC3'}
                  />
                  <Text style={s.rowText}>{sku.name}</Text>
                </View>
              </TouchableOpacity>
              {line ? (
                <TextInput
                  style={s.qty}
                  value={line.quantity}
                  onChangeText={(t) => setQty(sku.id, t)}
                  keyboardType="decimal-pad"
                />
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      <TouchableOpacity style={[s.create, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.createText}>Create</Text>}
      </TouchableOpacity>
    </CenterModal>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '700', color: '#95A5A6', letterSpacing: 0.6, marginBottom: 8 },
  row: { paddingVertical: 10, paddingHorizontal: 10, borderRadius: 8 },
  rowOn: { backgroundColor: 'rgba(108, 92, 231, 0.1)' },
  rowText: { fontSize: 14, color: '#2D3436', fontWeight: '500' },
  rowTextOn: { color: '#6C5CE7', fontWeight: '700' },
  skuRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 },
  qty: {
    width: 64,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    textAlign: 'center',
    fontSize: 14,
  },
  create: {
    marginTop: 16,
    backgroundColor: '#6C5CE7',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  createText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
