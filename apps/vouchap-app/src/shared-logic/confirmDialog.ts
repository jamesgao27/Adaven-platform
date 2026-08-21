/**
 * 统一确认浮窗的全局调用 API。
 * 由 ConfirmModalHost 挂载后，showAlertDialog / showConfirmDialog / showConfirmDestructiveDialog 会弹出统一样式的 Modal，替代系统 Alert。
 */

export type ConfirmDialogButtonStyle = 'primary' | 'destructive' | 'cancel';

export interface ConfirmDialogButton {
  text: string;
  onPress: () => void;
  style?: ConfirmDialogButtonStyle;
}

export interface ConfirmDialogState {
  visible: boolean;
  title: string;
  message?: string;
  buttons: ConfirmDialogButton[];
}

let listener: ((state: ConfirmDialogState) => void) | null = null;

export function setConfirmDialogListener(fn: ((state: ConfirmDialogState) => void) | null) {
  listener = fn;
}

function show(state: ConfirmDialogState) {
  if (listener) listener(state);
}

/** 仅提示（单按钮「确定」） */
export function showAlertDialog(title: string, message?: string) {
  show({
    visible: true,
    title,
    message: message ?? '',
    buttons: [{ text: 'OK', onPress: () => {}, style: 'primary' }],
  });
}

/** 确认后执行（取消 + 确定，确定为主操作） */
export function showConfirmDialog(
  title: string,
  message: string,
  onConfirm: () => void | Promise<void>,
  options?: { confirmText?: string; cancelText?: string }
) {
  const confirmText = options?.confirmText ?? 'OK';
  const cancelText = options?.cancelText ?? 'Cancel';
  show({
    visible: true,
    title,
    message,
    buttons: [
      { text: cancelText, onPress: () => {}, style: 'cancel' },
      { text: confirmText, onPress: onConfirm, style: 'primary' },
    ],
  });
}

/** 危险操作确认（取消 + 确定，确定为 destructive 样式，如删除、登出） */
export function showConfirmDestructiveDialog(
  title: string,
  message: string,
  onConfirm: () => void | Promise<void>,
  options?: { confirmLabel?: string }
) {
  const confirmLabel = options?.confirmLabel ?? 'OK';
  show({
    visible: true,
    title,
    message,
    buttons: [
      { text: 'Cancel', onPress: () => {}, style: 'cancel' },
      { text: confirmLabel, onPress: onConfirm, style: 'destructive' },
    ],
  });
}

/** 多选项浮窗（如：添加照片 - 相机/相册/取消），统一样式 */
export function showChoiceDialog(
  title: string,
  message: string,
  buttons: ConfirmDialogButton[]
) {
  show({ visible: true, title, message, buttons });
}
