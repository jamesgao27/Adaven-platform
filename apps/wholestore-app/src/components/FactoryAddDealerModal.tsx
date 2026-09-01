import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CenterModal, showToast } from '@adaven/platform-ui';
import { createDealer, listSkus, type ProviderSku } from '@/lib/provider';
import { listPosters, posterSkuNames, type ProviderPoster } from '@/lib/posters';

type Props = {
  visible: boolean;
  onClose: () => void;
  providerSpaceId: string | null;
  onSuccess?: () => void | Promise<void>;
};

export default function FactoryAddDealerModal({ visible, onClose, providerSpaceId, onSuccess }: Props) {
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [posters, setPosters] = useState<ProviderPoster[]>([]);
  const [skus, setSkus] = useState<ProviderSku[]>([]);
  const [posterId, setPosterId] = useState<string | null>(null);
  const [loadingPosters, setLoadingPosters] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setName('');
    setContactName('');
    setContactEmail('');
    setPosterId(null);
  }, [visible]);

  useEffect(() => {
    if (!visible || !providerSpaceId) return;
    let cancelled = false;
    (async () => {
      setLoadingPosters(true);
      try {
        const [all, catalog] = await Promise.all([listPosters(providerSpaceId), listSkus(providerSpaceId)]);
        if (cancelled) return;
        const published = all.filter((p) => p.isPublished);
        setPosters(published);
        setSkus(catalog);
        const featured = published.find((p) => p.isMarketplaceFeatured) ?? published.find((p) => p.isSystemDefault);
        setPosterId((featured ?? published[0])?.id ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load posters');
      } finally {
        if (!cancelled) setLoadingPosters(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, providerSpaceId]);

  const handleClose = useCallback(() => {
    setError(null);
    onClose();
  }, [onClose]);

  const selectedPoster = posters.find((p) => p.id === posterId) ?? null;

  const handleSubmit = useCallback(async () => {
    if (!providerSpaceId) return;
    const email = contactEmail.trim().toLowerCase();
    if (!name.trim()) {
      setError('Dealer name is required.');
      return;
    }
    if (!email) {
      setError('Contact email is required to let the dealer claim this record later.');
      return;
    }
    if (!posterId) {
      setError('Select a published poster for this invite.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createDealer({
        providerSpaceId,
        name: name.trim(),
        contactName,
        contactEmail: email,
        posterId,
      });
      showToast('Dealer saved. They can link their space when they sign in.', 'success');
      await onSuccess?.();
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }, [providerSpaceId, name, contactName, contactEmail, posterId, onSuccess, handleClose]);

  if (!providerSpaceId) return null;

  return (
    <CenterModal visible={visible} title="Add dealer" onClose={handleClose} maxWidth={840} cardHeight={660}>
      <View style={styles.addClientFormRow}>
        <ScrollView
          style={styles.addClientFormScroll}
          contentContainerStyle={styles.addClientFormScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.addClientSubtitle}>
            {'Add a dealer with a directed invite.\nChoose the poster they will see, then they claim this record by email.'}
          </Text>
          <View style={styles.addClientLeft}>
            <View style={[styles.addClientField, { marginTop: 8 }]}>
              <Text style={styles.addClientLabel}>Dealer name</Text>
              <TextInput
                style={styles.addClientInput}
                placeholder="Company or dealer name"
                placeholderTextColor="#95A5A6"
                value={name}
                onChangeText={setName}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.addClientField}>
              <Text style={styles.addClientLabel}>Contact name</Text>
              <TextInput
                style={styles.addClientInput}
                placeholder="Contact person name"
                placeholderTextColor="#95A5A6"
                value={contactName}
                onChangeText={setContactName}
                autoCapitalize="words"
              />
            </View>
            <View style={styles.addClientField}>
              <Text style={styles.addClientLabel}>Contact email *</Text>
              <TextInput
                style={styles.addClientInput}
                placeholder="email@example.com"
                placeholderTextColor="#95A5A6"
                value={contactEmail}
                onChangeText={setContactEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.addClientField}>
              <Text style={styles.addClientLabel}>Poster *</Text>
              {loadingPosters ? (
                <ActivityIndicator color="#6C5CE7" />
              ) : posters.length === 0 ? (
                <Text style={styles.addClientError}>Publish a poster in Marketing first.</Text>
              ) : (
                <View style={styles.posterTable}>
                  {posters.map((poster, index) => (
                    <TouchableOpacity
                      key={poster.id}
                      style={[
                        styles.posterRow,
                        posterId === poster.id && styles.posterRowSelected,
                        index === posters.length - 1 && { borderBottomWidth: 0 },
                      ]}
                      onPress={() => setPosterId(poster.id)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[styles.posterName, posterId === poster.id && styles.posterNameSelected]}
                        numberOfLines={1}
                      >
                        {poster.name}
                        {poster.isSystemDefault ? ' · Default' : ''}
                        {poster.isMarketplaceFeatured ? ' · Featured' : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
            {error ? <Text style={styles.addClientError}>{error}</Text> : null}
          </View>
          <View style={[styles.addClientBtnRow, styles.addClientBtnRowBelowDropdown]}>
            <TouchableOpacity style={styles.addClientSecondaryBtn} onPress={handleClose} activeOpacity={0.7}>
              <Text style={styles.addClientSecondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.addClientPrimaryBtn, (submitting || !posterId) && styles.primaryBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting || !posterId}
              activeOpacity={0.7}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.addClientPrimaryBtnText}>Save Dealer</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
        <View style={styles.addClientRight}>
          <Text style={styles.addClientPreviewTitle}>Poster preview</Text>
          <View style={styles.addClientNoTemplateBox}>
            <Text style={styles.addClientNoTemplateTitle}>
              {selectedPoster?.name ?? 'Select a published poster'}
            </Text>
            <Text style={styles.addClientNoTemplateDesc}>
              {selectedPoster?.description ||
                'The dealer sees this poster when they claim the invite. No order is created.'}
            </Text>
            {selectedPoster ? (
              <Text style={styles.addClientNoTemplateDesc}>
                {posterSkuNames(selectedPoster, skus) || 'No published SKUs on this poster yet.'}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </CenterModal>
  );
}

const styles = StyleSheet.create({
  addClientFormScroll: { maxHeight: 560 },
  addClientFormScrollContent: { padding: 20, paddingTop: 8, paddingBottom: 12 },
  addClientFormRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 24,
    position: 'relative',
    overflow: 'visible',
  },
  addClientLeft: { flex: 1, overflow: 'visible' },
  addClientRight: { width: 400, paddingRight: 12, flexShrink: 0 },
  addClientSubtitle: { fontSize: 13, color: '#636E72', lineHeight: 18, marginBottom: 20, flexWrap: 'wrap' },
  addClientField: { marginBottom: 16 },
  addClientLabel: { fontSize: 13, color: '#636E72', marginBottom: 6, fontWeight: '500' },
  addClientInput: {
    fontSize: 14,
    color: '#2D3436',
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  addClientError: { fontSize: 12, color: '#D63031', marginBottom: 12 },
  posterTable: {
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  posterRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F2F5',
  },
  posterRowSelected: { backgroundColor: 'rgba(108, 92, 231, 0.06)' },
  posterName: { fontSize: 14, fontWeight: '500', color: '#2D3436' },
  posterNameSelected: { color: '#6C5CE7' },
  addClientBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  addClientBtnRowBelowDropdown: { zIndex: 0, elevation: 0 },
  addClientSecondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  addClientSecondaryBtnText: { fontSize: 13, color: '#636E72', fontWeight: '500' },
  addClientPrimaryBtn: {
    flex: 1.618,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#6C5CE7',
  },
  primaryBtnDisabled: { opacity: 0.5 },
  addClientPrimaryBtnText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  addClientPreviewTitle: { fontSize: 13, fontWeight: '600', color: '#636E72', marginBottom: 8 },
  addClientNoTemplateBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E4F0',
    backgroundColor: '#FDFBFF',
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 560,
    maxHeight: 560,
    justifyContent: 'center',
  },
  addClientNoTemplateTitle: { fontSize: 14, fontWeight: '600', color: '#2D3436', marginBottom: 6 },
  addClientNoTemplateDesc: { fontSize: 13, color: '#636E72', lineHeight: 18, marginBottom: 8 },
});
