---
name: android-content-uri-image-pipeline
description: >-
  Diagnoses and prevents Android Failed to process expense / image upload
  failures caused by DocumentScanner content:// URIs hitting ImageManipulator
  or FileSystem.getInfoAsync. Use when Vouchap/Portalflow Android camera or
  document scan fails before storage/AI, or when changing ensureNativeImageUriIsJpegForStorage,
  processImageForUpload, or react-native-document-scanner-plugin.
---

# Android content:// 图片链路（拍小票）

## 已确认根因（Vouchap Android，logcat 实测）

**现象**：Android 正式版拍小票立刻 toast `Failed to process expense`；库里无新 `input_type=camera` 记录；Storage / gemini-proxy / 相册上传正常。

**实测 URI**（vivo / ML Kit）：  
`file:///data/user/0/com.vouchap.app/cache/mlkit_docscan_ui_client/….jpg`  
（不一定是 `content://`；勿只按 content 方案修。）

**根因**：`processImageForUpload` 调用  
`FileSystem.getInfoAsync(uri)`（**未传 options**）。  
`expo-file-system/legacy` 在 Android 上会把缺失的第 2 参打成 NPE：

`ExponentFileSystem.getInfoAsync has been rejected → cannot be cast to InfoOptionsLegacy → NullPointerException`

→ catch 包装成 `Failed to process image` → UI `Failed to process expense`。  
失败在**客户端预处理**，不是 RLS / 配额 / Gemini。

**修复（2.7.4）**：Android 上 **整段跳过** `processImageForUpload`（与相册一致，直接上传 ML Kit JPEG）。  
次要：`getInfoAsync(uri, { md5: false })`；预处理失败时调用方回退原 URI，禁止抛成 Failed to process。  
注意：仅传 `{}` 的 2.7.3 仍可能失败，不能当作已修复。

## 相关注意

| 因素 | 说明 |
|------|------|
| 触发链 | 相机扫描 → `processImageForUpload` → `getInfoAsync`（无 options）→ 抛错 |
| 相册为何正常 | `fromGallery: true` **跳过** `processImageForUpload` |
| HEIC/ImageManipulator | iOS 仍可能需要；Android 可跳过 manipulator，但 **2.7.2 实测致命点是 getInfoAsync** |
| 误诊风险 | 只按 `content://`、membership heal、ResponseType.Base64、后端挂掉 都会偏题 |

## 诊断清单

1. Toast 是否来自 `processCapturedImages` 的 `Failed to process expense`（插入前失败）。
2. 相册是否正常（跳过预处理）而相机失败 → 重点查 `processImageForUpload`。
3. **USB logcat**（商店包）：过滤 `ReactNativeJS`，找 `getInfoAsync` / `InfoOptionsLegacy` / `Processing captured image`。
4. 记下实测 URI（`file://…/mlkit_docscan_ui_client/…` 或 `content://`）。
5. DB：报错时段有无新 `receipts`（无 → 客户端早期失败）。

## 修复原则

1. **必做**：`FileSystem.getInfoAsync(uri, {})` — 第二参不能省（Android legacy NPE）。
2. Android 仍可跳过 `ensureNative` 的 ImageManipulator（iOS HEIC 保留）。
3. 不要只按 `content://` 或 Scanner `responseType: 'base64'` 当唯一方案。
4. 正式包须**重打 Android** 后验证。

## 关键代码

- `apps/vouchap-app/src/shared-logic/image-processor.ts` → `processImageForUpload`
- `apps/vouchap-app/src/shared-logic/supabase.ts` → `ensureNativeImageUriIsJpegForStorage`
- `apps/vouchap-app/src/mobile-ui/app/index.tsx` → `scanDocument` / `processCapturedImages`
- 同源：`apps/portalflow-app/...` 对应文件

## 反模式

- 因 iOS HEIC 修复而对 Android `content://` 无差别跑 ImageManipulator
- 后端探测成功就断定「识别服务坏了」
- 用新上传方案替代已验证的直接读 URI 上传，而未证明旧路径不可恢复
