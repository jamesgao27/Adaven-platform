import type { InputType } from '@/types';

const KNOWN: ReadonlySet<string> = new Set(['camera', 'image', 'text', 'audio', 'document']);

/** Normalize DB / API values so Method column and list badges match. */
export function normalizeInputTypeForUi(raw?: InputType | string | null): InputType | undefined {
  if (raw == null) return undefined;
  const x = String(raw).trim().toLowerCase();
  if (KNOWN.has(x)) return x as InputType;
  return undefined;
}

/**
 * Ionicons glyph for Web「Method」列与 App 列表 confirmed 角标（须保持一致）。
 * 与 chat 上传：`image` solid；拍摄：`camera`。
 */
export function inputTypeMethodIonicon(
  raw?: InputType | string | null,
): 'mic' | 'document-text' | 'camera' | 'image' | 'attach' {
  const t = normalizeInputTypeForUi(raw);
  if (t === 'audio') return 'mic';
  if (t === 'text') return 'document-text';
  if (t === 'camera') return 'camera';
  if (t === 'image') return 'image';
  if (t === 'document') return 'attach';
  return 'camera';
}

/** App/Web 角标仍用此名导入；实现同 `inputTypeMethodIonicon`。 */
export function inputTypeConfirmBadgeIonicon(
  raw?: InputType | string | null,
): ReturnType<typeof inputTypeMethodIonicon> {
  return inputTypeMethodIonicon(raw);
}
