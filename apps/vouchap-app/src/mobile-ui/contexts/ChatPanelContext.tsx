/**
 * Web 聊天侧栏状态：由 FAB 打开，不切换路由；右栏打开即常驻并压缩主区（无 pin 切换）。
 * Web 端默认右栏关闭，通过气泡（FAB）呼出。
 */
import React, { createContext, useContext, useState, useCallback, useRef, useMemo, ReactNode } from 'react';

export type ChatPanelType = 'receipt' | 'invoice' | 'inbound' | 'outbound' | 'tax-filing' | 'client';

export type AttachmentContext = {
  projectId?: string;
  todoId?: string;
  /** firm 侧上传时：强制使用 client 的 space_id 作为存储路径基准 */
  clientSpaceId?: string;
};

export type StagedAttachmentFile = { id: string; uri: string; name?: string };

/** File-detail payload opened from the right rail; rendered at app root. */
export type ChatFilePreview = {
  id: string;
  name?: string | null;
  imageUrl?: string | null;
  docType?: string | null;
  status?: string;
  extracted_data?: unknown;
  hideRightPanel?: boolean;
};

type ChatPanelContextValue = {
  open: boolean;
  setOpen: (v: boolean) => void;
  type: ChatPanelType;
  setType: (t: ChatPanelType) => void;
  openPanel: (t?: ChatPanelType) => void;
  closePanel: () => void;
  initialInput: string | null;
  setInitialInput: (v: string | null) => void;
  /** 从 FAB 展开栏带过来的已选图片，打开右栏时填入 chat-to-log 暂存区 */
  initialStagedFiles: StagedAttachmentFile[] | null;
  setInitialStagedFiles: (v: StagedAttachmentFile[] | null) => void;
  /** 报税附件模式：从报税项目页呼出时带入 projectId / todoId */
  attachmentContext: AttachmentContext;
  setAttachmentContext: (c: AttachmentContext) => void;
  /** 由右栏 ChatToLogContent 注册，openPanel 后用于聚焦输入框 */
  inputFocusRef: React.MutableRefObject<(() => void) | null>;
  /** 由 ChatToLog 注册：全局 ⌘V 截图直接写入暂存区 */
  appendStagedFilesRef: React.MutableRefObject<((files: StagedAttachmentFile[]) => void) | null>;
  imagePreviewUrl: string | null;
  openImagePreview: (url: string) => void;
  closeImagePreview: () => void;
  filePreview: ChatFilePreview | null;
  openFilePreview: (file: ChatFilePreview) => void;
  closeFilePreview: () => void;
};

const ChatPanelContext = createContext<ChatPanelContextValue | null>(null);

export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ChatPanelType>('receipt');
  const [initialInput, setInitialInput] = useState<string | null>(null);
  const [initialStagedFiles, setInitialStagedFiles] = useState<StagedAttachmentFile[] | null>(null);
  const [attachmentContext, setAttachmentContext] = useState<AttachmentContext>({});
  const inputFocusRef = useRef<(() => void) | null>(null);
  const appendStagedFilesRef = useRef<((files: StagedAttachmentFile[]) => void) | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<ChatFilePreview | null>(null);
  const openImagePreview = useCallback((url: string) => setImagePreviewUrl(url), []);
  const closeImagePreview = useCallback(() => setImagePreviewUrl(null), []);
  const openFilePreview = useCallback((file: ChatFilePreview) => setFilePreview(file), []);
  const closeFilePreview = useCallback(() => setFilePreview(null), []);

  const openPanel = useCallback((t?: ChatPanelType) => {
    if (t) setType(t);
    setOpen(true);
    setTimeout(() => inputFocusRef.current?.(), 150);
  }, []);

  const closePanel = useCallback(() => setOpen(false), []);

  const value = useMemo<ChatPanelContextValue>(
    () => ({
      open,
      setOpen,
      type,
      setType,
      openPanel,
      closePanel,
      initialInput,
      setInitialInput,
      initialStagedFiles,
      setInitialStagedFiles,
      attachmentContext,
      setAttachmentContext,
      inputFocusRef,
      appendStagedFilesRef,
      imagePreviewUrl,
      openImagePreview,
      closeImagePreview,
      filePreview,
      openFilePreview,
      closeFilePreview,
    }),
    [
      open,
      type,
      initialInput,
      initialStagedFiles,
      attachmentContext,
      openPanel,
      closePanel,
      imagePreviewUrl,
      openImagePreview,
      closeImagePreview,
      filePreview,
      openFilePreview,
      closeFilePreview,
    ],
  );

  return (
    <ChatPanelContext.Provider value={value}>
      {children}
    </ChatPanelContext.Provider>
  );
}

export function useChatPanel() {
  const ctx = useContext(ChatPanelContext);
  return ctx;
}
