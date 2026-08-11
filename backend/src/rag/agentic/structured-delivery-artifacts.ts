import type { RetrievedChunk } from '../karpathy/karpathy-rag.service';
import {
  createAgenticArtifact,
  type AgenticArtifact,
  type AgenticArtifactType,
} from './agentic-rag.state';

export interface StructuredDeliveryPayload {
  schemaVersion: 1;
  status: 'proposed' | 'ready_for_review' | 'needs_confirmation';
  query: string;
  evidenceIds: string[];
  sourceDocIds: string[];
  generatedFrom: 'retrieved_evidence' | 'workflow_template' | 'model_fallback';
  confirmationRequired: string[];
  sections: Record<string, unknown>;
}

const DELIVERY_TYPES: AgenticArtifactType[] = [
  'requirement_brief',
  'assumption_register',
  'claim_evidence_matrix',
  'solution_brief',
  'api_contract',
  'event_tracking_plan',
  'test_plan',
  'acceptance_checklist',
  'risk_register',
  'rollout_plan',
  'code_context_pack',
];

/**
 * 根据当前 Agentic 查询和真实召回证据生成“可评审初稿”交接物。
 * 这里故意不填充活动概率、预算、时间等未知业务事实，未知内容进入待确认清单。
 */
export function buildStructuredDeliveryArtifacts(
  query: string,
  chunks: RetrievedChunk[],
  answer: string,
  retrievalSufficient: boolean,
): AgenticArtifact[] {
  const evidenceIds = chunks.map((chunk) => chunk.id);
  const sourceDocIds = [...new Set(chunks.map((chunk) => chunk.docId))];
  const eventNames = extractEventNames(chunks);
  const source = chunks.length > 0 ? 'retrieved_evidence' : 'model_fallback';
  const common = {
    schemaVersion: 1 as const,
    query,
    evidenceIds,
    sourceDocIds,
    generatedFrom: source as 'retrieved_evidence' | 'model_fallback',
  };
  const pending = [
    '活动时间、预算、奖励数值和概率必须由产品／运营确认',
    '真实接口字段、权限和地区合规口径必须由对应负责人确认',
  ];
  const status = retrievalSufficient ? 'ready_for_review' : 'needs_confirmation';
  const make = (
    type: AgenticArtifactType,
    sections: Record<string, unknown>,
    confirmationRequired = pending,
  ) =>
    createAgenticArtifact<StructuredDeliveryPayload>(type, 'deliveryPlanner', {
      ...common,
      status,
      confirmationRequired,
      sections,
    });

  return [
    make('requirement_brief', {
      objective: query,
      targetUsers: ['产品', '设计', '前端', '后端', '测试', '运营'],
      expectedDeliverables: ['页面结构', '接口清单', '埋点方案', '风险项', '验收清单'],
      successCriteria: ['需求可评审', '方案可编码', '结果可验收'],
      openQuestions: pending,
    }),
    make('assumption_register', {
      assumptions: [
        { name: '活动类型', value: '根据召回模板识别，待产品确认', status: 'pending_confirmation' },
        { name: '目标地区与语言', value: '根据查询和文档 metadata 识别，待运营确认', status: 'pending_confirmation' },
        { name: '登录、支付、奖励接口', value: '只输出接口模式，不推断真实字段', status: 'pending_confirmation' },
      ],
    }),
    make('claim_evidence_matrix', {
      claims: chunks.slice(0, 8).map((chunk, index) => ({
        claimId: `claim-${index + 1}`,
        statement: chunk.content.slice(0, 180),
        evidenceIds: [chunk.id],
        sourceDocId: chunk.docId,
        supported: true,
        reviewStatus: 'retrieved_support',
      })),
      unsupportedClaims: retrievalSufficient ? [] : ['当前证据不足，不能将未召回的业务规则当作确定事实'],
    }),
    make('solution_brief', {
      problem: query,
      recommendedFlow: ['需求理解', '混合检索', '关系补全', '方案拆解', '引用校验', '人工评审'],
      pageModules: ['Hero／活动主视觉', '规则与奖励', '任务或互动入口', '结果／领取状态', 'FAQ／客服入口'],
      regionAdaptation: ['语言与文案长度', '时区与地区配置', '登录／支付渠道', '隐私与 Cookie 提示'],
      evidenceSummary: answer.slice(0, 800),
    }),
    make('api_contract', {
      endpoints: [
        { name: 'activity_config', purpose: '读取活动配置、状态和版本', idempotent: true, status: 'proposed' },
        { name: 'eligibility_check', purpose: '校验用户资格和地区范围', idempotent: true, status: 'proposed' },
        { name: 'reward_claim', purpose: '领取奖励并防止重复提交', idempotent: true, status: 'proposed' },
        { name: 'reward_status', purpose: '查询奖励发放和异常状态', idempotent: true, status: 'proposed' },
      ],
      errorHandling: ['未开始', '已结束', '资格不符', '重复提交', '库存不足', '发放延迟'],
      confirmationRequired: ['真实接口路径、字段、鉴权和错误码'],
    }),
    make('event_tracking_plan', {
      events: eventNames.length > 0 ? eventNames : ['page_view', 'primary_cta_click', 'reward_claim_click', 'reward_claim_success', 'faq_click'],
      fields: ['activity_id', 'activity_version', 'region', 'channel', 'user_state', 'result_code'],
      funnel: ['page_view', 'module_exposure', 'primary_cta_click', 'claim_success'],
      validation: ['事件触发一次', '字段完整', '失败结果可追踪', '重复上报可去重'],
    }),
    make('test_plan', {
      dimensions: ['功能', '权限', '地区', '兼容性', '性能', '安全', '异常恢复'],
      cases: ['未开始／进行中／已结束', '未登录／登录过期', '资格不符', '重复领取', '接口超时', '弱网和资源加载失败', '多语言文案溢出'],
      evidenceBasedChecks: evidenceIds.slice(0, 5),
    }),
    make('acceptance_checklist', {
      checklist: [
        { item: '页面模块和主流程覆盖需求', status: 'pending' },
        { item: '接口状态和错误码有对应 UI', status: 'pending' },
        { item: '埋点事件、字段和漏斗验收通过', status: 'pending' },
        { item: '地区、语言、时区和渠道适配通过', status: 'pending' },
        { item: '引用、权限、版本和回滚边界确认', status: 'pending' },
      ],
    }),
    make('risk_register', {
      risks: [
        { risk: '规则、概率、预算或活动时间被模型误填', level: 'high', mitigation: '标记待确认并要求业务审批' },
        { risk: '奖励重复领取或接口重试造成副作用', level: 'high', mitigation: '幂等键、状态机和服务端校验' },
        { risk: '地区／语言／时区适配遗漏', level: 'medium', mitigation: '地区矩阵和专项验收清单' },
        { risk: '素材、视频或第三方 SDK 加载失败', level: 'medium', mitigation: '懒加载、降级素材和错误监控' },
      ],
    }),
    make('rollout_plan', {
      stages: ['本地验证', '测试环境', '小流量灰度', '全量发布'],
      gates: ['关键接口成功率', '奖励领取成功率', '埋点完整率', '错误率和 P95', '用户反馈'],
      rollback: ['关闭活动开关', '回滚前端版本', '暂停奖励接口', '保留审计和事故时间线'],
    }),
    make('code_context_pack', {
      purpose: '为 Codex／Claude Code／Trae 提供编码前的受控上下文',
      context: ['需求摘要', '已确认证据', '页面模块', 'API Contract', '埋点方案', '风险和验收清单'],
      constraints: ['不得编造未确认规则', '只修改允许的目录和文件', '先读取项目规范再编码', '完成后运行指定验证命令'],
      mcpHints: ['rag_context', 'rag_game_plan', 'rag_graph_search'],
    }),
  ];
}

export function isStructuredDeliveryType(type: AgenticArtifactType): boolean {
  return DELIVERY_TYPES.includes(type);
}

function extractEventNames(chunks: RetrievedChunk[]): string[] {
  const result = new Set<string>();
  for (const chunk of chunks) {
    for (const match of chunk.content.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}\b/g)) {
      const value = match[0];
      if (/(click|view|success|fail|exposure|submit|play|claim|bind|redirect)/.test(value)) {
        result.add(value);
      }
    }
  }
  return [...result].slice(0, 20);
}
