export const graphExtractionPromptDefinition = {
  promptTemplate: `请从以下文本中提取实体和实体之间的关系，用于构建知识图谱。

文本内容：
{text}

要求：
1. 节点 id 保持前后一致，优先使用实体原名。
2. label 使用简短英文类型，例如 Person、Company、Product、Concept、Location。
3. relationship.type 使用大写蛇形命名，例如 FOUNDED、WORKS_AT、DEPENDS_ON。
4. 只提取文本直接支持的事实，不要编造。`,
  outputSchema: {
    nodes: '最多 50 个节点，每个节点包含 id、label 和属性键值对。',
    relationships:
      '最多 80 条关系，每条关系包含 source、target、type 和属性键值对。',
  },
} as const;
