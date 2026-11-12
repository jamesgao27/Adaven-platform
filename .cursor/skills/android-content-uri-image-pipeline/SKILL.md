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

## 已确认根因（Vouchap Android）

**现象**：Android 正式版拍小票立刻 toast `Failed to process expense`；库里无新 `input_type=camera` 记录；Storage / gemini-proxy 探测正常。

**根因**：Android DocumentScanner（ML Kit）返回 **`content://` URI**。拍后链路却按本地 **`file://` / iOS HEIC** 处理：

1. `processCapturedImages`（非相册）→ `processImageForUpload` → `FileSystem.getInfoAsync` + `ImageManipulator.manipulateAsync`
2. 上传前 → `ensureNativeImageUriIsJpegForStorage` → 再次 `ImageManipulator`

`content://` 上这两步易失败（exists=false / manipulate 抛错）→ `catch` 统一成 `Failed to process expense`。失败发生在**客户端读图**，不是 RLS、配额、Gemini。

## 为何会变成 Android 专属问题

| 因素 | 说明 |
|------|------|
| 触发源 | `react-native-document-scanner-plugin` 在 Android 默认把裁剪页以 `content://` 字符串放进 `scannedImages` |
| 历史改动 | `ensureNativeImageUriIsJpegForStorage` 为 **iOS HEIC 误标 JPEG** 引入，却对**全部原生端**强制转 JPEG |
| 平台差异 | Android 扫描/相机本已是 JPEG；此前可用路径是 **直接 `FileSystem.readAsStringAsync` 上传**，不经 ImageManipulator |
| 误诊风险 | Web/孤儿 space、membership heal、加长 toast、Scanner `ResponseType.Base64` 都是旁路，不是恢复原可用方案 |

## 诊断清单

1. Toast 是否来自 `processCapturedImages` / `receipts` 的 `Failed to process expense`（插入前失败）。
2. 是否仅 Android 相机/扫描；相册 `file://` 或 Web 是否正常。
3. 后端：同一项目 Storage 上传 + `gemini-proxy` 是否 OK。
4. DB：报错时段有无新 `receipts`（无 → 客户端早期失败）。
5. 代码：对扫描 URI 是否无条件调用 `getInfoAsync` / `manipulateAsync`。

## 修复原则（恢复，不另生变数）

1. **Android**：跳过 `ensureNativeImageUriIsJpegForStorage` 的 ImageManipulator（保留 iOS HEIC）。
2. **Android `content://`**：`processImageForUpload` 直接返回原 URI，走此前直接上传。
3. **不要**先发明 Scanner `responseType: 'base64'`、space membership 自动 heal、或把 error.message 拼进用户 toast 当作主修复。
4. 正式包须**重打 Android** 后验证；仅改 JS 未发商店包则用户仍见旧行为。

## 关键代码

- `apps/vouchap-app/src/shared-logic/image-processor.ts` → `processImageForUpload`
- `apps/vouchap-app/src/shared-logic/supabase.ts` → `ensureNativeImageUriIsJpegForStorage`
- `apps/vouchap-app/src/mobile-ui/app/index.tsx` → `scanDocument` / `processCapturedImages`
- 同源：`apps/portalflow-app/...` 对应文件

## 反模式

- 因 iOS HEIC 修复而对 Android `content://` 无差别跑 ImageManipulator
- 后端探测成功就断定「识别服务坏了」
- 用新上传方案替代已验证的直接读 URI 上传，而未证明旧路径不可恢复
