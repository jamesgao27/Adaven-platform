/**
 * Category / Attribution 在管理页与各类选单中的统一排序：
 * 「Other」固定最后；其余按 usage_count 降序、默认项优先、名称升序。
 */
export function sortScopeTagsForDisplay<
  T extends { name: string; isDefault?: boolean; usageCount?: number | null },
>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ao = a.name === 'Other' ? 1 : 0;
    const bo = b.name === 'Other' ? 1 : 0;
    if (ao !== bo) return ao - bo;
    const ua = Number(a.usageCount ?? 0);
    const ub = Number(b.usageCount ?? 0);
    if (ua !== ub) return ub - ua;
    const ad = a.isDefault ? 1 : 0;
    const bd = b.isDefault ? 1 : 0;
    if (ad !== bd) return bd - ad;
    return a.name.localeCompare(b.name);
  });
}
