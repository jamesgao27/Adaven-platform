---
name: android-content-uri-image-pipeline
description: >-
  Diagnoses and prevents Android Failed to process expense / image upload
  failures caused by DocumentScanner paths hitting ImageManipulator
  or FileSystem.getInfoAsync (InfoOptionsLegacy NPE). Use when Vouchap/Portalflow
  Android camera or document scan fails before storage/AI, or when changing
  ensureNativeImageUriIsJpegForStorage, processImageForUpload, or
  react-native-document-scanner-plugin.
---

# Android 拍小票图片链路

## 与「以前可用」路径对齐的结论

旧版可用路径本质是：**拍照/扫描得到本地 JPEG URI → 不做 ImageManipulator/getInfoAsync 预处理 → `readAsStringAsync` 上传**（相册一直如此）。

商店 2.7.x 回归是因为相机路径多走了 `processImageForUpload`（SDK 54 + `expo-file-system/legacy` 的 `getInfoAsync` → `InfoOptionsLegacy` NPE）。  
另外 DocumentScanner 在部分 OEM/dev 上 **Promise 不 resolve**，根本进不了上传。

## 版本对照（昨天以来）

| 版本 | 改动 | 结果 |
|------|------|------|
| **旧可用** | 直接上传扫描/拍摄 URI | 正常 |
| **2.7.2** | 仅跳过 Android `content://` 的 ensureNative/manipulator | **不够**：实测 URI 是 `file://…/mlkit_…`，仍进预处理 → NPE |
| **2.7.3** | `getInfoAsync(uri, {})` | **无效**：传入 map 仍强转 `InfoOptionsLegacy` NPE；且 catch 仍 `throw` |
| **2.7.4** | Android **整段跳过** `processImageForUpload` | 对症预处理；若仍失败 → 上传读字节/`spaceId`/或 Scanner 挂死 |
| **可用备份（Vouchap-261109backup）** | 双端 **`DocumentScanner.scanDocument`**：`croppedImageQuality: 90`、`letUserAdjustCrop: false`、Android `maxNumDocuments`；扫描后 `processCapturedImages(..., false, false)`；**不用系统相机** | 自动拍摄 / 边缘裁剪 / 对比加强 |
| **错误绕开** | 曾把 Android 改成 `ImagePicker.launchCameraAsync` | 丢失扫描体验 — **已按备份撤回** |

## 已确认根因 A（商店 toast `Failed to process expense`）

**实测 URI**：`file:///…/mlkit_docscan_ui_client/….jpg`  
**链**：`processImageForUpload` → `getInfoAsync` → InfoOptionsLegacy NPE → toast  
**相册正常**：`fromGallery` 跳过预处理。

## 已确认根因 B（dev Metro）

`opening DocumentScanner…` 后永无 `scanner returned`——插件在点击时 `register("document-scanner")`，Promise 不返回。

## 已确认根因 C（商店 minify + R8 fullMode：连系统相机都打不开）

`enableMinifyInReleaseBuilds=true` 且 AGP 默认 `android.enableR8.fullMode=true` 时，Expo Modules Sweet API 的 `Record`/`@Field` 元数据被剥掉：

- Google：`openBrowserAsync` → `OpenBrowserOptions` cast NPE（ReadableNativeMap）
- 拍照：`launchCameraAsync` → **`ImagePickerOptions` 同类 cast NPE** → 表现为点拍摄无相机界面

**修复**：`android.enableR8.fullMode=false` + `proguard-rules.pro` keep `expo.modules.**` / `Record` / `@Field`。发版前用 **本地 release APK** USB 点一次拍摄确认能进 `com.android.camera`。

## 必须落地的完整修复（发版 checklist）

1. **拍照入口（对照备份）**：`DocumentScanner.scanDocument`（插件内 Android=`SCANNER_MODE_FULL`）— **禁止**用系统相机替代主路径
2. **选项**：`croppedImageQuality: 90`、`letUserAdjustCrop: false`；首页 Android 另加 `maxNumDocuments`；扫描回调 `autoCrop=false`
3. **Android 跳过预处理**：在 **`image-processor.processImageForUpload`** 内 early return（调用方仍按备份写 `if (!fromGallery) processImageForUpload`）
4. **Android 跳过** `ensureNativeImageUriIsJpegForStorage` 的 ImageManipulator
5. **上传**：`readLocalFileBytes`；**`spaceId`** 空则回退 `getCurrentUser().currentSpaceId`
6. **Release R8**：`fullMode=false` + Expo Record keep（Google/`ImagePickerOptions`）

事实来源：`Vouchap-261109backup/vouchap-app/.../index.tsx` + `receipts.tsx`。不要用系统相机「绕开」猜测方案。

## 诊断

USB logcat / Metro 找：`expense-debug`、`InfoOptionsLegacy`、`opening DocumentScanner`（无 returned = 根因 B）、`system camera`、`upload ok`、`ImagePickerOptions` / `ReadableNativeMap` / `OpenBrowserOptions`。  
用 **preview/dev APK + Metro**，不要靠连发 production 试错。Play Console 远端崩溃日志默认不可见，以 USB `adb logcat` 为准。

## 相关代码

- `apps/vouchap-app/src/shared-logic/image-processor.ts`
- `apps/vouchap-app/src/shared-logic/supabase.ts`
- `apps/vouchap-app/src/mobile-ui/app/index.tsx` / `receipts.tsx`
- 同源：`apps/portalflow-app/...`、`packages/product-app/...`
