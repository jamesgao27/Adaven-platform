const pkg = require("./package.json");

export default {
  expo: {
    name: "Vouchap",
    slug: "vouchap",
    // 为提高稳定性，暂时在 iOS/Android 上统一使用 JSC 引擎，规避 Hermes 隐式崩溃
    jsEngine: "jsc",
    version: pkg.version,
    owner: "aimlink",
    // 使用 default 以支持大屏/平板旋转，符合 Google Play「移除屏幕方向限制」建议
    orientation: "default",
    // logo2: store / launcher source. expo.icon 用于 prebuild；裸 ios/android 以 AppIcon + mipmap 为准。
    // 更新 logo2.png 后运行：bash scripts/sync-native-launcher-icons-from-logo2.sh
    icon: "./assets/logo2.png",
    scheme: "vouchap", // 关键：解决邮件跳转的核心配置
    userInterfaceStyle: "light",
    splash: {
      backgroundColor: "#ffffff",
      resizeMode: "contain"
    },
    // 仅打包实际引用的资源，避免 "**/*" 把整个项目打进包导致体积暴增（原 315MB+）
    assetBundlePatterns: [],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.vouchap.app",
      // EAS Build 使用 appVersionSource: remote + autoIncrement，构建时由服务端注入，此处仅作参考
      buildNumber: "44",
      associatedDomains: ["applinks:vouchap.com"]
    },
    android: {
      package: "com.vouchap.app",
      // EAS Build 使用 appVersionSource: remote + autoIncrement，构建时由服务端注入，此处仅作参考
      versionCode: 61,
      // 使用系统照片选择器，不再声明 READ_MEDIA_IMAGES，符合 Google Play 照片权限政策
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
              host: "vouchap.com",
              pathPrefix: "/"
            },
            {
              scheme: "vouchap" // 允许通过 vouchap:// 唤起
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
          "photosPermission": "Vouchap requires Camera and Photo Library access to scan and upload your receipts for digital tracking.",
          "cameraPermission": "Vouchap requires Camera and Photo Library access to scan and upload your receipts for digital tracking."
        }
      ],
      ["expo-camera", { "cameraPermission": "Vouchap requires Camera and Photo Library access to scan and upload your receipts for digital tracking." }],
      [
        "react-native-document-scanner-plugin",
        {
          "cameraPermission": "Vouchap requires Camera and Photo Library access to scan and upload your receipts for digital tracking."
        }
      ],
      "expo-document-picker"
    ],
    // Web favicon：优先 public/favicon.ico（透明无白边，与 website 同源）；无 ico 时回退 favicon.png
    web: {
      name: "Vouchap",
      favicon: "./assets/favicon.png"
    },
    // 子路径部署（如 Cloudflare Pages 在 /app/）：设置 EXPO_PUBLIC_WEB_BASE_PATH=/app，否则图标/资源可能 404
    ...(process.env.EXPO_PUBLIC_WEB_BASE_PATH
      ? { experiments: { baseUrl: process.env.EXPO_PUBLIC_WEB_BASE_PATH } }
      : {}),
    // EAS projectId（原 app.json 已合并到本文件）
    // showAiInventory: production 默认隐藏；仅 develop 或显式 EXPO_PUBLIC_SHOW_AI_INVENTORY=true 时显示
    // showTaxFiling: 报税模块与 expenses/income 同级，全环境默认开启（feature-flags 中 extra.showTaxFiling !== false 即开）
    // geminiApiKey: 客户端仅保留代理标识，真实 Key 仅保存在 Supabase Edge Functions 环境变量
    extra: {
      eas: {
        projectId: "f98c5cea-fd51-41e3-9c9c-1512c6b1a8e7"
      },
      showAiInventory:
        process.env.NODE_ENV !== "production"
          ? true
          : process.env.EXPO_PUBLIC_SHOW_AI_INVENTORY === "true",
      showTaxFiling: true,
      geminiApiKey: "server-side-gemini-proxy",
      // Set only when forcing client-side provider; otherwise Edge uses AI_PROVIDER_DEFAULT
      ...(process.env.EXPO_PUBLIC_AI_PROVIDER === "deepseek"
        ? { aiProvider: "deepseek" }
        : {})
    }
  }
};