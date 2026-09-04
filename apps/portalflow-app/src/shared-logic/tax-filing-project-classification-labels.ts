/**
 * Build human-readable classification strings from project/SKU-facing fields for Tina / tax AI prompts.
 * Aligns with list card “pills”: jurisdiction, scenario, tax year, custom tags.
 */

export type ProjectFieldsForClassificationPrompt = {
  taxCountry?: string | null;
  taxScenario?: string | null;
  tags?: string[] | null;
  taxSeasonYear?: number | null;
};

/**
 * Ordered, de-duplicated labels (English phrasing where added) for prompt injection.
 */
export function classificationLabelsForTaxFilingPrompt(
  project: ProjectFieldsForClassificationPrompt | null | undefined,
): string[] {
  if (!project) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const t = s.trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  if (project.taxCountry != null && String(project.taxCountry).trim()) push(String(project.taxCountry));
  if (project.taxScenario != null && String(project.taxScenario).trim()) push(String(project.taxScenario));
  const y = project.taxSeasonYear;
  if (y != null && Number.isFinite(Number(y))) push(`Tax year ${y}`);
  for (const raw of project.tags ?? []) {
    if (typeof raw === 'string') push(raw);
  }
  return out;
}
