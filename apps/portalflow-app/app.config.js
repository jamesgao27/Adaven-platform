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
const isReceiptap = process.env.APP_VARIANT === "receiptap";
const appName = isReceiptap ? "Receiptap" : "Portalflow";
const scheme = isReceiptap ? "receiptap" : "portalflow";
const bundleId = isReceiptap ? "com.vouchap.app" : "com.portalflow.app";
const associatedHost = isReceiptap ? "vouchap.com" : "portalflow.app";
const cameraPermission = `${appName} requires Camera and Photo Library access to scan and upload your receipts for digital tracking.`;

export default {
  expo: {
    name: appName,
    slug: isReceiptap ? "vouchap" : "portalflow",
    jsEngine: "jsc",
    version: isReceiptap ? "2.6.7" : pkg.version,
    owner: "aimlink",
    orientation: "default",
    icon: isReceiptap ? "./assets/receiptap-icon.png" : "./assets/logo2.png",
    scheme,
    userInterfaceStyle: "light",
    splash: {
      backgroundColor: "#ffffff",
      resizeMode: "contain"
    },
    assetBundlePatterns: [],
    ios: {
      supportsTablet: true,
      bundleIdentifier: bundleId,
      buildNumber: isReceiptap ? "45" : "1",
      associatedDomains: [`applinks:${associatedHost}`]
    },
    android: {
      package: bundleId,
      versionCode: isReceiptap ? 62 : 1,
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
              host: associatedHost,
              pathPrefix: "/"
            },
            {
              scheme
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
          photosPermission: cameraPermission,
          cameraPermission
        }
      ],
      ["expo-camera", { cameraPermission }],
      [
        "react-native-document-scanner-plugin",
        {
          cameraPermission
        }
      ],
      "expo-document-picker"
    ],
    web: {
      name: appName,
      favicon: isReceiptap ? "./assets/receiptap-icon.png" : "./assets/favicon.png"
    },
    ...(process.env.EXPO_PUBLIC_WEB_BASE_PATH
      ? { experiments: { baseUrl: process.env.EXPO_PUBLIC_WEB_BASE_PATH } }
      : {}),
    extra: {
      ...(isReceiptap
        ? { eas: { projectId: "f98c5cea-fd51-41e3-9c9c-1512c6b1a8e7" }, appVariant: "receiptap" }
        : {}),
      supabaseUrl,
      supabaseAnonKey,
      showAiInventory: isReceiptap
        ? false
        : process.env.NODE_ENV !== "production"
          ? true
          : process.env.EXPO_PUBLIC_SHOW_AI_INVENTORY === "true",
      showTaxFiling: !isReceiptap,
      geminiApiKey: "server-side-gemini-proxy",
      ...(process.env.EXPO_PUBLIC_AI_PROVIDER === "deepseek"
        ? { aiProvider: "deepseek" }
        : {})
    }
  }
};
