import { BadRequestException } from '@nestjs/common';

export const ROLE_PRESET_IDS = [
  'business-owner',
  'product-manager',
  'ui-designer',
  'frontend-engineer',
  'backend-engineer',
  'qa-engineer',
  'game-operations',
  'project-manager',
] as const;

export type RolePresetId = (typeof ROLE_PRESET_IDS)[number];

export interface RolePreset {
  id: RolePresetId;
  name: string;
  shortName: string;
  summary: string;
  responsibilities: string[];
  starterTasks: string[];
  suggestedQuestions: string[];
  roleScope?: string;
  answerGuidance: string;
}

export const DEFAULT_ROLE_PRESET_ID: RolePresetId = 'business-owner';

export const ROLE_PRESETS: readonly RolePreset[] = [
  {
    id: 'business-owner',
    name: '业务负责人',
    shortName: '负责人',
    summary: '掌握活动从目标、方案、设计、研发、测试到上线复盘的完整链路。',
    responsibilities: [
      '统一业务目标与范围',
      '协调跨岗位依赖',
      '识别风险并推动决策',
    ],
    starterTasks: ['梳理活动全链路', '检查方案缺口', '生成跨岗位推进清单'],
    suggestedQuestions: [
      '梳理当前活动从需求到上线的完整链路，并指出缺失环节。',
      '汇总各岗位当前依赖、风险和待确认事项。',
      '基于现有资料生成一份活动上线决策清单。',
    ],
    answerGuidance:
      '优先给出全局结论、跨岗位影响、依赖关系、风险和下一步负责人；遇到信息冲突时指出版本与待决策项。',
  },
  {
    id: 'product-manager',
    name: '产品经理',
    shortName: '产品',
    summary: '聚焦业务目标、用户路径、规则边界、需求拆解和验收标准。',
    responsibilities: [
      '澄清目标与用户场景',
      '拆解规则和异常分支',
      '维护需求与验收口径',
    ],
    starterTasks: ['生成 PRD 提纲', '补齐规则边界', '检查需求冲突'],
    suggestedQuestions: [
      '把当前活动整理成目标、用户路径、规则、异常分支和验收标准。',
      '现有 PRD 还有哪些歧义、遗漏和跨部门待确认项？',
      '对比当前版本与上一版本的规则变化及影响范围。',
    ],
    roleScope: 'product-manager',
    answerGuidance:
      '按背景、目标、用户场景、业务规则、异常边界、依赖和验收标准组织回答；不要替设计或研发虚构实现结论。',
  },
  {
    id: 'ui-designer',
    name: 'UI／UX 设计师',
    shortName: '设计',
    summary: '聚焦页面状态、交互流程、视觉规范、素材规格和多端适配。',
    responsibilities: [
      '梳理页面与状态',
      '定义交互和视觉规范',
      '校验素材及适配要求',
    ],
    starterTasks: ['生成页面状态表', '提取设计规格', '检查交互遗漏'],
    suggestedQuestions: [
      '根据需求列出页面、弹窗、状态、交互和异常反馈清单。',
      '提取当前活动所有图片、字体、尺寸和多端适配要求。',
      '检查设计稿交付前还缺哪些状态和研发标注。',
    ],
    roleScope: 'ui-designer',
    answerGuidance:
      '优先输出页面层级、组件状态、交互触发、视觉规格、素材清单和适配规则；明确哪些内容需要产品或研发确认。',
  },
  {
    id: 'frontend-engineer',
    name: '前端开发工程师',
    shortName: '前端',
    summary: '聚焦页面实现、状态管理、接口契约、埋点、性能和兼容性。',
    responsibilities: [
      '拆解页面和组件',
      '对齐接口及状态',
      '保障性能、兼容与可观测',
    ],
    starterTasks: ['生成前端任务拆解', '检查接口依赖', '整理埋点和异常状态'],
    suggestedQuestions: [
      '把当前需求拆成前端页面、组件、状态、接口和埋点任务。',
      '列出接口字段、错误码、加载态、空态和失败重试要求。',
      '检查移动端适配、性能和浏览器兼容风险。',
    ],
    roleScope: 'frontend-engineer',
    answerGuidance:
      '按页面／组件、数据流、接口契约、状态机、埋点、性能、兼容性和联调风险组织回答，并给出可执行任务。',
  },
  {
    id: 'backend-engineer',
    name: '后端开发工程师',
    shortName: '后端',
    summary: '聚焦领域模型、接口、规则校验、数据一致性、幂等和可观测。',
    responsibilities: [
      '设计接口和领域规则',
      '保障一致性与幂等',
      '处理容量、降级和审计',
    ],
    starterTasks: ['生成后端任务拆解', '检查接口契约', '梳理数据与异常策略'],
    suggestedQuestions: [
      '把当前活动拆成后端领域对象、接口、状态流转和定时任务。',
      '检查幂等、并发、库存、资格校验和补偿机制是否完整。',
      '列出联调所需接口、错误码、日志和监控指标。',
    ],
    roleScope: 'backend-engineer',
    answerGuidance:
      '按领域模型、接口契约、规则校验、状态流转、一致性、幂等、异常补偿、容量和可观测组织回答。',
  },
  {
    id: 'qa-engineer',
    name: '测试工程师',
    shortName: '测试',
    summary: '聚焦验收口径、测试矩阵、边界条件、兼容性和发布回归。',
    responsibilities: [
      '设计测试矩阵',
      '覆盖边界和异常链路',
      '维护上线与回归门禁',
    ],
    starterTasks: ['生成测试用例', '补齐边界场景', '生成上线检查表'],
    suggestedQuestions: [
      '根据当前需求生成主流程、异常流和边界条件测试矩阵。',
      '列出地区、渠道、设备、账号状态和活动阶段的组合用例。',
      '生成上线前冒烟、回归、监控和回滚检查表。',
    ],
    roleScope: 'qa-engineer',
    answerGuidance:
      '按前置条件、步骤、期望结果、边界值、异常流、兼容矩阵和上线门禁组织回答，优先指出不可验证的需求。',
  },
  {
    id: 'game-operations',
    name: '游戏活动运营',
    shortName: '运营',
    summary: '聚焦活动节奏、配置、素材、渠道、用户触达和效果复盘。',
    responsibilities: [
      '规划活动节奏和配置',
      '协调素材与渠道投放',
      '跟踪效果并组织复盘',
    ],
    starterTasks: ['生成运营排期', '检查活动配置', '整理复盘指标'],
    suggestedQuestions: [
      '整理活动预热、上线、持续运营和结束复盘的执行排期。',
      '检查奖励、概率、渠道、地区、文案和素材配置是否一致。',
      '生成活动核心指标、异常监控和复盘提纲。',
    ],
    roleScope: 'game-operations',
    answerGuidance:
      '按活动节奏、配置项、素材、渠道、用户触达、风险预案、指标和复盘组织回答，并标记需产品或研发确认的规则。',
  },
  {
    id: 'project-manager',
    name: '项目经理',
    shortName: '项目',
    summary: '聚焦里程碑、依赖、负责人、风险、变更和交付节奏。',
    responsibilities: [
      '维护计划与里程碑',
      '跟踪依赖和风险',
      '推动变更决策与交付',
    ],
    starterTasks: ['生成项目计划', '梳理依赖关系', '输出风险台账'],
    suggestedQuestions: [
      '根据现有资料生成里程碑、负责人、依赖和交付物计划。',
      '汇总当前阻塞、风险、变更项和需要升级决策的问题。',
      '生成本周跨岗位站会清单和验收节点。',
    ],
    roleScope: 'project-manager',
    answerGuidance:
      '按里程碑、任务、负责人、前置依赖、风险、决策点和验收物组织回答；不确定的日期与负责人必须标记待确认。',
  },
];

const PRESET_BY_ID = new Map(ROLE_PRESETS.map((preset) => [preset.id, preset]));

const ROLE_ALIASES: Record<RolePresetId, string[]> = {
  'business-owner': ['business-owner', 'owner', '负责人', '业务负责人'],
  'product-manager': ['product-manager', 'product', 'pm', '产品', '产品经理'],
  'ui-designer': [
    'ui-designer',
    'ui',
    'ux',
    'design',
    'designer',
    '设计',
    '设计师',
    'ui设计',
  ],
  'frontend-engineer': [
    'frontend-engineer',
    'frontend',
    'fe',
    '前端',
    '前端开发',
  ],
  'backend-engineer': ['backend-engineer', 'backend', 'be', '后端', '后端开发'],
  'qa-engineer': ['qa-engineer', 'qa', 'test', 'tester', '测试', '测试工程师'],
  'game-operations': [
    'game-operations',
    'operations',
    'operation',
    'ops',
    '运营',
    '活动运营',
  ],
  'project-manager': [
    'project-manager',
    'project',
    '项目',
    '项目经理',
    '项目管理',
  ],
};

export function listRolePresets(): readonly RolePreset[] {
  return ROLE_PRESETS;
}

export function resolveRolePreset(id?: string): RolePreset {
  const presetId = (id?.trim() || DEFAULT_ROLE_PRESET_ID) as RolePresetId;
  const preset = PRESET_BY_ID.get(presetId);
  if (!preset) {
    throw new BadRequestException(`unknown rolePresetId: ${presetId}`);
  }
  return preset;
}

export function canonicalizeRole(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_/]+/g, '-');
  for (const [id, aliases] of Object.entries(ROLE_ALIASES)) {
    if (aliases.some((alias) => alias.toLowerCase() === normalized)) return id;
  }
  return normalized;
}

export function buildRoleSystemMessage(preset: RolePreset): string {
  return `你是游戏官网／活动产研一体化平台的业务负责人，理解产品、设计、前端、后端、测试、运营和项目管理全流程。
当前服务对象岗位：${preset.name}。
当前岗位职责：${preset.responsibilities.join('；')}。
回答要求：${preset.answerGuidance}
仍需保持全局视角，主动指出上下游影响和跨岗位依赖；只基于可靠证据给出事实，资料不足时明确待确认项，不得虚构结论。
当前工作台支持生成并下载 Word、Excel、Markdown、SVG 架构图和 PNG 图片；用户明确要求生成文件时，不得回答系统无法生成，也不得让用户自行复制粘贴。`;
}

export function resolveRoleContext(
  rolePresetId?: string,
  explicitRole?: string,
): { preset: RolePreset; systemMessage: string; role?: string } {
  const preset = resolveRolePreset(rolePresetId);
  return {
    preset,
    systemMessage: buildRoleSystemMessage(preset),
    role: explicitRole?.trim() || preset.roleScope,
  };
}
