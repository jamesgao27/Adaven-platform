/** 纯 JS 事件订阅，避免依赖 Node events 模块（React Native 不支持） */
export type ToastType = 'success' | 'error' | 'info';

export interface ToastPayload {
  message: string;
  type: ToastType;
  duration: number;
  /** 可选：自定义展示样式 */
  variant?: 'default' | 'center-success';
}

type Listener = (payload: ToastPayload) => void;
const listeners = new Set<Listener>();

export function showToast(
  message: string,
  type: ToastType = 'info',
  duration = 1500,
  variant: ToastPayload['variant'] = 'default',
) {
  const payload: ToastPayload = { message, type, duration, variant };
  listeners.forEach((fn) => fn(payload));
}

export function subscribeToast(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

