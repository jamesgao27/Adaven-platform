/** PostgREST 嵌套 select 需要 FK；line item 列为 attribution_id，关系应指向 attributions。 */
export function isMissingNestedAttributionEmbedError(
  err: unknown,
  itemsTable: 'receipt_items' | 'invoice_items'
): boolean {
  const e = err as { code?: string; message?: string; details?: string; hint?: string } | null;
  if (!e) return false;
  const blob = `${e.code ?? ''} ${e.message ?? ''} ${e.details ?? ''} ${e.hint ?? ''}`;
  if (!new RegExp(itemsTable, 'i').test(blob)) return false;
  return (
    e.code === 'PGRST200' ||
    /Could not find a relationship/i.test(blob) ||
    /Searched for a foreign key relationship/i.test(blob)
  );
}
