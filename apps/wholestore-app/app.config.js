const fs = require('fs');
const path = require('path');
const pkg = require('./package.json');

function applyLocalEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

applyLocalEnvFile();

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://foyecolycmxcneflpant.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export default {
  expo: {
    name: 'Wholestore',
    slug: 'wholestore',
    version: pkg.version,
    orientation: 'default',
    scheme: 'wholestore',
    userInterfaceStyle: 'light',
    icon: './assets/icon.png',
    splash: {
      backgroundColor: '#ffffff',
      resizeMode: 'contain',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.wholestore.app',
    },
    android: {
      package: 'com.wholestore.app',
    },
    plugins: [['expo-router', { root: './src/app' }]],
    web: {
      name: 'Wholestore',
      bundler: 'metro',
      output: 'single',
      favicon: './assets/icon.png',
    },
    ...(process.env.EXPO_PUBLIC_WEB_BASE_PATH
      ? { experiments: { baseUrl: process.env.EXPO_PUBLIC_WEB_BASE_PATH } }
      : {}),
    extra: {
      supabaseUrl,
      supabaseAnonKey,
      supabaseProjectRef: 'foyecolycmxcneflpant',
    },
  },
};
