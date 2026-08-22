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

export function showAlertDialog(title: string, message?: string) {
  show({
    visible: true,
    title,
    message: message ?? '',
    buttons: [{ text: 'OK', onPress: () => {}, style: 'primary' }],
  });
}

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

export function showChoiceDialog(title: string, message: string, buttons: ConfirmDialogButton[]) {
  show({ visible: true, title, message, buttons });
}
