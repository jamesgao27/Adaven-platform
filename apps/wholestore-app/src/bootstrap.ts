import { configurePlatformAuth, registerOnSpaceCreated, createSpaceCore } from '@adaven/platform-core';
import { configureProductUi } from '@adaven/platform-ui';
import { validateSupabaseConfig } from './supabase';

configurePlatformAuth({
  providers: { google: { enabled: true } },
  validateConfig: validateSupabaseConfig,
  inviteDeepLinkBase:
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'wholestore://',
  emailRedirectTo:
    typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/auth/confirm`
      : 'https://wholestore.pages.dev/auth/confirm',
});

registerOnSpaceCreated(async () => {
  // Factory / Dealer seeds land here later. Kernel only creates membership.
});

configureProductUi({
  productName: 'Wholestore',
  logo: require('../assets/icon.png'),
  authLogoSize: 88,
  sloganLine1: 'Wholesale clarity,',
  sloganLine2: 'from factory to dealer.',
  termsUrl: 'https://wholestore.app/terms',
  privacyUrl: 'https://wholestore.app/privacy',
  homePath: '/',
  spaceKinds: [
    { id: 'consumer', label: 'Dealer' },
    { id: 'provider', label: 'Vendor' },
  ],
  defaultSpaceKind: 'consumer',
  allowAdditionalSpaces: true,
  getSidebarNavItems: (space) => {
    if (space?.kind === 'provider') {
      return [
        { path: '/', label: 'Insights', icon: 'grid-outline', match: (p) => p === '/' || p === '' },
        { path: '/dealers', label: 'Dealers', icon: 'people-outline', match: (p) => p.startsWith('/dealers') },
        {
          path: '/orders',
          label: 'Orders',
          icon: 'briefcase-outline',
          match: (p) => p.startsWith('/orders'),
        },
        {
          path: '/catalog',
          label: 'Catalog',
          icon: 'library-outline',
          match: (p) => p.startsWith('/catalog'),
        },
        {
          path: '/marketing',
          label: 'Marketing',
          icon: 'images-outline',
          match: (p) => p.startsWith('/marketing'),
        },
      ];
    }
    return [
      { path: '/', label: 'Dashboard', icon: 'grid-outline', match: (p) => p === '/' || p === '' },
      {
        path: '/suppliers',
        label: 'Suppliers',
        icon: 'storefront-outline',
        match: (p) => p.startsWith('/suppliers') || p.startsWith('/marketplace'),
      },
      {
        path: '/orders',
        label: 'Orders',
        icon: 'briefcase-outline',
        match: (p) => p.startsWith('/orders'),
      },
    ];
  },
  createSpace: async ({ name, address, kind }) => {
    const { error } = await createSpaceCore(name, address || undefined, kind);
    return { error };
  },
});
