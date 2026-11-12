/** Max staged file chips shown above chat input before summarizing the rest (web folder / multi-select). */
export const CHAT_STAGED_FILES_DISPLAY_MAX = 10;

export function chatStagedFilesOverflowLabel(totalCount: number): string | null {
  const more = totalCount - CHAT_STAGED_FILES_DISPLAY_MAX;
  if (more <= 0) return null;
  return more === 1 ? 'and 1 more file' : `and ${more} more files`;
}
