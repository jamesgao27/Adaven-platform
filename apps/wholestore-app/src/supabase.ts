import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { bindPlatformClient } from '@adaven/platform-core';

type AuthStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

let nativeAuthStorage: AuthStorage | 'unavailable' | undefined;

function getAuthStorage(): AuthStorage | undefined {
  if (Platform.OS === 'web') return undefined;
  if (nativeAuthStorage === 'unavailable') return undefined;
  if (nativeAuthStorage) return nativeAuthStorage;
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default as AuthStorage;
    nativeAuthStorage = AsyncStorage;
    return nativeAuthStorage;
  } catch {
    nativeAuthStorage = 'unavailable';
    return undefined;
  }
}

const extra = (Constants.expoConfig?.extra ?? {}) as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

export const supabaseUrl =
  extra.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://foyecolycmxcneflpant.supabase.co';
export const supabaseAnonKey =
  extra.supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export function validateSupabaseConfig(): { valid: boolean; error?: string } {
  if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
    return { valid: false, error: 'Supabase URL is not configured.' };
  }
  if (!supabaseAnonKey || supabaseAnonKey === 'your_anon_key') {
    return { valid: false, error: 'Set EXPO_PUBLIC_SUPABASE_ANON_KEY for project foyecolycmxcneflpant.' };
  }
  return { valid: true };
}

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder-key', {
  auth: {
    storage: getAuthStorage(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    headers: { 'x-client-info': 'wholestore@0.1.0' },
  },
});

bindPlatformClient(supabase);
