import type { ChatMode } from './rag-api-client.js';

export type GameToolKind = 'plan' | 'checklist' | 'tracking' | 'region-check';

export interface GameToolInput {
  activity: string;
  region?: string;
  platform?: string;
  product?: string;
  constraints?: string;
  mode?: ChatMode;
}

export function buildGameMarketingPrompt(kind: GameToolKind, input: GameToolInput): string {
  const base = [
    '你是游戏活动/营销/官网业务线的 RAG 助手。',
    '优先使用知识库中的活动类型、营销玩法、官网落地页模块、前端工程规范、埋点规范、地区适配、风险检查和验收 checklist。',
    '不要编造不存在的内部组件、接口或历史规则；缺证据时明确标注“待确认”。',
    `活动/需求：${input.activity}`,
    `产品/游戏：${input.product ?? '未指定'}`,
    `地区：${input.region ?? '未指定'}`,
    `平台：${input.platform ?? '未指定，可能是小程序/H5/PC 官网/H5 官网'}`,
    `约束：${input.constraints ?? '无额外约束'}`,
  ];

  if (kind === 'plan') {
    return [
      ...base,
      '请输出一份可交给 Codex/DeepSeek 继续写前端代码的方案上下文，包含：',
      '1. 业务目标和用户路径',
      '2. 活动/营销玩法拆解',
      '3. 页面结构和组件候选',
      '4. 前后端接口清单',
      '5. 素材需求',
      '6. 埋点和转化指标',
      '7. 多地区/本地化注意点',
      '8. 风险项和验收标准',
      '9. 可直接给 AI Coding 工具的编码计划',
    ].join('\n');
  }

  if (kind === 'checklist') {
    return [
      ...base,
      '请输出上线前验收 checklist，按产品/UI/前端/测试/业务负责人视角组织。',
      '重点覆盖活动规则理解、页面状态、异常兜底、登录态、抽奖/充值/分享、素材适配、埋点、性能、合规和地区差异。',
    ].join('\n');
  }

  if (kind === 'tracking') {
    return [
      ...base,
      '请输出埋点设计草案，包含事件名建议、触发时机、核心属性、转化漏斗、业务指标、技术校验方式。',
      '事件命名要通用，避免绑定一次性活动规则。',
    ].join('\n');
  }

  return [
    ...base,
    '请输出多地区/本地化检查清单，覆盖语言、时区、币种、支付、法务合规、素材、渠道、登录、分享链路和客服反馈。',
    '地区差异不确定时标注待确认，不要替业务负责人做最终结论。',
  ].join('\n');
}
