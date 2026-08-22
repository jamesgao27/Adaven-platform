import { getPlatformClient } from './client';
import { getCurrentUser, getCurrentSpace, setCurrentSpace } from './auth';
import { runOnSpaceCreated } from './space-created-hooks';
import type { PlatformSpace } from './types';

/**
 * Create spaces + membership + current space only.
 * Product seeds belong in registerOnSpaceCreated.
 * Prefers RPC create_space_core; falls back to direct inserts if the function is missing.
 */
export async function createSpaceCore(
  name: string,
  address?: string,
  kind?: string
): Promise<{ space: PlatformSpace | null; error: Error | null }> {
  try {
    const supabase = getPlatformClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      return { space: null, error: new Error('Not authenticated') };
    }

    const trimmed = name.trim();
    if (!trimmed) {
      return { space: null, error: new Error('Space name is required') };
    }

    const kindValue = kind?.trim() || undefined;

    let spaceId: string | null = null;
    const { data: rpcId, error: rpcError } = await supabase.rpc('create_space_core', {
      p_space_name: trimmed,
      p_space_address: address?.trim() || null,
      p_user_id: authUser.id,
      ...(kindValue ? { p_kind: kindValue } : {}),
    });

    if (!rpcError && rpcId) {
      spaceId = typeof rpcId === 'string' ? rpcId : String(rpcId);
    } else if (rpcError && rpcError.code !== '42883' && !rpcError.message?.includes('does not exist')) {
      return { space: null, error: new Error(rpcError.message) };
    } else {
      const { data: spaceRow, error: spaceError } = await supabase
        .from('spaces')
        .insert({ name: trimmed, address: address?.trim() || null, ...(kindValue ? { kind: kindValue } : {}) })
        .select('id')
        .single();
      if (spaceError || !spaceRow) {
        return { space: null, error: new Error(spaceError?.message || 'Failed to create space') };
      }
      spaceId = spaceRow.id as string;
      await supabase.from('user_spaces').insert({
        user_id: authUser.id,
        space_id: spaceId,
        is_admin: true,
      });
      await supabase.from('users').update({ current_space_id: spaceId }).eq('id', authUser.id);
    }

    if (!spaceId) {
      return { space: null, error: new Error('Failed to create space') };
    }

    await setCurrentSpace(spaceId);
    await runOnSpaceCreated({ spaceId, name: trimmed, kind: kindValue });
    const space = await getCurrentSpace(true);
    await getCurrentUser(true);
    return { space, error: null };
  } catch (error) {
    return {
      space: null,
      error: error instanceof Error ? error : new Error('Failed to create space'),
    };
  }
}
