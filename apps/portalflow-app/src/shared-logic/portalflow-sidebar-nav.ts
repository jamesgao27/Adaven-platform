import type { PlatformSpace } from '@adaven/platform-core';
import type { SidebarNavItem } from '@adaven/platform-ui';
import { isReceiptap, showAiInventory, showTaxFiling } from './feature-flags';

export function getPortalflowSidebarNavItems(space: PlatformSpace | null): SidebarNavItem[] {
  if (!isReceiptap && space?.kind === 'provider') {
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

  if (!isReceiptap) {
    return [
      { path: '/', label: 'Services', icon: 'grid-outline', match: (p) => p === '/' || p === '' },
      {
        path: '/tax-filing',
        label: 'Tax filing',
        icon: 'document-text-outline',
        match: (p) => p.startsWith('/tax-filing'),
      },
    ];
  }

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
  if (showAiInventory) {
    items.push({
      path: '/ai-inventory',
      label: 'AI Inventory',
      icon: 'cube-outline',
      match: (p) => p.startsWith('/ai-inventory'),
    });
  }
  if (showTaxFiling) {
    items.push({
      path: '/tax-filing',
      label: 'Tax Filing',
      icon: 'document-text-outline',
      match: (p) => p.startsWith('/tax-filing'),
    });
  }
  return items;
}
