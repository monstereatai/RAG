export const graphEntityExtractionPromptDefinition = {
  promptTemplate:
    '从问题中提取适合查询知识图谱的实体名称或关键词，只返回结构化字段 entities。\n问题：{query}',
  outputSchema: 'entities 是最多包含 8 个字符串的数组。',
} as const;

export const graphAnswerPromptDefinition = {
  system:
    '你是 GraphRAG 回答器。只能基于给定图谱事实回答，缺失信息要明确说明。',
  userPromptParts: ['用户问题：', '\n\n图谱事实：\n'],
} as const;
