/**
 * Invite consent continues here: email code, then a client space with no setup form.
 */
import { supabase } from './supabase';
import { createSpace, getCurrentUser, getUserSpaces, setCurrentSpace } from './auth';
import {
  acceptFirmClientInvite,
  getPendingInviteesForEmail,
  inviteeClaimEngagement,
} from './firm-clients';
import { confirmOrderAndCreateProjectTodos } from './firm';

export type ConsumerSpaceChoice = { id: string; name: string };

export async function sendPortalEmailCode(email: string): Promise<void> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) throw new Error('Enter a valid email address.');
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: { shouldCreateUser: true },
  });
  if (error) throw new Error(error.message);
}

export async function verifyPortalEmailCode(email: string, code: string): Promise<void> {
  const trimmed = email.trim().toLowerCase();
  const token = code.replace(/\s/g, '');
  if (token.length < 6) throw new Error('Enter the 6-digit code from your email.');
  const { error } = await supabase.auth.verifyOtp({
    email: trimmed,
    token,
    type: 'email',
  });
  if (error) throw new Error(error.message);
  await getCurrentUser(true);
}

async function latestOrderId(spaceId: string, skuId?: string | null): Promise<string | null> {
  const { data, error } = await supabase
    .schema('provider')
    .from('orders')
    .select('id, sku_id, created_at')
    .eq('consumer_space_id', spaceId)
    .order('created_at', { ascending: false })
    .limit(12);
  if (error || !data?.length) return null;
  if (skuId) {
    const hit = data.find((row) => row.sku_id === skuId);
    if (hit?.id) return String(hit.id);
  }
  return data[0]?.id ? String(data[0].id) : null;
}

export async function listConsumerSpacesForPortal(): Promise<ConsumerSpaceChoice[]> {
  const rows = await getUserSpaces();
  return rows
    .filter((row) => row.space?.kind === 'consumer')
    .map((row) => ({ id: row.spaceId, name: row.space?.name || 'Client space' }));
}

/** Create a consumer space named from the email, or use the only existing one. */
export async function ensureConsumerSpace(
  email: string,
  chosenSpaceId?: string | null
): Promise<{ spaceId: string } | { choices: ConsumerSpaceChoice[] }> {
  const choices = await listConsumerSpacesForPortal();
  if (chosenSpaceId) {
    if (!choices.some((choice) => choice.id === chosenSpaceId)) {
      throw new Error('Choose one of your client spaces.');
    }
    await setCurrentSpace(chosenSpaceId);
    return { spaceId: chosenSpaceId };
  }
  if (choices.length === 1) {
    await setCurrentSpace(choices[0].id);
    return { spaceId: choices[0].id };
  }
  if (choices.length > 1) return { choices };
  const local = email.trim().split('@')[0]?.replace(/[^\w.-]+/g, ' ').trim() || 'Client';
  const { space, error } = await createSpace(local, undefined, { kind: 'consumer' });
  if (error || !space) throw error ?? new Error('Could not create a space.');
  return { spaceId: space.id };
}

export async function openEngagementAfterVerify(params: {
  email: string;
  token?: string;
  firmClientId?: string;
  spaceId: string;
}): Promise<string> {
  const user = await getCurrentUser(true);
  if (!user) throw new Error('Email verification did not sign you in.');
  await setCurrentSpace(params.spaceId);

  let skuId: string | null = null;
  if (params.firmClientId) {
    const { result, error } = await inviteeClaimEngagement(params.firmClientId, params.spaceId);
    if (error) throw error;
    if (!result) throw new Error('This invitation is not for this email.');
    const pending = await getPendingInviteesForEmail(params.email);
    skuId = pending.list.find((row) => row.firmClientId === params.firmClientId)?.skuId ?? null;
  } else if (params.token) {
    const { result, error } = await acceptFirmClientInvite(params.token, params.spaceId, user.id);
    if (error) throw error;
    if (!result) throw new Error('This invitation could not be accepted.');
    skuId = result.skuId;
  } else {
    throw new Error('Missing invitation.');
  }

  const orderId = await latestOrderId(params.spaceId, skuId);
  if (!orderId) throw new Error('The engagement was not created.');
  const { error: confirmError } = await confirmOrderAndCreateProjectTodos(orderId);
  if (confirmError) throw confirmError;
  return orderId;
}
