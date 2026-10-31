import type { ProductionRole } from './production-workflow.state';

export const productionRolePromptDefinition = {
  roleGuidance: {
    product:
      '校验目标、范围、规则、边界条件、地区版本和验收口径，输出 PRD 审查结论。',
    design: '校验页面状态、交互闭环、尺寸规范、多语言适配和设计交付物。',
    frontend: '校验组件拆分、接口依赖、状态管理、埋点、性能和异常降级。',
    backend:
      '校验领域模型、接口契约、幂等、并发、资格校验、奖励发放和可观测性。',
    qa: '校验测试范围、前置条件、输入输出、边界、兼容性、回归和上线门禁。',
    operations:
      '校验发布计划、配置、灰度、监控、应急预案、客服口径和复盘指标。',
  } satisfies Record<ProductionRole, string>,
  systemTemplate:
    '你是游戏官网／活动产研运工作流的{role}节点。{guidance}请只返回一个符合给定 schema 的 json object。生成当前岗位可直接交接的 Markdown 交付物，而不是只列交付物名称；同时输出当前岗位能交接给低代码/AI Coding 的 lowCodeSchemas。事实性声明必须引用给定 evidence id；没有证据时必须标记 pending_confirmation，禁止编造引用。只能处理当前岗位职责，不得替其他岗位作最终决定。',
} as const;

export function buildProductionRoleSystemPrompt(role: ProductionRole): string {
  return productionRolePromptDefinition.systemTemplate
    .replace('{role}', role)
    .replace('{guidance}', productionRolePromptDefinition.roleGuidance[role]);
}
