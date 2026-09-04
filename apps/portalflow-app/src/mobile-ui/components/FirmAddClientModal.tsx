/**
 * Add client floating modal — same layout as Firm → Clients → Add client.
 * Manual entry, or recognition batch with read-only client fields + user-selected SKU.
 */
import { useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CenterModal from '@/components/CenterModal';
import SkuPreview from '@/components/SkuPreview';
import { getFirmSkus, type FirmSku } from '@/lib/firm';
import { createPendingOrderForInvitee, createInviteeOnly } from '@/lib/firm-clients';
import { showToast } from '@/lib/toast';

function filterInviteSkus(all: FirmSku[]): FirmSku[] {
  return all.filter((s) =>
    s.templateStatus != null
      ? s.templateStatus !== 'draft'
      : s.isPublished === true || !!s.taxCountry || !!s.taxScenario
  );
}

export type FirmAddClientRecognitionDisplay = {
  clientName: string;
  contactName: string;
  contactEmail: string;
};

export type FirmAddClientBatchRow = {
  clientName: string;
  contactName: string;
  contactEmail: string;
};

export type FirmAddClientModalProps = {
  visible: boolean;
  onClose: () => void;
  firmSpaceId: string | null;
  /**
   * Pre-loaded SKUs from parent (e.g. clients list). If empty/missing, modal loads when opened.
   */
  inviteSkusFromParent?: FirmSku[];
  variant: 'manual' | 'recognition';
  /** Read-only labels (use "Multiple" for each when batch has multiple rows). */
  recognitionDisplay?: FirmAddClientRecognitionDisplay;
  /** Rows to create on submit (recognition only). */
  batchRows?: FirmAddClientBatchRow[];
  /** manual: pre-select first SKU. recognition: start with no SKU so user must choose. */
  initialSkuSelection: 'first' | 'none';
  onSuccess?: () => void | Promise<void>;
};

export default function FirmAddClientModal({
  visible,
  onClose,
  firmSpaceId,
  inviteSkusFromParent,
  variant,
  recognitionDisplay,
  batchRows,
  initialSkuSelection,
  onSuccess,
}: FirmAddClientModalProps) {
  const [inviteSkus, setInviteSkus] = useState<FirmSku[]>([]);
  const [clientName, setClientName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [addClientSkuId, setAddClientSkuId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSkuMenu, setShowSkuMenu] = useState(false);
  const [selectRect, setSelectRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    if (!visible || !firmSpaceId) return;
    setError(null);
    setShowSkuMenu(false);
    if (variant === 'manual') {
      setClientName('');
      setContactName('');
      setContactEmail('');
    }
    let cancelled = false;
    (async () => {
      let skus: FirmSku[] = [];
      if (inviteSkusFromParent && inviteSkusFromParent.length > 0) {
        skus = inviteSkusFromParent;
      } else {
        const all = await getFirmSkus(firmSpaceId);
        if (cancelled) return;
        skus = filterInviteSkus(all);
      }
      if (cancelled) return;
      setInviteSkus(skus);
      if (initialSkuSelection === 'first') {
        setAddClientSkuId(skus.length > 0 ? skus[0].id : null);
      } else {
        setAddClientSkuId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, firmSpaceId, variant, initialSkuSelection, inviteSkusFromParent]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!showSkuMenu) {
      setSelectRect(null);
      return;
    }
    const measure = () => {
      const el = document.getElementById('firm-add-client-template-select');
      if (el) {
        const r = el.getBoundingClientRect();
        setSelectRect({ left: r.left, top: r.top, width: r.width, height: r.height });
      } else {
        setSelectRect(null);
      }
    };
    measure();
    const t = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(t);
      setSelectRect(null);
    };
  }, [showSkuMenu]);

  const handleClose = useCallback(() => {
    setShowSkuMenu(false);
    setError(null);
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(async () => {
    if (!firmSpaceId) return;
    setSubmitting(true);
    setError(null);
    try {
      if (variant === 'recognition' && batchRows?.length) {
        const rows = batchRows.filter((r) => (r.contactEmail || '').trim());
        if (rows.length === 0) {
          setError('No valid contact emails in this batch.');
          return;
        }
        const hasTemplate = !!addClientSkuId;
        let failed = 0;
        let lastErr: string | null = null;
        for (const row of rows) {
          const email = (row.contactEmail || '').trim().toLowerCase();
          if (!email) {
            failed++;
            lastErr = 'Contact email is required';
            continue;
          }
          let err: Error | null = null;
          if (hasTemplate) {
            const { error: e } = await createPendingOrderForInvitee(firmSpaceId, {
              clientName: row.clientName.trim(),
              contactName: row.contactName.trim(),
              contactEmail: email,
              skuId: addClientSkuId!,
            });
            err = e;
          } else {
            const { error: e } = await createInviteeOnly(firmSpaceId, {
              clientName: row.clientName.trim(),
              contactName: row.contactName.trim(),
              contactEmail: email,
            });
            err = e;
          }
          if (err) {
            failed++;
            lastErr = err.message;
          }
        }
        const created = rows.length - failed;
        if (failed > 0 && created === 0) {
          setError(lastErr ?? 'Create failed');
          return;
        }
        showToast(
          failed > 0
            ? `Created ${created} ${hasTemplate ? 'pending engagement(s)' : 'client(s)'}; ${failed} failed.`
            : `Created ${created} ${hasTemplate ? 'pending engagement(s)' : 'client(s)'}.`,
          created > 0 ? 'success' : 'error'
        );
        await onSuccess?.();
        handleClose();
        return;
      }

      const email = (contactEmail || '').trim().toLowerCase();
      if (!email) {
        setError('Contact email is required to let the client claim this engagement later.');
        return;
      }
      const hasTemplate = !!addClientSkuId;
      let submitError: Error | null = null;
      if (hasTemplate) {
        const { error: e } = await createPendingOrderForInvitee(firmSpaceId, {
          clientName: clientName.trim(),
          contactName: contactName.trim(),
          contactEmail: email,
          skuId: addClientSkuId!,
        });
        submitError = e;
      } else {
        const { error: e } = await createInviteeOnly(firmSpaceId, {
          clientName: clientName.trim(),
          contactName: contactName.trim(),
          contactEmail: email,
        });
        submitError = e;
      }
      if (submitError) {
        setError(submitError.message);
        return;
      }
      showToast(
        hasTemplate ? 'Pending engagement created.' : 'Client saved. They can link their space when they sign in.',
        'success'
      );
      await onSuccess?.();
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }, [
    firmSpaceId,
    variant,
    batchRows,
    addClientSkuId,
    clientName,
    contactName,
    contactEmail,
    onSuccess,
    handleClose,
  ]);

  const subtitle =
    variant === 'recognition'
      ? 'Review the recognized details and choose a service template. The same template applies to all clients in this batch.'
      : 'Add a client and create a service engagement.\nYou can invite clients to sign up and collaborate,\nAI Cody can batch process your clients info later.';

  const readOnly = variant === 'recognition' && recognitionDisplay;

  if (!firmSpaceId) return null;
  if (variant === 'recognition' && (!recognitionDisplay || !batchRows?.length)) {
    return null;
  }

  return (
    <>
      {Platform.OS === 'web' &&
        showSkuMenu &&
        selectRect &&
        typeof document !== 'undefined' &&
        document.body &&
        createPortal(
          <div
            style={{
              position: 'absolute',
              left: selectRect.left,
              top: selectRect.top + selectRect.height + 4,
              width: selectRect.width,
              zIndex: 99999,
            }}
          >
            <View style={styles.addClientSelectDropdown}>
              <ScrollView
                style={styles.addClientSelectDropdownScroll}
                contentContainerStyle={styles.addClientSelectDropdownContent}
                nestedScrollEnabled
              >
                <TouchableOpacity
                  key="__none__"
                  style={[styles.addClientSelectOption, !addClientSkuId && styles.addClientSelectOptionSelected]}
                  onPress={() => {
                    setAddClientSkuId(null);
                    setShowSkuMenu(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.addClientSelectOptionTitle,
                      !addClientSkuId && styles.addClientSelectOptionTitleSelected,
                    ]}
                    numberOfLines={1}
                  >
                    Create client only (no template)
                  </Text>
                </TouchableOpacity>
                {inviteSkus.map((sku) => (
                  <TouchableOpacity
                    key={sku.id}
                    style={[
                      styles.addClientSelectOption,
                      addClientSkuId === sku.id && styles.addClientSelectOptionSelected,
                    ]}
                    onPress={() => {
                      setAddClientSkuId(sku.id);
                      setShowSkuMenu(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.addClientSelectOptionTitle,
                        addClientSkuId === sku.id && styles.addClientSelectOptionTitleSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {sku.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </div>,
          document.body
        )}
      <CenterModal visible={visible} title="Add client" onClose={handleClose} maxWidth={840} cardHeight={660}>
        <View style={styles.addClientFormRow}>
          <ScrollView
            style={styles.addClientFormScroll}
            contentContainerStyle={styles.addClientFormScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.addClientSubtitle}>{subtitle}</Text>
            {variant === 'recognition' && batchRows && batchRows.length > 1 ? (
              <Text style={styles.addClientBatchHint}>
                Creating {batchRows.length} clients with the same service choice below.
              </Text>
            ) : null}
            <View style={styles.addClientLeft}>
              <View style={[styles.addClientField, { marginTop: 8 }]}>
                <Text style={styles.addClientLabel}>Client name</Text>
                {readOnly ? (
                  <View style={[styles.addClientInput, styles.addClientReadOnly]}>
                    <Text style={styles.addClientReadOnlyText} numberOfLines={3}>
                      {recognitionDisplay!.clientName}
                    </Text>
                  </View>
                ) : (
                  <TextInput
                    style={styles.addClientInput}
                    placeholder="Company or client name"
                    placeholderTextColor="#95A5A6"
                    value={clientName}
                    onChangeText={setClientName}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                )}
              </View>
              <View style={styles.addClientField}>
                <Text style={styles.addClientLabel}>Contact name</Text>
                {readOnly ? (
                  <View style={[styles.addClientInput, styles.addClientReadOnly]}>
                    <Text style={styles.addClientReadOnlyText} numberOfLines={3}>
                      {recognitionDisplay!.contactName}
                    </Text>
                  </View>
                ) : (
                  <TextInput
                    style={styles.addClientInput}
                    placeholder="Contact person name"
                    placeholderTextColor="#95A5A6"
                    value={contactName}
                    onChangeText={setContactName}
                    autoCapitalize="words"
                  />
                )}
              </View>
              <View style={styles.addClientField}>
                <Text style={styles.addClientLabel}>Contact email *</Text>
                {readOnly ? (
                  <View style={[styles.addClientInput, styles.addClientReadOnly]}>
                    <Text style={styles.addClientReadOnlyText} numberOfLines={3}>
                      {recognitionDisplay!.contactEmail}
                    </Text>
                  </View>
                ) : (
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
                )}
              </View>
              <View style={styles.addClientField}>
                <Text style={styles.addClientLabel}>Service template</Text>
                {inviteSkus.length === 0 ? (
                  <View style={[styles.addClientSelect, styles.addClientSelectDisabled]}>
                    <Text style={styles.addClientSelectPlaceholder}>
                      Configure Service Catalog in the Firm module first.
                    </Text>
                  </View>
                ) : (
                  <View
                    style={[
                      styles.addClientSelectWrapper,
                      showSkuMenu && Platform.OS !== 'web' && styles.addClientSelectWrapperMenuOpen,
                    ]}
                    {...(Platform.OS === 'web' ? { nativeID: 'firm-add-client-template-select' } : {})}
                  >
                    <TouchableOpacity
                      style={styles.addClientSelect}
                      onPress={() => setShowSkuMenu((v) => !v)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.addClientSelectText} numberOfLines={1}>
                        {addClientSkuId
                          ? inviteSkus.find((s) => s.id === addClientSkuId)?.name ?? 'Select a service template'
                          : 'Create client only (no template)'}
                      </Text>
                      <Ionicons name={showSkuMenu ? 'chevron-up' : 'chevron-down'} size={18} color="#636E72" />
                    </TouchableOpacity>
                    {showSkuMenu && Platform.OS !== 'web' && (
                      <View style={styles.addClientSelectDropdown}>
                        <ScrollView
                          style={styles.addClientSelectDropdownScroll}
                          contentContainerStyle={styles.addClientSelectDropdownContent}
                          nestedScrollEnabled
                        >
                          <TouchableOpacity
                            key="__none__"
                            style={[styles.addClientSelectOption, !addClientSkuId && styles.addClientSelectOptionSelected]}
                            onPress={() => {
                              setAddClientSkuId(null);
                              setShowSkuMenu(false);
                            }}
                            activeOpacity={0.7}
                          >
                            <Text
                              style={[
                                styles.addClientSelectOptionTitle,
                                !addClientSkuId && styles.addClientSelectOptionTitleSelected,
                              ]}
                              numberOfLines={1}
                            >
                              Create client only (no template)
                            </Text>
                          </TouchableOpacity>
                          {inviteSkus.map((sku) => (
                            <TouchableOpacity
                              key={sku.id}
                              style={[
                                styles.addClientSelectOption,
                                addClientSkuId === sku.id && styles.addClientSelectOptionSelected,
                              ]}
                              onPress={() => {
                                setAddClientSkuId(sku.id);
                                setShowSkuMenu(false);
                              }}
                              activeOpacity={0.7}
                            >
                              <Text
                                style={[
                                  styles.addClientSelectOptionTitle,
                                  addClientSkuId === sku.id && styles.addClientSelectOptionTitleSelected,
                                ]}
                                numberOfLines={1}
                              >
                                {sku.name}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    )}
                  </View>
                )}
              </View>
              <View style={{ height: 48 }} />
              <View style={[styles.addClientField, { opacity: 0.6 }]}>
                <View style={styles.addClientCheckboxRow} pointerEvents="none">
                  <Ionicons name="square-outline" size={18} color="#B2BEC3" style={{ marginRight: 6 }} />
                  <Text style={[styles.addClientCheckboxLabel, { color: '#95A5A6' }]}>
                    Invite to sign up Portalflow via email?
                  </Text>
                </View>
              </View>
              {error ? <Text style={styles.addClientError}>{error}</Text> : null}
            </View>
            <View style={[styles.addClientBtnRow, styles.addClientBtnRowBelowDropdown]}>
              <TouchableOpacity style={styles.addClientSecondaryBtn} onPress={handleClose} activeOpacity={0.7}>
                <Text style={styles.addClientSecondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.addClientPrimaryBtn, submitting && styles.primaryBtnDisabled]}
                onPress={handleSubmit}
                disabled={submitting}
                activeOpacity={0.7}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.addClientPrimaryBtnText}>
                    {addClientSkuId ? 'Create Engagement' : 'Save Client'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
          <View style={styles.addClientRight}>
            <Text style={styles.addClientPreviewTitle}>Service preview</Text>
            {addClientSkuId ? (
              <SkuPreview sku={inviteSkus.find((s) => s.id === addClientSkuId) ?? null} />
            ) : (
              <View style={styles.addClientNoTemplateBox}>
                <Text style={styles.addClientNoTemplateTitle}>Create client with no engagement attached</Text>
                <Text style={styles.addClientNoTemplateDesc}>
                  You will create this client profile without creating a service engagement.
                </Text>
                <Text style={styles.addClientNoTemplateDesc}>
                  You can start a new service order for this client later from the client info page.
                </Text>
              </View>
            )}
          </View>
        </View>
      </CenterModal>
    </>
  );
}

const styles = StyleSheet.create({
  addClientFormScroll: {
    maxHeight: 560,
  },
  addClientFormScrollContent: {
    padding: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  addClientFormRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 24,
    position: 'relative',
    overflow: 'visible',
  },
  addClientLeft: {
    flex: 1,
    overflow: 'visible',
  },
  addClientRight: {
    width: 400,
    paddingRight: 12,
    flexShrink: 0,
  },
  addClientSubtitle: {
    fontSize: 13,
    color: '#636E72',
    lineHeight: 18,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  addClientBatchHint: {
    fontSize: 12,
    color: '#636E72',
    marginBottom: 12,
    marginTop: -12,
  },
  addClientField: {
    marginBottom: 16,
  },
  addClientLabel: {
    fontSize: 13,
    color: '#636E72',
    marginBottom: 6,
    fontWeight: '500',
  },
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
  addClientReadOnly: {
    backgroundColor: '#F0F2F5',
  },
  addClientReadOnlyText: {
    fontSize: 14,
    color: '#2D3436',
  },
  addClientError: {
    fontSize: 12,
    color: '#D63031',
    marginBottom: 12,
  },
  addClientBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
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
  addClientSecondaryBtnText: {
    fontSize: 13,
    color: '#636E72',
    fontWeight: '500',
  },
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
  primaryBtnDisabled: {
    opacity: 0.5,
  },
  addClientPrimaryBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  addClientPreviewTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#636E72',
    marginBottom: 8,
  },
  addClientCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addClientCheckboxLabel: {
    fontSize: 13,
    color: '#2D3436',
    flex: 1,
  },
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
  addClientNoTemplateTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 6,
  },
  addClientNoTemplateDesc: {
    fontSize: 13,
    color: '#636E72',
    lineHeight: 18,
    marginBottom: 2,
  },
  addClientSelectWrapper: {
    marginTop: 4,
    position: 'relative',
    zIndex: 50,
  },
  addClientSelectWrapperMenuOpen: {
    zIndex: 10000,
    elevation: 10000,
  },
  addClientBtnRowBelowDropdown: {
    zIndex: 0,
    elevation: 0,
  },
  addClientSelect: {
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    backgroundColor: '#F8F9FA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addClientSelectDisabled: {
    opacity: 0.6,
  },
  addClientSelectText: {
    flex: 1,
    fontSize: 13,
    color: '#636E72',
    marginRight: 8,
  },
  addClientSelectPlaceholder: {
    fontSize: 13,
    color: '#B2BEC3',
  },
  addClientSelectDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    backgroundColor: '#FFFFFF',
    maxHeight: 220,
    overflow: 'hidden',
    zIndex: 9999,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  addClientSelectDropdownScroll: {
    maxHeight: 220,
  },
  addClientSelectDropdownContent: {
    paddingVertical: 4,
  },
  addClientSelectOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F2F5',
  },
  addClientSelectOptionSelected: {
    backgroundColor: 'rgba(108,92,231,0.06)',
  },
  addClientSelectOptionTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#2D3436',
    marginBottom: 2,
  },
  addClientSelectOptionTitleSelected: {
    color: '#6C5CE7',
  },
});
