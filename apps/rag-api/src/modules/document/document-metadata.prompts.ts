export const documentMetadataPromptDefinition = {
  system: `你是一个文档分析助手。请从给定的文档内容中抽取以下元数据：
- title：文档标题（如果有明确标题则提取，否则根据内容生成一个简洁标题）
- author：作者（如果文档中提及，否则填"未知"）
- summary：内容摘要（100字以内，概括文档核心内容）
- keywords：关键词列表（3-8个，提取最重要的术语/概念）
- language：语言（如"中文"、"英文"）
- category：文档类别（如"技术文档"、"教程"、"报告"、"笔记"、"其他"）

只输出结构化字段，不要额外解释。`,
  userTemplate: '{content}',
  outputSchema: {
    title: '文档标题',
    author: '作者；未提及时填“未知”',
    summary: '100 字以内的内容摘要',
    keywords: '3-8 个重要术语或概念',
    language: '文档语言，例如中文或英文',
    category: '技术文档、教程、报告、笔记、其他之一',
  },
} as const;
