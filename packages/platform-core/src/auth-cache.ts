import type { PlatformUser as User, PlatformSpace as Space } from './types';

// 全局缓存用户和空间信息
let cachedUser: User | null = null;
let cachedSpace: Space | null = null;
let cacheInitialized = false;

// 初始化缓存（登录时调用）
export async function initializeAuthCache(
  user: User | null,
  space: Space | null
): Promise<void> {
  cachedUser = user;
  cachedSpace = space;
  cacheInitialized = true;
}

// 获取缓存的用户信息
export function getCachedUser(): User | null {
  return cachedUser;
}

// 获取缓存的空间信息
export function getCachedSpace(): Space | null {
  return cachedSpace;
}

// 更新缓存的用户信息
export function updateCachedUser(user: User | null): void {
  cachedUser = user;
}

// 更新缓存的空间信息
export function updateCachedSpace(space: Space | null): void {
  cachedSpace = space;
}

// 清除缓存（登出时调用）
export function clearAuthCache(): void {
  cachedUser = null;
  cachedSpace = null;
  cacheInitialized = false;
}

// 检查缓存是否已初始化
export function isCacheInitialized(): boolean {
  return cacheInitialized;
}

