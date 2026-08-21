/**
 * Web 聊天侧栏：由 context 控制，打开即常驻并压缩主区（无 pin 切换）。
 * 头部：头像 + 昵称 + 职务，可点击切换助理类型；右侧关闭按钮。
 */
import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Image, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useChatPanel, type ChatPanelType } from '../contexts/ChatPanelContext';
import { ChatToLogContent } from '../app/chat-to-log';
import { getAssistantInfo } from '@/lib/assistant-config';
import { getChatToLogAllowedTypes } from '@/lib/chat-to-log-allowed-types';
import { getCurrentSpace } from '@/lib/auth';

const PANEL_WIDTH = 420;

const PANEL_NATIVE_ID = 'web-chat-panel';

/** effectiveType: 由当前路由决定，保证在 Clients 页一定显示 Client Assistant，不串成 Expenses */
export default function WebChatPanel(props: { effectiveType?: ChatPanelType }) {
  const chatPanel = useChatPanel();
  const [currentSpace, setCurrentSpace] = useState<{ kind?: string } | null>(null);
  const [showTypePicker, setShowTypePicker] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCurrentSpace().then((space) => {
      if (!cancelled) setCurrentSpace(space ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  if (Platform.OS !== 'web' || !chatPanel?.open) return null;

  const { type, setType, closePanel } = chatPanel;
  const typeOptions = getChatToLogAllowedTypes(currentSpace);
  const displayType = props.effectiveType ?? type ?? 'receipt';
  const assistant = getAssistantInfo(displayType);

  return (
    <View
      nativeID={PANEL_NATIVE_ID}
      style={[styles.panel, styles.panelPinned]}
      collapsable={false}
    >
      <View style={styles.header}>
        <Pressable
          style={styles.headerAssistant}
          onPress={() => setShowTypePicker((v) => !v)}
        >
          <Image source={assistant.avatar} style={styles.headerAvatar} resizeMode="cover" />
          <View style={styles.headerNameBlock}>
            <View style={styles.headerNicknameRow}>
              <Text style={styles.headerNickname}>{assistant.nickname}</Text>
              <Ionicons name="chevron-down" size={18} color="#636E72" />
            </View>
            <Text style={styles.headerRole}>{assistant.role}</Text>
          </View>
        </Pressable>
        {showTypePicker && (
          <View style={styles.typePickerDropdown}>
            {typeOptions.map((opt) => {
              const optAssistant = getAssistantInfo(opt.value);
              return (
                <Pressable
                  key={opt.value}
                  style={[styles.typePickerItem, displayType === opt.value && styles.typePickerItemActive]}
                  onPress={() => { setType(opt.value); setShowTypePicker(false); }}
                >
                  <Image source={optAssistant.avatar} style={styles.typePickerItemAvatar} resizeMode="cover" />
                  <View style={styles.typePickerItemTextBlock}>
                    <Text style={[styles.typePickerItemText, displayType === opt.value && styles.typePickerItemTextActive]}>{optAssistant.nickname}</Text>
                    <Text style={[styles.typePickerItemRole, displayType === opt.value && styles.typePickerItemRoleActive]}>{optAssistant.role}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
        <TouchableOpacity style={styles.iconButton} onPress={closePanel}>
          <Ionicons name="close" size={24} color="#2D3436" />
        </TouchableOpacity>
      </View>
      <View style={styles.body}>
        <ChatToLogContent key={displayType} voucherType={displayType} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: PANEL_WIDTH,
    backgroundColor: '#fff',
    flexDirection: 'column',
    borderLeftWidth: 1,
    borderLeftColor: '#E9ECEF',
    shadowColor: '#000',
    shadowOffset: { width: -6, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  panelFloating: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 16,
  },
  panelPinned: {
    flexShrink: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 0,
    minHeight: 64,
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
    position: 'relative',
    overflow: 'visible',
    zIndex: 10,
  },
  headerAssistant: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: 10,
  },
  headerAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: -50,
    zIndex: 11,
  },
  headerNameBlock: {
    flex: 1,
    minWidth: 0,
  },
  headerNicknameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerNickname: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
  },
  headerRole: {
    fontSize: 11,
    color: '#636E72',
    marginTop: 1,
  },
  typePickerDropdown: {
    position: 'absolute',
    left: 16,
    top: 52,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    minWidth: 160,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  typePickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 10,
  },
  typePickerItemAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  typePickerItemTextBlock: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  typePickerItemActive: {
    backgroundColor: '#F1F3F5',
  },
  typePickerItemText: {
    fontSize: 14,
    color: '#2D3436',
  },
  typePickerItemTextActive: {
    fontWeight: '600',
  },
  typePickerItemRole: {
    fontSize: 11,
    color: '#636E72',
  },
  typePickerItemRoleActive: {
    color: '#636E72',
  },
  iconButton: {
    padding: 4,
  },
  body: {
    flex: 1,
    minHeight: 0,
    zIndex: 0,
  },
});

export { PANEL_WIDTH };
