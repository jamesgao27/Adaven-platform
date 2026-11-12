import { getEntities, getEntitiesForOptions } from './entities';

/** 选关联方用（支出/收入/入库/出库）：仅未被合并的 */
export async function getEntityOptions(): Promise<{ id: string; name: string }[]> {
  const list = await getEntities();
  return list.map((it) => ({ id: it.id, name: it.name }));
}

/** 名称重复判断用：含已合并的，便于按名称找到任意一条并解析到最终目标 */
export async function getEntityOptionsForDuplicateCheck(): Promise<{ id: string; name: string }[]> {
  const list = await getEntitiesForOptions();
  return list.map((it) => ({ id: it.id, name: it.name }));
}
