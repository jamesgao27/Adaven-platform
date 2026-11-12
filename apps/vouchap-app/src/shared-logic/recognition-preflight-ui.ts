import { assertClientRecognitionAllowed } from './client-recognition-quota';
import { showChoiceDialog, type ConfirmDialogButton } from './confirmDialog';

export type RecognitionRouterLike = {
  push: (href: string) => void;
};

export type RecognitionPreflightOptions = {
  onSwitchSpace?: () => void;
};

type GateDenied = { allowed: false; message?: string };

/** App-styled modal (ConfirmModalHost); no system Alert / window.confirm. */
export function alertClientRecognitionQuotaBlocked(
  router: RecognitionRouterLike,
  gate: GateDenied,
  options?: RecognitionPreflightOptions,
): void {
  const title = 'Recognition unavailable';
  const message =
    gate.message ??
    'Your workspace cannot run AI recognition right now. Check your plan or credits in Subscription and billing.';

  const buttons: ConfirmDialogButton[] = [
    { text: 'Close', onPress: () => {}, style: 'cancel' },
    ...(options?.onSwitchSpace
      ? [{ text: 'Switch space', onPress: () => options.onSwitchSpace!(), style: 'cancel' as const }]
      : []),
    { text: 'Subscription and billing', onPress: () => router.push('/management'), style: 'primary' },
  ];
  showChoiceDialog(title, message, buttons);
}

/**
 * Client space: block snap/chat/add flows when subscription included + credits cannot serve another recognition.
 * Returns true if the action may proceed.
 */
export async function preflightRecognitionOrAlert(
  spaceId: string | null | undefined,
  router: RecognitionRouterLike,
  options?: RecognitionPreflightOptions,
): Promise<boolean> {
  if (!spaceId) return true;
  const gate = await assertClientRecognitionAllowed(spaceId);
  if (gate.allowed) return true;
  alertClientRecognitionQuotaBlocked(router, { allowed: false, message: gate.message }, options);
  return false;
}
