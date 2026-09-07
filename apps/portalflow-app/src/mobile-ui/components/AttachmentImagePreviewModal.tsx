import { Modal, View, Image, Pressable, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { saveAttachmentImageToDevice } from '@/lib/save-image-to-device';

export function promptSaveAttachmentImage(uri: string) {
  if (!uri) return;
  if (Platform.OS === 'web') {
    void saveAttachmentImageToDevice(uri);
    return;
  }
  Alert.alert('Save image', 'Save this image to your device?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Save', onPress: () => { void saveAttachmentImageToDevice(uri); } },
  ]);
}

interface AttachmentImagePreviewModalProps {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
}

/** Full-screen image preview. Long-press (or the download button) saves the image. */
export function AttachmentImagePreviewModal({ visible, uri, onClose }: AttachmentImagePreviewModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.content} pointerEvents="box-none">
          {uri ? (
            <Pressable
              style={styles.image}
              onLongPress={() => promptSaveAttachmentImage(uri)}
              delayLongPress={350}
            >
              <Image source={{ uri }} style={styles.image} resizeMode="contain" />
            </Pressable>
          ) : null}
        </View>
        <TouchableOpacity style={styles.close} onPress={onClose} hitSlop={8}>
          <Ionicons name="close-circle" size={36} color="rgba(255,255,255,0.9)" />
        </TouchableOpacity>
        {uri ? (
          <TouchableOpacity
            style={styles.save}
            onPress={() => promptSaveAttachmentImage(uri)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Save image"
          >
            <Ionicons name="download-outline" size={28} color="rgba(255,255,255,0.95)" />
          </TouchableOpacity>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  close: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 40,
    right: 20,
  },
  save: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 40,
    right: 68,
    padding: 4,
  },
});
