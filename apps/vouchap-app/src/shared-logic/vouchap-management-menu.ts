import type { SpaceKind } from '@/types';
import type { ManagementMenuItem } from '@adaven/platform-ui';

const PRODUCT_ITEMS: ManagementMenuItem[] = [
  {
    id: 'permissions',
    title: 'Permissions',
    icon: 'shield-checkmark-outline',
    route: '/firm/permissions',
    description: 'Roles and permission scopes settings',
  },
  {
    id: 'claim',
    title: 'Claim engagement',
    icon: 'link-outline',
    route: '/auth/claim',
    description: 'Link your space with a pending engagement from a firm',
  },
  {
    id: 'accounts',
    title: 'Accounts',
    icon: 'wallet-outline',
    route: '/accounts-manage',
    description: 'Manage and merge accounts',
  },
  {
    id: 'entities',
    title: 'Entities',
    icon: 'storefront-outline',
    route: '/entities-manage',
    description: 'Payee/Payer/Sender/Receiver',
  },
  {
    id: 'expense-settings',
    title: 'Expense Settings',
    icon: 'card-outline',
    route: '/expense-settings',
    description: 'Categories and attributions',
  },
  {
    id: 'income-settings',
    title: 'Income Settings',
    icon: 'cash-outline',
    route: '/income-settings',
    description: 'Categories and attributions',
  },
  {
    id: 'billing',
    title: 'Subscription and billing',
    icon: 'receipt-outline',
    route: '/space-orders',
    description: 'Plans, invoices, and payment history',
  },
];

/** Vouchap product rows on Management. Kernel Members / Space roles come from platform-ui. */
export function getVouchapManagementMenuItems(kind?: SpaceKind): ManagementMenuItem[] {
  if (kind === 'firm') {
    return PRODUCT_ITEMS.filter((item) => item.id === 'permissions' || item.id === 'billing');
  }
  return PRODUCT_ITEMS.filter((item) => item.id !== 'claim' && item.id !== 'permissions');
}
