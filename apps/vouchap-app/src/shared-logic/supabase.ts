import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { bindPlatformClient } from '@adaven/platform-core';

type SupabaseAuthStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

// Web：不传 storage，由 @supabase/auth-js 使用 localStorage。
// 原生：不传 storage 时会退化为内存适配器，杀进程后会话丢失；用户会误以为「每次都要登录」且易与密码错误混淆。
// 在首次创建 client 时用 try/catch require AsyncStorage；未 link 时退回 undefined（与旧行为一致，不白屏）。
let nativeAuthStorageMemo: SupabaseAuthStorage | 'unavailable' | undefined;

function getAuthStorage(): SupabaseAuthStorage | undefined {
  if (Platform.OS === 'web') return undefined;
  if (nativeAuthStorageMemo === 'unavailable') return undefined;
  if (nativeAuthStorageMemo) return nativeAuthStorageMemo;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = require('@react-native-async-storage/async-storage').default as {
      getItem: (key: string) => Promise<string | null>;
      setItem: (key: string, value: string) => Promise<void>;
      removeItem: (key: string) => Promise<void>;
    };
    nativeAuthStorageMemo = {
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
      removeItem: (key) => AsyncStorage.removeItem(key),
    };
    return nativeAuthStorageMemo;
  } catch (e) {
    console.warn('[supabase] AsyncStorage unavailable; auth session will not persist across restarts.', e);
    nativeAuthStorageMemo = 'unavailable';
    return undefined;
  }
}

// 安全获取环境变量，避免启动时崩溃
const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// 验证环境变量是否配置
export function validateSupabaseConfig(): { valid: boolean; error?: string } {
  if (!supabaseUrl || supabaseUrl === '' || supabaseUrl.includes('placeholder')) {
    return { valid: false, error: 'Supabase URL is not configured. Please set EXPO_PUBLIC_SUPABASE_URL.' };
  }
  if (!supabaseAnonKey || supabaseAnonKey === '' || supabaseAnonKey === 'placeholder-key') {
    return { valid: false, error: 'Supabase Anon Key is not configured. Please set EXPO_PUBLIC_SUPABASE_ANON_KEY.' };
  }
  return { valid: true };
}

// 使用安全默认值初始化客户端，避免启动时崩溃
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      storage: getAuthStorage(),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    db: {
      schema: 'public',
    },
    global: {
      headers: {
        'x-client-info': 'vouchap@2.0.0',
      },
    },
  }
);

bindPlatformClient(supabase);

// Storage Bucket 名称配置
const STORAGE_BUCKET = 'receipts';
/** SKU 封面等服务市场资源 */
const MARKETPLACE_BUCKET = 'marketplace';
/** 税表模块上传：按 client space_id 分文件夹存储 */
export const TAX_FILING_BUCKET = 'tax-filing';

/** 从 fileUri（可能为 file://、blob:、content:// 等）安全解析图片扩展名与 MIME，避免拼错 */
const IMAGE_EXT_REG = /\.(jpe?g|png|gif|webp)$/i;
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'] as const;
function getImageExtAndMime(fileUri: string): { ext: string; mimeType: string } {
  const pathPart = fileUri.includes('/') ? fileUri.split('/').pop()?.split('?')[0] ?? '' : fileUri.split('?')[0] ?? '';
  const match = pathPart.match(IMAGE_EXT_REG);
  const ext = match ? match[1].toLowerCase() : 'jpg';
  const normalized = ALLOWED_EXT.includes(ext as any) ? ext : 'jpg';
  const mimeType = normalized === 'jpg' ? 'image/jpeg' : `image/${normalized}`;
  return { ext: normalized === 'jpg' ? 'jpg' : normalized, mimeType };
}

/** 文档扩展名与 MIME 映射（tax-filing 附件支持 PDF、DOC、Excel 等） */
const DOC_MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'text/csv': 'csv',
  'application/csv': 'csv',
};
const DOC_EXT_REG = /\.(pdf|docx?|xlsx?|csv)$/i;

function mimeTypeForDocExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'doc':
      return 'application/msword';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'csv':
      return 'text/csv';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Heuristic: browser / picker sometimes gives image/* while bytes are an Open XML xlsx (ZIP with xl/).
 * Avoid storing spreadsheets as .jpg (breaks preview + recognition).
 */
export function sniffOpenXmlSpreadsheetPrefix(bytes: ArrayBuffer): boolean {
  const u = new Uint8Array(bytes);
  if (u.length < 32 || u[0] !== 0x50 || u[1] !== 0x4b || u[2] !== 0x03 || u[3] !== 0x04) return false;
  const limit = Math.min(u.length, 16000);
  for (let i = 0; i <= limit - 3; i++) {
    if (u[i] === 0x78 && u[i + 1] === 0x6c && u[i + 2] === 0x2f) return true;
  }
  return false;
}

/** Heuristic: bytes are a .docx (ZIP) with word/document.xml — avoid storing as .jpg. */
export function sniffOpenXmlWordPrefix(bytes: ArrayBuffer): boolean {
  const u = new Uint8Array(bytes);
  if (u.length < 32 || u[0] !== 0x50 || u[1] !== 0x4b || u[2] !== 0x03 || u[3] !== 0x04) return false;
  const needle = new Uint8Array([
    0x77, 0x6f, 0x72, 0x64, 0x2f, 0x64, 0x6f, 0x63, 0x75, 0x6d, 0x65, 0x6e, 0x74,
  ]);
  const limit = Math.min(u.length, 64000);
  outer: for (let i = 0; i <= limit - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (u[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * 解析文件扩展名与 MIME，支持图片（jpg/png/gif/webp）与文档（pdf/doc/docx/xlsx/xls/csv）。
 * 当 opts 传入 fileName 或 mimeType 时优先使用（如 DocumentPicker 结果）。
 */
export function getFileExtAndMime(
  fileUri: string,
  opts?: { fileName?: string; mimeType?: string }
): { ext: string; mimeType: string } {
  if (opts?.mimeType) {
    const rawMime = opts.mimeType.trim();
    const mapped = DOC_MIME_TO_EXT[rawMime];
    if (mapped) return { ext: mapped, mimeType: rawMime };
    const m = rawMime.toLowerCase();
    if (m.includes('spreadsheetml.sheet')) {
      return {
        ext: 'xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }
    if (m.includes('wordprocessingml.document')) {
      return {
        ext: 'docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
    }
    if (m.includes('ms-excel') && !m.includes('spreadsheetml')) {
      return { ext: 'xls', mimeType: rawMime };
    }
  }
  const name = opts?.fileName ?? (fileUri.includes('/') ? fileUri.split('/').pop()?.split('?')[0] ?? '' : fileUri.split('?')[0] ?? '');
  const docMatch = name.match(DOC_EXT_REG);
  if (docMatch) {
    const ext = docMatch[1].toLowerCase();
    return { ext, mimeType: mimeTypeForDocExtension(ext) };
  }
  if (name && IMAGE_EXT_REG.test(name)) {
    return getImageExtAndMime(`local/${name}`);
  }
  const genericExtMatch = name.match(/\.([a-zA-Z0-9]{1,32})$/);
  if (genericExtMatch) {
    const ext = genericExtMatch[1].toLowerCase();
    const mimeFromOpts = opts?.mimeType?.trim();
    if (mimeFromOpts) {
      return { ext, mimeType: mimeFromOpts };
    }
    return { ext, mimeType: 'application/octet-stream' };
  }
  return getImageExtAndMime(fileUri);
}

// 上传图片到Supabase Storage（临时文件名，用于识别前上传）
// 建议使用 uploadReceiptImageTempWithSpace 按 space_id 分文件夹存储
export async function uploadReceiptImageTemp(fileUri: string, tempFileName: string): Promise<string> {
  return uploadReceiptImageTempWithSpace(fileUri, tempFileName, '');
}

/**
 * 原生相册常见 HEIC/HEIF；getImageExtAndMime 无法从路径识别时会误用 .jpg + image/jpeg，
 * 字节与 MIME 不一致会导致存储/CDN 与 Gemini 解码异常、置信度极低（表现为 Needs Retake）。
 * 与 uploadSpaceImage 一致：非 Web 的本地图片在上传前统一转为 JPEG。
 */
async function ensureNativeImageUriIsJpegForStorage(
  fileUri: string,
  fileOpts?: { fileName?: string; mimeType?: string }
): Promise<string> {
  if (Platform.OS === 'web') return fileUri;
  if (fileUri.startsWith('blob:') || fileUri.startsWith('data:')) return fileUri;
  const mime = fileOpts?.mimeType?.trim();
  if (mime && !mime.toLowerCase().startsWith('image/')) return fileUri;

  const manipulated = await ImageManipulator.manipulateAsync(fileUri, [], {
    compress: 0.9,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return manipulated.uri;
}

/** 按 space_id 分文件夹上传到 receipts bucket，路径为 {spaceId}/temp/{tempFileName}.{ext}；支持图片与 PDF/DOC 等文档；expenses/income/inbound/outbound 新上传使用此方法 */
export async function uploadReceiptImageTempWithSpace(
  fileUri: string,
  tempFileName: string,
  spaceId: string,
  fileOpts?: { fileName?: string; mimeType?: string }
): Promise<string> {
  try {
    const normalizedUri = await ensureNativeImageUriIsJpegForStorage(fileUri, fileOpts);
    let arrayBuffer: ArrayBuffer | Uint8Array;
    if (Platform.OS === 'web') {
      const res = await fetch(normalizedUri);
      if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
      arrayBuffer = await res.arrayBuffer();
    } else {
      const base64 = await FileSystem.readAsStringAsync(normalizedUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      arrayBuffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    }

    const { ext: fileExt, mimeType } = fileOpts
      ? getFileExtAndMime(normalizedUri, fileOpts)
      : getImageExtAndMime(normalizedUri);
    const fileName = `${tempFileName}.${fileExt}`;
    const folder = spaceId && spaceId.trim() ? spaceId.trim() : 'unknown';
    const filePath = `${folder}/temp/${fileName}`;

    console.log(`Uploading to bucket: ${STORAGE_BUCKET}, path: ${filePath}`);

    const uploadPayload = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : (arrayBuffer as Uint8Array).buffer;
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, uploadPayload, {
        contentType: mimeType,
        upsert: true,
      });

    if (error) {
      console.error('Upload error:', error);
      throw error;
    }

    // 获取公共URL
    const { data: { publicUrl } } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filePath);

    console.log('Upload successful, public URL:', publicUrl);
    return publicUrl;
  } catch (error) {
    console.error('Error uploading image:', error);
    throw error;
  }
}

/** 空间 Logo 上传到 marketplace bucket（强制 JPEG，upsert 覆盖） */
export async function uploadSpaceImage(fileUri: string, spaceId: string): Promise<string> {
  try {
    const isBlobOrData = fileUri.startsWith('blob:') || fileUri.startsWith('data:');
    // 部分移动端会返回 heic 等格式；强制转换成 JPEG，避免 contentType/扩展名猜错导致渲染失败
    if (Platform.OS !== 'web' && !isBlobOrData) {
      const manipulated = await ImageManipulator.manipulateAsync(
        fileUri,
        [],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );
      fileUri = manipulated.uri;
    }

    let arrayBuffer: ArrayBuffer | Uint8Array;

    if (Platform.OS === 'web' || isBlobOrData) {
      const res = await fetch(fileUri);
      if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
      arrayBuffer = await res.arrayBuffer();
    } else {
      const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
      arrayBuffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    }

    const folder = spaceId && spaceId.trim() ? spaceId.trim() : 'unknown';
    const mimeType = 'image/jpeg';
    const filePath = `${folder}/space_logo/space_logo.jpg`;

    const uploadPayload = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : (arrayBuffer as Uint8Array).buffer;
    const { error } = await supabase.storage
      .from(MARKETPLACE_BUCKET)
      .upload(filePath, uploadPayload, { contentType: mimeType, upsert: true });
    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage.from(MARKETPLACE_BUCKET).getPublicUrl(filePath);
    const cacheBustedUrl = publicUrl + (publicUrl.includes('?') ? '&' : '?') + `v=${Date.now()}`;
    return cacheBustedUrl;
  } catch (error) {
    console.error('Error uploading space image:', error);
    throw error;
  }
}

/** 用户 Logo 上传到 marketplace bucket（强制 JPEG，upsert 覆盖） */
export async function uploadUserLogo(fileUri: string, userId: string): Promise<string> {
  try {
    const isBlobOrData = fileUri.startsWith('blob:') || fileUri.startsWith('data:');
    // 强制转换成 JPEG，避免替换时由于 heic/未知格式导致内容不可渲染
    if (Platform.OS !== 'web' && !isBlobOrData) {
      const manipulated = await ImageManipulator.manipulateAsync(
        fileUri,
        [],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );
      fileUri = manipulated.uri;
    }

    let arrayBuffer: ArrayBuffer | Uint8Array;

    if (Platform.OS === 'web' || isBlobOrData) {
      const res = await fetch(fileUri);
      if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
      arrayBuffer = await res.arrayBuffer();
    } else {
      const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
      arrayBuffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    }

    const folder = userId && userId.trim() ? userId.trim() : 'unknown';
    const mimeType = 'image/jpeg';
    const filePath = `${folder}/user_logo/user_logo.jpg`;

    const uploadPayload = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : (arrayBuffer as Uint8Array).buffer;
    const { error } = await supabase.storage
      .from(MARKETPLACE_BUCKET)
      .upload(filePath, uploadPayload, { contentType: mimeType, upsert: true });
    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage.from(MARKETPLACE_BUCKET).getPublicUrl(filePath);
    const cacheBustedUrl = publicUrl + (publicUrl.includes('?') ? '&' : '?') + `v=${Date.now()}`;
    return cacheBustedUrl;
  } catch (error) {
    console.error('Error uploading user logo:', error);
    throw error;
  }
}

/** Firm 注册：上传验证机构附件到 receipts bucket，路径 firm-verification/{userId}/{fileName}.{ext}；支持图片与 PDF/DOC；注册 firm 时必填 */
export async function uploadFirmVerificationFile(
  fileUri: string,
  userId: string,
  fileOpts?: { fileName?: string; mimeType?: string }
): Promise<string> {
  try {
    let arrayBuffer: ArrayBuffer | Uint8Array;
    if (Platform.OS === 'web') {
      const res = await fetch(fileUri);
      if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
      arrayBuffer = await res.arrayBuffer();
    } else {
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      arrayBuffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    }
    const { ext: fileExt, mimeType } = getFileExtAndMime(fileUri, fileOpts);
    const fileName = `verification_${Date.now()}.${fileExt}`;
    const folder = userId && userId.trim() ? userId.trim() : 'unknown';
    const filePath = `firm-verification/${folder}/${fileName}`;
    const uploadPayload = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : (arrayBuffer as Uint8Array).buffer;
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, uploadPayload, { contentType: mimeType, upsert: true });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
    return publicUrl;
  } catch (error) {
    console.error('Error uploading firm verification file:', error);
    throw error;
  }
}

/** 税表模块：上传到 tax-filing bucket，路径为 {clientSpaceId}/{tempFileName}.{ext}；支持图片与 PDF/DOC 等文档；Web 支持 blob URL */
export async function uploadTaxFilingFile(
  fileUri: string,
  tempFileName: string,
  clientSpaceId: string,
  fileOpts?: { fileName?: string; mimeType?: string }
): Promise<string> {
  try {
    let arrayBuffer: ArrayBuffer | Uint8Array;
    if (Platform.OS === 'web') {
      const res = await fetch(fileUri);
      if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
      arrayBuffer = await res.arrayBuffer();
    } else {
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      arrayBuffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    }

    let { ext: fileExt, mimeType } = getFileExtAndMime(fileUri, fileOpts);
    const rawBytes = (
      arrayBuffer instanceof ArrayBuffer
        ? arrayBuffer
        : (arrayBuffer as Uint8Array).buffer.slice(
            (arrayBuffer as Uint8Array).byteOffset,
            (arrayBuffer as Uint8Array).byteOffset + (arrayBuffer as Uint8Array).byteLength,
          )
    ) as ArrayBuffer;
    const sniffSheet = sniffOpenXmlSpreadsheetPrefix(rawBytes);
    const sniffWord = sniffOpenXmlWordPrefix(rawBytes);
    if (
      sniffSheet &&
      ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileExt.toLowerCase())
    ) {
      fileExt = 'xlsx';
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else if (
      sniffWord &&
      !sniffSheet &&
      ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileExt.toLowerCase())
    ) {
      fileExt = 'docx';
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    const fileName = `${tempFileName}.${fileExt}`;
    const folder = clientSpaceId?.trim();
    if (!folder) {
      throw new Error('clientSpaceId is required for tax-filing uploads');
    }
    const filePath = `${folder}/${fileName}`;

    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log(`Uploading to bucket: ${TAX_FILING_BUCKET}, path: ${filePath}`);
    }

    const uploadPayload = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : (arrayBuffer as Uint8Array).buffer;
    const { error } = await supabase.storage
      .from(TAX_FILING_BUCKET)
      .upload(filePath, uploadPayload, {
        contentType: mimeType,
        upsert: true,
      });

    if (error) {
      console.error('Upload error:', error);
      throw error;
    }

    const { data: { publicUrl } } = supabase.storage
      .from(TAX_FILING_BUCKET)
      .getPublicUrl(filePath);

    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log('Tax-filing upload successful');
    }
    return publicUrl;
  } catch (error) {
    console.error('Error uploading tax-filing image:', error);
    throw error;
  }
}

/** 上传任意字节到 tax-filing bucket；路径为 {clientSpaceId}/{fileName}，返回公网 URL（与附件 URL 格式一致） */
export async function uploadTaxFilingFileBytes(
  clientSpaceId: string,
  fileName: string,
  bytes: ArrayBuffer | Uint8Array,
  contentType: string
): Promise<string> {
  const folder = clientSpaceId?.trim();
  if (!folder) {
    throw new Error('clientSpaceId is required for tax-filing uploads');
  }
  const safeName = fileName.replace(/^\/+/, '');
  const filePath = `${folder}/${safeName}`;
  const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const { error } = await supabase.storage.from(TAX_FILING_BUCKET).upload(filePath, payload, {
    contentType,
    upsert: true,
  });
  if (error) {
    console.error('[uploadTaxFilingFileBytes]', error);
    throw error;
  }
  const {
    data: { publicUrl },
  } = supabase.storage.from(TAX_FILING_BUCKET).getPublicUrl(filePath);
  return publicUrl;
}

/** 从 tax-filing 的 storage URL 中解析出 bucket 内路径（即 createSignedUrl 需要的 path） */
export function parseTaxFilingStoragePath(attachmentUrl: string): string | null {
  if (!attachmentUrl || typeof attachmentUrl !== 'string') return null;
  try {
    // 支持格式: .../storage/v1/object/public/tax-filing/spaceId/file.ext 或 .../tax-filing/spaceId/file.ext
    const withStorage = attachmentUrl.match(/\/storage\/v1\/object\/(?:public\/)?tax-filing\/([^?]+)/);
    if (withStorage?.[1]) return decodeURIComponent(withStorage[1].replace(/\/+$/, ''));
    const onlyBucket = attachmentUrl.match(/\/tax-filing\/([^?]+)/);
    if (onlyBucket?.[1]) return decodeURIComponent(onlyBucket[1].replace(/\/+$/, ''));
    return null;
  } catch {
    return null;
  }
}

/**
 * 获取报税附件的可查看 URL：若为本站 tax-filing bucket，则返回带签名的 URL，便于 firm 侧（及 bucket 私有时）正常打开；
 * 否则返回原 URL。
 */
export async function getTaxFilingViewUrl(attachmentUrl: string): Promise<string> {
  const path = parseTaxFilingStoragePath(attachmentUrl);
  if (!path) return attachmentUrl;
  try {
    const { data, error } = await supabase.storage.from(TAX_FILING_BUCKET).createSignedUrl(path, 3600);
    if (error) {
      console.warn('[getTaxFilingViewUrl] createSignedUrl error:', error.message, { path });
      return attachmentUrl;
    }
    if (!data?.signedUrl) return attachmentUrl;
    return data.signedUrl;
  } catch (e) {
    console.warn('[getTaxFilingViewUrl] createSignedUrl exception:', e);
    return attachmentUrl;
  }
}

/** 上传小票正式图到 receipts，路径 {spaceId}/receipt_{receiptId}.{ext}；支持 Web blob/file URI */
export async function uploadReceiptImage(fileUri: string, receiptId: string, spaceId: string): Promise<string> {
  try {
    const normalizedUri = await ensureNativeImageUriIsJpegForStorage(fileUri);
    let arrayBuffer: ArrayBuffer | Uint8Array;
    if (Platform.OS === 'web' || normalizedUri.startsWith('blob:') || normalizedUri.startsWith('data:')) {
      const res = await fetch(normalizedUri);
      if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
      arrayBuffer = await res.arrayBuffer();
    } else {
      const base64 = await FileSystem.readAsStringAsync(normalizedUri, { encoding: FileSystem.EncodingType.Base64 });
      arrayBuffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    }
    const { ext: fileExt, mimeType } = getImageExtAndMime(normalizedUri);
    const folder = spaceId && spaceId.trim() ? spaceId.trim() : 'unknown';
    const filePath = `${folder}/receipt_${receiptId}.${fileExt}`;
    const uploadPayload = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : (arrayBuffer as Uint8Array).buffer;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(filePath, uploadPayload, { contentType: mimeType, upsert: true });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
    return publicUrl;
  } catch (error) {
    console.error('Error uploading receipt image:', error);
    throw error;
  }
}

// 获取图片URL
export function getReceiptImageUrl(filePath: string): string {
  const { data: { publicUrl } } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(filePath);
  return publicUrl;
}

/** 上传项目封面到 tax-filing bucket，路径 {spaceId}/cover_{projectId}.{ext}；spaceId 为 client space，支持 Web blob */
export async function uploadProjectCover(fileUri: string, projectId: string, spaceId: string): Promise<string> {
  try {
    let arrayBuffer: ArrayBuffer | Uint8Array;
    if (Platform.OS === 'web' || fileUri.startsWith('blob:') || fileUri.startsWith('data:')) {
      const res = await fetch(fileUri);
      if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
      arrayBuffer = await res.arrayBuffer();
    } else {
      const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
      arrayBuffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    }
    const { ext: fileExt, mimeType } = getImageExtAndMime(fileUri);
    const folder = spaceId && spaceId.trim() ? spaceId.trim() : 'unknown';
    const filePath = `${folder}/cover_${projectId}.${fileExt}`;
    const uploadPayload = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : (arrayBuffer as Uint8Array).buffer;
    const { error } = await supabase.storage.from(TAX_FILING_BUCKET).upload(filePath, uploadPayload, { contentType: mimeType, upsert: true });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(TAX_FILING_BUCKET).getPublicUrl(filePath);
    // 为避免浏览器 / CDN 对同一路径封面的缓存，统一追加版本参数强制刷新
    const versionedUrl = `${publicUrl}${publicUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
    return versionedUrl;
  } catch (error) {
    console.error('Error uploading project cover:', error);
    throw error;
  }
}

/** 上传发票正式图到 receipts，路径 {spaceId}/invoice_{invoiceId}.{ext}；支持 Web blob */
export async function uploadInvoiceImage(fileUri: string, invoiceId: string, spaceId: string): Promise<string> {
  try {
    let arrayBuffer: ArrayBuffer | Uint8Array;
    if (Platform.OS === 'web' || fileUri.startsWith('blob:') || fileUri.startsWith('data:')) {
      const res = await fetch(fileUri);
      if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
      arrayBuffer = await res.arrayBuffer();
    } else {
      const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
      arrayBuffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    }
    const { ext: fileExt, mimeType } = getImageExtAndMime(fileUri);
    const folder = spaceId && spaceId.trim() ? spaceId.trim() : 'unknown';
    const filePath = `${folder}/invoice_${invoiceId}.${fileExt}`;
    const uploadPayload = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : (arrayBuffer as Uint8Array).buffer;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(filePath, uploadPayload, { contentType: mimeType, upsert: true });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
    return publicUrl;
  } catch (error) {
    console.error('Error uploading invoice image:', error);
    throw error;
  }
}

/** 上传 Firm SKU 封面图到 marketplace bucket，路径 sku/{skuId}.{ext}；Web 支持 blob/data URI */
export async function uploadFirmSkuImage(fileUri: string, skuId: string): Promise<string> {
  let arrayBuffer: ArrayBuffer;
  const isBlobOrData = fileUri.startsWith('blob:') || fileUri.startsWith('data:');
  if (Platform.OS === 'web' || isBlobOrData) {
    const res = await fetch(fileUri);
    if (!res.ok) throw new Error(`Failed to read image: ${res.status}`);
    arrayBuffer = await res.arrayBuffer();
  } else {
    const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
    arrayBuffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
  }
  const { ext: fileExt, mimeType } = getImageExtAndMime(fileUri);
  const filePath = `sku/${skuId}.${fileExt}`;
  const { error } = await supabase.storage.from(MARKETPLACE_BUCKET).upload(filePath, arrayBuffer, { contentType: mimeType, upsert: true });
  if (error) {
    console.error('Storage upload error:', error);
    throw new Error(error.message || 'Upload failed');
  }
  const { data: { publicUrl } } = supabase.storage.from(MARKETPLACE_BUCKET).getPublicUrl(filePath);
  return publicUrl;
}

/** 上传入库单图片（临时），路径 {spaceId}/temp/inbound_{tempFileName}.{ext} */
export async function uploadInboundImageTempWithSpace(fileUri: string, tempFileName: string, spaceId: string): Promise<string> {
  try {
    let arrayBuffer: ArrayBuffer | Uint8Array;
    if (Platform.OS === 'web') {
      const res = await fetch(fileUri);
      if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
      arrayBuffer = await res.arrayBuffer();
    } else {
      const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
      arrayBuffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    }
    const { ext: fileExt, mimeType } = getImageExtAndMime(fileUri);
    const folder = spaceId && spaceId.trim() ? spaceId.trim() : 'unknown';
    const filePath = `${folder}/temp/inbound_${tempFileName}.${fileExt}`;
    const uploadPayload = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : (arrayBuffer as Uint8Array).buffer;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(filePath, uploadPayload, { contentType: mimeType, upsert: true });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
    return publicUrl;
  } catch (error) {
    console.error('Error uploading inbound image temp:', error);
    throw error;
  }
}

/** @deprecated 建议使用 uploadInboundImageTempWithSpace 按 space_id 分文件夹 */
export async function uploadInboundImageTemp(fileUri: string, tempFileName: string): Promise<string> {
  return uploadInboundImageTempWithSpace(fileUri, tempFileName, '');
}

/** 上传入库单正式图到 receipts，路径 {spaceId}/inbound_{inboundId}.{ext}；支持 Web blob */
export async function uploadInboundImage(fileUri: string, inboundId: string, spaceId: string): Promise<string> {
  try {
    let arrayBuffer: ArrayBuffer | Uint8Array;
    if (Platform.OS === 'web' || fileUri.startsWith('blob:') || fileUri.startsWith('data:')) {
      const res = await fetch(fileUri);
      if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
      arrayBuffer = await res.arrayBuffer();
    } else {
      const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
      arrayBuffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    }
    const { ext: fileExt, mimeType } = getImageExtAndMime(fileUri);
    const folder = spaceId && spaceId.trim() ? spaceId.trim() : 'unknown';
    const filePath = `${folder}/inbound_${inboundId}.${fileExt}`;
    const uploadPayload = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : (arrayBuffer as Uint8Array).buffer;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(filePath, uploadPayload, { contentType: mimeType, upsert: true });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
    return publicUrl;
  } catch (error) {
    console.error('Error uploading inbound image:', error);
    throw error;
  }
}

/** 上传出库单图片（临时），路径 {spaceId}/outbound_{tempFileName}.{ext}；仅一层 space_id 文件夹 */
export async function uploadOutboundImageTempWithSpace(fileUri: string, tempFileName: string, spaceId: string): Promise<string> {
  try {
    let arrayBuffer: ArrayBuffer | Uint8Array;
    if (Platform.OS === 'web') {
      const res = await fetch(fileUri);
      if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
      arrayBuffer = await res.arrayBuffer();
    } else {
      const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
      arrayBuffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    }
    const { ext: fileExt, mimeType } = getImageExtAndMime(fileUri);
    const folder = spaceId && spaceId.trim() ? spaceId.trim() : 'unknown';
    const filePath = `${folder}/outbound_${tempFileName}.${fileExt}`;
    const uploadPayload = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : (arrayBuffer as Uint8Array).buffer;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(filePath, uploadPayload, { contentType: mimeType, upsert: true });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
    return publicUrl;
  } catch (error) {
    console.error('Error uploading outbound image temp:', error);
    throw error;
  }
}

/** @deprecated 建议使用 uploadOutboundImageTempWithSpace 按 space_id 分文件夹 */
export async function uploadOutboundImageTemp(fileUri: string, tempFileName: string): Promise<string> {
  return uploadOutboundImageTempWithSpace(fileUri, tempFileName, '');
}

/** 上传出库单正式图到 receipts，路径 {spaceId}/outbound_{outboundId}.{ext}；支持 Web blob */
export async function uploadOutboundImage(fileUri: string, outboundId: string, spaceId: string): Promise<string> {
  try {
    let arrayBuffer: ArrayBuffer | Uint8Array;
    if (Platform.OS === 'web' || fileUri.startsWith('blob:') || fileUri.startsWith('data:')) {
      const res = await fetch(fileUri);
      if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
      arrayBuffer = await res.arrayBuffer();
    } else {
      const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
      arrayBuffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    }
    const { ext: fileExt, mimeType } = getImageExtAndMime(fileUri);
    const folder = spaceId && spaceId.trim() ? spaceId.trim() : 'unknown';
    const filePath = `${folder}/outbound_${outboundId}.${fileExt}`;
    const uploadPayload = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : (arrayBuffer as Uint8Array).buffer;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(filePath, uploadPayload, { contentType: mimeType, upsert: true });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
    return publicUrl;
  } catch (error) {
    console.error('Error uploading outbound image:', error);
    throw error;
  }
}

// 从公共URL中提取文件路径
function extractFilePathFromUrl(url: string): string | null {
  try {
    // URL 格式通常是: https://[project].supabase.co/storage/v1/object/public/receipts/[filename]
    // 或者: https://[project].supabase.co/storage/v1/object/sign/receipts/[filename]?token=...
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const bucketIndex = pathParts.indexOf(STORAGE_BUCKET);
    if (bucketIndex !== -1 && bucketIndex + 1 < pathParts.length) {
      // 提取 bucket 后面的所有路径部分（文件名可能包含目录结构）
      const fileName = pathParts.slice(bucketIndex + 1).join('/');
      return fileName;
    }
    return null;
  } catch (error) {
    console.error('Error extracting file path from URL:', error);
    return null;
  }
}

// 删除Supabase Storage中的文件
export async function deleteReceiptImage(imageUrl: string): Promise<void> {
  try {
    const filePath = extractFilePathFromUrl(imageUrl);
    if (!filePath) {
      console.warn('Could not extract file path from URL:', imageUrl);
      return;
    }

    console.log(`Deleting file from bucket: ${STORAGE_BUCKET}, path: ${filePath}`);
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([filePath]);

    if (error) {
      console.error('Error deleting file:', error);
      // 不抛出错误，因为删除失败不应该影响主流程
    } else {
      console.log('File deleted successfully:', filePath);
    }
  } catch (error) {
    console.error('Error deleting image:', error);
    // 不抛出错误，因为删除失败不应该影响主流程
  }
}
