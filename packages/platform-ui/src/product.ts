import type { ImageSourcePropType } from 'react-native';
import type { ReactNode } from 'react';
import type { PlatformSpace } from '@adaven/platform-core';

export type SpaceKindOption = {
  id: string;
  label: string;
};

export type SetupExtrasContext = {
  kind: string;
  extras: Record<string, unknown>;
  setExtras: (next: Record<string, unknown>) => void;
};

export type SidebarNavItem = {
  path: string;
  label: string;
  icon: string;
  match?: (path: string) => boolean;
};

export type ManagementMenuItem = {
  id: string;
  title: string;
  icon: string;
  route: string;
  description: string;
};

/** Kernel entries always shown inside Management. Not sidebar items. */
export const KERNEL_MANAGEMENT_MENU: ManagementMenuItem[] = [
  {
    id: 'members',
    title: 'Members',
    icon: 'people-outline',
    route: '/space-members',
    description: 'Manage members & invitations',
  },
  {
    id: 'space-roles',
    title: 'Space roles',
    icon: 'shield-checkmark-outline',
    route: '/permissions',
    description: 'Admin and Member access',
  },
];

export type ProductUiConfig = {
  productName: string;
  logo: ImageSourcePropType;
  sidebarLogo?: ImageSourcePropType;
  sloganLine1: string;
  sloganLine2: string;
  termsUrl: string;
  privacyUrl: string;
  homePath: string;
  spaceKinds: SpaceKindOption[];
  defaultSpaceKind: string;
  createSpace: (input: {
    name: string;
    address: string;
    kind: string;
    extras: Record<string, unknown>;
  }) => Promise<{ error: Error | null }>;
  renderSetupExtras?: (ctx: SetupExtrasContext) => ReactNode;
  canSubmitSetup?: (kind: string, extras: Record<string, unknown>) => boolean;
  /** Business pages only. Kernel Members/roles stay in Management. */
  getSidebarNavItems?: (space: PlatformSpace | null) => SidebarNavItem[];
  /** Product rows under kernel Members / Space roles on Management. */
  getManagementMenuItems?: (space: PlatformSpace | null) => ManagementMenuItem[];
  uploadSpaceImage?: (fileUri: string, spaceId: string) => Promise<string>;
  uploadUserLogo?: (fileUri: string, userId: string) => Promise<string>;
  getSidebarClaimCount?: (email: string) => Promise<number>;
  sidebarClaimRoute?: string;
};

let config: ProductUiConfig | null = null;

export function configureProductUi(next: ProductUiConfig): void {
  config = next;
}

export function getProductUi(): ProductUiConfig {
  if (!config) {
    throw new Error(
      'configureProductUi() must run before rendering platform screens (import the app bootstrap first).'
    );
  }
  return config;
}

export function getManagementMenu(space: PlatformSpace | null): ManagementMenuItem[] {
  const product = getProductUi();
  const extras = product.getManagementMenuItems?.(space) ?? [];
  const extraIds = new Set(extras.map((item) => item.id));
  return [...KERNEL_MANAGEMENT_MENU.filter((item) => !extraIds.has(item.id)), ...extras];
}
