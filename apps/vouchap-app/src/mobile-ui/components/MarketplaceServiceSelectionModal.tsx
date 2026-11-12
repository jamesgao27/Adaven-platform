/**
 * Client Service Marketplace — confirm template choice.
 * Layout mirrors {@link FirmAddClientModal}: CenterModal + two columns; right pane uses {@link SkuPreview} like Add client.
 */
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import CenterModal from '@/components/CenterModal';
import SkuPreview from '@/components/SkuPreview';
import type { FirmSku } from '@/types';

const NEXT_STEPS_FONT_SIZE = 13;

const NEXT_STEP_LINES = [
  'You will start a service order for this offering.',
  'Your firm will contact you about next steps for this engagement.',
  'Please watch your inbox for related email from your firm.',
] as const;

const SUBTITLE =
  'Review your firm and service choice before continuing.\nAfter you continue, you will confirm consent to start this engagement.';

/**
 * Right column total height: one line "Service preview" + {@link SkuPreview} card.
 * Use **fixed row height** (not minHeight): otherwise a tall left column grows the row and stretches
 * the right column, leaving empty space under the preview so buttons look too low vs the card bottom.
 */
const SKU_PREVIEW_CARD_HEIGHT = 560;
const PREVIEW_TITLE_LINE_HEIGHT = 18;
const PREVIEW_TITLE_MARGIN_BOTTOM = 8;
const PREVIEW_COLUMN_HEIGHT =
  SKU_PREVIEW_CARD_HEIGHT + PREVIEW_TITLE_LINE_HEIGHT + PREVIEW_TITLE_MARGIN_BOTTOM;

type Props = {
  visible: boolean;
  firmName: string;
  templateName: string;
  /** Full SKU row from the catalog — same as Add client preview source. */
  previewSku?: FirmSku | null;
  onCancel: () => void;
  onContinue: () => void;
};

export default function MarketplaceServiceSelectionModal({
  visible,
  firmName,
  templateName,
  previewSku,
  onCancel,
  onContinue,
}: Props) {
  return (
    <CenterModal visible={visible} title="Confirm your selection" onClose={onCancel} maxWidth={840} cardHeight={660}>
      <View style={styles.formRow}>
        <View style={styles.leftPane}>
          <ScrollView
            style={styles.leftScroll}
            contentContainerStyle={styles.leftScrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.subtitle}>{SUBTITLE}</Text>
            <View style={styles.highlightBlock}>
              <Text style={styles.metaLabel}>Firm</Text>
              <Text style={styles.firmName}>{firmName.trim() || '—'}</Text>
              <Text style={[styles.metaLabel, styles.metaLabelSecond]}>Service</Text>
              <Text style={styles.templateName}>{templateName.trim() || '—'}</Text>
            </View>

            <View style={styles.nextStepsBlock}>
              {NEXT_STEP_LINES.map((line, index) => (
                <View key={line} style={styles.nextStepRow}>
                  <View style={styles.stepBulletCol}>
                    <Text style={styles.stepBulletMark} accessibilityLabel={`Step ${index + 1}`}>
                      •
                    </Text>
                  </View>
                  <View style={styles.stepTextCol}>
                    <Text style={styles.nextStepsLine}>{line}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onCancel} activeOpacity={0.7}>
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={onContinue} activeOpacity={0.7}>
              <Text style={styles.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.rightCol}>
          <Text style={styles.previewTitle}>Service preview</Text>
          {previewSku ? (
            <SkuPreview sku={previewSku} maxHeight={SKU_PREVIEW_CARD_HEIGHT} />
          ) : (
            <View style={styles.previewPlaceholder}>
              <Text style={styles.previewPlaceholderText}>No template selected.</Text>
            </View>
          )}
        </View>
      </View>
    </CenterModal>
  );
}

/** Layout tokens aligned with `FirmAddClientModal` (addClientFormRow / addClientRight / buttons). */
const styles = StyleSheet.create({
  formRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 24,
    height: PREVIEW_COLUMN_HEIGHT,
    position: 'relative',
    overflow: 'visible',
  },
  leftPane: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'column',
    height: PREVIEW_COLUMN_HEIGHT,
  },
  leftScroll: {
    flex: 1,
    minHeight: 0,
  },
  leftScrollContent: {
    padding: 20,
    paddingTop: 8,
    paddingBottom: 12,
    flexGrow: 1,
  },
  rightCol: {
    width: 400,
    paddingRight: 12,
    flexShrink: 0,
    height: PREVIEW_COLUMN_HEIGHT,
    justifyContent: 'flex-start',
  },
  subtitle: {
    fontSize: 13,
    color: '#636E72',
    lineHeight: 18,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  previewTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#636E72',
    lineHeight: PREVIEW_TITLE_LINE_HEIGHT,
    marginBottom: PREVIEW_TITLE_MARGIN_BOTTOM,
  },
  previewPlaceholder: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E4F0',
    backgroundColor: '#F8F9FA',
    minHeight: SKU_PREVIEW_CARD_HEIGHT,
    maxHeight: SKU_PREVIEW_CARD_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  previewPlaceholderText: {
    fontSize: 13,
    color: '#95A5A6',
    textAlign: 'center',
  },
  highlightBlock: {
    alignSelf: 'stretch',
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    marginBottom: 16,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#95A5A6',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metaLabelSecond: {
    marginTop: 12,
  },
  firmName: {
    alignSelf: 'stretch',
    marginTop: 4,
    fontSize: 18,
    fontWeight: '700',
    color: '#2D3436',
    lineHeight: 24,
  },
  templateName: {
    alignSelf: 'stretch',
    marginTop: 4,
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
    lineHeight: 22,
  },
  nextStepsBlock: {
    alignSelf: 'stretch',
    gap: 8,
    marginBottom: 8,
  },
  nextStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    width: '100%',
  },
  stepBulletCol: {
    flexShrink: 0,
    paddingTop: 1,
    paddingRight: 6,
  },
  stepBulletMark: {
    fontSize: NEXT_STEPS_FONT_SIZE,
    lineHeight: 19,
    color: '#636E72',
    fontWeight: '700',
  },
  stepTextCol: {
    flex: 1,
    minWidth: 0,
  },
  nextStepsLine: {
    alignSelf: 'stretch',
    width: '100%',
    fontSize: NEXT_STEPS_FONT_SIZE,
    color: '#636E72',
    lineHeight: 19,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 0,
    flexShrink: 0,
  },
  secondaryBtn: {
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
  secondaryBtnText: {
    fontSize: 13,
    color: '#636E72',
    fontWeight: '500',
  },
  primaryBtn: {
    flex: 1.618,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#6C5CE7',
  },
  primaryBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
});
