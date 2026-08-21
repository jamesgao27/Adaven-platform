/**
 * 短日期归一化：将 "26/02/06" 等歧义格式统一为 YYYY-MM-DD，
 * 优先采用「更接近参考日期」的解释（如 26/02/06 → 2026-02-06，而非 2006-02-26）。
 */

/** 取本地日期 YYYY-MM-DD（所见即所得，非 UTC） */
export function getLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const YYYY_MM_DD = /^\d{4}-\d{1,2}-\d{1,2}$/;

function twoDigitYearToFull(yy: number, referenceYear: number): number {
  if (yy >= 0 && yy <= 30) return 2000 + yy;
  if (yy >= 31 && yy <= 99) return 1900 + yy;
  return yy;
}

function isValidDayMonth(month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= (daysInMonth[month - 1] ?? 31);
}

/**
 * 将短日期字符串归一化为 YYYY-MM-DD。
 * - 已是 YYYY-MM-DD：若年份明显早于参考年，且可解释为「日/月/年」误成「年/月/日」（如 2006-02-26 实为 26/02/06 的 DD/MM/YY），则尝试「日→年、年→日」的候选，取更接近参考日期的。
 * - 若为 A/B/C 形式（如 26/02/06），尝试 YY/MM/DD、DD/MM/YY、MM/DD/YY，取与 referenceDate 最接近且合理的日期。
 */
export function normalizeShortDate(
  dateStr: string,
  referenceDate: Date = new Date()
): string {
  if (!dateStr || typeof dateStr !== 'string') return dateStr;
  const trimmed = dateStr.trim();
  const refTime = referenceDate.getTime();
  const refYear = referenceDate.getFullYear();

  // 已是 YYYY-MM-DD：可能来自模型把 26/02/06 解析成 DD/MM/YY → 2006-02-26，需用「最接近今天」纠正
  if (YYYY_MM_DD.test(trimmed)) {
    const parts = trimmed.split('-').map((p) => parseInt(p, 10));
    const [y, m, d] = parts;
    if (refYear - y >= 2 && d <= 31 && (y % 100) >= 1 && (y % 100) <= 31 && isValidDayMonth(m, y % 100)) {
      const altY = twoDigitYearToFull(d, refYear);
      const altD = y % 100;
      const current = new Date(y, m - 1, d).getTime();
      const alternative = new Date(altY, m - 1, altD).getTime();
      if (Math.abs(alternative - refTime) < Math.abs(current - refTime))
        return `${altY}-${String(m).padStart(2, '0')}-${String(altD).padStart(2, '0')}`;
    }
    return trimmed;
  }

  // 仅处理含斜杠的格式
  if (!trimmed.includes('/')) return trimmed;
  const parts = trimmed.split('/').map((p) => parseInt(p.trim(), 10));
  if (parts.length !== 3 || parts.some((n) => isNaN(n))) return trimmed;

  const [a, b, c] = parts;
  const candidates: { y: number; m: number; d: number }[] = [];

  // YY/MM/DD：第一位为年（常见于单据 26/02/06 = 2026-02-06）
  const y1 = a <= 99 ? twoDigitYearToFull(a, refYear) : a;
  if (isValidDayMonth(b, c)) candidates.push({ y: y1, m: b, d: c });

  // DD/MM/YY：第一位为日
  const y2 = c <= 99 ? twoDigitYearToFull(c, refYear) : c;
  if (isValidDayMonth(b, a)) candidates.push({ y: y2, m: b, d: a });

  // MM/DD/YY：第二位为日
  if (isValidDayMonth(a, b)) {
    const y3 = c <= 99 ? twoDigitYearToFull(c, refYear) : c;
    candidates.push({ y: y3, m: a, d: b });
  }

  if (candidates.length === 0) return trimmed;

  // 选与参考日期距离最小的（优先更接近今天的解释）
  let best = candidates[0];
  let bestDiff = Math.abs(new Date(best.y, best.m - 1, best.d).getTime() - refTime);
  for (let i = 1; i < candidates.length; i++) {
    const cand = candidates[i];
    const diff = Math.abs(new Date(cand.y, cand.m - 1, cand.d).getTime() - refTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = cand;
    }
  }

  const y = best.y;
  const m = String(best.m).padStart(2, '0');
  const d = String(best.d).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
