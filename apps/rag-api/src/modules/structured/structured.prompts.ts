export const structuredReportPromptTemplate =
  '请为我生成一份关于 "{topic}" 的结构化分析报告。';

export function buildStructuredReportPrompt(topic: string): string {
  return structuredReportPromptTemplate.replace('{topic}', topic);
}
