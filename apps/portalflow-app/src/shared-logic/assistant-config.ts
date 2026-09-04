/**
 * Assistant nickname, role and avatar per chat-to-log type.
 * Avatar filenames: Eric (Expenses), Anna (Income), Orla (Outbound, renamed from Oona).
 */
import type { VoucherLogType } from '@/types';

export type AssistantInfo = {
  nickname: string;
  role: string;
  avatar: number;
};

const AVATAR_EXPENSES = require('../mobile-ui/assets/assistants/Eric-Expenses_Assistant.png');
const AVATAR_INCOME = require('../mobile-ui/assets/assistants/Anna-Income_Assistant.png');
const AVATAR_TAX = require('../mobile-ui/assets/assistants/Tina-Tax_Assistant.png');
const AVATAR_CLIENT = require('../mobile-ui/assets/assistants/Cody-Client_Assistant.png');
const AVATAR_INBOUND = require('../mobile-ui/assets/assistants/Ivan-Inbound_Assistant.png');
const AVATAR_OUTBOUND = require('../mobile-ui/assets/assistants/Orla-Outbound_Assistant.png');

const ASSISTANT_MAP: Record<VoucherLogType, AssistantInfo> = {
  receipt: { nickname: 'Eric', role: 'Expenses Assistant', avatar: AVATAR_EXPENSES },
  invoice: { nickname: 'Anna', role: 'Income Assistant', avatar: AVATAR_INCOME },
  inbound: { nickname: 'Ivan', role: 'Inbound Assistant', avatar: AVATAR_INBOUND },
  outbound: { nickname: 'Orla', role: 'Outbound Assistant', avatar: AVATAR_OUTBOUND },
  'tax-filing': { nickname: 'Tina', role: 'Tax Assistant', avatar: AVATAR_TAX },
  client: { nickname: 'Cody', role: 'Client Assistant', avatar: AVATAR_CLIENT },
};

export function getAssistantInfo(type: VoucherLogType): AssistantInfo {
  return ASSISTANT_MAP[type] ?? ASSISTANT_MAP.receipt;
}

/** 输入框占位两行文案，如：I'm Cody, your Client Assistant.\nLeave it all to me. */
export function getInputPlaceholder(type: VoucherLogType): string {
  const { nickname, role } = getAssistantInfo(type);
  return `I'm ${nickname}, your ${role}.\nLeave it all to me.`;
}
