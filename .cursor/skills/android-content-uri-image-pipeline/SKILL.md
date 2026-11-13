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
| **2.7.5（商店）** | 上 + **Android 改系统相机** + `readLocalFileBytes` + `spaceId` 回退 + 首页/receipts 调用方 skip 预处理 | Metro 实测拍摄可识别；发版前复核 checklist 全绿 |

## 已确认根因 A（商店 toast `Failed to process expense`）

**实测 URI**：`file:///…/mlkit_docscan_ui_client/….jpg`  
**链**：`processImageForUpload` → `getInfoAsync` → InfoOptionsLegacy NPE → toast  
**相册正常**：`fromGallery` 跳过预处理。

## 已确认根因 B（dev Metro）

`opening DocumentScanner…` 后永无 `scanner returned`——插件在点击时 `register("document-scanner")`，Promise 不返回。

## 必须落地的完整修复（发版 checklist）

1. **Android 拍照**：`ImagePicker.launchCameraAsync`（首页 + receipts；iOS 可留 DocumentScanner）
2. **Android 跳过预处理**：`processImageForUpload` early return **且** 调用方 `skipPreprocess = fromGallery \|\| android`
3. **Android 跳过** `ensureNativeImageUriIsJpegForStorage` 的 ImageManipulator
4. **上传**：`readLocalFileBytes`（安全 base64 解码 + `fetch` 兜底）
5. **`spaceId`**：空则回退 `getCurrentUser().currentSpaceId`

仅做 2.7.3「补 options」或仅 2.7.4「跳过预处理」都**不完整**。

## 诊断

USB logcat / Metro 找：`expense-debug`、`InfoOptionsLegacy`、`opening DocumentScanner`（无 returned = 根因 B）、`system camera`、`upload ok`。  
用 **preview/dev APK + Metro**，不要靠连发 production 试错。

## 相关代码

- `apps/vouchap-app/src/shared-logic/image-processor.ts`
- `apps/vouchap-app/src/shared-logic/supabase.ts`
- `apps/vouchap-app/src/mobile-ui/app/index.tsx` / `receipts.tsx`
- 同源：`apps/portalflow-app/...`、`packages/product-app/...`
