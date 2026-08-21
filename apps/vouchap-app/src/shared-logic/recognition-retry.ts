/**
 * 识别失败时后台静默重试，直至成功或判定为「内容质量太差」。
 * - 可重试：网络/API/404/限流等，继续重试。
 * - 不可重试（内容质量）：缺失必填字段、无法解析等，直接提示用户重新提交。
 */

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_DELAY_MS = 2000;

/** 是否为「内容质量太差」导致的错误（不重试，提示用户重新提交） */
export function isContentQualityError(error: unknown): boolean {
  const msg = error != null ? String(error).toLowerCase() : '';
  return (
    /missing required|required fields|validation|invalid response|no json|no valid json|无法识别|内容不清晰/i.test(msg)
  );
}

/** 是否为可重试错误（网络/API/404/限流等） */
export function isRetriableError(error: unknown): boolean {
  return !isContentQualityError(error);
}

export type RetryResult<T> =
  | { success: true; result: T }
  | { success: false; error: Error; isContentQuality: boolean };

/**
 * 执行识别函数，失败时按间隔重试直至成功或达到最大次数。
 * - 可重试错误：等待 delayMs 后重试。
 * - 内容质量错误：立即返回，不重试。
 */
export async function runWithRecognitionRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    delayMs?: number;
  } = {}
): Promise<RetryResult<T>> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      return { success: true, result };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      lastError = err;

      if (isContentQualityError(e)) {
        return { success: false, error: err, isContentQuality: true };
      }

      if (attempt < maxAttempts) {
        console.warn(`Recognition attempt ${attempt}/${maxAttempts} failed, retrying in ${delayMs}ms...`, err.message);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  return {
    success: false,
    error: lastError ?? new Error('Recognition failed'),
    isContentQuality: false,
  };
}

/** 用户可见错误文案（英文）：内容质量 → 提示重新提交；其他 → 稍后重试 */
export function getUserFacingMessage(result: RetryResult<unknown>): string {
  if (result.success) return '';
  if (result.isContentQuality) {
    return 'Content unclear or not recognized. Please resubmit.';
  }
  return 'Recognition failed. Please try again later.';
}
