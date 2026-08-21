/** Static DeepSeek model catalog for `listModels` (OpenAI-compatible API has no public list endpoint). */
export function getDeepseekListModelsPayload(): Array<{
  name: string;
  supportedGenerationMethods?: string[];
}> {
  const ids = [
    'deepseek-chat',
    'deepseek-reasoner',
    'deepseek-v4-flash',
    'deepseek-v4-pro',
  ];
  return ids.map((name) => ({
    name,
    supportedGenerationMethods: ['generateContent'],
  }));
}
