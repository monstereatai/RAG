import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmProvider } from '../../providers/llm/llm.provider';
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

/** 兼容旧调用方的遗留 API。生产路由不再使用关键词作决策。 */
export function requiresKnowledgeRetrieval(query: string): boolean {
  const text = query.trim();
  if (!text) return true;
  if (
    /(?:公司|项目|部门|团队|内部|知识库|文档|制度|员工|同事|客户|用户|业务|活动|接口|系统|当前|我们|上传|资料|数据库|配置|线上|版本|数据)/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /(?:是谁|什么人|哪个人|叫什么|做了什么|属于哪个|在哪个部门)/i.test(text)
  ) {
    return true;
  }
  return /(?:上次|刚才|前面|这个|那个|上述|继续|再说)/i.test(text);
}

const ROUTER_PROMPT = `你是问答系统的意图路由器，只分析当前用户问题，不读取历史对话、知识库或记忆。
路由边界示例：
${formatQueryRoutingFewShots()}
只要包含公司／项目／员工／活动／文档中的实体，即使句子很短，也必须 retrieve；错别字和同音字不能当作公共问题直答。
返回 JSON：{"intent":"...","confidence":0到1之间的小数,"action":"direct_answer|retrieve","sourcePolicy":"direct_answer|local_only|web_allowed","needsSynthesis":true或false,"targetKbs":[],"queryType":"...","entities":[],"filters":{"department":null,"project":null,"timeRange":null,"documentType":null},"rewriteQueries":[],"standaloneQuery":"可独立检索的问题","multiIntent":false,"subQueries":[],"reason":"中文理由"}。
needsSynthesis=true 表示用户要求对实体、人物、项目、文档或事件做整体性总结、综述、介绍、梳理，需要综合多个片段生成自然语言回答；false 表示单点事实查询、精确 lookup、可直接从单个片段提取。该判断必须基于语义理解，不能仅凭“总结/概括/介绍”等词出现与否，也不能因为没有这些词就忽略其整体性语义。
同时返回 ambiguity：是否存在多义词、候选语义和必要时的澄清问题。人名、员工、客户、部门、产品、活动、项目和内部术语属于待查实体；即使问题很短（如“李四是谁”），也必须判为 project_knowledge 或 general 并先检索，不得判为 objective_fact 直答。只有多个语义同等合理、无法判断主流指代时才 detected=true。
若一条输入包含两个或以上可独立回答的问题、编号事项或测试项，multiIntent=true，并按原意拆出最多五个 subQueries；此时 intent 选择整体最需要的处理方式。单个问题要求多个解释角度时不是 multiIntent。
意图定义：
- system_capability：询问你是什么模型、当前使用的模型、模型系列、支持哪些输入或能力、上下文限制
- objective_fact：数学、技术定义、科学或通识事实
- follow_up：依赖上一轮指代、上下文或继续当前任务
- project_knowledge：询问项目、公司、业务资料或已上传文档
- realtime：询问最新、当前变化、价格、天气、新闻或其他时效性信息
- task_execution：要求写代码、生成文档、执行方案或调用工具
- general：无法归入以上类别的普通问题
判定边界：sourcePolicy=direct_answer 只用于高置信度、无需外部证据的稳定通用事实；sourcePolicy=local_only 用于公司、项目、用户提供的资料、上传文档及任何需要本地事实依据的问题；sourcePolicy=web_allowed 只用于用户明确要求外部实时信息的问题。无法确定来源时必须选择 local_only，禁止把不确定问题交给公网搜索。sourcePolicy 是唯一的证据来源决策，不得依赖固定关键词推断。
当 action=retrieve 时，rewriteQueries 必须给出 1～3 条保留原实体和约束的独立检索表达，用于不同资料写法的召回；不得臆造事实或特定答案。若问题依赖“上次／刚才／这个”等指代，standaloneQuery 用当前问题和可见的实体改写；没有指代时原样保留。只输出 JSON，不解释分类过程。`;

@Injectable()
export class QueryIntentRouter {
  private readonly logger = new Logger(QueryIntentRouter.name);

  constructor(private readonly llmProvider: LlmProvider) {}

  async classify(query: string): Promise<QueryIntent> {
    try {
      // 避免 withStructuredOutput 触发 provider 的工具调用／重试，直接要求最小 JSON 响应并本地校验。
      const content = await this.withTimeout(
        this.llmProvider.invoke(
          `${ROUTER_PROMPT}\n\n当前用户问题：${query.trim()}\n只输出一个合法 JSON 对象。`,
        ),
        20_000,
      );
      const intent = this.normalizeDecision(
        query,
        queryIntentSchema.parse(this.parseJson(content)),
      );
      const explicitSubQueries = this.extractExplicitSubQueries(query);
      if (intent.multiIntent || explicitSubQueries.length > 1) {
        return this.normalizeDecision(query, {
          ...intent,
          multiIntent: true,
          subQueries:
            intent.subQueries.length > 1
              ? intent.subQueries
              : explicitSubQueries,
        });
      }
      return intent;
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

  /**
   * 只识别明确的问号分隔问题列表，不猜测词义或按关键词路由。
   * 当模型遗漏 multiIntent 字段时，保留每个完整问句用于后续 Agentic 规划。
   */
  private extractExplicitSubQueries(query: string): string[] {
    const subQueries = query.match(/[^？?]+[？?]/gu) ?? [];
    return subQueries
      .map((item) => item.trim())
      .filter((item) => item.length > 1)
      .slice(0, 5);
  }

  private safeFallback(query: string): QueryIntent {
    const text = query.trim();
    return this.normalizeDecision(query, {
      intent: 'general',
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
    const sourcePolicy =
      raw.sourcePolicy ??
      (intent.action === 'direct_answer'
        ? 'direct_answer'
        : intent.intent === 'realtime'
          ? 'web_allowed'
          : 'local_only');
    // 低置信度时只允许本地证据，避免模型不确定时意外放行公网搜索。
    const resolvedSourcePolicy =
      intent.confidence < 0.75 && sourcePolicy === 'direct_answer'
        ? 'local_only'
        : sourcePolicy;
    const mustRetrieve =
      resolvedSourcePolicy === 'local_only' || intent.action === 'retrieve';
    const entities = [
      ...new Set([...intent.entities, ...this.extractEntityCandidates(query)]),
    ].slice(0, 10);
    const queryType = intent.multiIntent
      ? 'multi_intent'
      : intent.ambiguity.detected
        ? 'ambiguous'
        : mustRetrieve && intent.intent === 'follow_up'
          ? 'follow_up'
          : mustRetrieve
            ? 'private_entity'
            : intent.intent === 'realtime'
              ? 'realtime'
              : intent.intent === 'task_execution'
                ? 'task_execution'
                : 'public_knowledge';
    const targetKbs = (
      mustRetrieve
        ? [
            ...new Set([
              'documents',
              ...(entities.length > 0 ? ['company'] : []),
              ...(intent.intent === 'project_knowledge' ? ['project'] : []),
            ]),
          ]
        : resolvedSourcePolicy === 'web_allowed' || intent.intent === 'realtime'
          ? ['realtime']
          : ['general']
    ) as QueryIntent['targetKbs'];
    const rewriteQueries = mustRetrieve
      ? [
          ...new Set([
            query.trim(),
            ...intent.rewriteQueries,
            ...entities.map((entity) => `${entity} 相关资料`),
          ]),
        ].slice(0, 5)
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
      rewriteQueries,
      reason:
        intent.reason ||
        (mustRetrieve
          ? '命中私域实体、上下文或业务资料信号，必须先检索'
          : '稳定公共知识，可直接回答'),
    };
  }

  private extractEntityCandidates(query: string): string[] {
    const candidates: string[] = [];
    const suffix =
      /(?:是谁|叫什么|花名|绰号|外号|负责什么|在哪个部门|的资料|的介绍)/g;
    let match: RegExpExecArray | null;
    while ((match = suffix.exec(query)) !== null) {
      const prefix = query
        .slice(0, match.index)
        .match(/[\u4e00-\u9fffA-Za-z0-9]{2,12}$/)?.[0];
      if (prefix) candidates.push(prefix);
    }
    return candidates.slice(0, 10);
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
