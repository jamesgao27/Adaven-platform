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
const appName = "Portalflow";
const scheme = "portalflow";
const bundleId = "com.portalflow.app";
const associatedHost = "portalflow.app";
const cameraPermission = `${appName} requires Camera and Photo Library access to upload client documents.`;

export default {
  expo: {
    name: appName,
    slug: "portalflow",
    jsEngine: "jsc",
    version: pkg.version,
    owner: "aimlink",
    orientation: "default",
    icon: "./assets/logo2.png",
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
      buildNumber: "1",
      associatedDomains: [`applinks:${associatedHost}`]
    },
    android: {
      package: bundleId,
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
