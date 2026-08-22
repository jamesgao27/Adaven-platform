/** Shared toast bus. Apps re-export this so product pages and kernel screens share one host. */
export type ToastType = 'success' | 'error' | 'info';

export interface ToastPayload {
  message: string;
  type: ToastType;
  duration: number;
  variant?: 'default' | 'center-success';
}

type Listener = (payload: ToastPayload) => void;
const listeners = new Set<Listener>();

export function showToast(
  message: string,
  type: ToastType = 'info',
  duration = 1500,
  variant: ToastPayload['variant'] = 'default'
) {
  const payload: ToastPayload = { message, type, duration, variant };
  listeners.forEach((fn) => fn(payload));
}

export function subscribeToast(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
