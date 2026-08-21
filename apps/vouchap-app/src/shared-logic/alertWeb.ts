/**
 * 统一确认浮窗 API：全部走 ConfirmModalHost 的统一样式浮窗，替代系统 Alert。
 * 在各机型/Web 上 UI 一致（与邀请处理、合并确认、批量删除等浮窗一致）。
 */
import {
  showAlertDialog,
  showConfirmDialog as showConfirmDialogApi,
  showConfirmDestructiveDialog as showConfirmDestructiveDialogApi,
} from './confirmDialog';

/** 仅提示（单按钮「确定」），统一样式浮窗 */
export function showAlert(title: string, message?: string): void {
  showAlertDialog(title, message);
}

/** 确认后执行（取消 + 确定），统一样式浮窗 */
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

/** 危险操作确认（取消 + 确定，destructive 样式），统一样式浮窗 */
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
