import { supabase } from './supabase';
import { getCurrentUser } from './auth';
import type { Attribution, ExpenseIncomeScope } from '@/types';
import { sortScopeTagsForDisplay } from './sort-scope-tags-for-display';

export type { Attribution };

function mapAttributionRow(row: any): Attribution {
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

export async function getAttributions(scope?: ExpenseIncomeScope): Promise<Attribution[]> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    let query = supabase.from('attributions').select('*').eq('space_id', spaceId);
    if (scope === 'expense') query = query.or('scope.eq.expense,scope.is.null');
    else if (scope === 'income') query = query.eq('scope', 'income');

    const result = await query
      .order('usage_count', { ascending: false, nullsFirst: false })
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });

    if (result.error) throw result.error;
    return sortScopeTagsForDisplay((result.data || []).map(mapAttributionRow));
  } catch (error) {
    console.error('Error fetching attributions:', error);
    throw error;
  }
}

export async function createAttribution(
  name: string,
  color: string = '#95A5A6',
  scope: ExpenseIncomeScope = 'expense'
): Promise<Attribution> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { data, error } = await supabase
      .from('attributions')
      .insert({
        space_id: spaceId,
        name: name.trim(),
        color,
        is_default: false,
        scope,
      })
      .select()
      .single();

    if (error) throw error;
    return mapAttributionRow(data);
  } catch (error) {
    console.error('Error creating attribution:', error);
    throw error;
  }
}

export async function updateAttribution(
  attributionId: string,
  updates: { name?: string; color?: string; scope?: ExpenseIncomeScope }
): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const updateData: any = {};
    if (updates.name !== undefined) updateData.name = updates.name.trim();
    if (updates.color !== undefined) updateData.color = updates.color;
    if (updates.scope !== undefined) updateData.scope = updates.scope;

    const { error } = await supabase
      .from('attributions')
      .update(updateData)
      .eq('id', attributionId)
      .eq('space_id', spaceId);
    if (error) throw error;
  } catch (error) {
    console.error('Error updating attribution:', error);
    throw error;
  }
}

export async function deleteAttribution(attributionId: string): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) throw new Error('No space selected');

    const { error } = await supabase
      .from('attributions')
      .delete()
      .eq('id', attributionId)
      .eq('space_id', spaceId);
    if (error) throw error;
  } catch (error) {
    console.error('Error deleting attribution:', error);
    throw error;
  }
}

export async function findAttributionByName(name: string, scope?: ExpenseIncomeScope): Promise<Attribution | null> {
  try {
    const user = await getCurrentUser();
    if (!user) return null;

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) return null;

    let query = supabase
      .from('attributions')
      .select('*')
      .eq('space_id', spaceId)
      .ilike('name', name.trim())
      .limit(1);
    if (scope === 'expense') query = query.or('scope.eq.expense,scope.is.null');
    else if (scope === 'income') query = query.eq('scope', 'income');

    const result = await query.maybeSingle();
    if (result.error) throw result.error;
    return result.data ? mapAttributionRow(result.data) : null;
  } catch (error) {
    console.error('Error finding attribution:', error);
    return null;
  }
}
