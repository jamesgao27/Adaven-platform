import { supabase } from './supabase';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_EXPENSE_ATTRIBUTIONS,
  DEFAULT_INCOME_ATTRIBUTIONS,
  DEFAULT_CATEGORY_COLOR,
  DEFAULT_ATTRIBUTION_COLOR,
} from './category-attribution-presets';

// 创建默认分类与 attributions（支出+收入，带 scope 与预设颜色）+ 默认支付账户
export async function createDefaultCategoriesAndAccounts(
  spaceId: string,
  spaceType: 'household' | 'business' = 'household'
): Promise<void> {
  console.log('Seeding default categories and attributions for new space');
  const { error: seedError } = await supabase.rpc('seed_default_categories_purposes_for_space', {
    p_space_id: spaceId,
    p_space_type: spaceType,
  });

  if (seedError) {
    console.warn('RPC 种子预设失败，使用应用层预设回退:', seedError.message);
    const colorCat = DEFAULT_CATEGORY_COLOR;
    const colorAttr = DEFAULT_ATTRIBUTION_COLOR;
    const categoryRows = [
      ...DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
        space_id: spaceId,
        name,
        color: colorCat,
        is_default: false,
        scope: 'expense',
      })),
      ...DEFAULT_INCOME_CATEGORIES.map((name) => ({
        space_id: spaceId,
        name,
        color: colorCat,
        is_default: false,
        scope: 'income',
      })),
    ];
    const attributionRows = [
      ...DEFAULT_EXPENSE_ATTRIBUTIONS.map((name) => ({
        space_id: spaceId,
        name,
        color: colorAttr,
        is_default: false,
        scope: 'expense',
      })),
      ...DEFAULT_INCOME_ATTRIBUTIONS.map((name) => ({
        space_id: spaceId,
        name,
        color: colorAttr,
        is_default: false,
        scope: 'income',
      })),
    ];
    const { error: catErr } = await supabase.from('categories').insert(categoryRows);
    if (catErr) console.warn('应用层回退创建分类失败:', catErr.message);
    const { error: attrErr } = await supabase.from('attributions').insert(attributionRows);
    if (attrErr) console.warn('应用层回退创建 attributions 失败:', attrErr.message);
    if (!catErr && !attrErr) console.log('默认分类与 attributions（含颜色）创建成功');
  } else {
    console.log('默认分类与 attributions 已通过 RPC 写入');
  }

  // 创建默认账户（只创建 Cash）
  console.log('Creating default account (Cash only)');
  const { error: paymentAccountsError } = await supabase.rpc('create_default_accounts', {
    p_space_id: spaceId,
  });

  if (paymentAccountsError) {
    console.warn('RPC创建默认账户失败，尝试手动创建:', paymentAccountsError);
    const { error: manualAccountsError } = await supabase.from('accounts').insert([
      { space_id: spaceId, name: 'Cash', is_ai_recognized: true },
    ]);
    if (manualAccountsError) {
      console.error('手动创建默认账户也失败:', manualAccountsError);
    } else {
      console.log('默认账户（Cash）创建成功');
    }
  }
}

