import React, { useRef } from 'react';
import {
  Modal,
  View,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
  PanResponder,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { saveAttachmentImageToDevice } from '@/lib/save-image-to-device';
import { useOverlayViewportSize } from '../lib/web-viewport';
import { previewStatusBarInset } from '../lib/preview-status-bar';

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

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/** Native photo-viewer gestures: pinch zoom, drag while zoomed, double-tap to zoom. */
function ZoomableImage({ uri }: { uri: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const state = useRef({
    scale: 1,
    x: 0,
    y: 0,
    pinchDist: 0,
    pinchScale: 1,
    lastTap: 0,
    width: 1,
    height: 1,
  });

  const snapBack = () => {
    state.current.scale = 1;
    state.current.x = 0;
    state.current.y = 0;
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 0 }),
      Animated.spring(translate, { toValue: { x: 0, y: 0 }, useNativeDriver: true, bounciness: 0 }),
    ]).start();
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const now = Date.now();
        const touches = e.nativeEvent.touches;
        if (touches.length === 1 && now - state.current.lastTap < 280) {
          if (state.current.scale > 1.05) {
            snapBack();
          } else {
            state.current.scale = 2.5;
            scale.setValue(2.5);
          }
          state.current.lastTap = 0;
          return;
        }
        state.current.lastTap = now;
        state.current.pinchDist = 0;
      },
      onPanResponderMove: (e, gesture) => {
        const touches = e.nativeEvent.touches;
        if (touches.length >= 2) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          const dist = Math.hypot(dx, dy) || 1;
          if (!state.current.pinchDist) {
            state.current.pinchDist = dist;
            state.current.pinchScale = state.current.scale;
            return;
          }
          const next = clamp(state.current.pinchScale * (dist / state.current.pinchDist), 1, 4);
          state.current.scale = next;
          scale.setValue(next);
          return;
        }
        if (state.current.scale > 1) {
          const maxX = ((state.current.scale - 1) * state.current.width) / 2;
          const maxY = ((state.current.scale - 1) * state.current.height) / 2;
          const x = clamp(state.current.x + gesture.dx, -maxX, maxX);
          const y = clamp(state.current.y + gesture.dy, -maxY, maxY);
          translate.setValue({ x, y });
        }
      },
      onPanResponderRelease: (_e, gesture) => {
        state.current.pinchDist = 0;
        if (state.current.scale <= 1.02) {
          snapBack();
          return;
        }
        const maxX = ((state.current.scale - 1) * state.current.width) / 2;
        const maxY = ((state.current.scale - 1) * state.current.height) / 2;
        state.current.x = clamp(state.current.x + gesture.dx, -maxX, maxX);
        state.current.y = clamp(state.current.y + gesture.dy, -maxY, maxY);
        translate.setValue({ x: state.current.x, y: state.current.y });
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  return (
    <View
      style={styles.imageFill}
      onLayout={(e) => {
        state.current.width = e.nativeEvent.layout.width;
        state.current.height = e.nativeEvent.layout.height;
      }}
      {...responder.panHandlers}
    >
      <Animated.Image
        source={{ uri }}
        style={[
          styles.imageFill,
          { transform: [{ translateX: translate.x }, { translateY: translate.y }, { scale }] },
        ]}
        resizeMode="contain"
      />
    </View>
  );
}

interface AttachmentImagePreviewModalProps {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
}

/** Full-screen image preview. Web uses a DOM img (same as FileDetailModal); native uses RN Image. */
export function AttachmentImagePreviewModal({ visible, uri, onClose }: AttachmentImagePreviewModalProps) {
  const { width, height } = useOverlayViewportSize();
  const statusBarInset = previewStatusBarInset();
  const frameStyle = {
    width: Math.max(width * 0.92, 1),
    height: Math.max(height * 0.88, 1),
    zIndex: 1,
  } as const;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        pointerEvents="none"
        style={[styles.statusBarGap, { height: statusBarInset }]}
      />
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
          <ZoomableImage uri={uri} />
        ) : null}
        <View
          style={[styles.chrome, statusBarInset > 0 ? { top: statusBarInset + 12 } : null]}
          pointerEvents="box-none"
        >
          {uri ? (
            <TouchableOpacity
              style={styles.chromeBtn}
              onPress={() => promptSaveAttachmentImage(uri)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Save image"
            >
              <Ionicons name="download-outline" size={22} color="#1A1A1A" />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.chromeBtn} onPress={onClose} hitSlop={8} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color="#1A1A1A" />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  statusBarGap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 3,
    backgroundColor: '#FFFFFF',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 0,
  },
  imageFill: {
    width: '100%',
    height: '100%',
  },
  chrome: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 40,
    right: 16,
    zIndex: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chromeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
});
