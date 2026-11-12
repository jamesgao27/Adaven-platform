import type { PlatformSpace } from '@adaven/platform-core';
import type { SidebarNavItem } from '@adaven/platform-ui';
import { isVouchap } from './feature-flags';

export function getPortalflowSidebarNavItems(_space: PlatformSpace | null): SidebarNavItem[] {
  if (isVouchap) {
    const items: SidebarNavItem[] = [
      { path: '/', label: 'Dashboard', icon: 'grid-outline', match: (p) => p === '/' || p === '' },
      {
        path: '/receipts',
        label: 'Expenses',
        icon: 'document-text-outline',
        match: (p) => p.startsWith('/receipts') || p.startsWith('/receipt-details') || p.startsWith('/receipt-items'),
      },
      {
        path: '/invoices',
        label: 'Income',
        icon: 'arrow-up-circle-outline',
        match: (p) => p.startsWith('/invoices') || p.startsWith('/invoice-details'),
      },
    ];
    return items;
  }
  return [
    { path: '/', label: 'Insights', icon: 'grid-outline', match: (p) => p === '/' || p === '' },
    { path: '/firm/clients', label: 'Clients', icon: 'people-outline', match: (p) => p.startsWith('/firm/clients') },
    {
      path: '/firm/engagements',
      label: 'Engagements',
      icon: 'briefcase-outline',
      match: (p) => p.startsWith('/firm/engagements'),
    },
    {
      path: '/firm/service-catalog',
      label: 'Service Catalog',
      icon: 'library-outline',
      match: (p) => p.startsWith('/firm/service-catalog'),
    },
  ];
}
