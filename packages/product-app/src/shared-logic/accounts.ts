import { supabase } from './supabase';
import { Account } from '@/types';
import { getCurrentUser } from './auth';

// 获取当前空间的所有账户（仅展示“无指向”的，即未被合并的）
export async function getAccounts(): Promise<Account[]> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('space_id', spaceId)
      .is('merged_into_id', null)
      .order('usage_count', { ascending: false, nullsFirst: false })
      .order('is_ai_recognized', { ascending: false })
      .order('name', { ascending: true });

    if (error) throw error;

    return (data || []).map(mapAccountRow);
  } catch (error) {
    console.error('Error fetching accounts:', error);
    throw error;
  }
}

/** 获取全部账户（含已合并指向的），供大模型选项等用 */
export async function getAccountsForOptions(): Promise<Account[]> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('space_id', spaceId)
      .order('usage_count', { ascending: false, nullsFirst: false })
      .order('is_ai_recognized', { ascending: false })
      .order('name', { ascending: true });

    if (error) throw error;

    return (data || []).map(mapAccountRow);
  } catch (error) {
    console.error('Error fetching accounts for options:', error);
    throw error;
  }
}

function mapAccountRow(row: any): Account {
  return {
    id: row.id,
    spaceId: row.space_id,
    name: row.name,
    isAiRecognized: row.is_ai_recognized,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createAccount(name: string, isAiRecognized: boolean = false): Promise<Account> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { data, error } = await supabase
      .from('accounts')
      .insert({
        space_id: spaceId,
        name: name.trim(),
        is_ai_recognized: isAiRecognized,
      })
      .select()
      .single();

    if (error) {
      // 如果是因为名称重复导致的数据库约束错误（23505），尝试查找已存在的账户并返回
      // 这种情况可能发生在并发场景：两个请求同时调用 findOrCreateAccount，都找不到已存在的，然后都尝试创建
      if (error.code === '23505' && (error.message?.includes('name') || error.message?.includes('账户'))) {
        console.log('账户名称已存在（数据库约束），尝试查找已存在的账户:', name.trim());
        const { data: existingAccount } = await supabase
          .from('accounts')
          .select('*')
          .eq('space_id', spaceId)
          .eq('name', name.trim())
          .single();
        if (existingAccount) {
          console.log('找到已存在的账户，返回:', existingAccount.id);
          return mapAccountRow(existingAccount);
        }
      }
      throw error;
    }

    return mapAccountRow(data);
  } catch (error) {
    console.error('Error creating account:', error);
    throw error;
  }
}

export async function updateAccount(accountId: string, updates: { name?: string }): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const updateData: any = {};
    if (updates.name !== undefined) updateData.name = updates.name.trim();

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    if (updates.name !== undefined && updates.name.trim()) {
      const options = await getAccountOptionsForDuplicateCheck();
      const currentResolvedId = await resolveAccountId(spaceId, accountId);
      const normalizedNew = normalizeAccountName(updates.name.trim());
      const found = options.find(
        (o) => o.id !== currentResolvedId && normalizeAccountName(o.name) === normalizedNew
      );
      if (found) {
        throw Object.assign(new Error('账户名称已存在'), {
          code: 'ACCOUNT_NAME_EXISTS' as const,
          duplicateName: updates.name.trim(),
          targetId: found.id,
        });
      }
    }

    const { error } = await supabase
      .from('accounts')
      .update(updateData)
      .eq('id', accountId)
      .eq('space_id', spaceId);

    if (error) throw error;
  } catch (error) {
    console.error('Error updating account:', error);
    throw error;
  }
}

export async function deleteAccount(accountId: string): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { error } = await supabase
      .from('accounts')
      .delete()
      .eq('id', accountId)
      .eq('space_id', spaceId);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting account:', error);
    throw error;
  }
}

/** Masked card / receipt lines: extract last contiguous digit run used as card last-4 (or longer). */
export function extractCardSuffix(name: string): string | null {
  if (!name || typeof name !== 'string') return null;
  const patterns = [
    /\*{2,}(\d{4,})/,
    /\*(\d{4,})/,
    /尾号[：:\s]*(\d{4,})/i,
    /(?:last\s*4|last\s*four)[：:\s]*(\d{4,})/i,
    /(?:ending\s*in|ends\s*in)[：:\s]*(\d{4,})/i,
    /#:\s*\*+(\d{4,})/i,
    /#\s*\*+(\d{4,})/i,
    /#\s*(\d{4,})/,
    /\b(\d{4,})\s*(?:尾号|ending|last)/i,
    /(\d{4,})$/,
  ];
  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Normalize model/user input to exactly 4 digits (last 4 of digit run), or undefined. */
export function normalizeCardLastFourDigits(raw: unknown): string | undefined {
  if (raw == null || raw === 'null') return undefined;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 4) return undefined;
  return digits.slice(-4);
}

/**
 * When AI gives card last-4 (or we infer it), map to an existing space account if possible.
 * Resolves merge chains; if multiple roots share the same last-4, picks highest usage_count.
 */
export async function resolveAccountByCardLastFourDigits(lastFourRaw: string): Promise<Account | null> {
  const lastFour = normalizeCardLastFourDigits(lastFourRaw);
  if (!lastFour) return null;

  const user = await getCurrentUser();
  if (!user) return null;
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) return null;

  const { data: allAccounts, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('space_id', spaceId);

  if (error || !allAccounts?.length) return null;

  const mergeMap = new Map<string, string>();
  allAccounts.forEach((r: any) => {
    if (r.merged_into_id) mergeMap.set(r.id, r.merged_into_id);
  });
  const resolveToFinal = (id: string): string => {
    let current = id;
    const seen = new Set<string>();
    while (mergeMap.has(current) && !seen.has(current)) {
      seen.add(current);
      current = mergeMap.get(current)!;
    }
    return current;
  };

  const finalIds = new Set<string>();
  for (const r of allAccounts) {
    const suffix = extractCardSuffix(r.name);
    if (suffix === lastFour) finalIds.add(resolveToFinal(r.id));
  }

  if (finalIds.size === 0) return null;

  const pickRow = (id: string) => allAccounts.find((r: any) => r.id === id);
  if (finalIds.size === 1) {
    const id = [...finalIds][0];
    const row = pickRow(id);
    return row ? mapAccountRow(row) : null;
  }

  let best: any = null;
  for (const id of finalIds) {
    const row = pickRow(id);
    if (!row) continue;
    const uc = row.usage_count ?? 0;
    if (!best || uc > (best.usage_count ?? 0)) best = row;
  }
  return best ? mapAccountRow(best) : null;
}

export function normalizeAccountName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[：:]/g, ':').replace(/\*+/g, '*');
}

/** 供发票/重复名校验：返回 { id: 解析后最终 id, name } 列表，每个最终账户一条 */
export async function getAccountOptionsForDuplicateCheck(): Promise<{ id: string; name: string }[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data: rows, error } = await supabase
    .from('accounts')
    .select('id, name, merged_into_id')
    .eq('space_id', spaceId);

  if (error) throw error;
  if (!rows?.length) return [];

  const mergeMap = new Map<string, string>();
  rows.forEach((r: any) => {
    if (r.id && r.merged_into_id) mergeMap.set(r.id, r.merged_into_id);
  });
  const resolveToFinal = (id: string): string => {
    let current = id;
    const seen = new Set<string>();
    while (mergeMap.has(current) && !seen.has(current)) {
      seen.add(current);
      current = mergeMap.get(current)!;
    }
    return current;
  };

  const byFinalId = new Map<string, string>();
  const rowMap = new Map<string, { id: string; name: string }>();
  rows.forEach((r: any) => rowMap.set(r.id, { id: r.id, name: r.name }));
  for (const r of rows) {
    const finalId = resolveToFinal(r.id);
    if (!byFinalId.has(finalId)) {
      const finalRow = rowMap.get(finalId);
      byFinalId.set(finalId, finalRow?.name ?? r.name);
    }
  }
  return Array.from(byFinalId.entries()).map(([id, name]) => ({ id, name }));
}

export async function findOrCreateAccount(name: string, isAiRecognized: boolean = true): Promise<Account> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Account name cannot be empty');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { data: allAccounts, error: fetchError } = await supabase
      .from('accounts')
      .select('*')
      .eq('space_id', spaceId)
      .order('usage_count', { ascending: false, nullsFirst: false });

    if (fetchError) throw fetchError;

    if (!allAccounts?.length) return await createAccount(trimmedName, isAiRecognized);

    const normalizedName = normalizeAccountName(trimmedName);

    const mergeHistory = await getMergeHistory();
    const mergedTargetId = mergeHistory.get(normalizedName);
    if (mergedTargetId) {
      const mergedAccount = allAccounts.find(acc => acc.id === mergedTargetId);
      if (mergedAccount) {
        return {
          id: mergedAccount.id,
          spaceId: mergedAccount.space_id,
          name: mergedAccount.name,
          isAiRecognized: mergedAccount.is_ai_recognized,
          createdAt: mergedAccount.created_at,
          updatedAt: mergedAccount.updated_at,
        };
      }
    }

    const exactMatch = allAccounts.find(acc => normalizeAccountName(acc.name) === normalizedName);
    if (exactMatch) {
      return {
        id: exactMatch.id,
        spaceId: exactMatch.space_id,
        name: exactMatch.name,
        isAiRecognized: exactMatch.is_ai_recognized,
        createdAt: exactMatch.created_at,
        updatedAt: exactMatch.updated_at,
      };
    }

    const cardSuffix = extractCardSuffix(trimmedName);
    if (cardSuffix) {
      for (const account of allAccounts) {
        const accountSuffix = extractCardSuffix(account.name);
        if (accountSuffix === cardSuffix) {
          return {
            id: account.id,
            spaceId: account.space_id,
            name: account.name,
            isAiRecognized: account.is_ai_recognized,
            createdAt: account.created_at,
            updatedAt: account.updated_at,
          };
        }
      }
    }

    return await createAccount(trimmedName, isAiRecognized);
  } catch (error) {
    console.error('Error finding or creating account:', error);
    throw error;
  }
}

// 合并账户：只设置“合并指向”，不删记录、不修改小票/发票
export async function mergeAccount(
  sourceAccountIds: string[],
  targetAccountId: string
): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');
    if (sourceAccountIds.length === 0) throw new Error('No source accounts to merge');
    if (sourceAccountIds.includes(targetAccountId)) throw new Error('Cannot merge account to itself');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const allAccountIds = [...sourceAccountIds, targetAccountId];
    const { data: accounts, error: fetchError } = await supabase
      .from('accounts')
      .select('id, merged_into_id')
      .eq('space_id', spaceId)
      .in('id', allAccountIds);

    if (fetchError) throw fetchError;
    if (!accounts || accounts.length !== allAccountIds.length) {
      throw new Error('Account does not exist or does not belong to current space');
    }

    const { data: withPointer } = await supabase
      .from('accounts')
      .select('id, merged_into_id')
      .eq('space_id', spaceId)
      .not('merged_into_id', 'is', null);

    const mergeMap = new Map<string, string>();
    (withPointer || []).forEach((r: any) => {
      if (r.merged_into_id) mergeMap.set(r.id, r.merged_into_id);
    });
    const resolveToFinal = (id: string): string => {
      let current = id;
      const seen = new Set<string>();
      while (mergeMap.has(current) && !seen.has(current)) {
        seen.add(current);
        current = mergeMap.get(current)!;
      }
      return current;
    };

    const finalTargetId = resolveToFinal(targetAccountId);

    for (const sourceId of sourceAccountIds) {
      const { error: updatePointers } = await supabase
        .from('accounts')
        .update({ merged_into_id: finalTargetId })
        .eq('space_id', spaceId)
        .eq('merged_into_id', sourceId);
      if (updatePointers) throw updatePointers;

      const { error: setSource } = await supabase
        .from('accounts')
        .update({ merged_into_id: finalTargetId })
        .eq('id', sourceId)
        .eq('space_id', spaceId);
      if (setSource) throw setSource;
    }
  } catch (error) {
    console.error('Error merging account:', error);
    throw error;
  }
}

/** 取消合并：将子账户的 merged_into_id 置为 null，使其重新成为根账户 */
export async function unmergeAccount(accountId: string): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { error } = await supabase
      .from('accounts')
      .update({ merged_into_id: null })
      .eq('id', accountId)
      .eq('space_id', spaceId);

    if (error) throw error;
  } catch (error) {
    console.error('Error unmerging account:', error);
    throw error;
  }
}

/** 从 accounts 表构建合并指向映射 id -> merged_into_id */
export async function getAccountMergeMap(spaceId: string): Promise<Map<string, string>> {
  const { data: rows } = await supabase
    .from('accounts')
    .select('id, merged_into_id')
    .eq('space_id', spaceId)
    .not('merged_into_id', 'is', null);

  const map = new Map<string, string>();
  (rows || []).forEach((r: any) => {
    if (r.id && r.merged_into_id) map.set(r.id, r.merged_into_id);
  });
  return map;
}

/** 合并历史用：无指向的根账户列表 + 每个根下“指向其”的子账户列表 */
export type AccountsMergeHistoryData = {
  roots: Account[];
  childrenByRootId: Map<string, Account[]>;
};

export async function getAccountsForMergeHistory(): Promise<AccountsMergeHistoryData> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data: allRows, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('space_id', spaceId)
    .order('name', { ascending: true });

  if (error) throw error;
  const rows = allRows || [];

  const roots = rows.filter((r: any) => r.merged_into_id == null).map(mapAccountRow);
  const childrenByRootId = new Map<string, Account[]>();
  for (const root of roots) {
    const children = rows.filter((r: any) => r.merged_into_id === root.id).map(mapAccountRow);
    if (children.length) childrenByRootId.set(root.id, children);
  }
  return { roots, childrenByRootId };
}

/** 各账户直接关联的 expenses(receipts)、income(invoices) 数量（按 account_id 统计） */
export type AccountUsageCounts = {
  receiptCountByAccountId: Record<string, number>;
  invoiceCountByAccountId: Record<string, number>;
};

export async function getAccountUsageCounts(): Promise<AccountUsageCounts> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const receiptCountByAccountId: Record<string, number> = {};
  const invoiceCountByAccountId: Record<string, number> = {};

  const { data: receiptRows } = await supabase
    .from('receipts')
    .select('account_id')
    .eq('space_id', spaceId)
    .not('account_id', 'is', null);
  (receiptRows || []).forEach((r: any) => {
    if (r.account_id) receiptCountByAccountId[r.account_id] = (receiptCountByAccountId[r.account_id] || 0) + 1;
  });

  const { data: invoiceRows } = await supabase
    .from('invoices')
    .select('account_id')
    .eq('space_id', spaceId)
    .not('account_id', 'is', null);
  (invoiceRows || []).forEach((r: any) => {
    if (r.account_id) invoiceCountByAccountId[r.account_id] = (invoiceCountByAccountId[r.account_id] || 0) + 1;
  });

  return { receiptCountByAccountId, invoiceCountByAccountId };
}

/** 按 merged_into_id 解析账户 ID：返回应展示的目标 ID */
export async function resolveAccountId(spaceId: string, accountId: string): Promise<string> {
  const map = await getAccountMergeMap(spaceId);
  let current = accountId;
  const seen = new Set<string>();
  while (map.has(current) && !seen.has(current)) {
    seen.add(current);
    current = map.get(current)!;
  }
  return current;
}

/** 按 ID 获取单个账户（用于合并后展示） */
export async function getAccountById(id: string): Promise<Account | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) return null;

  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', id)
    .eq('space_id', spaceId)
    .maybeSingle();

  if (error || !data) return null;
  return mapAccountRow(data);
}

// 名称 -> 应归并到的目标账户 ID（用于 findOrCreateAccount：已合并指向的记录按名称匹配到最终目标）
async function getMergeHistory(): Promise<Map<string, string>> {
  try {
    const user = await getCurrentUser();
    if (!user) return new Map();
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) return new Map();

    const { data: withPointer, error } = await supabase
      .from('accounts')
      .select('id, name, merged_into_id')
      .eq('space_id', spaceId)
      .not('merged_into_id', 'is', null);

    if (error) return new Map();
    if (!withPointer?.length) return new Map();

    const mergeMap = new Map<string, string>();
    (withPointer || []).forEach((r: any) => {
      if (r.id && r.merged_into_id) mergeMap.set(r.id, r.merged_into_id);
    });
    const resolveToFinal = (id: string): string => {
      let current = id;
      const seen = new Set<string>();
      while (mergeMap.has(current) && !seen.has(current)) {
        seen.add(current);
        current = mergeMap.get(current)!;
      }
      return current;
    };

    const historyMap = new Map<string, string>();
    for (const r of withPointer) {
      historyMap.set(normalizeAccountName(r.name), resolveToFinal(r.id));
    }
    return historyMap;
  } catch (error) {
    console.warn('Error getting merge history:', error);
    return new Map();
  }
}
