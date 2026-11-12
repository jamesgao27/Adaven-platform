/**
 * Chat-to-log 识别类型与空间功能模块关联。
 * - Firm 空间：Tax Documents + Client。
 * - 非 Firm（client/household）：按 feature flags 展示 receipt / invoice / inbound / outbound / tax-filing。
 */
import type { VoucherLogType } from '@/types';
import { showAiInventory, showTaxFiling } from '@/lib/feature-flags';

export const CHAT_TO_LOG_TYPE_OPTIONS: { value: VoucherLogType; label: string }[] = [
  { value: 'receipt', label: 'Expenses' },
  { value: 'invoice', label: 'Incomes' },
  ...(showAiInventory ? [{ value: 'inbound' as const, label: 'Inbound' }, { value: 'outbound' as const, label: 'Outbound' }] : []),
  ...(showTaxFiling ? [{ value: 'tax-filing' as const, label: 'Tax Documents' }] : []),
];

/** Firm 空间：Tax Documents + Client（Client 仅 firm 可选） */
const FIRM_TYPE_OPTIONS: { value: VoucherLogType; label: string }[] = [
  ...(showTaxFiling ? [{ value: 'tax-filing' as const, label: 'Tax Documents' }] : []),
  { value: 'client', label: 'Client' },
];

/**
 * 根据当前空间返回 chat-to-log 可选的识别类型选项。
 * - kind === 'provider'：Tax Documents + Client。
 * - 其他：返回 household 全部可选类型（受 feature flags 控制）。
 */
export function getChatToLogAllowedTypes(space: { kind?: string } | null): { value: VoucherLogType; label: string }[] {
  return space?.kind === 'provider' ? FIRM_TYPE_OPTIONS : CHAT_TO_LOG_TYPE_OPTIONS;
}

/** 可选的 type 值数组，用于校验与默认回退 */
export function getChatToLogAllowedTypeValues(space: { kind?: string } | null): VoucherLogType[] {
  return getChatToLogAllowedTypes(space).map((o) => o.value);
}
