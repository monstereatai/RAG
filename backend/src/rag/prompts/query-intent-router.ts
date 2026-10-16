import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmProvider } from '../../providers/llm/llm.provider';
import type { LlmInvokeOptions } from '../../providers/llm/llm-provider.interface';
import { formatQueryRoutingFewShots } from './few-shot.examples';

export const queryIntentSchema = z.object({
  intent: z.enum([
    'system_capability',
    'objective_fact',
    'follow_up',
    'project_knowledge',
    'realtime',
    'task_execution',
    'general',
  ]),
  /** 当前问题与会话设定/客观事实的语义关系。 */
  contextMode: z
    .enum([
      'conversation_setting',
      'context_follow_up',
      'factual_verification',
      'mixed',
      'none',
    ])
    .default('none'),
  /** 兼容现有链路的历史使用边界标记。 */
  historyPolicy: z
    .enum(['context_only', 'hypothesis_only', 'factual_priority'])
    .default('context_only'),
  confidence: z.number().min(0).max(1),
  standaloneQuery: z.string().trim().max(1000).optional(),
  multiIntent: z.boolean().default(false),
  subQueries: z.array(z.string().trim().min(1).max(1000)).max(5).default([]),
  action: z.enum(['direct_answer', 'retrieve']).default('retrieve'),
  /** 证据来源策略由语义路由决定，业务链路不得再依据关键词猜测。 */
  sourcePolicy: z
    .enum(['direct_answer', 'local_only', 'web_allowed'])
    .default('local_only'),
  /** 语义上是否要求综合多个证据生成整体性总结/综述/介绍。 */
  needsSynthesis: z.boolean().default(false),
  /** 是否需要实体关系或多跳证据，供检索层按需探测图谱。 */
  requiresGraph: z.boolean().default(false),
  targetKbs: z
    .array(z.enum(['company', 'documents', 'project', 'realtime', 'general']))
    .max(5)
    .default([]),
  queryType: z
    .enum([
      'public_knowledge',
      'private_entity',
      'project_knowledge',
      'follow_up',
      'realtime',
      'task_execution',
      'multi_intent',
      'ambiguous',
    ])
    .default('project_knowledge'),
  entities: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
  filters: z
    .object({
      department: z.string().trim().max(100).nullable().default(null),
      project: z.string().trim().max(100).nullable().default(null),
      timeRange: z.string().trim().max(100).nullable().default(null),
      documentType: z.string().trim().max(100).nullable().default(null),
    })
    .default({
      department: null,
      project: null,
      timeRange: null,
      documentType: null,
    }),
  rewriteQueries: z
    .array(z.string().trim().min(1).max(1000))
    .max(5)
    .default([]),
  reason: z.string().trim().max(300).default(''),
  ambiguity: z
    .object({
      detected: z.boolean().default(false),
      confidence: z.number().min(0).max(1).default(1),
      senses: z.array(z.string().trim().min(1)).max(5).default([]),
      clarificationQuestion: z.string().trim().max(300).optional(),
    })
    .default({ detected: false, confidence: 1, senses: [] }),
});

export type QueryIntent = z.infer<typeof queryIntentSchema>;

export const QUERY_INTENT_CONFIDENCE_THRESHOLD = 0.75;

/** 只为检索补全追问，原始用户问题始终保留。 */
export function resolveStandaloneRetrievalQuery(
  query: string,
  intent?: QueryIntent,
): string {
  const original = query.trim();
  if (
    !intent ||
    intent.confidence < QUERY_INTENT_CONFIDENCE_THRESHOLD ||
    !(
      intent.intent === 'follow_up' ||
      intent.contextMode === 'context_follow_up' ||
      intent.contextMode === 'mixed'
    )
  ) {
    return original;
  }
  return intent.standaloneQuery?.trim() || original;
}

export function isObjectiveKnowledgeIntent(intent?: QueryIntent): boolean {
  return Boolean(
    intent &&
    (intent.intent === 'objective_fact' ||
      intent.intent === 'system_capability' ||
      intent.queryType === 'public_knowledge'),
  );
}

export function shouldClarifyQueryIntent(intent?: QueryIntent): boolean {
  return Boolean(
    intent?.ambiguity.detected &&
    intent.ambiguity.confidence < QUERY_INTENT_CONFIDENCE_THRESHOLD,
  );
}

/** 兼容旧调用方的遗留 API。生产路由只接受结构化语义决策。 */
export function requiresKnowledgeRetrieval(query: string): boolean {
  void query;
  return false;
}

const ROUTER_PROMPT = `你是问答系统的意图路由器。你可以读取极少量的当前会话上下文，但上下文只用于识别用户设定和指代，不是事实证据。
路由边界示例：
${formatQueryRoutingFewShots()}
返回 JSON：{"intent":"...","contextMode":"conversation_setting|context_follow_up|factual_verification|mixed|none","historyPolicy":"context_only|hypothesis_only|factual_priority","confidence":0到1之间的小数,"action":"direct_answer|retrieve","sourcePolicy":"direct_answer|local_only|web_allowed","needsSynthesis":true或false,"requiresGraph":true或false,"targetKbs":[],"queryType":"...","entities":[],"filters":{"department":null,"project":null,"timeRange":null,"documentType":null},"rewriteQueries":[],"standaloneQuery":"可独立检索的问题","multiIntent":false,"subQueries":[],"ambiguity":{"detected":true或false,"confidence":0到1之间的小数,"senses":[],"clarificationQuestion":"必要时的澄清问题"},"reason":"中文理由"}。
needsSynthesis=true 表示用户要求对实体、人物、项目、文档或事件做整体性总结、综述、介绍、梳理，需要综合多个片段生成自然语言回答；false 表示单点事实查询、精确 lookup、可直接从单个片段提取。该判断必须基于语义理解，不能仅凭“总结/概括/介绍”等词出现与否，也不能因为没有这些词就忽略其整体性语义。
requiresGraph=true 仅用于问题确实要求实体关系、依赖、上下游、影响路径或多跳关联，且图谱证据有助于回答；普通总结、比较或多个并列问题都应为 false。
同时返回 ambiguity：是否存在多义词、候选语义和必要时的澄清问题。涉及未知身份、组织内部对象、用户已提供资料或上下文指代的事实都属于待查实体；即使问题很短也应先检索，不能当作稳定公共事实直答。只有多个语义同等合理、无法判断主流指代时才 detected=true。
若一条输入包含两个或以上可独立回答的问题、编号事项或测试项，multiIntent=true，并按原意拆出最多五个 subQueries；此时 intent 选择整体最需要的处理方式。单个问题要求多个解释角度时不是 multiIntent。
意图定义：
- system_capability：询问你是什么模型、当前使用的模型、模型系列、支持哪些输入或能力、上下文限制
- objective_fact：数学、技术定义、科学或通识事实
- follow_up：依赖上一轮指代、上下文或继续当前任务
- project_knowledge：询问项目、公司、业务资料或已上传文档
- realtime：询问最新、当前变化、价格、天气、新闻或其他时效性信息
- task_execution：要求写代码、生成文档、执行方案或调用工具
- general：无法归入以上类别的普通问题
contextMode 定义：
- conversation_setting：用户正在本会话中显式设定临时规则、定义或事实（例如“在这个故事里小明是一条鱼”）；只对当前 session 生效，不能写入公共知识库或长期记忆。
- context_follow_up：当前问题是在追问、确认或引用会话里刚刚设定的内容；回答时按当前会话最新有效设定处理。
- factual_verification：用户要求真实、官方、通用事实，或明确要求纠正会话中的说法；必须优先使用通用知识或检索证据。
- mixed：同时要求会话设定和客观事实的对照；回答时明确区分两个范围。
- none：无法判断存在上述关系。
historyPolicy 定义：hypothesis_only 用于用户明确要求假设推演的历史；factual_priority 用于客观事实核验；其它情况使用 context_only。
ambiguity.confidence 表示你对“当前问题存在多种合理解释”的把握；低于 0.75 时提供澄清问题。
如果最近上下文中有同一实体的单条临时设定，短而含糊的追问默认判断为 context_follow_up；如果同一实体存在互相冲突的多条临时设定，且当前问题是开放式“是什么／哪一个”这类实体定义问题，判断为 mixed，以便先给客观答案、再列出历史设定；只有用户明确要求真实／官方定义时才判断为 factual_verification。不要用固定关键词列表代替语义判断。
判定边界：sourcePolicy=direct_answer 只用于高置信度、无需外部证据的稳定通用事实；sourcePolicy=local_only 用于公司、项目、用户提供的资料、上传文档及任何需要本地事实依据的问题；sourcePolicy=web_allowed 只用于用户明确要求外部实时信息的问题。无法确定来源时必须选择 local_only，禁止把不确定问题交给公网搜索。sourcePolicy 是唯一的证据来源决策，不得依赖固定关键词推断。
当 action=retrieve 时，rewriteQueries 必须给出 1～3 条保留原实体和约束的独立检索表达，用于不同资料写法的召回；不得臆造事实或特定答案。若问题依赖“上次／刚才／这个”等指代，standaloneQuery 用当前问题和可见的实体改写；没有指代时原样保留。只输出 JSON，不解释分类过程。`;

@Injectable()
export class QueryIntentRouter {
  private readonly logger = new Logger(QueryIntentRouter.name);

  constructor(private readonly llmProvider: LlmProvider) {}

  /** 分类结果经 JSON 解析、Schema 校验和策略归一后才交给下游；异常统一走保守检索兜底。 */
  async classify(
    query: string,
    recentContext: Array<{ role: 'human' | 'ai'; content: string }> = [],
    options?: LlmInvokeOptions,
  ): Promise<QueryIntent> {
    try {
      // 避免 withStructuredOutput 触发 provider 的工具调用／重试，直接要求最小 JSON 响应并本地校验。
      const contextText = recentContext
        .slice(-8)
        .map(
          (item) =>
            `${item.role === 'human' ? '用户' : '助手'}：${item.content}`,
        )
        .join('\n');
      // 意图提示词包含分类定义、判定边界、JSON 格式和 few-shot 示例。
      const content = await this.withTimeout(
        this.llmProvider.invoke(
          `${ROUTER_PROMPT}\n\n当前会话上下文（仅用于识别临时设定和指代，不可当作外部事实）：${contextText || '无'}\n当前用户问题：${query.trim()}\n只输出一个合法 JSON 对象。`,
          options,
        ),
        20_000,
      );
      const parsed = queryIntentSchema.parse(this.parseJson(content));
      return this.normalizeDecision(query, parsed);
    } catch (error) {
      this.logger.warn(`Semantic routing failed: ${(error as Error).message}`);
      return this.safeFallback(query);
    }
  }

  private parseJson(content: string): unknown {
    const candidate = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end < start)
      throw new Error('semantic router returned non-JSON');
    return JSON.parse(candidate.slice(start, end + 1));
  }

  private safeFallback(query: string): QueryIntent {
    const text = query.trim();
    return this.normalizeDecision(query, {
      intent: 'general',
      contextMode: 'none',
      confidence: 0,
      standaloneQuery: text,
      multiIntent: false,
      subQueries: [],
      ambiguity: { detected: false, confidence: 0, senses: [] },
    });
  }

  private normalizeDecision(query: string, input: unknown): QueryIntent {
    const intent = queryIntentSchema.parse(input);
    const raw = input as Partial<QueryIntent>;
    const contextualMode =
      intent.contextMode !== 'none' &&
      intent.contextMode !== 'factual_verification';
    const requestedSourcePolicy =
      raw.sourcePolicy ??
      (contextualMode
        ? 'local_only'
        : intent.action === 'direct_answer'
          ? 'direct_answer'
          : intent.intent === 'realtime'
            ? 'web_allowed'
            : 'local_only');
    const localClassification =
      contextualMode ||
      intent.multiIntent ||
      intent.ambiguity.detected ||
      ['project_knowledge', 'task_execution', 'follow_up'].includes(
        intent.intent,
      ) ||
      [
        'private_entity',
        'project_knowledge',
        'follow_up',
        'task_execution',
        'ambiguous',
        'multi_intent',
      ].includes(intent.queryType) ||
      intent.targetKbs.some((target) =>
        ['company', 'documents', 'project'].includes(target),
      );
    // Local facts and low-confidence decisions must use local evidence.
    const resolvedSourcePolicy =
      localClassification ||
      (intent.confidence < QUERY_INTENT_CONFIDENCE_THRESHOLD &&
        requestedSourcePolicy === 'direct_answer')
        ? 'local_only'
        : requestedSourcePolicy;
    const mustRetrieve =
      resolvedSourcePolicy === 'local_only' || intent.action === 'retrieve';
    const entities = [...new Set(intent.entities)].slice(0, 10);
    const queryType = intent.multiIntent
      ? 'multi_intent'
      : intent.ambiguity.detected
        ? 'ambiguous'
        : intent.contextMode === 'context_follow_up'
          ? 'follow_up'
          : intent.queryType;
    const localTargets = intent.targetKbs.filter((target) =>
      ['company', 'documents', 'project'].includes(target),
    );
    const fallbackTargets =
      resolvedSourcePolicy === 'local_only'
        ? [
            'documents',
            ...(entities.length > 0 ? ['company'] : []),
            ...(intent.intent === 'project_knowledge' ? ['project'] : []),
          ]
        : resolvedSourcePolicy === 'web_allowed'
          ? ['realtime']
          : ['general'];
    const targetKbs = (
      resolvedSourcePolicy === 'local_only'
        ? localTargets.length > 0
          ? localTargets
          : fallbackTargets
        : intent.targetKbs.length > 0
          ? intent.targetKbs
          : fallbackTargets
    ) as QueryIntent['targetKbs'];
    const rewriteQueries = mustRetrieve
      ? [...new Set([query.trim(), ...intent.rewriteQueries])].slice(0, 5)
      : intent.rewriteQueries;

    return {
      ...intent,
      action:
        mustRetrieve || intent.multiIntent || intent.action === 'retrieve'
          ? 'retrieve'
          : 'direct_answer',
      sourcePolicy: resolvedSourcePolicy,
      queryType,
      targetKbs,
      entities,
      standaloneQuery: intent.standaloneQuery?.trim() || query.trim(),
      rewriteQueries,
      reason:
        intent.reason ||
        (mustRetrieve ? '需要本地检索证据' : '按意图分类结果处理'),
    };
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('query intent timeout')), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
