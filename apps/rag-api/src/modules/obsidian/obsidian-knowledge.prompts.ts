import type { ProjectWorkflowType } from './obsidian-knowledge.types';

export const obsidianNoteDraftPromptDefinition = {
  system: '你是个人知识库整理助手。只返回 JSON，不要 Markdown，不要解释。',
  instructions: [
    '请完整阅读下面文章，生成个人知识库笔记元信息。',
    '要求：',
    '1. summary 写 2-3 句话，每句话独立成数组项。',
    '2. keyPoints 写 3-5 条要点。',
    '3. tags 写 3-5 个中文标签，不够就少写，别硬凑。',
    '4. topics 写 2-5 个主题，entities 写 2-8 个人/产品/公司/技术/模块实体。',
    '5. keyConclusions 写关键结论，objections 写反对意见，boundaries 写适用边界，risks 写落地风险，acceptanceCriteria 写验收口径。',
    '6. 只返回 JSON：{"summary":[],"keyPoints":[],"tags":[],"topics":[],"entities":[],"keyConclusions":[],"objections":[],"boundaries":[],"risks":[],"acceptanceCriteria":[]}',
  ],
  inputLabels: {
    title: '标题：',
    content: '正文：',
  },
  contentLimit: 20_000,
} as const;

export const obsidianProjectWorkflowPromptDefinition = {
  system:
    '你是软件项目决策编排助手。请基于输入和 Obsidian 证据输出 Markdown，不要输出代码围栏。',
  commonRequirements: [
    '结论先行。',
    '明确方案取舍，不要含糊。',
    '每个关键判断都要写依据或待确认项。',
    '输出要能直接放进 Obsidian 作为项目决策记录。',
  ],
  labels: {
    workflowType: '工作流类型：',
    commonRequirements: '固定要求：',
    title: '标题：',
    question: '问题：',
    context: '背景：',
    constraints: '约束：',
    options: '候选方案：',
    evidence: 'Obsidian 证据：',
    emptyEvidence: '无',
    bullet: '-',
  },
  workflowLabels: {
    solution: '方案选择',
    'tech-selection': '技术选型',
    adr: '架构决策 ADR',
    'task-breakdown': '任务拆解',
  } satisfies Record<ProjectWorkflowType, string>,
  workflowInstructions: {
    solution: [
      '请输出以下小节：',
      '## 推荐方案',
      '## 方案对比',
      '## 取舍理由',
      '## 适用边界',
      '## 风险与缓解',
      '## 待确认问题',
    ],
    'tech-selection': [
      '请输出以下小节：',
      '## 最终技术选型',
      '## 候选技术评分',
      '## 关键约束',
      '## 集成影响',
      '## 迁移/替换成本',
      '## 待验证点',
    ],
    adr: [
      '请按 ADR 格式输出以下小节：',
      '## Status',
      '## Context',
      '## Decision',
      '## Alternatives',
      '## Consequences',
      '## Rollback Conditions',
    ],
    'task-breakdown': [
      '请输出以下小节：',
      '## 模块拆解',
      '## 接口清单',
      '## 数据流',
      '## 里程碑',
      '## 风险清单',
      '## 验收标准',
    ],
  } satisfies Record<ProjectWorkflowType, readonly string[]>,
} as const;
