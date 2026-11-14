import { supabase } from './supabase';

/**
 * Ensure CRM tag presets + Cash account exist for a consumer space.
 *
 * Categories/attributions are already seeded inside `create_space_with_user`
 * via `crm.apply_consumer_tag_presets_to_space`. This hook only fills gaps and
 * must never insert the legacy English app-catalog (that caused duplicate tags
 * alongside the emoji CRM presets).
 */
export async function createDefaultCategoriesAndAccounts(
  spaceId: string,
  spaceType: 'household' | 'business' = 'household'
): Promise<void> {
  const profile: 'household' | 'business' = spaceType === 'business' ? 'business' : 'household';

  const { count: existingCatCount, error: countError } = await supabase
    .from('categories')
    .select('id', { count: 'exact', head: true })
    .eq('space_id', spaceId);

  if (countError) {
    console.warn('Could not check existing categories before seed:', countError.message);
  }

  if ((existingCatCount ?? 0) === 0) {
    console.log('Seeding CRM category/attribution presets for new space');
    const { error: seedError } = await supabase.rpc('seed_default_categories_purposes_for_space', {
      p_space_id: spaceId,
      p_space_type: profile,
    });
    if (seedError) {
      // Do not fall back to DEFAULT_* English names — they diverge from crm.preset_* and
      // produce redundant tags next to the registration seed.
      console.error(
        'CRM tag preset seed failed (no English fallback):',
        seedError.message
      );
    } else {
      console.log('Default categories and attributions written via CRM RPC');
    }
  } else {
    console.log(
      `Space already has ${existingCatCount} categories; skipping tag re-seed (avoids duplicate catalogs)`
    );
  }

  console.log('Creating default account (Cash only)');
  const { error: paymentAccountsError } = await supabase.rpc('create_default_accounts', {
    p_space_id: spaceId,
  });

  if (paymentAccountsError) {
    console.warn('RPC create_default_accounts failed, trying manual insert:', paymentAccountsError);
    const { error: manualAccountsError } = await supabase.from('accounts').insert([
      { space_id: spaceId, name: 'Cash', is_ai_recognized: true },
    ]);
    if (manualAccountsError) {
      console.error('Manual Cash account create failed:', manualAccountsError);
    } else {
      console.log('Default account (Cash) created');
    }
  }
}
