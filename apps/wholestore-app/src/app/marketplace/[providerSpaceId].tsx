import { Redirect, useLocalSearchParams } from 'expo-router';

export default function MarketplaceStoreRedirect() {
  const { providerSpaceId } = useLocalSearchParams<{ providerSpaceId: string }>();
  if (!providerSpaceId) return <Redirect href="/suppliers" />;
  return <Redirect href={`/suppliers/${providerSpaceId}`} />;
}
