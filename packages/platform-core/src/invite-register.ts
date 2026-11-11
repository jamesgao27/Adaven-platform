import { getPlatformClient } from './client';
import { signIn } from './auth';
import type { PlatformUser } from './types';

/**
 * Register (or set password) for a pending invitation without a second email OTP.
 * Invitation row must be pending and match `email`. Auth user is created/confirmed server-side.
 */
export async function registerWithInvitation(options: {
  email: string;
  password: string;
  invitationId: string;
  name?: string;
  kind?: 'space' | 'workspace';
}): Promise<{ user: PlatformUser | null; error: Error | null }> {
  const email = options.email.toLowerCase().trim();
  const password = options.password;
  const invitationId = options.invitationId.trim();
  if (!email || !invitationId) {
    return { user: null, error: new Error('Email and invitation are required') };
  }
  if (password.length < 6) {
    return { user: null, error: new Error('Password must be at least 6 characters') };
  }

  const { data, error } = await getPlatformClient().functions.invoke('register-with-invitation', {
    body: {
      email,
      password,
      invitationId,
      name: options.name?.trim() || undefined,
      kind: options.kind || 'space',
    },
  });

  if (error) {
    return { user: null, error: new Error(error.message || 'Could not complete invitation registration') };
  }
  if (data && (data as { success?: boolean }).success === false) {
    return {
      user: null,
      error: new Error((data as { error?: string }).error || 'Could not complete invitation registration'),
    };
  }

  const { user, error: signInError } = await signIn(email, password);
  if (signInError) {
    return { user: null, error: signInError };
  }
  return { user, error: null };
}
