import React, { ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface CenterModalProps {
  visible: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * 可选：卡片最大宽度（默认 520）
   */
  maxWidth?: number;
  /**
   * 可选：卡片高度（数字时固定高度；不传则默认 height: '82%'）
   */
  cardHeight?: number;
  /**
   * 可选：为 true 时 body 内容区填满可用高度（用于表格等需占满浮窗的场景）
   */
  contentFillsHeight?: boolean;
}

export default function CenterModal({
  visible,
  title,
  onClose,
  children,
  maxWidth,
  cardHeight,
  contentFillsHeight,
}: CenterModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.card, maxWidth ? { maxWidth } : null, cardHeight != null ? { height: cardHeight } : null]}>
          <View style={styles.header}>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={22} color="#636E72" />
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.body}
            contentContainerStyle={[
              styles.bodyContent,
              contentFillsHeight ? styles.bodyContentFills : null,
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={Platform.OS === 'web'}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  card: {
    maxWidth: 900,
    width: '100%',
    height: '82%',
    backgroundColor: '#FFF',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
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
    paddingTop: 4,
    paddingBottom: 8,
    gap: 12,
  },
  bodyContentFills: {
    flexGrow: 1,
    minHeight: '100%',
  },
});

