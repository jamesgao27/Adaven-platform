/**
 * 报税附件：根据文件内容识别文档类别，并自动匹配到项目的某个 task（用于 chat-to-log attachments 模式，不再由用户选 task）。
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { GoogleGenerativeAI } from './gemini-server-sdk';
import { resolveModelsToTryOrder } from './ai-model-helper';
import { getRecognitionApiKeyPlaceholder } from './ai-provider';

export interface TaxDocumentTaskMatcherContext {
  /** 报税辖区：CANADA | USA */
  taxCountry: string | null;
  /** 报税场景：T1, T2, 1040, 1120-S 等 */
  taxScenario: string | null;
  /** 原始文件名（如 T4A-2024.jpg）可作为辅助线索，不得覆盖图像中的表单编号 */
  fileName?: string | null;
  /**
   * 项目上的分类标签（辖区、场景、税年、自定义 tag），与 SKU/列表 pills 一致；
   * 用于收窄候选项，不得覆盖图像中的表单类型。
   */
  classificationLabels?: string[];
}

export interface TaxDocumentTaskOption {
  id: string;
  title: string;
}

/** Web 上使用 fetch 转 base64；Native 使用 expo-file-system（downloadAsync 在 web 不可用） */
async function downloadImageToBase64(imageUrl: string): Promise<{ base64: string; mimeType: string }> {
  let mimeType = 'image/jpeg';
  if (imageUrl.includes('.png')) mimeType = 'image/png';
  else if (imageUrl.includes('.gif')) mimeType = 'image/gif';
  else if (imageUrl.includes('.webp')) mimeType = 'image/webp';

  if (Platform.OS === 'web') {
    const res = await fetch(imageUrl, { mode: 'cors' });
    if (!res.ok) throw new Error('Failed to fetch image from URL');
    const blob = await res.blob();
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const b64 = dataUrl.split(',')[1];
        resolve(b64 ?? '');
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return { base64, mimeType };
  }

  const downloadResult = await FileSystem.downloadAsync(
    imageUrl,
    FileSystem.documentDirectory + `temp-tax-matcher-${Date.now()}.jpg`
  );
  if (!downloadResult.uri) throw new Error('Failed to download image from URL');
  const base64 = await FileSystem.readAsStringAsync(downloadResult.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  try {
    await FileSystem.deleteAsync(downloadResult.uri, { idempotent: true });
  } catch (_) {}
  return { base64, mimeType };
}

function buildTaskMatcherPrompt(context: TaxDocumentTaskMatcherContext, tasks: TaxDocumentTaskOption[]): string {
  const jurisdiction =
    context.taxCountry === 'CANADA'
      ? 'Canada (CRA / Revenu Québec / provincial)'
      : context.taxCountry === 'USA'
        ? 'USA (IRS / SSA)'
        : 'North America';
  const scenario = (context.taxScenario || 'general tax').trim() || 'general tax';
  const taskList = tasks.map((t) => `- id: "${t.id}", title: "${t.title}"`).join('\n');
  const nameHint =
    context.fileName && context.fileName.trim()
      ? `\nOriginal filename (weak hint; if it conflicts with the image, trust the image): "${context.fileName.trim()}"\n`
      : '';

  const labels = (context.classificationLabels ?? []).map((s) => s.trim()).filter(Boolean);
  const engagementBlock =
    labels.length > 0
      ? `
## Engagement classification (from this project’s metadata)
These labels describe the service scope (same as the app’s project tags). They narrow **likely** document families; the image is always authoritative for the actual form type.
${labels.map((l) => `- ${l}`).join('\n')}
When several tasks could fit, prefer the task whose title best matches **both** the visible slip/form **and** this engagement scope. If tags conflict with a clearly identified form on the image, choose the task that matches the form.
`
      : '';

  const scenarioFocus =
    scenario === 'T1'
      ? 'Focus on personal income slips (T4 family, T5, donations, RRSP, T2202, medical, etc.). Do not map a clear T4 to a generic “other income” task when a T4-specific task exists.'
      : scenario === 'T2'
        ? 'Focus on corporate: financial statements, T2 schedules, GST/HST, minute books, corporate NOA—not personal T4 unless a task explicitly asks for owner employment slips.'
        : scenario === '1040'
          ? 'Focus on individual 1040 support: W-2, 1099 variants, 1098, SSA-1099, 1099-R, K-1 flowing to the individual return.'
          : /^1120/i.test(scenario)
            ? 'Focus on S-corp / business: Form 1120-S pages, Schedule K-1 (1120-S), payroll, business statements as labelled in tasks.'
            : 'Use jurisdiction-appropriate forms exactly as shown on the document.';

  return `You are a senior North American tax preparer. The input is ONE file (image). Pick exactly ONE task id from TASK LIST for this file.

Context — Jurisdiction: ${jurisdiction}. Project tax scenario: ${scenario}.
${scenarioFocus}
${engagementBlock}
${nameHint}
## Identification protocol (internal reasoning; output JSON only)
1. Read visible headers, form codes, box labels, and issuer lines (e.g. “Statement of Remuneration Paid”, “T4A”, “Relevé 1” / RL-1, “W-2”, “OMB No.”, “Department of the Treasury—Internal Revenue Service”, “Canada Revenue Agency”).
2. Use the **most specific** form id (T4 ≠ T4A ≠ T4A(OAS) ≠ T4PS ≠ T4E ≠ T2202; 1099-INT ≠ 1099-DIV ≠ 1099-NEC ≠ 1099-R).
3. If only part of a page is visible, classify from what is shown; do not assume a different form family.
4. Map to the task whose **title** best matches that form (exact code in the title wins over vague words like “income”).
5. Do not map generic bank/credit card statements to slip-specific tasks unless the task title clearly requests statements.

## Common Canada identifiers
T4, T4A, T4A(OAS), T4PS, T4E, T4FHSA, T4RSP, T4RIF, T5, T3, T5008, T2202, RRSP receipt, donation receipt, medical summaries, RL-1, NOA, T1 jacket.

## Common USA identifiers
W-2, 1099-INT, 1099-DIV, 1099-MISC, 1099-NEC, 1099-R, 1099-G, SSA-1099, 1098, 1098-T, 1098-E, K-1 (1065/1120-S), 1120-S.

## TASK LIST (each line: id + task title — your answer must be one id from this list)
${taskList}

Output ONLY valid JSON, no markdown: {"task_id":"<id from TASK LIST>"}`;
}

/**
 * 根据附件图片识别文档类别，并返回应关联的 project todo (task) id。
 * 用于 chat-to-log attachments 模式：上传后自动匹配任务，无需用户选择。
 */
export async function classifyTaxDocumentAndPickTask(
  imageUrl: string,
  context: TaxDocumentTaskMatcherContext,
  tasks: TaxDocumentTaskOption[]
): Promise<{ taskId: string }> {
  if (tasks.length === 0) throw new Error('No tasks to match');
  const currentApiKey = getRecognitionApiKeyPlaceholder();

  const prompt = buildTaskMatcherPrompt(context, tasks);
  const { base64, mimeType } = await downloadImageToBase64(imageUrl);
  const imagePart = { inlineData: { data: base64, mimeType } };
  const genAI = new GoogleGenerativeAI(currentApiKey);
  const modelsToTry = await resolveModelsToTryOrder({
    promptTextLength: prompt.length,
    inlineBase64Length: base64.length,
    mimeType,
  });
  const validIds = new Set(tasks.map((t) => t.id));
  let lastError: Error | null = null;

  for (const modelName of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent([prompt, imagePart]);
      const text = result.response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      const parsed = JSON.parse(jsonMatch[0]) as { task_id?: string };
      const taskId = parsed?.task_id && validIds.has(parsed.task_id) ? parsed.task_id : null;
      if (taskId) return { taskId };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      continue;
    }
  }

  // 识别失败或无有效 task_id 时兜底：优先「Other」字眼任务，否则第一个任务
  return { taskId: getFallbackTaskId(tasks) };
}

/** 标题是否含「其他」类字样（多语言：英 other、中 其他/其它/其余、法 autre、西 otro 等），用于 fallback task 匹配 */
function isOtherLikeTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (/other/i.test(t)) return true;
  if (/其他|其它|其余/.test(t)) return true;
  if (/autre/i.test(t)) return true;
  if (/otro|otros|otra|otras/i.test(t)) return true;
  return false;
}

/**
 * 匹配不上 task 的文件应关联到的 task id：优先标题含「其他」类字样的任务（多语言），否则第一个 task。
 * 仅用于 Tina（tax-filing）分类失败或无法识别时仍保留文件链接并关联到固定 task。
 */
export function getFallbackTaskId(tasks: TaxDocumentTaskOption[]): string {
  if (tasks.length === 0) throw new Error('No tasks to match');
  const otherTask = tasks.find((t) => isOtherLikeTitle(t.title));
  return (otherTask ?? tasks[0]).id;
}
