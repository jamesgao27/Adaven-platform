const fs = require("fs");
const path = require("path");
const pkg = require("./package.json");

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
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const isVouchap = process.env.APP_VARIANT === "vouchap";
applyLocalEnvFile(isVouchap ? ".env.vouchap" : ".env");

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const appName = isVouchap ? "Vouchap" : "Portalflow";
const scheme = isVouchap ? "vouchap" : "portalflow";
const bundleId = isVouchap ? "com.vouchap.app" : "com.portalflow.app";
const associatedHost = isVouchap ? "vouchap.com" : "portalflow.app";
const icon = isVouchap ? "./assets/vouchap-icon.png" : "./assets/logo2.png";
const version = isVouchap ? "2.7.1" : pkg.version;
const iosBuildNumber = isVouchap ? "56" : "1";
const androidVersionCode = isVouchap ? 74 : 1;
const cameraPermission = isVouchap
  ? "Vouchap requires Camera and Photo Library access to scan and upload your receipts for digital tracking."
  : `${appName} requires Camera and Photo Library access to upload client documents.`;

export default {
  expo: {
    name: appName,
    slug: isVouchap ? "vouchap" : "portalflow",
    jsEngine: "jsc",
    version,
    owner: "aimlink",
    orientation: "default",
    icon,
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
      buildNumber: iosBuildNumber,
      associatedDomains: [`applinks:${associatedHost}`]
    },
    android: {
      package: bundleId,
      versionCode: androidVersionCode,
      permissions: [
        "CAMERA",
        "READ_EXTERNAL_STORAGE",
        "WRITE_EXTERNAL_STORAGE",
        "ACCESS_NETWORK_STATE",
        "INTERNET"
      ],
      adaptiveIcon: isVouchap
        ? {
            foregroundImage: "./assets/vouchap-foreground.png",
            backgroundImage: "./assets/vouchap-background.png",
            backgroundColor: "#C8AEF9"
          }
        : {
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
      favicon: isVouchap ? "./assets/vouchap-icon.png" : "./assets/favicon.png"
    },
    ...(process.env.EXPO_PUBLIC_WEB_BASE_PATH
      ? { experiments: { baseUrl: process.env.EXPO_PUBLIC_WEB_BASE_PATH } }
      : {}),
    extra: {
      appVariant: isVouchap ? "vouchap" : "portalflow",
      supabaseUrl,
      supabaseAnonKey,
      ...(isVouchap
        ? { eas: { projectId: "f98c5cea-fd51-41e3-9c9c-1512c6b1a8e7" } }
        : {}),
      showAiInventory: false,
      showTaxFiling: true,
      geminiApiKey: "server-side-gemini-proxy",
      ...(process.env.EXPO_PUBLIC_AI_PROVIDER === "deepseek"
        ? { aiProvider: "deepseek" }
        : {})
    }
  }
};
