/**
 * Web 端聊天气泡 FAB；悬停展开为与右栏一致的底部输入区（嵌入/非嵌入均支持），移开延迟还原。
 * 图片选择与完整 chat-to-log 一致，打开右栏时已选图片会带入暂存区。
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  Platform,
  View,
  TextInput,
  Pressable,
  Text,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useChatPanel } from '../contexts/ChatPanelContext';
import type { ChatPanelType, StagedAttachmentFile } from '../contexts/ChatPanelContext';
import { PANEL_WIDTH } from './WebChatPanel';
import { getCurrentSpace } from '@/lib/auth';
import { getChatToLogAllowedTypes } from '@/lib/chat-to-log-allowed-types';
import { getAssistantInfo, getInputPlaceholder } from '@/lib/assistant-config';
import { showToast } from '@/lib/toast';
import { webInputBlockStyles } from '../styles/web-input-block-styles';
import {
  CHAT_STAGED_FILES_DISPLAY_MAX,
  chatStagedFilesOverflowLabel,
} from '../lib/chat-staged-files-display';
import {
  WEBCHAT_FAB_COMPOSER_NATIVE_ID,
  extractClipboardImageFiles,
  useWebClipboardImagePaste,
} from '../lib/use-web-clipboard-image-paste';

/** 与嵌入式页面 `fabContainerWeb` 必须一致，否则折叠态与悬停展开态头像垂直位置错位 */
export const WEB_CHAT_FAB_SIZE = 100;
export const WEB_CHAT_FAB_BOTTOM = 52;
export const WEB_CHAT_FAB_RIGHT = 40;

const FAB_SIZE = WEB_CHAT_FAB_SIZE;
const FAB_BOTTOM = WEB_CHAT_FAB_BOTTOM;
const FAB_RIGHT = WEB_CHAT_FAB_RIGHT;
const CHAT_ICON_SIZE = 36;
const LEAVE_DELAY_MS = 280;

export type WebFabVariant = 'chat' | 'add';

interface WebChatFabProps {
  type?: ChatPanelType;
  variant?: WebFabVariant;
  embedded?: boolean;
}

function getPlaceholder(type: ChatPanelType): string {
  return getInputPlaceholder(type);
}

export default function WebChatFab({ type = 'receipt', variant = 'chat', embedded }: WebChatFabProps) {
  const chatPanel = useChatPanel();
  const open = chatPanel?.open ?? false;
  const openPanel = chatPanel?.openPanel;
  const contextType = chatPanel?.type ?? type;
  const setType = chatPanel?.setType;
  const setInitialStagedFiles = chatPanel?.setInitialStagedFiles;
  const [hovered, setHovered] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [stagedAttachmentFiles, setStagedAttachmentFiles] = useState<StagedAttachmentFile[]>([]);
  const [currentSpace, setCurrentSpace] = useState<{ kind?: string } | null>(null);
  const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCurrentSpace().then((space) => {
      if (!cancelled) setCurrentSpace(space ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  const typeOptions = getChatToLogAllowedTypes(currentSpace);
  const currentType: ChatPanelType =
    typeOptions.some((o) => o.value === contextType) ? contextType : (typeOptions[0]?.value ?? 'receipt');
  const currentLabel = typeOptions.find((o) => o.value === currentType)?.label ?? 'Expenses';

  const pickImagesForSend = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync?.();
      if (status !== 'granted' && status !== 'undetermined') {
        showToast('Need photo library permission.', 'info');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        allowsEditing: false,
        quality: 0.9,
      });
      if (result.canceled || !result.assets?.length) return;
      const now = Date.now();
      setStagedAttachmentFiles(prev => [...prev, ...result.assets.map((a, i) => ({ id: `${a.uri}-${now}-${i}`, uri: a.uri!, name: a.fileName }))]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to add files', 'error');
    }
  }, []);

  const stageClipboardImages = useCallback((files: StagedAttachmentFile[]) => {
    if (!files.length) return;
    setStagedAttachmentFiles((prev) => [...prev, ...files]);
  }, []);

  useWebClipboardImagePaste(stageClipboardImages, Platform.OS === 'web' && hovered && !open);

  const onWebComposerPaste = useCallback((e: unknown) => {
    const files = extractClipboardImageFiles(e);
    if (!files.length) return;
    const ev = e as { preventDefault?: () => void; stopPropagation?: () => void };
    ev.preventDefault?.();
    ev.stopPropagation?.();
    stageClipboardImages(files);
  }, [stageClipboardImages]);

  const pickFoldersForSend = useCallback(() => {
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    input.multiple = true;
    (input as any).webkitdirectory = true;
    (input as any).directory = true;
    input.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const files = target.files;
      if (!files?.length) return;
      const now = Date.now();
      const next: StagedAttachmentFile[] = Array.from(files).map((f, i) => ({
        id: `web-dir-${now}-${i}-${f.name}`,
        uri: URL.createObjectURL(f),
        name: f.name,
      }));
      setStagedAttachmentFiles(prev => [...prev, ...next]);
    };
    input.click();
  }, []);

  // 与当前页一致：右侧栏关闭时同步提交类别
  useEffect(() => {
    if (!open) setType?.(type);
  }, [type, open, setType]);

  const clearLeaveTimeout = useCallback(() => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
  }, []);

  const scheduleCollapse = useCallback(() => {
    clearLeaveTimeout();
    leaveTimeoutRef.current = setTimeout(() => {
      leaveTimeoutRef.current = null;
      setHovered(false);
      setShowTypeDropdown(false);
    }, LEAVE_DELAY_MS);
  }, [clearLeaveTimeout]);

  const handleEnter = useCallback(() => {
    clearLeaveTimeout();
    setHovered(true);
  }, [clearLeaveTimeout]);

  // 选单打开时：点击选单外区域收起（仅 Web）。须放在所有条件 return 之前，保证 hooks 顺序稳定
  useEffect(() => {
    if (Platform.OS !== 'web' || !showTypeDropdown) return;
    const handler = (e: PointerEvent) => {
      const el = document.getElementById('webchatfab-type-dropdown');
      if (el && !el.contains(e.target as Node)) setShowTypeDropdown(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [showTypeDropdown]);

  if (Platform.OS !== 'web') return null;
  if (open) return null;

  const openFullPanel = () => {
    if (!openPanel) return;
    if (stagedAttachmentFiles.length) {
      setInitialStagedFiles?.(stagedAttachmentFiles);
    }
    openPanel(currentType);
    setStagedAttachmentFiles([]);
    setHovered(false);
    setShowTypeDropdown(false);
  };

  // 悬停时展开输入栏，头像保持未触摸前位置（右下角）；点击后打开右栏、头像隐去
  if (hovered) {
    const stagedAttachmentFilesVisible = stagedAttachmentFiles.slice(0, CHAT_STAGED_FILES_DISPLAY_MAX);
    const stagedAttachmentFilesOverflowHint = chatStagedFilesOverflowLabel(stagedAttachmentFiles.length);
    const thumbAlignTopLeft = Platform.select({
      web: { objectFit: 'cover' as const, objectPosition: 'top left' as const },
      default: {},
    });
    return (
      <View
        style={styles.expandedOuter}
        onMouseEnter={handleEnter}
        onMouseLeave={scheduleCollapse}
      >
        <View
          nativeID={WEBCHAT_FAB_COMPOSER_NATIVE_ID}
          // @ts-expect-error web DOM id + paste
          id={WEBCHAT_FAB_COMPOSER_NATIVE_ID}
          onPaste={onWebComposerPaste}
          style={[webInputBlockStyles.webInputOuter, styles.expandedOuterInner]}
        >
          <View style={webInputBlockStyles.webInputBlock}>
            {stagedAttachmentFiles.length > 0 ? (
              <View style={webInputBlockStyles.stagedFilesRow}>
                <View style={webInputBlockStyles.stagedFilesList}>
                  {stagedAttachmentFilesVisible.map((f) => (
                    <View key={f.id} style={webInputBlockStyles.stagedFileChip}>
                      <View style={webInputBlockStyles.stagedFileThumbWrap}>
                        <Image source={{ uri: f.uri }} style={[webInputBlockStyles.stagedFileThumb, thumbAlignTopLeft]} resizeMode="cover" />
                      </View>
                      <Text style={webInputBlockStyles.stagedFileChipText} numberOfLines={1}>{f.name ?? 'Image'}</Text>
                      <TouchableOpacity
                        hitSlop={8}
                        onPress={() => setStagedAttachmentFiles(prev => prev.filter(x => x.id !== f.id))}
                      >
                        <Ionicons name="close-circle" size={18} color="#636E72" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
                {stagedAttachmentFilesOverflowHint ? (
                  <Text style={webInputBlockStyles.stagedFilesMoreHint}>{stagedAttachmentFilesOverflowHint}</Text>
                ) : null}
              </View>
            ) : null}
            <TouchableOpacity style={webInputBlockStyles.webInputRow} onPress={openFullPanel} activeOpacity={1}>
              <View style={webInputBlockStyles.webInputWrapper}>
                <TextInput
                  style={webInputBlockStyles.webInput}
                  placeholder={getPlaceholder(currentType)}
                  placeholderTextColor="#95A5A6"
                  editable={false}
                  multiline
                  pointerEvents="none"
                />
              </View>
            </TouchableOpacity>
              <View style={[webInputBlockStyles.webInputActionsRow, styles.expandedActionsRowRight]}>
              <View style={webInputBlockStyles.webInputActionsLeftGroup}>
                <View style={webInputBlockStyles.webInputActionsLeft}>
                  <TouchableOpacity style={webInputBlockStyles.webActionIcon} onPress={pickImagesForSend}>
                    <Ionicons name="image" size={22} color="#636E72" />
                  </TouchableOpacity>
                  <TouchableOpacity style={webInputBlockStyles.webActionIcon} onPress={pickFoldersForSend}>
                    <Ionicons name="folder-open-outline" size={22} color="#636E72" />
                  </TouchableOpacity>
                </View>
                <View style={webInputBlockStyles.webTypeDropdownWrap} nativeID="webchatfab-type-dropdown">
                <Pressable
                  style={({ hovered: h }) => [webInputBlockStyles.webTypeDropdownTrigger, h && webInputBlockStyles.webTypeDropdownTriggerHover]}
                  onPress={() => setShowTypeDropdown(v => !v)}
                >
                  <Text style={webInputBlockStyles.webTypeDropdownLabel}>{currentLabel}</Text>
                  <Ionicons name={showTypeDropdown ? 'chevron-up' : 'chevron-down'} size={16} color="#636E72" />
                </Pressable>
                {showTypeDropdown && (
                  <View style={webInputBlockStyles.webTypeDropdownMenu}>
                    {typeOptions.map((opt) => (
                      <Pressable
                        key={opt.value}
                        style={({ hovered: h }) => [
                          webInputBlockStyles.webTypeDropdownItem,
                          currentType === opt.value && webInputBlockStyles.webTypeDropdownItemActive,
                          h && webInputBlockStyles.webTypeDropdownItemHover,
                        ]}
                        onPress={() => { setType?.(opt.value); setShowTypeDropdown(false); }}
                      >
                        <Text style={[webInputBlockStyles.webTypeDropdownItemText, currentType === opt.value && webInputBlockStyles.webTypeDropdownItemTextActive]}>{opt.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                </View>
              </View>
            </View>
          </View>
          <Text style={webInputBlockStyles.webInputDisclaimer}>
            AI Assistant may make mistakes. Paste a screenshot with Ctrl+V or ⌘V.
          </Text>
        </View>
        <View style={styles.expandedAvatarFixed} pointerEvents="none">
          <Image
            source={getAssistantInfo(currentType).avatar}
            style={styles.expandedAvatarFixedImage}
            resizeMode="cover"
          />
        </View>
      </View>
    );
  }

  return (
    <View
      style={[styles.fabWrapper, !embedded && styles.fabWrapperAbsolute]}
      onMouseEnter={handleEnter}
      onMouseLeave={scheduleCollapse}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        style={[styles.fab, embedded && styles.fabEmbedded]}
        onPress={openFullPanel}
        activeOpacity={0.85}
        accessible
        accessibilityRole="button"
        accessibilityLabel="Open chat panel"
      >
        <Image
          source={getAssistantInfo(type).avatar}
          style={styles.fabAvatar}
          resizeMode="cover"
        />
      </TouchableOpacity>
    </View>
  );
}

export const webFabStyle = {
  position: 'absolute' as const,
  right: FAB_RIGHT,
  bottom: FAB_BOTTOM,
  width: FAB_SIZE,
  height: FAB_SIZE,
  borderRadius: FAB_SIZE / 2,
  backgroundColor: '#6C5CE7',
  justifyContent: 'center' as const,
  alignItems: 'center' as const,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.25,
  shadowRadius: 8,
  elevation: 8,
};

const styles = StyleSheet.create({
  fabWrapper: {},
  fabWrapperAbsolute: {
    position: 'absolute',
    right: FAB_RIGHT,
    bottom: FAB_BOTTOM,
    width: FAB_SIZE,
    height: FAB_SIZE,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  fabAvatar: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
  },
  fabEmbedded: {
    // 嵌入时样式与 fab 一致，父级控制位置
  },
  // 展开区：与右栏 chat-to-log 的 inputContainer + webInputBlock 尺寸完全一致（padding、圆角、行高、按钮尺寸）
  expandedOuter: {
    position: 'fixed' as any,
    right: 0,
    bottom: 0,
    width: PANEL_WIDTH,
    paddingHorizontal: 16,
    paddingVertical: 10,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderLeftWidth: 1,
    borderTopWidth: 1,
    borderColor: '#E9ECEF',
    zIndex: 999,
    shadowColor: '#000',
    shadowOffset: { width: -6, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  expandedOuterInner: {},
  expandedActionsRowRight: {
    marginRight: FAB_RIGHT + FAB_SIZE + 8,
  },
  expandedAvatarFixed: {
    position: 'absolute' as const,
    right: FAB_RIGHT,
    bottom: FAB_BOTTOM,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    overflow: 'hidden',
    zIndex: 10,
  },
  expandedAvatarFixedImage: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
  },
});
