import type { PostgrestError } from '@supabase/supabase-js';

/** PostgREST 服务端 max-rows 上限，Supabase 默认 1000 */
export const SUPABASE_PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: PostgrestError | null };

/**
 * 单个 PostgREST 请求最多返回服务端 `max-rows`（Supabase 默认 1000）行，**超出部分会被静默丢弃**，
 * 既不报错也没有任何提示。凡是语义上要「取全量」的列表查询都必须翻页，否则数据会无声缺失。
 *
 * `buildPage` 必须带**稳定且唯一**的排序（如主键），否则翻页之间可能重复或漏行。
 * 只在返回空页时停止，而不是靠「不足一页」判断，这样服务端 max-rows 小于 pageSize 时也不会提前截断。
 */
export async function fetchAllPages<T>(
  buildPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options?: { pageSize?: number; maxPages?: number },
): Promise<PageResult<T>> {
  const pageSize = options?.pageSize ?? SUPABASE_PAGE_SIZE;
  const maxPages = options?.maxPages ?? 200;

  const all: T[] = [];
  let from = 0;

  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) return { data: null, error };

    const rows = data ?? [];
    all.push(...rows);
    if (rows.length === 0) break;
    from += rows.length;
  }

  return { data: all, error: null };
}
