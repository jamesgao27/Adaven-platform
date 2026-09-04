const fs = require("fs");
const path = require("path");
const pkg = require("./package.json");

function applyLocalEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
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

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

export default {
  expo: {
    name: "Portalflow",
    slug: "portalflow",
    jsEngine: "jsc",
    version: pkg.version,
    owner: "aimlink",
    orientation: "default",
    icon: "./assets/logo2.png",
    scheme: "portalflow",
    userInterfaceStyle: "light",
    splash: {
      backgroundColor: "#ffffff",
      resizeMode: "contain"
    },
    assetBundlePatterns: [],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.portalflow.app",
      buildNumber: "1",
      associatedDomains: ["applinks:portalflow.app"]
    },
    android: {
      package: "com.portalflow.app",
      versionCode: 1,
      permissions: [
        "CAMERA",
        "READ_EXTERNAL_STORAGE",
        "WRITE_EXTERNAL_STORAGE",
        "ACCESS_NETWORK_STATE",
        "INTERNET"
      ],
      adaptiveIcon: {
        foregroundImage: "./assets/logo2.png",
        backgroundColor: "#ffffff"
      },
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [
            {
              scheme: "https",
              host: "portalflow.app",
              pathPrefix: "/"
            },
            {
              scheme: "portalflow"
            }
          ],
          category: ["BROWSABLE", "DEFAULT"]
        }
      ]
    },
    plugins: [
      ["expo-router", { root: "./src/mobile-ui/app" }],
      [
        "expo-image-picker",
        {
          photosPermission: "Portalflow requires Camera and Photo Library access to scan and upload your receipts for digital tracking.",
          cameraPermission: "Portalflow requires Camera and Photo Library access to scan and upload your receipts for digital tracking."
        }
      ],
      ["expo-camera", { cameraPermission: "Portalflow requires Camera and Photo Library access to scan and upload your receipts for digital tracking." }],
      [
        "react-native-document-scanner-plugin",
        {
          cameraPermission: "Portalflow requires Camera and Photo Library access to scan and upload your receipts for digital tracking."
        }
      ],
      "expo-document-picker"
    ],
    web: {
      name: "Portalflow",
      favicon: "./assets/favicon.png"
    },
    ...(process.env.EXPO_PUBLIC_WEB_BASE_PATH
      ? { experiments: { baseUrl: process.env.EXPO_PUBLIC_WEB_BASE_PATH } }
      : {}),
    extra: {
      supabaseUrl,
      supabaseAnonKey,
      showAiInventory:
        process.env.NODE_ENV !== "production"
          ? true
          : process.env.EXPO_PUBLIC_SHOW_AI_INVENTORY === "true",
      showTaxFiling: true,
      geminiApiKey: "server-side-gemini-proxy",
      ...(process.env.EXPO_PUBLIC_AI_PROVIDER === "deepseek"
        ? { aiProvider: "deepseek" }
        : {})
    }
  }
};
