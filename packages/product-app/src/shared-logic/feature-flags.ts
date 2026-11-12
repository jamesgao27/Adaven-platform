import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = (Constants.expoConfig as { extra?: Record<string, unknown> } | null)?.extra ?? {};

/** Client bookkeeping build. Uses the current Vouchap database, not Portalflow's. */
export const isVouchap = extra.appVariant === 'vouchap' || extra.appVariant === 'receiptap';

/** Portalflow web is firm CRM only. Bookkeeping lives on the Vouchap web build. */
const BOOKKEEPING_ROOTS = new Set([
  'receipts',
  'receipt-details',
  'receipt-items',
  'invoices',
  'invoice-details',
  'manual-entry',
  'chat-to-log',
  'expense-settings',
  'income-settings',
  'categories-manage',
  'purposes-manage',
  'attributions-manage',
  'accounts-manage',
  'entities-manage',
  'customers-manage',
  'suppliers-manage',
]);

export function isBookkeepingPath(pathname: string): boolean {
  const root = pathname.split('?')[0].replace(/^\//, '').split('/')[0] ?? '';
  return BOOKKEEPING_ROOTS.has(root);
}

/** Inventory is not part of Vouchap or Portalflow. The screens live under Wholestore for a later module. */
export const showAiInventory = false;

/**
 * 是否显示报税入口与功能。
 * - 默认开启（所有平台、所有环境），除非显式在 app.config.js / app.json 的 extra 中将 showTaxFiling 设为 false。
 * - 这样可以在生产环境正常从首页按钮进入 Tax Filing 模块，同时保留一键关闭开关。
 */
export const showTaxFiling = !isVouchap && extra.showTaxFiling !== false;
