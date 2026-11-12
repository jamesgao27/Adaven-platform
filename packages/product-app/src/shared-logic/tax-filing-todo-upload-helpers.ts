/** Whether a todo attachment upload should be logged / treated as an image vs document. */

export function taxFilingTodoUploadIsImageKind(fileName: string, mimeType?: string | null): boolean {
  const m = (mimeType ?? '').toLowerCase();
  if (m.startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(fileName);
}
