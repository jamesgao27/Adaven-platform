import {
  showAlertDialog,
  showConfirmDialog as showConfirmDialogApi,
  showConfirmDestructiveDialog as showConfirmDestructiveDialogApi,
} from './confirmDialog';

export function showAlert(title: string, message?: string): void {
  showAlertDialog(title, message);
}

export function confirmThen(
  title: string,
  message: string,
  onConfirm: () => void | Promise<void>,
  options?: { confirmText?: string; cancelText?: string }
): void {
  const wrapped = () => {
    Promise.resolve(onConfirm()).catch((err) => {
      console.error('confirmThen onConfirm error:', err);
    });
  };
  showConfirmDialogApi(title, message, wrapped, options);
}

export function confirmDestructive(
  title: string,
  message: string,
  onConfirm: () => void | Promise<void>,
  options?: { confirmLabel?: string }
): void {
  const wrapped = () => {
    Promise.resolve(onConfirm()).catch((err) => {
      console.error('confirmDestructive onConfirm error:', err);
    });
  };
  showConfirmDestructiveDialogApi(title, message, wrapped, options);
}
