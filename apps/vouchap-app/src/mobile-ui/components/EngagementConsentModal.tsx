import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const TERMS_URL = 'https://vouchap.com/terms';
const PRIVACY_URL = 'https://vouchap.com/privacy';

type Props = {
  visible: boolean;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (payload: { allowPullRecords: boolean }) => void;
};

export default function EngagementConsentModal({
  visible,
  loading = false,
  onClose,
  onConfirm,
}: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const [agreeProject, setAgreeProject] = useState(false);
  const [agreePlatformBoundary, setAgreePlatformBoundary] = useState(false);
  const [agreePullRecords, setAgreePullRecords] = useState(false);
  const useGoldenButtonRatio = windowWidth >= 420;

  useEffect(() => {
    if (!visible) {
      setAgreeProject(false);
      setAgreePlatformBoundary(false);
      setAgreePullRecords(false);
    }
  }, [visible]);

  const canConfirm = useMemo(
    () => agreeProject && agreePlatformBoundary && !loading,
    [agreeProject, agreePlatformBoundary, loading]
  );

  const openUrl = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={loading ? undefined : onClose}
          accessibilityRole="button"
          accessibilityLabel="Close consent modal"
        />
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Engagement Consent & Data Authorization</Text>
            <TouchableOpacity onPress={onClose} disabled={loading} hitSlop={10}>
              <Ionicons name="close" size={20} color="#636E72" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={Platform.OS === 'web'}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            <Text style={styles.intro}>
              Before starting this engagement, please review and confirm the following terms.
            </Text>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>1) Engagement Activation & Project Governance</Text>
                  <Text style={styles.sectionText}>
                    By consenting, you agree to start a client-owned tax-filing project in Vouchap. This project is
                    used for collaboration with your authorized firm team. The firm's deliverables, submissions,
                    and final tax-filing outcomes will be recorded in this project.
                  </Text>
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>2) Document Submission Methods</Text>
                  <Text style={styles.sectionText}>
                    You may provide required tax documents in either of the following ways:
                  </Text>
                  <Text style={styles.bullet}>• Upload documents item-by-item from the Todos list; or</Text>
                  <Text style={styles.bullet}>
                    • Submit documents in batch to the AI agent <Text style={styles.agentName}>Tina</Text> for automatic matching to relevant Todos.
                  </Text>
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>3) Optional Pull Authorization (Expense/Income)</Text>
                  <Text style={styles.sectionText}>
                    You may optionally authorize the firm to pull your expense and income records by tax-season
                    filters. Pulled records are read-only for the firm and used only for tax-filing review and
                    preparation. Pulled records are not converted into firm-owned financial records.
                  </Text>
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>4) Platform Role, Visibility, and Data Access Boundary</Text>
                  <Text style={styles.sectionText}>
                    Vouchap acts only as a transmission and collaboration platform. All required client document
                    checklists and tax-material requests are defined by the firm, not by Vouchap. Your uploaded or
                    linked tax documents are visible only to the firm you authorize. Vouchap and any third party have
                    no right to access your tax materials, except as required to provide the service under your
                    authorization and applicable law.
                  </Text>
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>5) Third-Party Processing and AI Safeguards</Text>
                  <Text style={styles.sectionText}>
                    We use encrypted AI services for document processing. Your tax data is not used for model training.
                  </Text>
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>6) Data Retention and Revocation</Text>
                  <Text style={styles.sectionText}>
                    Your tax materials remain stored in your client-owned space. Access granted to your authorized
                    firm is permission-based and can be revoked by you after engagement completion at any time.
                  </Text>
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>7) Your Control</Text>
                  <Text style={styles.sectionText}>
                    You can manage or revoke pull authorization later in Engagement settings. Revocation affects
                    future pulls and does not retroactively change records already used in this engagement.
                  </Text>
                </View>

                <View style={styles.checkboxSection}>
                  <CheckboxRow
                    checked={agreeProject}
                    onPress={() => setAgreeProject((v) => !v)}
                    label="I agree to start this engagement project and collaborate with my authorized firm in Vouchap."
                  />
                  <CheckboxRow
                    checked={agreePullRecords}
                    onPress={() => setAgreePullRecords((v) => !v)}
                    label="I authorize the firm to pull my expense and income records by tax season for read-only tax-filing review."
                  />
                  <CheckboxRow
                    checked={agreePlatformBoundary}
                    onPress={() => setAgreePlatformBoundary((v) => !v)}
                    label="I understand that Vouchap is only a transmission platform, that document requirements are provided by the firm, and that only my authorized firm can view my tax materials."
                  />
                </View>

          </ScrollView>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              By continuing, you acknowledge and agree to the{' '}
              <Text style={styles.link} onPress={() => openUrl(TERMS_URL)}>Vouchap Terms</Text>
              {' '}and{' '}
              <Text style={styles.link} onPress={() => openUrl(PRIVACY_URL)}>Privacy Policy</Text>.
            </Text>
            <Text style={styles.authorityText}>
              By clicking, you confirm you have the authority to share these tax materials.
            </Text>
            <View style={styles.footerActions}>
              <TouchableOpacity
                style={[styles.cancelBtn, useGoldenButtonRatio && styles.cancelBtnGolden]}
                onPress={onClose}
                disabled={loading}
                activeOpacity={0.85}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  useGoldenButtonRatio && styles.confirmBtnGolden,
                  !canConfirm && styles.btnDisabled,
                ]}
                onPress={() => onConfirm({ allowPullRecords: agreePullRecords })}
                disabled={!canConfirm}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                <Text style={styles.confirmBtnText} numberOfLines={1}>
                  Agree and Start Project
                </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function CheckboxRow({
  checked,
  onPress,
  label,
}: {
  checked: boolean;
  onPress: () => void;
  label: string;
}) {
  return (
    <TouchableOpacity style={styles.checkboxRow} onPress={onPress} activeOpacity={0.85}>
      <Ionicons
        name={checked ? 'checkbox' : 'square-outline'}
        size={20}
        color={checked ? '#6C5CE7' : '#7F8C8D'}
      />
      <Text style={styles.checkboxLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  card: {
    width: '100%',
    maxWidth: 760,
    height: Platform.OS === 'web' ? '92%' : '88%',
    maxHeight: Platform.OS === 'web' ? '92%' : '88%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF1F4',
  },
  title: {
    flex: 1,
    marginRight: 10,
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3436',
  },
  body: { flex: 1, minHeight: 0 },
  bodyContent: { padding: 16, gap: 12, paddingBottom: 20 },
  intro: { fontSize: 13, color: '#636E72', lineHeight: 19 },
  section: { gap: 6 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#2D3436' },
  sectionText: { fontSize: 13, color: '#2D3436', lineHeight: 19 },
  bullet: { fontSize: 13, color: '#2D3436', lineHeight: 19 },
  agentName: { color: '#6C5CE7', fontWeight: '700' },
  checkboxSection: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#EEF1F4',
    paddingTop: 12,
    gap: 10,
  },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  checkboxLabel: { flex: 1, fontSize: 13, color: '#2D3436', lineHeight: 19 },
  footerText: { fontSize: 12, color: '#636E72', lineHeight: 18 },
  link: { color: '#6C5CE7', textDecorationLine: 'underline' },
  footer: {
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#EEF1F4',
  },
  authorityText: {
    fontSize: 12,
    color: '#636E72',
    lineHeight: 18,
  },
  footerActions: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'nowrap',
    alignItems: 'stretch',
  },
  cancelBtn: {
    minWidth: 96,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DDE1E6',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: '#636E72' },
  confirmBtn: {
    flex: 1,
    minWidth: 140,
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: '#6C5CE7',
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF', textAlign: 'center' },
  cancelBtnGolden: { flex: 0.382, minWidth: 0 },
  confirmBtnGolden: { flex: 0.618, minWidth: 0 },
  btnDisabled: { opacity: 0.5 },
});
