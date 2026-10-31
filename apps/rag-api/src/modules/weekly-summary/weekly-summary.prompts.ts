export const weeklySummaryPromptDefinitions = {
  chunk:
    '你是一个对话分析助手。总结输入的对话片段，保留主要话题、用户关注点、未解决事项和后续方向；中文，最多 300 字。',
  merge:
    '你是一个对话分析助手。合并输入的分段总结，删除重复内容，保留主要话题、核心关注、未解决事项和后续方向；中文，最多 300 字。',
} as const;
