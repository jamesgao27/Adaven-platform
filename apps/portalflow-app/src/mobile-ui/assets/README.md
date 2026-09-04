# Assets 目录

此目录用于存放应用的静态资源文件。`apps/portalflow-app/assets` 为指向本目录的符号链接。

## 品牌图标（当前约定）

1. **logo2.png** — 商店 / 系统桌面图标：`app.config.js` 的 `expo.icon` 与 `expo.android.adaptiveIcon.foregroundImage`。
2. **换 logo2 后**：在 `apps/portalflow-app` 根执行 `bash scripts/sync-native-launcher-icons-from-logo2.sh`，从本文件重新生成 **iOS** `AppIcon.appiconset/App-Icon-1024x1024@1x.png` 与 **Android** 各 `mipmap-*` 的 `ic_launcher*.webp`（裸工程以原生资源为准，仅改 `logo2.png` 不会自动进包）。**iOS 1024 图标**由脚本合成 **不透明白底**、去除 alpha，以满足 App Store Connect **90717**（禁止透明大图标）。
3. **logo.png** — 默认主品牌：登录/注册/重置密码等页面、`expo.web.favicon`；与营销站 `public/logo.png` 保持一致。
4. **logo3.png** — **仅** `WebSidebar.tsx`（Web 端大屏左侧栏品牌区）使用，与全站主图 `logo.png` 区分。

历史文件 **icon.png** 可保留作备份。

## 品牌文件位置

Logo 源文件在本目录。更新后按上面步骤同步原生图标即可。

## 其他常见资源

- **assistants/** — AI 助手头像等
