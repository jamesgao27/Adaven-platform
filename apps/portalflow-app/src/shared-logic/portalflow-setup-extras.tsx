import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SetupExtrasContext } from '@adaven/platform-ui';

export function PortalflowSetupExtras({ kind, extras, setExtras }: SetupExtrasContext) {
  const clientProfileType = (extras.clientProfileType as string) || 'household';
  const verificationFileUri = extras.verificationFileUri as string | undefined;

  if (kind === 'consumer') {
    return (
      <View style={styles.block}>
        <Text style={styles.label}>Client profile</Text>
        <View style={styles.row}>
          {(['household', 'business'] as const).map((id) => (
            <TouchableOpacity
              key={id}
              style={[styles.option, clientProfileType === id && styles.optionSelected]}
              onPress={() => setExtras({ ...extras, clientProfileType: id })}
            >
              <Ionicons
                name={clientProfileType === id ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={clientProfileType === id ? '#6C5CE7' : '#BDC3C7'}
              />
              <Text style={[styles.optionText, clientProfileType === id && styles.optionTextSelected]}>
                {id === 'household' ? 'Household' : 'Business'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  if (kind === 'provider') {
    return (
      <View style={styles.block}>
        <Text style={styles.label}>Verification document * (e.g. practice certificate)</Text>
        <Text style={styles.hint}>Firm features will be enabled after approval.</Text>
        <TouchableOpacity
          style={styles.fileButton}
          onPress={async () => {
            const ImagePicker = await import('expo-image-picker');
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              allowsEditing: false,
            });
            if (!result.canceled && result.assets?.[0]?.uri) {
              setExtras({ ...extras, verificationFileUri: result.assets[0].uri });
            }
          }}
        >
          <Ionicons name="document-attach-outline" size={20} color="#6C5CE7" />
          <Text style={styles.fileButtonText}>
            {verificationFileUri ? 'Document selected. Tap to change' : 'Select image to upload'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  block: { marginTop: 4 },
  label: { fontSize: 13, fontWeight: '600', color: '#636E72', marginBottom: 4 },
  hint: { fontSize: 12, color: '#95A5A6', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 12 },
  option: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    backgroundColor: '#F8F9FA',
  },
  optionSelected: { borderColor: '#6C5CE7', backgroundColor: 'rgba(108, 92, 231, 0.06)' },
  optionText: { fontSize: 15, color: '#636E72' },
  optionTextSelected: { color: '#6C5CE7', fontWeight: '600' },
  fileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    backgroundColor: '#F8F9FA',
    borderStyle: 'dashed',
  },
  fileButtonText: { fontSize: 15, color: '#6C5CE7', fontWeight: '500' },
});
