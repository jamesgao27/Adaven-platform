import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function bindPlatformClient(supabase: SupabaseClient): void {
  client = supabase;
}

export function getPlatformClient(): SupabaseClient {
  if (!client) {
    throw new Error('bindPlatformClient() must run at app start before using platform-core.');
  }
  return client;
}
