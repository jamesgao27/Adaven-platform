import type { SpaceKind } from '@/types';

export type ManagementMenuItem = {
  id: string;
  title: string;
  icon: string;
  route: string;
  description: string;
};

const ALL_ITEMS: ManagementMenuItem[] = [
  { id: 'members', title: 'Members', icon: 'people-outline', route: '/space-members', description: 'Manage members & invitations' },
  { id: 'permissions', title: 'Permissions', icon: 'shield-checkmark-outline', route: '/firm/permissions', description: 'Roles and permission scopes settings' },
  { id: 'claim', title: 'Claim engagement', icon: 'link-outline', route: '/auth/claim', description: 'Link your space with a pending engagement from a firm' },
  { id: 'accounts', title: 'Accounts', icon: 'wallet-outline', route: '/accounts-manage', description: 'Manage and merge accounts' },
  { id: 'entities', title: 'Entities', icon: 'storefront-outline', route: '/entities-manage', description: 'Payee/Payer/Sender/Receiver' },
  { id: 'expense-settings', title: 'Expense Settings', icon: 'card-outline', route: '/expense-settings', description: 'Categories and attributions' },
  { id: 'income-settings', title: 'Income Settings', icon: 'cash-outline', route: '/income-settings', description: 'Categories and attributions' },
];

/** Platform-visible: Members. Remaining items are Vouchap product. */
export function getVouchapManagementMenuItems(kind?: SpaceKind): ManagementMenuItem[] {
  if (kind === 'firm') {
    return ALL_ITEMS.filter((item) => item.id === 'members' || item.id === 'permissions');
  }
  return ALL_ITEMS.filter((item) => item.id !== 'claim' && item.id !== 'permissions');
}
