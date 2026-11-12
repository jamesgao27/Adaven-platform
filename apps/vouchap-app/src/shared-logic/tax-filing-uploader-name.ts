import { getCurrentUser } from './auth';
import { supabase } from './supabase';

/** Display name for project_todo_attachments.uploader_name (matches TaxFilingTodosView / list UI). */
export async function resolveUploaderNameForTaxFilingAttachment(): Promise<string | null> {
  const user = await getCurrentUser();
  if (user?.name?.trim()) return user.name.trim();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (authUser) {
    const fromMeta = (authUser.user_metadata?.name ?? authUser.email?.split('@')[0] ?? '')
      .toString()
      .trim();
    if (fromMeta) return fromMeta;
  }
  return null;
}
