import React from 'react';
import { Modal, View, Image, Pressable, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { saveAttachmentImageToDevice } from '@/lib/save-image-to-device';
import { useOverlayViewportSize } from '../lib/web-viewport';

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

/** Full-screen image preview. Web uses a DOM img (same as FileDetailModal); native uses RN Image. */
export function AttachmentImagePreviewModal({ visible, uri, onClose }: AttachmentImagePreviewModalProps) {
  const { width, height } = useOverlayViewportSize();
  const frameStyle = {
    width: Math.max(width * 0.92, 1),
    height: Math.max(height * 0.88, 1),
    zIndex: 1,
  } as const;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        {uri && Platform.OS === 'web' ? (
          <View style={frameStyle} pointerEvents="box-none">
            {React.createElement('img', {
              src: uri,
              alt: '',
              style: {
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: 'block',
              },
              onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
            })}
          </View>
        ) : uri ? (
          <Image
            source={{ uri }}
            style={styles.imageFill}
            resizeMode="contain"
            onLongPress={() => promptSaveAttachmentImage(uri)}
            delayLongPress={350}
          />
        ) : null}
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
  imageFill: {
    width: '100%',
    height: '100%',
  },
  close: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 40,
    right: 20,
    zIndex: 2,
  },
  save: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 40,
    right: 68,
    padding: 4,
    zIndex: 2,
  },
});
