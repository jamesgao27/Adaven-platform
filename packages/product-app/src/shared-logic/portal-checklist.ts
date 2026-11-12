/**
 * After a file lands in the engagement folder, decide which client checklist
 * items are now complete. Title and description are the only requirement text.
 */
import { GoogleGenerativeAI } from './gemini-server-sdk';
import { resolveModelsToTryOrder } from './ai-model-helper';
import { getRecognitionApiKeyPlaceholder } from './ai-provider';
import { Platform } from 'react-native';

export type ChecklistItemInput = {
  id: string;
  title: string;
  description?: string | null;
};

export type ChecklistVerdict = {
  id: string;
  satisfied: boolean;
  gap: string | null;
};

async function fileToInline(url: string, mimeHint?: string | null): Promise<{ base64: string; mimeType: string } | null> {
  const mimeType = mimeHint || (url.includes('.png') ? 'image/png' : url.includes('.pdf') ? 'application/pdf' : 'image/jpeg');
  if (!mimeType.startsWith('image/') && mimeType !== 'application/pdf') return null;
  if (Platform.OS !== 'web') return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      resolve(dataUrl.split(',')[1] || '');
    };
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(blob);
  });
  if (!base64) return null;
  return { base64, mimeType };
}

export async function evaluateChecklistAgainstFile(
  fileUrl: string,
  fileName: string,
  items: ChecklistItemInput[],
  mimeType?: string | null
): Promise<ChecklistVerdict[]> {
  const openItems = items.filter((item) => item.id && item.title);
  if (!openItems.length) return [];
  const list = openItems
    .map((item) => `- id: "${item.id}" title: "${item.title}" required: "${(item.description || item.title).replace(/"/g, "'")}"`)
    .join('\n');
  const prompt = `You review one uploaded file against a document checklist.
Mark an item satisfied only when this file contains the information that item asks for.
If it does not, leave it unsatisfied and say what is still missing in a short phrase.
File name: ${fileName}

CHECKLIST
${list}

Output only JSON: {"items":[{"id":"...","satisfied":false,"gap":"what is missing"}]}`;

  const inline = await fileToInline(fileUrl, mimeType);
  const genAI = new GoogleGenerativeAI(getRecognitionApiKeyPlaceholder());
  const models = await resolveModelsToTryOrder({
    promptTextLength: prompt.length,
    inlineBase64Length: inline?.base64.length ?? 0,
    mimeType: inline?.mimeType,
  });
  const valid = new Set(openItems.map((item) => item.id));
  let parsed: { items?: { id?: string; satisfied?: boolean; gap?: string }[] } | null = null;
  for (const modelName of models) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = inline
        ? await model.generateContent([prompt, { inlineData: { data: inline.base64, mimeType: inline.mimeType } }])
        : await model.generateContent(prompt);
      const text = result.response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;
      parsed = JSON.parse(jsonMatch[0]);
      break;
    } catch {
      continue;
    }
  }
  if (!parsed?.items) return [];
  return parsed.items
    .filter((row) => row.id && valid.has(row.id))
    .map((row) => ({
      id: String(row.id),
      satisfied: row.satisfied === true,
      gap: row.satisfied === true ? null : (row.gap || 'Still needed').trim(),
    }));
}
