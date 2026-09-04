import React, { ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createPortal } from 'react-dom';

interface RightSidePanelProps {
  visible: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

function PanelContent({ title, onClose, children, width }: RightSidePanelProps) {
  return (
    <View style={styles.overlay}>
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      />
      <View style={[styles.panel, width ? { width } : null]}>
        <View style={styles.header}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={20} color="#636E72" />
          </TouchableOpacity>
        </View>
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

export default function RightSidePanel(props: RightSidePanelProps) {
  const { visible } = props;
  if (!visible) return null;

  if (Platform.OS === 'web' && typeof document !== 'undefined' && document.body) {
    return createPortal(
      <PanelContent {...props} />,
      document.body
    );
  }

  // Native：占满屏幕右侧卡片（与 Web 视觉略有不同，但交互一致）
  return <PanelContent {...props} />;
}

const styles = StyleSheet.create({
  overlay: {
    position: 'fixed' as any,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    zIndex: 9999,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  panel: {
    width: 380,
    maxWidth: '90%',
    height: '100%',
    backgroundColor: '#FFF',
    borderLeftWidth: 1,
    borderLeftColor: '#E9ECEF',
    shadowColor: '#000',
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 12,
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingBottom: 24,
    gap: 12,
  },
});

