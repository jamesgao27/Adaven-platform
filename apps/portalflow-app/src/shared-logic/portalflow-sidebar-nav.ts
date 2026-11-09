import type { PlatformSpace } from '@adaven/platform-core';
import type { SidebarNavItem } from '@adaven/platform-ui';

export function getPortalflowSidebarNavItems(_space: PlatformSpace | null): SidebarNavItem[] {
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
