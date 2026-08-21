# 版本与构建号说明

## 为何每次 EAS 构建要用对版本/构建号？

项目存在 `ios/`、`android/` 原生目录时，**EAS 会优先读取原生工程里的版本**（`Info.plist`、`build.gradle`），而不是 `app.config.js`。若只改 `app.config.js` 或 `package.json` 而不同步到原生，构建出的包仍是旧版本。

## 当前方案（保证每次构建正确）

1. **用户可见版本号（version）**  
   - 唯一来源：`package.json` 的 `version`。  
   - 发布前改这里（如 `2.2.2`），然后执行：
     ```bash
     npm run version:sync
     ```
   - 该脚本会把 `package.json` 的 version 写入：
     - `ios/Vouchap/Info.plist` 的 `CFBundleShortVersionString`
     - `android/app/build.gradle` 的 `versionName`
   - **改完 version 后必须跑一次 `version:sync` 并提交变更**，再执行 `eas build`。

2. **构建号（iOS buildNumber / Android versionCode）**  
   - 由 **EAS 服务端** 管理（`eas.json` 里 `cli.appVersionSource: "remote"`、`production.autoIncrement: true`）。  
   - 每次 production 构建会自动递增，无需在仓库里改数字。  
   - 首次使用或需要与现有商店一致时，在项目根目录执行一次：
     ```bash
     eas build:version:set
     ```
     按提示选择平台并输入当前商店上的构建号，EAS 会以此为起点后续自动递增。

## 发布流程（推荐）

1. 更新 `package.json` 的 `version`（如 `2.2.3`）。
2. 执行 `npm run version:sync`，提交 `ios/`、`android/` 中变更的文件。
3. 执行 `eas build --platform ios --profile production`（或 android）。  
   - 版本号 = 你刚写的 version，构建号 = EAS 自动递增。

这样即可确保每次构建都采用正确的版本号和构建号。
