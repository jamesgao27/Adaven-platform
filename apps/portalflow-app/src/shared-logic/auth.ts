import { supabase } from './supabase';
import { Space, UserSpace } from '@/types';
import {
  getCurrentUser,
  getCurrentSpace as getPlatformCurrentSpace,
  getUserSpaces as getPlatformUserSpaces,
  setCurrentSpace,
  signUp,
  signIn,
  signOut,
  isAuthenticated,
  resetPassword,
  updatePassword,
  runOnSpaceCreated,
} from '@adaven/platform-core';
import type { PlatformSpace } from '@adaven/platform-core';
import './portalflow-space-bootstrap';

export {
  getCurrentUser,
  setCurrentSpace,
  signUp,
  signIn,
  signOut,
  isAuthenticated,
  resetPassword,
  updatePassword,
  signInWithOAuth,
  getEnabledAuthProviders,
  configurePlatformAuth,
} from '@adaven/platform-core';

async function enrichFirmStatus(space: PlatformSpace | null): Promise<Space | null> {
  if (!space) return null;
  let firmStatus: 'pending' | 'approved' | undefined;
  if (space.kind === 'provider') {
    const { data: firmRow } = await supabase
      .schema('firm')
      .from('firms')
      .select('status')
      .eq('space_id', space.id)
      .maybeSingle();
    firmStatus = (firmRow?.status as 'pending' | 'approved') ?? undefined;
  }
  return {
    ...(space as Space),
    kind: (space.kind as Space['kind']) || 'consumer',
    clientProfileType: (space.clientProfileType as Space['clientProfileType']) ?? 'household',
    firmStatus,
  };
}

export async function getCurrentSpace(forceRefresh: boolean = false): Promise<Space | null> {
  const space = await getPlatformCurrentSpace(forceRefresh);
  return enrichFirmStatus(space);
}

export async function getUserSpaces(): Promise<UserSpace[]> {
  const list = await getPlatformUserSpaces();
  const firmIds = list.filter((row) => row.space?.kind === 'provider').map((row) => row.spaceId);
  let firmStatusBySpaceId: Record<string, 'pending' | 'approved'> = {};
  if (firmIds.length > 0) {
    const { data: firmRows } = await supabase
      .schema('firm')
      .from('firms')
      .select('space_id, status')
      .in('space_id', firmIds);
    if (firmRows) {
      firmRows.forEach((r: { space_id: string; status: string }) => {
        firmStatusBySpaceId[r.space_id] = r.status as 'pending' | 'approved';
      });
    }
  }
  return list.map((row) => ({
    id: row.id,
    userId: row.userId,
    spaceId: row.spaceId,
    isAdmin: row.isAdmin,
    createdAt: row.createdAt,
    space: row.space
      ? {
          ...(row.space as Space),
          kind: (row.space.kind as Space['kind']) || 'consumer',
          clientProfileType:
            (row.space.clientProfileType as Space['clientProfileType']) ?? 'household',
          firmStatus:
            row.space.kind === 'provider' ? firmStatusBySpaceId[row.spaceId] : undefined,
        }
      : undefined,
  }));
}

let createSpaceInFlight = false;

/** 创建空间选项：kind=provider（Firm）时需传 verificationAttachmentUrl */
export type CreateSpaceOptions = {
  kind?: 'consumer' | 'provider';
  clientProfileType?: 'household' | 'business';
  verificationAttachmentUrl?: string;
};

/**
 * Product RPC wrapper around kernel create_space_core (see 20260904010000).
 * Seeds also run via registerOnSpaceCreated in createSpace().
 */
export async function createSpaceCore(
  name: string,
  address?: string,
  options?: CreateSpaceOptions
): Promise<{ space: Space | null; error: Error | null }> {
  try {
    const kind = options?.kind ?? 'consumer';
    const clientProfileType = options?.clientProfileType ?? 'household';
    if (kind === 'provider') {
      const url = options?.verificationAttachmentUrl?.trim();
      if (!url) {
        return { space: null, error: new Error('Firm registration requires a verification document.') };
      }
    }

    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      return { space: null, error: new Error('Not authenticated') };
    }

    const verificationUrl = kind === 'provider' ? options!.verificationAttachmentUrl!.trim() : null;
    const { data: rpcSpaceId, error: rpcError } = await supabase.rpc('create_space_with_user', {
      p_space_name: name.trim(),
      p_space_address: address?.trim() || null,
      p_user_id: authUser.id,
      p_kind: kind,
      p_client_profile_type: kind === 'consumer' ? clientProfileType : 'household',
      p_firm_verification_url: verificationUrl,
    });

    if (rpcError || !rpcSpaceId) {
      return {
        space: null,
        error: new Error(rpcError?.message || 'Failed to create space'),
      };
    }

    const { data: spaceData, error: fetchError } = await supabase
      .from('spaces')
      .select('*')
      .eq('id', rpcSpaceId)
      .single();

    if (fetchError || !spaceData) {
      return {
        space: null,
        error: new Error(fetchError?.message || 'Space created but could not be loaded'),
      };
    }

    const space: Space = {
      id: spaceData.id,
      name: spaceData.name,
      address: spaceData.address,
      kind: (spaceData.kind as 'consumer' | 'provider') || 'consumer',
      clientProfileType: (spaceData as { client_profile_type?: 'household' | 'business' }).client_profile_type ?? 'household',
      createdAt: spaceData.created_at,
      updatedAt: spaceData.updated_at,
    };

    return { space, error: null };
  } catch (error) {
    console.error('Error creating space:', error);
    return {
      space: null,
      error: error instanceof Error ? error : new Error('Failed to create space'),
    };
  }
}

export async function createSpace(
  name: string,
  address?: string,
  options?: CreateSpaceOptions
): Promise<{ space: Space | null; error: Error | null }> {
  if (createSpaceInFlight) {
    return {
      space: null,
      error: new Error('A space is already being created. Please wait a moment and try again.'),
    };
  }
  createSpaceInFlight = true;
  try {
    const result = await createSpaceCore(name, address, options);
    if (result.error || !result.space) {
      return result;
    }

    try {
      await runOnSpaceCreated({
        spaceId: result.space.id,
        name: result.space.name,
        kind: result.space.kind,
        clientProfileType: result.space.clientProfileType,
      });
    } catch (hookError) {
      console.warn('onSpaceCreated handler failed (space already created):', hookError);
    }

    let firmStatus: 'pending' | 'approved' | undefined;
    if (result.space.kind === 'provider') {
      const { data: firmRow } = await supabase
        .schema('firm')
        .from('firms')
        .select('status')
        .eq('space_id', result.space.id)
        .maybeSingle();
      firmStatus = (firmRow?.status as 'pending' | 'approved') ?? undefined;
    }

    return {
      space: { ...result.space, firmStatus },
      error: null,
    };
  } finally {
    createSpaceInFlight = false;
  }
}

