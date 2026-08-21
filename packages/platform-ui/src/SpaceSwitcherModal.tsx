import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type SwitcherSpace = {
  spaceId: string;
  space?: {
    name?: string;
    address?: string;
    logoUrl?: string | null;
  };
};

type SpaceSwitcherModalProps = {
  visible: boolean;
  spaces: SwitcherSpace[];
  currentSpaceId?: string | null;
  switching: boolean;
  onClose: () => void;
  onSwitch: (spaceId: string) => void;
  onCreateNew: () => void;
};

export function SpaceSwitcherModal({
  visible,
  spaces,
  currentSpaceId,
  switching,
  onClose,
  onSwitch,
  onCreateNew,
}: SpaceSwitcherModalProps) {
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.handle} />
          <View style={[styles.header, styles.headerCenter]}>
            <Text style={[styles.title, switching && styles.titleHidden]}>Switch Space</Text>
            {switching ? (
              <View style={styles.headerSpinnerWrap}>
                <ActivityIndicator size="small" color="#6C5CE7" />
              </View>
            ) : null}
          </View>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {spaces.map((userSpace) => {
              const selected = currentSpaceId === userSpace.spaceId;
              return (
                <TouchableOpacity
                  key={userSpace.spaceId}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => onSwitch(userSpace.spaceId)}
                  disabled={switching || selected}
                >
                  {userSpace.space?.logoUrl ? (
                    <Image
                      source={{ uri: userSpace.space.logoUrl }}
                      style={[styles.logo, selected ? { backgroundColor: '#E8F4FD' } : null]}
                      resizeMode="cover"
                    />
                  ) : (
                    <View
                      style={[
                        styles.logoPlaceholder,
                        selected ? { borderColor: '#6C5CE7' } : null,
                      ]}
                    >
                      <Ionicons
                        name="business-outline"
                        size={14}
                        color={selected ? '#6C5CE7' : '#636E72'}
                      />
                    </View>
                  )}
                  <View style={styles.optionContent}>
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                      {userSpace.space?.name || 'Unnamed Space'}
                    </Text>
                    {userSpace.space?.address ? (
                      <Text style={styles.address} numberOfLines={1}>
                        {userSpace.space.address}
                      </Text>
                    ) : null}
                  </View>
                  {selected ? <Ionicons name="checkmark" size={20} color="#6C5CE7" /> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <View style={styles.footer}>
            <TouchableOpacity style={styles.createButton} onPress={onCreateNew} disabled={switching}>
              <Ionicons name="add-circle-outline" size={20} color="#6C5CE7" />
              <Text style={styles.createButtonText}>Create a New</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 20,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#D1D5DB',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  headerCenter: { justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '600', color: '#2D3436' },
  titleHidden: { opacity: 0 },
  headerSpinnerWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scroll: { maxHeight: 500 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    gap: 12,
  },
  optionSelected: { backgroundColor: '#E8F4FD' },
  logo: { width: 20, height: 20, borderRadius: 6, backgroundColor: '#E9ECEF' },
  logoPlaceholder: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    backgroundColor: '#F8F9FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionContent: { flex: 1 },
  optionText: { flex: 1, fontSize: 16, color: '#2D3436', fontWeight: '500' },
  optionTextSelected: { color: '#6C5CE7', fontWeight: '600' },
  address: { fontSize: 14, color: '#636E72' },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: '#E9ECEF',
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F4FF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 8,
  },
  createButtonText: { fontSize: 16, fontWeight: '600', color: '#6C5CE7' },
});
