import { useEffect } from 'react';
import { useRouter } from 'expo-router';

/**
 * Admin and member changes live on the members list for every product.
 * This route remains so older Management links still land there.
 * Finer provider permissions are product screens, added on top of this membership.
 */
export default function SpaceRolesScreen() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/space-members');
  }, [router]);
  return null;
}
