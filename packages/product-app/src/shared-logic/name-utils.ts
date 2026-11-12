/**
 * 名称比较用归一化：仅大小写与空格容错，便于“相同”判断统一一致。
 * - 转为字符串并 trim 首尾空白
 * - Unicode 规范化（NFKC：全角等统一为半角）
 * - 连续空白合并为一个空格
 * - 使用 en-US 转小写，避免土耳其语等 locale 下 I→ı 导致大小写不一致
 */
export function normalizeNameForCompare(name: string): string {
  const s = String(name ?? '').trim();
  if (!s) return '';
  return s
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
}

/**
 * 判断两个名称在容错规则下是否视为相同。
 */
export function isSameName(a: string, b: string): boolean {
  return normalizeNameForCompare(a) === normalizeNameForCompare(b);
}
