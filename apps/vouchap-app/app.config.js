const fs = require("fs");
const path = require("path");

function applyLocalEnvFile(filename) {
  const envPath = path.join(__dirname, filename);
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
    if (!process.env[key]) process.env[key] = value;
  }
}

applyLocalEnvFile(".env");

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const cameraPermission =
  "Vouchap requires Camera and Photo Library access to scan and upload your receipts for digital tracking.";

export default {
  expo: {
    name: "Vouchap",
    slug: "vouchap",
    jsEngine: "jsc",
    version: "2.7.5",
    owner: "aimlink",
    orientation: "default",
    icon: "./assets/vouchap-icon.png",
    scheme: "vouchap",
    userInterfaceStyle: "light",
    splash: {
      backgroundColor: "#ffffff",
      resizeMode: "contain"
    },
    assetBundlePatterns: [],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.vouchap.app",
      buildNumber: "62",
      associatedDomains: ["applinks:vouchap.com"]
    },
    android: {
      package: "com.vouchap.app",
      versionCode: 81,
      permissions: [
        "CAMERA",
        "READ_EXTERNAL_STORAGE",
        "WRITE_EXTERNAL_STORAGE",
        "ACCESS_NETWORK_STATE",
        "INTERNET"
      ],
      adaptiveIcon: {
        foregroundImage: "./assets/vouchap-foreground.png",
        backgroundImage: "./assets/vouchap-background.png",
        backgroundColor: "#C8AEF9"
      },
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [
            { scheme: "https", host: "vouchap.com", pathPrefix: "/" },
            { scheme: "vouchap" }
          ],
          category: ["BROWSABLE", "DEFAULT"]
        }
      ]
    },
    plugins: [
      ["expo-router", { root: "./src/mobile-ui/app" }],
      ["expo-image-picker", { photosPermission: cameraPermission, cameraPermission }],
      ["expo-camera", { cameraPermission }],
      ["react-native-document-scanner-plugin", { cameraPermission }],
      "expo-document-picker"
    ],
    web: {
      name: "Vouchap",
      favicon: "./assets/vouchap-logo.png"
    },
    extra: {
      appVariant: "vouchap",
      supabaseUrl,
      supabaseAnonKey,
      eas: { projectId: "f98c5cea-fd51-41e3-9c9c-1512c6b1a8e7" },
      showAiInventory: false,
      showTaxFiling: true,
      geminiApiKey: "server-side-gemini-proxy"
    }
  }
};
