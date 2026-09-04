import { supabase } from './supabase';
import { Category, ExpenseIncomeScope } from '@/types';
import { getCurrentUser } from './auth';
import { sortScopeTagsForDisplay } from './sort-scope-tags-for-display';

function mapCategoryRow(row: any): Category {
  return {
    id: row.id,
    spaceId: row.space_id,
    name: row.name,
    color: row.color,
    isDefault: row.is_default,
    usageCount: row.usage_count != null ? Number(row.usage_count) : 0,
    scope: row.scope === 'income' ? 'income' : (row.scope === 'expense' ? 'expense' : undefined),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 获取当前空间的分类，可选 scope 仅返回支出或收入 */
export async function getCategories(scope?: ExpenseIncomeScope): Promise<Category[]> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    let query = supabase
      .from('categories')
      .select('*')
      .eq('space_id', spaceId);

    if (scope === 'expense') {
      query = query.or('scope.eq.expense,scope.is.null');
    } else if (scope === 'income') {
      query = query.eq('scope', 'income');
    }

    let result = await query
      .order('usage_count', { ascending: false, nullsFirst: false })
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });

    if (result.error) {
      if (result.error.message?.includes('scope') || result.error.code === '42703') {
        const { data: all } = await supabase
          .from('categories')
          .select('*')
          .eq('space_id', spaceId)
          .order('usage_count', { ascending: false, nullsFirst: false })
          .order('is_default', { ascending: false })
          .order('name', { ascending: true });
        const filtered = scope === 'income'
          ? (all || []).filter((r: any) => r.scope === 'income')
          : (all || []).filter((r: any) => r.scope === 'expense' || r.scope == null);
        return sortScopeTagsForDisplay(filtered.map(mapCategoryRow));
      }
      throw result.error;
    }

    return sortScopeTagsForDisplay((result.data || []).map(mapCategoryRow));
  } catch (error) {
    console.error('Error fetching categories:', error);
    throw error;
  }
}

// 创建分类，scope 必填以区分支出/收入
export async function createCategory(name: string, color: string = '#95A5A6', scope: ExpenseIncomeScope = 'expense'): Promise<Category> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { data, error } = await supabase
      .from('categories')
      .insert({
        space_id: spaceId,
        name: name.trim(),
        color: color,
        is_default: false,
        scope: scope,
      })
      .select()
      .single();

    if (error) {
      if (error.message?.includes('scope') || error.code === '42703') {
        const { data: fallback, error: err2 } = await supabase
          .from('categories')
          .insert({ space_id: spaceId, name: name.trim(), color, is_default: false })
          .select()
          .single();
        if (err2) throw err2;
        return mapCategoryRow(fallback);
      }
      throw error;
    }
    return mapCategoryRow(data!);
  } catch (error) {
    console.error('Error creating category:', error);
    throw error;
  }
}

// 更新分类
export async function updateCategory(categoryId: string, updates: { name?: string; color?: string; scope?: ExpenseIncomeScope }): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const updateData: any = {};
    if (updates.name !== undefined) updateData.name = updates.name.trim();
    if (updates.color !== undefined) updateData.color = updates.color;
    if (updates.scope !== undefined) updateData.scope = updates.scope;

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { error } = await supabase
      .from('categories')
      .update(updateData)
      .eq('id', categoryId)
      .eq('space_id', spaceId);

    if (error) throw error;
  } catch (error) {
    console.error('Error updating category:', error);
    throw error;
  }
}

// 删除分类（不能删除默认分类）
export async function deleteCategory(categoryId: string): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    // 优先使用 currentSpaceId，如果没有则使用 spaceId（向后兼容）
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    // 检查是否为默认分类
    const { data: category, error: fetchError } = await supabase
      .from('categories')
      .select('is_default')
      .eq('id', categoryId)
      .eq('space_id', spaceId)
      .single();

    if (fetchError) throw fetchError;
    if (category?.is_default) {
      throw new Error('Cannot delete default category');
    }

    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', categoryId)
      .eq('space_id', spaceId);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting category:', error);
    throw error;
  }
}

// 根据名称查找分类（用于AI识别后匹配），scope 可选以限定支出/收入
export async function findCategoryByName(name: string, scope?: ExpenseIncomeScope): Promise<Category | null> {
  try {
    const user = await getCurrentUser();
    if (!user) return null;

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) return null;

    let query = supabase
      .from('categories')
      .select('*')
      .eq('space_id', spaceId)
      .ilike('name', name.trim())
      .limit(1);

    if (scope === 'expense') query = query.or('scope.eq.expense,scope.is.null');
    else if (scope === 'income') query = query.eq('scope', 'income');

    let result = await query.single();

    if (result.error) {
      if (result.error.code === 'PGRST116') return null;
      if (result.error.message?.includes('scope') || result.error.code === '42703') {
        const { data: fallback } = await supabase
          .from('categories')
          .select('*')
          .eq('space_id', spaceId)
          .ilike('name', name.trim())
          .limit(1)
          .maybeSingle();
        return fallback ? mapCategoryRow(fallback) : null;
      }
      throw result.error;
    }

    return mapCategoryRow(result.data);
  } catch (error) {
    console.error('Error finding category:', error);
    return null;
  }
}

// 合并分类（将源分类的所有商品项合并到目标分类，然后删除源分类）
export async function mergeCategory(sourceCategoryId: string, targetCategoryId: string): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    if (sourceCategoryId === targetCategoryId) {
      throw new Error('Cannot merge category to itself');
    }

    // 优先使用 currentSpaceId，如果没有则使用 spaceId（向后兼容）
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    // 验证两个分类都属于当前家庭
    const { data: categories, error: fetchError } = await supabase
      .from('categories')
      .select('*')
      .eq('space_id', spaceId)
      .in('id', [sourceCategoryId, targetCategoryId]);

    if (fetchError) throw fetchError;
    if (!categories || categories.length !== 2) {
      throw new Error('Category does not exist or does not belong to current household');
    }

    const sourceCategory = categories.find(cat => cat.id === sourceCategoryId);
    const targetCategory = categories.find(cat => cat.id === targetCategoryId);

    if (!sourceCategory || !targetCategory) {
      throw new Error('Category does not exist');
    }

    // 更新所有使用源分类的商品项，将它们指向目标分类
    // 由于需要确保只更新当前家庭的商品项，我们需要先获取所有相关的 receipt_ids
    const { data: receipts, error: receiptsError } = await supabase
      .from('receipts')
      .select('id')
      .eq('space_id', spaceId);

    if (receiptsError) throw receiptsError;

    if (receipts && receipts.length > 0) {
      const receiptIds = receipts.map(r => r.id);
      
      // 获取所有使用源分类的商品项
      const { data: items, error: itemsError } = await supabase
        .from('receipt_items')
        .select('id')
        .eq('category_id', sourceCategoryId)
        .in('receipt_id', receiptIds);

      if (itemsError) throw itemsError;

      // 更新这些商品项
      if (items && items.length > 0) {
        const itemIds = items.map(item => item.id);
        const { error: updateItemsError } = await supabase
          .from('receipt_items')
          .update({ category_id: targetCategoryId })
          .in('id', itemIds);

        if (updateItemsError) throw updateItemsError;
      }
    }

    // 删除源分类（不能删除默认分类，但如果用户明确要合并，可以允许）
    // 注意：默认分类可以被合并，但合并后的目标分类保持其属性
    const { error: deleteError } = await supabase
      .from('categories')
      .delete()
      .eq('id', sourceCategoryId)
      .eq('space_id', spaceId);

    if (deleteError) throw deleteError;
  } catch (error) {
    console.error('Error merging category:', error);
    throw error;
  }
}

