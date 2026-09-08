import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { z } from 'zod';
import { LlmProvider } from '../../providers/llm/llm.provider';
import {
  KarpathyRagService,
  RetrieveOptions,
  RetrievedChunk,
} from '../karpathy/karpathy-rag.service';
import { SseCallback } from './sse-event';
import {
  AgenticRagState,
  type AgenticRagStateType,
  type AgenticSubQuestion,
  createAgenticArtifact,
  type AgenticArtifact,
  type AnswerContractArtifactPayload,
} from './agentic-rag.state';
import { generateAnswerPrompt } from '../prompts/rag.prompts';
import { sanitizeUntrustedContext } from '../prompts/prompt-injection.guard';
import {
  queryAugmentPrompt,
  reflectionPrompt,
  sufficiencyPrompt,
  deepAgentQueryPlanSystemPrompt,
  deepAgentQueryPlanUserPrompt,
} from '../prompts/agentic.prompts';
import { queryAugmentFewShotPrompt } from '../prompts/few-shot.examples';
import { SemanticExampleSelector } from '../prompts/semantic-example.selector';
import {
  BadCaseFlywheelService,
  type BadCaseMatch,
} from '../prompts/bad-case-flywheel.service';
import { BochaSearchService } from '../../tools/bocha-search.service';
import { DashScopeRerankService } from '../../tools/dashscope-rerank.service';
import { ToolExecutionPolicyService } from '../../tools/tool-execution-policy.service';
import { ToolExecutionService } from '../../tools/tool-execution.service';
import { Command, interrupt, StateGraph, START, END } from '@langchain/langgraph';
import { RunnableConfig } from '@langchain/core/runnables';
import { ConfigService } from '@nestjs/config';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { RedisCheckpointer } from '../../providers/langgraph-checkpointer/redis-checkpointer';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { TracingService } from '../../modules/tracing/tracing.service';
import { GraphService } from '../../modules/graph/graph.service';
import { buildStructuredDeliveryArtifacts } from './structured-delivery-artifacts';
import { AgenticStructuredArtifactEntity } from '../../providers/db/entities/agentic-structured-artifact.entity';
import { ArtifactDependencyEntity } from '../../providers/db/entities/artifact-dependency.entity';
import { randomUUID } from 'node:crypto';
import { AgentLoopService } from '../../modules/agent-loop/agent-loop.service';

/**
 * 深度问答的 LangGraph 状态机。
 *
 * 它只在显式 Agentic 或 Auto 的充分性／复杂度门禁要求升级时运行：
 * 查询增强 → 并发检索 → 证据充分性判断 → 按需网页补证／重排 → 生成 → 反思重试。
 * 每个节点将状态和事件写入检查点，支持中断后的受控恢复，而非盲目重新执行副作用。
 */
@Injectable()
export class AgenticRagService {
  private readonly logger = new Logger(AgenticRagService.name);
  private readonly deepAgents = new Map<
    string,
    { invoke: (input: unknown) => Promise<unknown> }
  >();
  private app: any;
  private readonly checkpointer: RedisCheckpointer;

  private readonly confidenceThreshold: number;
  private readonly maxRetries: number;
  private readonly maxAugmentedQueries: number;
  private readonly maxRetrievalQueries: number;
  private readonly maxSubQuestions: number;
  private readonly maxRetrievedChunks: number;
  private readonly maxWebSearchResults: number;
  private readonly maxRerankTopN: number;
  private readonly webSearchFallbackEnabled: boolean;
  private readonly rerankEnabled: boolean;
  private readonly graphSearchEnabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly llmProvider: LlmProvider,
    private readonly karpathyRagService: KarpathyRagService,
    private readonly bochaSearchService: BochaSearchService,
    private readonly dashScopeRerankService: DashScopeRerankService,
    private readonly toolPolicy: ToolExecutionPolicyService,
    private readonly semanticExampleSelector: SemanticExampleSelector,
    private readonly badCaseFlywheel: BadCaseFlywheelService,
    private readonly metricsService: MetricsService,
    private readonly tracingService: TracingService,
    private readonly redisProvider: RedisProvider,
    private readonly agentLoop: AgentLoopService,
    @Optional() private readonly toolExecution?: ToolExecutionService,
    @Optional() private readonly graphService?: GraphService,
    @Optional()
    @InjectRepository(AgenticStructuredArtifactEntity)
    private readonly structuredArtifactRepository?: Repository<AgenticStructuredArtifactEntity>,
    @Optional()
    @InjectRepository(ArtifactDependencyEntity)
    private readonly artifactDependencyRepository?: Repository<ArtifactDependencyEntity>,
  ) {
    this.confidenceThreshold = this.numberConfig(
      'agentic.confidenceThreshold',
      0.7,
      0,
      1,
    );
    this.maxRetries = this.intConfig('agentic.maxRetries', 2, 0, 5);
    this.maxAugmentedQueries = this.intConfig(
      'agentic.maxAugmentedQueries',
      3,
      1,
      5,
    );
    this.maxRetrievalQueries = this.intConfig(
      'agentic.maxRetrievalQueries',
      4,
      1,
      8,
    );
    this.maxSubQuestions = this.intConfig('agentic.maxSubQuestions', 3, 1, 5);
    this.maxRetrievedChunks = this.intConfig(
      'agentic.maxRetrievedChunks',
      5,
      1,
      12,
    );
    this.maxWebSearchResults = this.intConfig(
      'agentic.maxWebSearchResults',
      5,
      0,
      10,
    );
    this.maxRerankTopN = this.intConfig('agentic.maxRerankTopN', 5, 1, 10);
    this.webSearchFallbackEnabled =
      this.configService.get<boolean>('agentic.webSearchFallbackEnabled') ??
      true;
    this.rerankEnabled =
      this.configService.get<boolean>('agentic.rerankEnabled') ?? true;
    this.graphSearchEnabled =
      this.configService.get<boolean>('agentic.graphSearchEnabled') ?? true;
    this.checkpointer = new RedisCheckpointer(this.redisProvider);
    this.initGraph();
  }

  /**
   * 初始化 LangGraph 状态图
   */
  private initGraph() {
    const workflow = new StateGraph(AgenticRagState)
      .addNode(
        'queryAugment',
        this.observedNode('queryAugment', this.queryAugmentNode.bind(this)),
      )
      .addNode(
        'retrieval',
        this.observedNode('retrieval', this.retrievalNode.bind(this)),
      )
      .addNode(
        'sufficiency',
        this.observedNode('sufficiency', this.sufficiencyNode.bind(this)),
      )
      .addNode(
        'webSearchFallback',
        this.observedNode(
          'webSearchFallback',
          this.webSearchFallbackNode.bind(this),
        ),
      )
      .addNode(
        'rerank',
        this.observedNode('rerank', this.rerankNode.bind(this)),
      )
      .addNode(
        'generate',
        this.observedNode('generate', this.generateNode.bind(this)),
      )
      .addNode(
        'humanApprovalNode',
        this.observedNode(
          'humanApprovalNode',
          this.humanApprovalNode.bind(this),
        ),
      )
      .addNode(
        'reflection',
        this.observedNode('reflection', this.reflectionNode.bind(this)),
      );

    workflow.addEdge(START, 'queryAugment');
    workflow.addEdge('queryAugment', 'retrieval');
    workflow.addEdge('retrieval', 'sufficiency');

    workflow.addConditionalEdges(
      'sufficiency',
      (state) => {
        if (state.retrievalSufficient || state.webSearchAttempted) {
          return 'rerank';
        }
        return 'webSearchFallback';
      },
      {
        rerank: 'rerank',
        webSearchFallback: 'webSearchFallback',
      },
    );

    workflow.addEdge('webSearchFallback', 'sufficiency');
    workflow.addEdge('rerank', 'generate');
    workflow.addEdge('generate', 'humanApprovalNode');

    // humanApprovalNode → reflection（approved/skipped）或 END（rejected）
    workflow.addConditionalEdges(
      'humanApprovalNode',
      (state) => {
        if (state.humanApproval === 'rejected') return END;
        return 'reflection';
      },
      {
        reflection: 'reflection',
        [END]: END,
      },
    );

    workflow.addConditionalEdges(
      'reflection',
      (state) => {
        const action = this.reflectionRouter(state);
        return action === 'retry' ? 'retrieval' : END;
      },
      {
        retrieval: 'retrieval',
        [END]: END,
      },
    );

    this.app = workflow.compile({
      checkpointer: this.checkpointer,
    });
  }

  /**
   * 路由决策：判断走 simple 还是 agentic
   * auto 模式下只在明确复杂问题时走 agentic
   */
  routeNode(
    state: AgenticRagStateType,
    mode: 'simple' | 'agentic' | 'auto',
  ): Partial<AgenticRagStateType> {
    let route: 'simple' | 'agentic';

    if (mode === 'auto') {
      route = this.shouldUseAgentic(state.query) ? 'agentic' : 'simple';
    } else {
      route = mode;
    }

    this.logger.log(
      `Route decision: ${route} (mode=${mode}, query="${state.query.slice(0, 50)}")`,
    );
    return { route };
  }

  /**
   * 查询扩展节点：用 LLM 生成 3 条多角度检索问句
   */
  async queryAugmentNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    const badCaseMatchesPromise = this.withTimeout(
      this.badCaseFlywheel.retrieveMatches(state.query, 2),
      2_000,
      'Bad case candidate retrieval',
    ).catch(() => [] as BadCaseMatch[]);
    const deepAgentQueries = await this.planQueriesWithDeepAgent(state.query);
    let queries: string[];

    if (deepAgentQueries.length > 0) {
      queries = this.normalizeQueries(state.query, deepAgentQueries);
      this.logger.log(`DeepAgent planned queries: ${JSON.stringify(queries)}`);
    } else {
      const model = this.llmProvider.getModel();

      const schema = z.object({
        queries: z
          .array(z.string())
          .min(1)
          .max(this.maxAugmentedQueries)
          .describe(
            `最多 ${this.maxAugmentedQueries} 条中文检索问句：不同角度改写或扩写；保留专有名词、订单号等字面信息`,
          ),
      });

      try {
        const structured = model.withStructuredOutput(schema);
        const chain = queryAugmentPrompt.pipe(structured);

        // 优先使用语义示例选择器（从 Milvus 检索相关示例），超时则回退静态 few-shot。
        let fewShotBlock = '';
        try {
          fewShotBlock = await this.withTimeout(
            this.semanticExampleSelector.selectAndFormat(
              state.query,
              2,
              'query_augment',
            ),
            4_000,
            'Semantic example selection',
          );
        } catch (err) {
          this.logger.warn(
            `Semantic example selection skipped: ${(err as Error).message}`,
          );
        }

        // 若语义选择器返回空（Milvus 未就绪），回退到静态 few-shot
        if (!fewShotBlock) {
          fewShotBlock = await queryAugmentFewShotPrompt.format({});
        }

        const raw = await this.withTimeout(
          chain.invoke({
            query: state.query,
            few_shot_block: fewShotBlock,
          }),
          8_000,
          'Query augment structured output',
        );
        queries = this.normalizeQueries(state.query, raw.queries);
        this.logger.log(`Augmented queries: ${JSON.stringify(queries)}`);
      } catch (err) {
        this.logger.warn(
          `Query augment failed, fallback to original: ${(err as Error).message}`,
        );
        queries = [state.query];
      }
    }

    const subQuestions = this.buildSubQuestions(
      state.query,
      queries,
      this.getSubQuestionLimit(config),
    );
    onEvent?.({
      type: 'query_augment',
      data: { queries, subQuestions },
    });
    const artifact = createAgenticArtifact('subquestion_plan', 'queryAugment', {
      query: state.query,
      subQuestions,
    });
    onEvent?.({ type: 'artifact', data: artifact });
    return {
      augmentedQueries: queries,
      subQuestions,
      badCaseMatches: await badCaseMatchesPromise,
      artifacts: [artifact],
    };
  }

  /**
   * 检索节点：每个子问题独立执行完整 Hybrid Search（向量＋关键词／ES），
   * 低命中时再补一次 BM25，最后合并去重。这样扩展问句不会只依赖关键词检索。
   */
  async retrievalNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    const userId = config?.configurable?.userId as string | undefined;
    const retrieveOptions = (config?.configurable?.retrieveOptions ??
      {}) as RetrieveOptions;
    const fastPathChunks = (config?.configurable?.fastPathChunks ??
      []) as RetrievedChunk[];
    const subQuestionLimit = this.getSubQuestionLimit(config);
    const plannedSubQuestions =
      state.subQuestions?.length > 0
        ? state.subQuestions
        : this.buildSubQuestions(
            state.query,
            state.augmentedQueries,
            subQuestionLimit,
          );
    const boundedSubQuestions = plannedSubQuestions.slice(
      0,
      Math.min(subQuestionLimit, this.maxRetrievalQueries),
    );

    this.logger.log(
      `Retrieving ${boundedSubQuestions.length}/${plannedSubQuestions.length} sub-questions with hybrid search for userId=${userId ?? 'none'}`,
    );

    const retrievedSubQuestions = await Promise.all(
      boundedSubQuestions.map(async (subQuestion, index) => {
        const q = subQuestion.question;
        try {
          // Auto 升级时复用 Fast Path 原问题结果，避免再次访问 Milvus／ES。
          let results =
            index === 0 && q === state.query && fastPathChunks.length > 0
              ? fastPathChunks
              : await this.karpathyRagService.retrieve(
                  q,
                  retrieveOptions,
                  userId,
                );
          // 向量服务短暂不可用或混合结果为空时，保留关键词降级能力。
          if (results.length === 0) {
            results = await this.karpathyRagService.retrieveBm25Only(
              q,
              userId,
              retrieveOptions.scope,
            );
          }
          const graphChunks = await this.retrieveGraphEvidence(q, userId, config);
          results = [...results, ...graphChunks];
          return {
            ...subQuestion,
            status:
              results.length > 0
                ? ('retrieved' as const)
                : ('needs_more' as const),
            evidenceIds: results.map((chunk) => chunk.id),
            retrievalAttempts: subQuestion.retrievalAttempts + 1,
            results,
          };
        } catch (err) {
          this.logger.warn(
            `Retrieve failed for query "${q.slice(0, 30)}": ${(err as Error).message}`,
          );
          return {
            ...subQuestion,
            status: 'needs_more' as const,
            retrievalAttempts: subQuestion.retrievalAttempts + 1,
            reason: (err as Error).message,
            results: [] as RetrievedChunk[],
          };
        }
      }),
    );
    const allResults = retrievedSubQuestions.map((item) => item.results);
    const updatedSubQuestions: AgenticSubQuestion[] = retrievedSubQuestions.map(
      ({ results, ...subQuestion }) => {
        void results;
        return subQuestion;
      },
    );

    const resultIds = new Set(allResults.flat().map((chunk) => chunk.id));
    const remainingSubQuestions = plannedSubQuestions
      .slice(boundedSubQuestions.length)
      .map((item) => ({ ...item, status: 'needs_more' as const }));

    const fusedMap = new Map<string, RetrievedChunk>();
    for (const results of allResults) {
      for (const chunk of results) {
        const existing = fusedMap.get(chunk.id);
        if (!existing || chunk.totalScore > existing.totalScore) {
          fusedMap.set(chunk.id, chunk);
        }
      }
    }

    const rankedChunks = Array.from(fusedMap.values()).sort(
      (a, b) => b.totalScore - a.totalScore,
    );
    const requiredIds = updatedSubQuestions
      .map((item) => item.evidenceIds[0])
      .filter((id): id is string => Boolean(id));
    const requiredChunks = requiredIds
      .map((id) => fusedMap.get(id))
      .filter((chunk): chunk is RetrievedChunk => Boolean(chunk));
    const chunks = Array.from(
      new Map(
        [...requiredChunks, ...rankedChunks].map((chunk) => [chunk.id, chunk]),
      ).values(),
    ).slice(0, this.maxRetrievedChunks);

    this.logger.log(
      `Retrieved ${chunks.length} unique chunks from ${boundedSubQuestions.length} sub-questions`,
    );

    onEvent?.({
      type: 'retrieval',
      data: {
        chunks,
        subQuestions: [...updatedSubQuestions, ...remainingSubQuestions].map(
          (item) => ({ ...item, evidenceCount: item.evidenceIds.length }),
        ),
        evidenceCount: resultIds.size,
      },
    });
    const previousArtifacts = (state.artifacts ?? []).filter(
      (artifact) => artifact.type !== 'evidence_bundle',
    );
    const evidenceArtifact = createAgenticArtifact(
      'evidence_bundle',
      'retrieval',
      {
        query: state.query,
        chunkIds: chunks.map((chunk) => chunk.id),
        subQuestions: [...updatedSubQuestions, ...remainingSubQuestions].map(
          ({ id, question, evidenceIds, status }) => ({
            id,
            question,
            evidenceIds,
            status,
          }),
        ),
        webSearchCount: 0,
      },
    );
    onEvent?.({ type: 'artifact', data: evidenceArtifact });
    if (chunks.length === 0) {
      this.metricsService.observeAgentEmptyRetrieval(state.route || 'agentic');
    }
    return {
      retrievedChunks: chunks,
      subQuestions: [...updatedSubQuestions, ...remainingSubQuestions],
      artifacts: [...previousArtifacts, evidenceArtifact],
      webSearchAttempted: false,
      webSearchCount: 0,
      answer: '',
      passed: false,
    };
  }

  /**
   * 检索充分性评估
   */
  async sufficiencyNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    const subQuestions = state.subQuestions?.length
      ? state.subQuestions
      : this.buildSubQuestions(
          state.query,
          state.augmentedQueries,
          this.getSubQuestionLimit(config),
        );
    const chunksById = new Map(
      state.retrievedChunks.map((chunk) => [chunk.id, chunk]),
    );
    const evaluatedSubQuestions = subQuestions.map((subQuestion) => {
      const evidence = subQuestion.evidenceIds
        .map((id) => chunksById.get(id))
        .filter((chunk): chunk is RetrievedChunk => Boolean(chunk));
      const gate = this.karpathyRagService.assessRetrievedChunks(
        subQuestion.question,
        evidence,
      );
      return {
        ...subQuestion,
        sufficient: gate.sufficient,
        status: gate.sufficient
          ? ('sufficient' as const)
          : ('needs_more' as const),
        reason: gate.reason,
      };
    });
    const unresolved = evaluatedSubQuestions.filter((item) => !item.sufficient);

    if (state.retrievedChunks.length === 0 || unresolved.length > 0) {
      const res = {
        retrievalSufficient: false,
        retrievalReason:
          state.retrievedChunks.length === 0
            ? '没有检索到任何可用片段'
            : `仍有 ${unresolved.length} 个子问题缺少直接证据：${unresolved.map((item) => item.question).join('；')}`,
        subQuestions: evaluatedSubQuestions,
      };
      onEvent?.({
        type: 'sufficiency',
        data: {
          sufficient: res.retrievalSufficient,
          reason: res.retrievalReason,
        },
      });
      return res;
    }

    const localGate = this.karpathyRagService.assessRetrievedChunks(
      state.query,
      state.retrievedChunks,
    );
    if (!localGate.sufficient) {
      onEvent?.({
        type: 'sufficiency',
        data: {
          sufficient: false,
          reason: localGate.reason,
        },
      });
      return {
        retrievalSufficient: false,
        retrievalReason: localGate.reason,
        subQuestions: evaluatedSubQuestions,
      };
    }

    const model = this.llmProvider.getModel();
    const schema = z.object({
      sufficient: z.boolean().describe('检索片段是否足够直接支撑回答用户问题'),
      reason: z.string().describe('中文评估理由'),
    });

    try {
      const structured = model.withStructuredOutput(schema);
      const chain = sufficiencyPrompt.pipe(structured);
      const context = state.retrievedChunks
        .map((c, i) => `[片段 ${i + 1}] ${c.content.slice(0, 500)}`)
        .join('\n\n');
      const result = await chain.invoke({
        query: state.query,
        context,
      });

      this.logger.log(
        `Retrieval sufficiency: sufficient=${result.sufficient}, reason=${result.reason}`,
      );

      onEvent?.({
        type: 'sufficiency',
        data: {
          sufficient: result.sufficient,
          reason: result.reason,
        },
      });

      return {
        retrievalSufficient: result.sufficient,
        retrievalReason: result.reason,
        subQuestions: evaluatedSubQuestions.map((item) => ({
          ...item,
          sufficient: result.sufficient && item.sufficient,
          status:
            result.sufficient && item.sufficient ? 'sufficient' : 'needs_more',
        })),
      };
    } catch (err) {
      // 结构化充分性判断失败时复用统一质量门禁；不能再用更高的硬编码分数阈值，
      // 否则已通过关键词覆盖的网页证据会因 0.15 < 0.20 被错误拒答。
      const fallbackGate = this.karpathyRagService.assessRetrievedChunks(
        state.query,
        state.retrievedChunks,
      );
      const sufficient = fallbackGate.sufficient;
      const reason = `充分性 LLM 评估失败，按检索质量门禁判断：${fallbackGate.reason}`;
      this.logger.warn(`${reason}: ${(err as Error).message}`);

      onEvent?.({
        type: 'sufficiency',
        data: {
          sufficient,
          reason,
        },
      });

      return {
        retrievalSufficient: sufficient,
        retrievalReason: reason,
        subQuestions: evaluatedSubQuestions,
      };
    }
  }

  /**
   * 联网兜底
   */
  async webSearchFallbackNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType> & { webSearchCount: number }> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    if (state.retrievalSufficient) {
      return { webSearchCount: 0 };
    }

    if (
      !this.webSearchFallbackEnabled ||
      !this.bochaSearchService.isEnabled() ||
      !this.toolPolicy.decide('bocha_web_search', this.pluginPolicy(config, 'agentic')).allowed
    ) {
      this.logger.warn(
        'Retrieval insufficient but Bocha web_search is disabled or budgeted off',
      );
      const reason = `${state.retrievalReason || '检索不足'}；联网兜底未启用或 BOCHA_API_KEY 未配置，已跳过`;
      onEvent?.({
        type: 'web_search',
        data: {
          count: 0,
          enabled:
            this.webSearchFallbackEnabled &&
            this.bochaSearchService.isEnabled(),
          reason,
        },
      });
      return {
        retrievalReason: reason,
        webSearchCount: 0,
        webSearchAttempted: true,
      };
    }

    try {
      const subQuestions = state.subQuestions?.length
        ? state.subQuestions
        : this.buildSubQuestions(
            state.query,
            state.augmentedQueries,
            this.getSubQuestionLimit(config),
          );
      const unresolved = subQuestions.filter((item) => !item.sufficient);
      const searchQuestions = unresolved.length
        ? unresolved.slice(0, this.getSubQuestionLimit(config))
        : [{ question: state.query }];
      const threadId = this.threadIdFromConfig(config);
      const searchResults = await Promise.all(
        searchQuestions.map(async (item) => ({
          question: item.question,
          results:
            this.maxWebSearchResults > 0
              ? await this.executeAgenticTool(
                  'bocha_web_search',
                  threadId,
                  this.userIdFromConfig(config),
                  { question: item.question, count: this.maxWebSearchResults },
                  () => this.bochaSearchService.search(item.question, this.maxWebSearchResults),
                  config,
                )
              : [],
        })),
      );
      const webIdsByQuestion = new Map<string, string[]>();
      const webChunks: RetrievedChunk[] = [];
      const maxResultsPerQuestion = Math.max(
        ...searchResults.map(({ results }) => results.length),
        0,
      );
      // 轮转合并：候选上限较小时，先保证每个子问题至少保留一条网页证据，再补充同题的更多结果。
      for (let resultIndex = 0; resultIndex < maxResultsPerQuestion; resultIndex += 1) {
        for (const { results } of searchResults) {
          const result = results[resultIndex];
          if (!result) continue;
          const parts = [
            `标题：${result.title}`,
            `来源：${result.siteName ?? result.url}`,
            result.datePublished ? `发布时间：${result.datePublished}` : '',
            result.summary ? `摘要：${result.summary}` : '',
            result.snippet ? `片段：${result.snippet}` : '',
            `URL：${result.url}`,
          ].filter(Boolean);

          webChunks.push({
            id: `web:${result.url}`,
            content: parts.join('\n'),
            docId: result.url,
            chunkIndex: resultIndex,
            bm25Score: 0,
            cosineScore: 0,
            totalScore: 0.15,
          });
        }
      }
      for (const { question, results } of searchResults) {
        webIdsByQuestion.set(
          question,
          results.map((result) => `web:${result.url}`),
        );
      }

      this.logger.log(`Bocha web_search returned ${webChunks.length} results`);
      const reason = `${state.retrievalReason || '检索不足'}；已通过 Bocha web_search 补充 ${webChunks.length} 条结果`;
      onEvent?.({
        type: 'web_search',
        data: {
          count: webChunks.length,
          enabled: true,
          reason,
        },
      });
      return {
        // 本地召回已占满上限时，网页补证必须优先进入后续重排和引用阶段，不能在末尾被 slice 丢弃。
        retrievedChunks: [...webChunks, ...state.retrievedChunks].slice(
          0,
          this.maxRetrievedChunks,
        ),
        subQuestions: subQuestions.map((item) => ({
          ...item,
          evidenceIds: [
            ...item.evidenceIds,
            ...(webIdsByQuestion.get(item.question) ?? []),
          ],
          status: webIdsByQuestion.has(item.question)
            ? ('retrieved' as const)
            : item.status,
        })),
        retrievalReason: reason,
        webSearchCount: webChunks.length,
        webSearchAttempted: true,
      };
    } catch (err) {
      const reason = `Bocha web_search 调用失败：${(err as Error).message}`;
      this.logger.warn(reason);
      const fallbackReason = `${state.retrievalReason || '检索不足'}；${reason}`;
      onEvent?.({
        type: 'web_search',
        data: {
          count: 0,
          enabled:
            this.webSearchFallbackEnabled &&
            this.bochaSearchService.isEnabled(),
          reason: fallbackReason,
        },
      });
      return {
        retrievalReason: fallbackReason,
        webSearchCount: 0,
        webSearchAttempted: true,
      };
    }
  }

  /**
   * 二次排序
   */
  async rerankNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType> & { reranked: boolean }> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    if (state.retrievedChunks.length < 2) {
      onEvent?.({
        type: 'rerank',
        data: {
          enabled:
            this.rerankEnabled && this.dashScopeRerankService.isEnabled(),
          reranked: false,
          count: state.retrievedChunks.length,
        },
      });
      return { reranked: false };
    }

    if (
      !this.rerankEnabled ||
      !this.dashScopeRerankService.isEnabled() ||
      !this.toolPolicy.decide('dashscope_rerank', this.pluginPolicy(config, 'agentic')).allowed
    ) {
      onEvent?.({
        type: 'rerank',
        data: {
          enabled: false,
          reranked: false,
          count: state.retrievedChunks.length,
        },
      });
      return { reranked: false };
    }

    try {
      const chunks = await this.executeAgenticTool(
        'dashscope_rerank',
        this.threadIdFromConfig(config),
        this.userIdFromConfig(config),
        { query: state.query, candidateCount: state.retrievedChunks.length, topN: this.maxRerankTopN },
        () => this.dashScopeRerankService.rerank(state.query, state.retrievedChunks, this.maxRerankTopN),
        config,
      );
      onEvent?.({
        type: 'rerank',
        data: {
          enabled: true,
          reranked: true,
          count: chunks.length,
        },
      });
      return { retrievedChunks: chunks, reranked: true };
    } catch (err) {
      this.logger.warn(`DashScope rerank skipped: ${(err as Error).message}`);
      onEvent?.({
        type: 'rerank',
        data: {
          enabled: true,
          reranked: false,
          count: state.retrievedChunks.length,
        },
      });
      return { reranked: false };
    }
  }

  /**
   * 生成节点：基于检索结果生成答案
   */
  async generateNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    const history = (config?.configurable?.history ?? []) as Array<{
      role: 'human' | 'ai';
      content: string;
    }>;
    const memoryMessages = (config?.configurable?.memoryMessages ??
      []) as Array<{
      role: string;
      content: string;
    }>;
    const badCaseMatches = state.badCaseMatches ?? [];
    const badCasePrompt = badCaseMatches.length
      ? this.badCaseFlywheel.formatPrompt(badCaseMatches)
      : '';
    const generationMemory = badCasePrompt
      ? [...memoryMessages, { role: 'system', content: badCasePrompt }]
      : memoryMessages;
    const strongBadCase = badCaseMatches.find(
      (match) => match.mode === 'exact',
    );
    const correction = strongBadCase
      ? this.karpathyRagService.extractCorrectedAnswer(strongBadCase.text)
      : '';
    if (strongBadCase && correction) {
      const answer = await this.karpathyRagService.generateCorrectionAnswer(
        state.query,
        correction,
        history,
        memoryMessages,
        (token) => onEvent?.({ type: 'token', data: token }),
        strongBadCase.query,
      );
      onEvent?.({ type: 'citation', data: state.retrievedChunks });
      const artifacts = this.withAnswerArtifact(
        state,
        answer,
        true,
        1,
        '命中已审核 Bad Case 纠错答案',
      );
      onEvent?.({ type: 'artifact', data: artifacts[artifacts.length - 1] });
      return {
        answer,
        retrievalSufficient: true,
        retrievalReason: `命中已审核 Bad Case 纠错证据（${strongBadCase.mode}，${strongBadCase.score.toFixed(3)}）`,
        artifacts,
      };
    }

    if (state.retrievedChunks.length === 0 || !state.retrievalSufficient) {
      const reason =
        state.retrievedChunks.length === 0
          ? '没有检索到任何可用片段'
          : state.retrievalReason || '检索不足';
      const ans = this.karpathyRagService.unsupportedReliableAnswer();
      onEvent?.({ type: 'token', data: ans });
      onEvent?.({ type: 'citation', data: [] });
      const artifacts = this.withAnswerArtifact(
        state,
        ans,
        false,
        0,
        '本地与联网证据不足，已进入安全降级',
      );
      onEvent?.({ type: 'artifact', data: artifacts[artifacts.length - 1] });
      return {
        answer: ans,
        retrievedChunks: [],
        retrievalSufficient: false,
        retrievalReason: `${reason}；本地与联网证据不足，已进入安全降级`,
        artifacts,
      };
    }

    const context = state.retrievedChunks
      .map((c, i) => `[片段 ${i + 1}]\n${sanitizeUntrustedContext(c.content)}`)
      .join('\n\n---\n\n');

    type GenerationLoopState = {
      answer: string;
      citationGate?: { sufficient: boolean; reason: string };
    };
    const model = this.llmProvider.getModel();
    const loop = await this.agentLoop.run<GenerationLoopState, GenerationLoopState>({
      threadId: this.threadIdFromConfig(config) || 'agentic-rag',
      runId: this.runIdFromConfig(config),
      actor: 'agentic_answer',
      initialState: { answer: '' },
      maxSteps: 3,
      maxToolCalls: 1,
      timeoutMs: 90_000,
      decide: (loopState) => {
        if (!loopState.answer) {
          return {
            type: 'model' as const,
            name: 'generate_grounded_answer',
            execute: async () => {
              const messages = await generateAnswerPrompt.formatMessages({
                context,
                query: state.query,
                history,
                memory: generationMemory,
              });
              const stream = await model.stream(messages);
              let draft = '';
              for await (const chunk of stream) {
                const token = typeof chunk.content === 'string'
                  ? chunk.content
                  : JSON.stringify(chunk.content);
                if (!token) continue;
                draft += token;
                onEvent?.({ type: 'token', data: token });
              }
              return this.karpathyRagService.addVersionConflictNotice(
                draft,
                state.retrievedChunks,
              );
            },
            reduce: (current: GenerationLoopState, answer: string) => ({ ...current, answer }),
          };
        }
        if (!loopState.citationGate) {
          return {
            type: 'tool' as const,
            name: 'citation_validate',
            mode: 'agentic' as const,
            ownerUserId: this.userIdFromConfig(config),
            input: { answerLength: loopState.answer.length, evidenceCount: state.retrievedChunks.length },
            execute: async () => this.karpathyRagService.validateAnswerCitationSupport(
              loopState.answer,
              state.retrievedChunks,
            ),
            reduce: (
              current: GenerationLoopState,
              citationGate: { sufficient: boolean; reason: string },
            ) => ({ ...current, citationGate }),
          };
        }
        return { type: 'complete' as const, output: loopState, reason: loopState.citationGate.sufficient ? '引用门禁通过' : loopState.citationGate.reason };
      },
    });
    if (loop.status !== 'completed' || !loop.output?.citationGate) {
      throw new Error(`Agent Loop 未完成：${loop.terminationReason}`);
    }
    const answer = loop.output.answer;
    const citationGate = loop.output.citationGate;
    if (!citationGate.sufficient) {
      // 联网或复杂问答中，模型可能已引用片段但不满足逐句覆盖；只要抽取式答案能通过校验，
      // 就应保留已验证证据，而不是把可回答问题直接降级为拒答。
      const fallbackAnswer = this.karpathyRagService.buildExtractiveAnswer(
        state.query,
        state.retrievedChunks,
      );
      if (fallbackAnswer) {
        const fallbackGate = this.karpathyRagService.validateAnswerCitationSupport(
          fallbackAnswer,
          state.retrievedChunks,
        );
        if (fallbackGate.sufficient) {
          onEvent?.({ type: 'token', data: fallbackAnswer });
          onEvent?.({ type: 'citation', data: state.retrievedChunks });
          const artifacts = this.withAnswerArtifact(
            state,
            fallbackAnswer,
            true,
            this.getSubQuestionCoverage(state),
            '抽取式答案通过引用校验',
          );
          onEvent?.({
            type: 'artifact',
            data: artifacts[artifacts.length - 1],
          });
          return {
            answer: fallbackAnswer,
            retrievalSufficient: true,
            retrievalReason: 'LLM 答案引用不足，已回退为片段抽取式回答',
            artifacts,
          };
        }
      }

      const safeAnswer = this.karpathyRagService.unsupportedReliableAnswer();
      onEvent?.({ type: 'token', data: safeAnswer });
      onEvent?.({ type: 'citation', data: [] });
      const artifacts = this.withAnswerArtifact(
        state,
        safeAnswer,
        false,
        0,
        citationGate.reason,
      );
      onEvent?.({ type: 'artifact', data: artifacts[artifacts.length - 1] });
      return {
        answer: safeAnswer,
        retrievedChunks: [],
        retrievalSufficient: false,
        retrievalReason: citationGate.reason,
        passed: true,
        artifacts,
      };
    }

    onEvent?.({ type: 'citation', data: state.retrievedChunks });
    const artifacts = this.withAnswerArtifact(
      state,
      answer,
      true,
      this.getSubQuestionCoverage(state),
      '答案通过引用和子问题覆盖校验',
    );
    onEvent?.({ type: 'artifact', data: artifacts[artifacts.length - 1] });
    return { answer, artifacts };
  }

  /**
   * Reflection 节点：评估答案置信度，决定是否重试
   */
  async reflectionNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    if (!state.retrievalSufficient) {
      onEvent?.({
        type: 'reflection',
        data: {
          // 安全降级代表「没有编造答案」，不是「答案结论可信」。
          confidence: 0,
          passed: true,
          retryCount: state.retryCount,
          reason: '本地与联网证据不足时已进入安全降级，不再生成无证据答案',
        },
      });
      return { confidence: 0, passed: true, retryCount: state.retryCount };
    }

    const answerContract = [...(state.artifacts ?? [])]
      .reverse()
      .find((artifact) => artifact.type === 'answer_contract');
    const contractPayload = answerContract?.payload as
      | AnswerContractArtifactPayload
      | undefined;
    if (contractPayload && !contractPayload.valid) {
      const retryCount = state.retryCount + 1;
      const reason = `答案契约校验未通过：${contractPayload.reason}`;
      onEvent?.({
        type: 'reflection',
        data: {
          confidence: 0,
          passed: false,
          retryCount,
          reason,
        },
      });
      return { confidence: 0, passed: false, retryCount };
    }

    const model = this.llmProvider.getModel();

    const schema = z.object({
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe(
          '答案置信度 0~1：是否完整回答了问题、是否有引用支撑、是否编造',
        ),
      reason: z.string().describe('评估理由（中文）'),
    });

    try {
      const structured = model.withStructuredOutput(schema);
      const chain = reflectionPrompt.pipe(structured);
      const result = await chain.invoke({
        query: state.query,
        context: state.retrievedChunks
          .map((c, i) => `[片段 ${i + 1}] ${c.content.slice(0, 800)}`)
          .join('\n'),
        answer: state.answer,
      });

      const passed = result.confidence >= this.confidenceThreshold;
      const retryCount = state.retryCount + 1;

      this.logger.log(
        `Reflection: confidence=${result.confidence.toFixed(2)}, passed=${passed}, retry=${retryCount}/${this.maxRetries}, reason=${result.reason}`,
      );

      onEvent?.({
        type: 'reflection',
        data: {
          confidence: result.confidence,
          passed,
          retryCount,
        },
      });

      return {
        confidence: result.confidence,
        passed,
        retryCount,
      };
    } catch (err) {
      this.logger.warn(
        `Reflection failed, assume passed: ${(err as Error).message}`,
      );
      const retryCount = state.retryCount + 1;
      onEvent?.({
        type: 'reflection',
        data: {
          confidence: 1,
          passed: true,
          retryCount,
        },
      });
      return { confidence: 1, passed: true, retryCount };
    }
  }

  /**
   * 人工审批节点：当 enableInterrupt=true 时暂停图执行，等待用户审批
   * 如果 enableInterrupt=false（默认），直接标记为 approved 跳过
   */
  async humanApprovalNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    await Promise.resolve();
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    const enableInterrupt = config?.configurable?.enableInterrupt as
      | boolean
      | undefined;

    // 不启用中断时直接跳过
    if (!enableInterrupt) {
      return { humanApproval: 'approved' };
    }

    // LangGraph 原生中断会持久化当前图状态；恢复时该节点从开头重跑，
    // 因此中断前只发送只读事件，绝不执行外部副作用。
    const reason = `答案生成完成，等待人工审批（confidence 将在后续 reflection 评估）`;
    this.logger.log(`Human approval interrupt: ${reason}`);
    onEvent?.({
      type: 'interrupt',
      data: {
        reason,
        answer: state.answer,
        references: state.retrievedChunks,
        threadId: (config?.configurable?.thread_id as string) ?? '',
      },
    });
    const review = interrupt<{
      reason: string;
      answer: string;
      references: RetrievedChunk[];
      threadId: string;
    }, { approval: 'approved' | 'rejected'; feedback?: string }>({
      reason,
      answer: state.answer,
      references: state.retrievedChunks,
      threadId: (config?.configurable?.thread_id as string) ?? '',
    });
    return {
      humanApproval: review.approval,
      interruptReason: review.feedback ?? '',
    };
  }

  /**
   * 恢复被人工审批中断的图执行
   * @param threadId 会话 ID
   * @param approval 审批结果：'approved' 或 'rejected'
   * @param feedback 可选的用户反馈
   * @param onEvent SSE 事件回调
   */
  async resumeGraph(
    threadId: string,
    approval: 'approved' | 'rejected',
    feedback?: string,
    onEvent?: SseCallback,
  ): Promise<{
    answer: string;
    references: RetrievedChunk[];
    confidence: number;
    retryCount: number;
    approved: boolean;
  }> {
    this.logger.log(
      `Resuming graph for thread=${threadId}, approval=${approval}`,
    );

    // 使用 Command 恢复原生 interrupt，不能用普通输入重新 invoke。
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const finalState = (await this.app.invoke(
      new Command({ resume: { approval, feedback } }),
      {
        configurable: {
          thread_id: threadId,
          onEvent,
          enableInterrupt: true,
        },
      },
    )) as AgenticRagStateType;

    const result = {
      answer: finalState.answer,
      references: finalState.retrievedChunks,
      confidence: finalState.confidence,
      retryCount: finalState.retryCount,
      approved: approval === 'approved',
    };

    onEvent?.({ type: 'final', data: result });
    return result;
  }

  /**
   * 读取一次 Agentic 运行的最新检查点，供 Agent 运营后台审计。
   * 只返回已定义的状态字段，避免把 Redis 内部 checkpoint 结构直接暴露给后台。
   */
  async getRunSnapshot(threadId: string): Promise<{
    available: boolean;
    threadId: string;
    checkpointId: string | null;
    updatedAt: string | null;
    query: string | null;
    route: 'simple' | 'agentic' | null;
    subQuestions: AgenticSubQuestion[];
    artifacts: AgenticArtifact[];
    retrievalSufficient: boolean | null;
    retrievalReason: string | null;
    retryCount: number | null;
    passed: boolean | null;
  }> {
    const tuple = await this.checkpointer.getTuple({
      configurable: { thread_id: threadId },
    });
    if (!tuple) {
      const persistedArtifacts = await this.loadPersistedArtifacts(threadId);
      return {
        available: false,
        threadId,
        checkpointId: null,
        updatedAt: null,
        query: null,
        route: null,
        subQuestions: [],
        artifacts: persistedArtifacts,
        retrievalSufficient: null,
        retrievalReason: null,
        retryCount: null,
        passed: null,
      };
    }

    const values = tuple.checkpoint.channel_values as Record<string, unknown>;
    const checkpointArtifacts = this.isArtifacts(values.artifacts)
      ? values.artifacts
      : [];
    const persistedArtifacts = await this.loadPersistedArtifacts(threadId);
    const artifacts = [...checkpointArtifacts];
    for (const artifact of persistedArtifacts) {
      if (!artifacts.some((item) => item.id === artifact.id)) artifacts.push(artifact);
    }
    return {
      available: true,
      threadId,
      checkpointId:
        (tuple.config.configurable?.checkpoint_id as string | undefined) ??
        null,
      updatedAt: tuple.checkpoint.ts ?? null,
      query: typeof values.query === 'string' ? values.query : null,
      route: this.isAgenticRoute(values.route) ? values.route : null,
      subQuestions: this.isSubQuestions(values.subQuestions)
        ? values.subQuestions
        : [],
      artifacts,
      retrievalSufficient:
        typeof values.retrievalSufficient === 'boolean'
          ? values.retrievalSufficient
          : null,
      retrievalReason:
        typeof values.retrievalReason === 'string'
          ? values.retrievalReason
          : null,
      retryCount:
        typeof values.retryCount === 'number' ? values.retryCount : null,
      passed: typeof values.passed === 'boolean' ? values.passed : null,
    };
  }

  private async loadPersistedArtifacts(threadId: string): Promise<AgenticArtifact[]> {
    if (!this.structuredArtifactRepository) return [];
    const rows = await this.structuredArtifactRepository.find({
      where: { threadId },
      order: { createdAt: 'ASC' },
    });
    return rows.flatMap((row) => {
      try {
        return [{
          id: row.artifactId,
          type: row.type as AgenticArtifact['type'],
          version: row.version as 1,
          producer: row.producer,
          createdAt: row.createdAt.toISOString(),
          payload: JSON.parse(row.payload) as unknown,
        }];
      } catch {
        return [];
      }
    });
  }

  /** 重新执行当前 Thread 的 Agentic 全链路，保留同一会话用于对比前后 Artifact。 */
  async retryRun(threadId: string, onEvent?: SseCallback) {
    const snapshot = await this.getRunSnapshot(threadId);
    if (!snapshot.available || !snapshot.query) {
      throw new Error('未找到可重新执行的 Agentic Thread');
    }
    return this.run(snapshot.query, 'agentic', onEvent, [], threadId);
  }

  /**
   * 条件路由：reflection 后决定重试还是结束
   */
  reflectionRouter(state: AgenticRagStateType): 'retry' | 'end' {
    if (state.passed) {
      this.metricsService.observeAgentLoopDecision('passed');
      return 'end';
    }
    if (state.retryCount >= this.maxRetries) {
      this.logger.warn(`Max retries (${this.maxRetries}) reached, ending`);
      this.metricsService.observeAgentLoopDecision('max_retries');
      return 'end';
    }
    this.metricsService.observeAgentLoopDecision('retry');
    return 'retry';
  }

  /**
   * 完整执行 Agentic RAG 工作流（带 SSE 回调）
   */
  /**
   * 运行一次可回放的深度问答。`onEvent` 是唯一的流式出口，因此此处统一记录
   * 首 Token 延迟、工具成功率并向前端转发，避免节点各自发送不一致事件。
   */
  async run(
    query: string,
    mode: 'simple' | 'agentic' | 'auto',
    onEvent?: SseCallback,
    history: Array<{ role: 'human' | 'ai'; content: string }> = [],
    threadId = 'default-thread',
    userId?: string,
    memoryMessages: Array<{ role: string; content: string }> = [],
    enableInterrupt = false,
    retrieveOptions: RetrieveOptions = {},
  ): Promise<{
    answer: string;
    references: RetrievedChunk[];
    route: 'simple' | 'agentic';
    confidence: number;
    retryCount: number;
    retrievalSufficient?: boolean;
    retrievalReason?: string;
    obsidianPaths?: string[];
    interrupted?: boolean;
  }> {
    const requestStartedAt = Date.now();
    const downstreamOnEvent = onEvent;
    let firstTokenRecorded = false;
    let observedRoute = mode;
    onEvent = (event) => {
      if (event.type === 'token' && !firstTokenRecorded) {
        firstTokenRecorded = true;
        this.metricsService.observeAgentFirstToken(
          observedRoute,
          (Date.now() - requestStartedAt) / 1000,
        );
      }
      if (event.type === 'tool_call') {
        const data = this.recordOf(event.data);
        this.metricsService.observeAgentToolCall(
          typeof data.name === 'string' ? data.name : 'unknown',
          data.success !== false && !data.error,
        );
      }
      downstreamOnEvent?.(event);
    };
    // Auto 先尝试受治理的精确直答；命中时不进入状态机，以降低简单问题的时延和成本。
    if (mode === 'auto') {
      const direct = await this.karpathyRagService.answerDirect(
        query,
        history,
        userId,
        memoryMessages,
        (token) => onEvent?.({ type: 'token', data: token }),
        retrieveOptions.scope,
      );
      if (direct) {
        observedRoute = 'simple';
        onEvent?.({
          type: 'routing',
          data: { mode, route: 'simple', reason: 'direct_answer' },
        });
        onEvent?.({ type: 'citation', data: direct.references });
        onEvent?.({ type: 'final', data: direct });
        return {
          answer: direct.answer,
          references: direct.references,
          route: 'simple',
          confidence: 1,
          retryCount: 0,
          retrievalSufficient: direct.retrievalSufficient,
          retrievalReason: direct.retrievalReason,
          obsidianPaths: direct.obsidianPaths,
        };
      }
    }

    let fastPathGate =
      mode !== 'simple'
        ? await this.karpathyRagService.assessFastPath(
            query,
            userId,
            retrieveOptions,
          )
        : null;
    const route =
      mode === 'simple'
        ? 'simple'
        : mode === 'auto'
          ? this.resolveAutoRoute(query, Boolean(fastPathGate?.sufficient))
          : this.classifyRoute(query, mode);
    observedRoute = route;
    onEvent?.({ type: 'routing', data: { mode, route } });
    if (fastPathGate) {
      onEvent?.({
        type: 'sufficiency',
        data: {
          sufficient: fastPathGate.sufficient,
          reason: fastPathGate.reason,
          taskComplexity: this.shouldUseAgentic(query),
          obsidianPaths: fastPathGate.obsidianHits.map((hit) => hit.path),
          ragReferences: fastPathGate.chunks.map((chunk) => chunk.id),
        },
      });
    }

    if (route === 'simple') {
      const result = await this.karpathyRagService.answer(
        query,
        history,
        userId,
        memoryMessages,
        (token) => onEvent?.({ type: 'token', data: token }),
        fastPathGate
          ? {
              ...retrieveOptions,
              prefetchedFastPath: fastPathGate.prefetchedFastPath,
            }
          : retrieveOptions,
      );
      onEvent?.({ type: 'citation', data: result.references });
      onEvent?.({ type: 'final', data: result });
      return {
        answer: result.answer,
        references: result.references,
        route: 'simple',
        // 检索不足时即使安全返回了友好说明，也不能向 API／页面宣称结论满置信。
        confidence: result.retrievalSufficient ? 1 : 0,
        retryCount: 0,
        retrievalSufficient: result.retrievalSufficient,
        retrievalReason: result.retrievalReason,
        obsidianPaths: result.obsidianPaths,
      };
    }

    const obsidianContext = await this.karpathyRagService
      .getObsidianContext(query)
      .catch(() => ({ hits: [], context: '' }));
    if (obsidianContext.context) {
      memoryMessages = [
        ...memoryMessages,
        {
          role: 'system',
          content: `Obsidian 长期知识优先上下文：\n${obsidianContext.context}`,
        },
      ];
      onEvent?.({
        type: 'meta',
        data: {
          obsidianPaths: obsidianContext.hits.map((hit) => hit.path),
        },
      });
    }

    if (!fastPathGate) {
      fastPathGate = await this.karpathyRagService.assessFastPath(
        query,
        userId,
        retrieveOptions,
      );
    }
    // 通过 LangGraph StateGraph 执行 agentic 流程
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const finalState = (await this.app.invoke(
      {
        query,
        route: 'agentic',
        augmentedQueries: [],
        subQuestions: [],
        retrievedChunks: [],
        retrievalSufficient: false,
        retrievalReason: '',
        webSearchAttempted: false,
        webSearchCount: 0,
        answer: '',
        confidence: 0,
        retryCount: 0,
        passed: false,
        humanApproval: null,
        interruptReason: '',
        artifacts: [],
      },
      {
        configurable: {
          thread_id: threadId,
          onEvent,
          history,
          userId,
          memoryMessages,
          enableInterrupt,
          retrieveOptions,
          runtimeRunId: retrieveOptions.runtimeRunId,
          fastPathChunks: fastPathGate.chunks,
          subQuestionLimit:
            mode === 'auto'
              ? Math.min(this.maxSubQuestions, 2)
              : this.maxSubQuestions,
        },
      },
    )) as AgenticRagStateType;

    // 原生 interrupt 不以业务字段伪造暂停状态；从保存的图任务读取中断标记。
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const graphSnapshot = await this.app.getState({
      configurable: { thread_id: threadId },
    });
    const interrupted = Array.isArray(graphSnapshot?.tasks) && graphSnapshot.tasks.some(
      (task: { interrupts?: unknown[] }) => Array.isArray(task.interrupts) && task.interrupts.length > 0,
    );
    if (interrupted) {
      return {
        answer: finalState.answer,
        references: finalState.retrievedChunks,
        route: 'agentic' as const,
        confidence: 0,
        retryCount: 0,
        retrievalSufficient: finalState.retrievalSufficient,
        retrievalReason: finalState.retrievalReason,
        obsidianPaths: obsidianContext.hits.map((hit) => hit.path),
        interrupted: true,
      };
    }

    const result = {
      answer: finalState.answer,
      references: finalState.retrievedChunks,
      route: 'agentic' as const,
      confidence: finalState.confidence,
      retryCount: finalState.retryCount,
      retrievalSufficient: finalState.retrievalSufficient,
      retrievalReason: finalState.retrievalReason,
      obsidianPaths: obsidianContext.hits.map((hit) => hit.path),
    };
    await this.persistStructuredArtifacts(threadId, userId, finalState.artifacts);
    onEvent?.({ type: 'final', data: result });
    return result;
  }

  private async persistStructuredArtifacts(
    threadId: string,
    userId: string | undefined,
    artifacts: AgenticArtifact[],
  ): Promise<void> {
    if (!this.structuredArtifactRepository || artifacts.length === 0) return;
    const rows = artifacts
      .filter((artifact) => artifact.type !== 'subquestion_plan' || artifact.payload)
      .map((artifact) => {
        const payload = this.recordOf(artifact.payload);
        const sourceDocIds = Array.isArray(payload.sourceDocIds)
          ? payload.sourceDocIds.filter((item): item is string => typeof item === 'string')
          : [];
        return this.structuredArtifactRepository!.create({
          id: `${threadId}:${artifact.type}:${artifact.id}`.slice(0, 128),
          threadId,
          userId: userId ?? null,
          artifactId: artifact.id,
          type: artifact.type,
          producer: artifact.producer,
          version: artifact.version,
          status:
            typeof payload.status === 'string'
              ? payload.status
              : 'ready_for_review',
          payload: JSON.stringify(artifact.payload),
          sourceDocIds: sourceDocIds.length > 0 ? JSON.stringify(sourceDocIds) : null,
        });
      });
    if (rows.length > 0) {
      await this.structuredArtifactRepository.save(rows);
      if (this.artifactDependencyRepository) {
        const byType = new Map(rows.map((row) => [row.type, row.artifactId]));
        const dependencyTypes: Record<string, string[]> = {
          assumption_register: ['requirement_brief'],
          claim_evidence_matrix: ['requirement_brief'],
          solution_brief: ['requirement_brief', 'assumption_register', 'claim_evidence_matrix'],
          api_contract: ['solution_brief'],
          event_tracking_plan: ['solution_brief'],
          test_plan: ['api_contract', 'event_tracking_plan', 'solution_brief'],
          acceptance_checklist: ['test_plan', 'risk_register'],
          risk_register: ['solution_brief'],
          rollout_plan: ['acceptance_checklist', 'risk_register'],
          code_context_pack: ['solution_brief', 'api_contract', 'event_tracking_plan', 'test_plan'],
        };
        const links = rows.flatMap((row) => (dependencyTypes[row.type] ?? []).flatMap((type) => {
          const dependsOnArtifactId = byType.get(type);
          return dependsOnArtifactId ? [{ id: randomUUID(), threadId, artifactId: row.artifactId, dependsOnArtifactId, relation: 'input' }] : [];
        }));
        if (links.length > 0) await this.artifactDependencyRepository.save(links);
      }
    }
  }

  private observedNode(
    name: string,
    handler: (
      state: AgenticRagStateType,
      config?: RunnableConfig,
    ) => Promise<Partial<AgenticRagStateType>>,
  ) {
    return async (state: AgenticRagStateType, config?: RunnableConfig) => {
      const startedAt = Date.now();
      const startedAtDate = new Date();
      const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
      try {
        const result = await handler(state, config);
        const durationMs = Date.now() - startedAt;
        this.metricsService.observeAgentNode(
          name,
          'success',
          durationMs / 1000,
        );
        this.recordAgentNodeTrace(
          config,
          name,
          'success',
          durationMs,
          startedAtDate,
        );
        onEvent?.({
          type: 'node_timing',
          data: { node: name, status: 'success', durationMs },
        });
        return result;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        this.metricsService.observeAgentNode(name, 'error', durationMs / 1000);
        this.recordAgentNodeTrace(
          config,
          name,
          'error',
          durationMs,
          startedAtDate,
        );
        onEvent?.({
          type: 'node_timing',
          data: {
            node: name,
            status: 'error',
            durationMs,
            error: (error as Error).message,
          },
        });
        throw error;
      }
    };
  }

  private recordAgentNodeTrace(
    config: RunnableConfig | undefined,
    node: string,
    status: 'success' | 'error',
    durationMs: number,
    startedAt: Date,
  ): void {
    const threadId = config?.configurable?.thread_id as unknown;
    if (typeof threadId !== 'string' || !threadId) return;

    const trace = this.tracingService.recordAgentNode({
      threadId,
      node,
      status,
      durationMs,
      startedAt,
    });
    if (trace.alert === 'span_limit') {
      this.metricsService.observeAgentLoopDecision('span_limit_warning');
    }
  }

  private withAnswerArtifact(
    state: AgenticRagStateType,
    answer: string,
    citationSupported: boolean,
    subQuestionCoverage: number,
    reason: string,
  ): AgenticArtifact[] {
    const payload: AnswerContractArtifactPayload = {
      answer,
      citationSupported,
      subQuestionCoverage,
      valid: citationSupported && subQuestionCoverage >= 1,
      reason,
    };
    const artifact = createAgenticArtifact(
      'answer_contract',
      'generate',
      payload,
    );
    const artifacts = [
      ...(state.artifacts ?? []).filter(
        (item) =>
          item.type !== 'answer_contract' &&
          ![
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
          ].includes(item.type),
      ),
      artifact,
    ];
    return [
      ...artifacts,
      ...buildStructuredDeliveryArtifacts(
        state.query,
        state.retrievedChunks,
        answer,
        state.retrievalSufficient,
      ),
    ];
  }

  private getSubQuestionCoverage(state: AgenticRagStateType): number {
    if (!state.subQuestions?.length) return 1;
    const covered = state.subQuestions.filter((item) => item.sufficient).length;
    return covered / state.subQuestions.length;
  }

  private isAgenticRoute(value: unknown): value is 'simple' | 'agentic' {
    return value === 'simple' || value === 'agentic';
  }

  private isSubQuestions(value: unknown): value is AgenticSubQuestion[] {
    return Array.isArray(value);
  }

  private isArtifacts(value: unknown): value is AgenticArtifact[] {
    return Array.isArray(value);
  }

  private recordOf(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  }

  /**
   * auto 模式下用 LLM 判断问题复杂度
   */
  private classifyRoute(
    query: string,
    mode: 'simple' | 'agentic' | 'auto',
  ): 'simple' | 'agentic' {
    if (mode === 'simple') return 'simple';
    if (mode === 'agentic') return 'agentic';
    return this.shouldUseAgentic(query) ? 'agentic' : 'simple';
  }

  /** Auto 先看 Hybrid 证据，再将多步骤／分析类请求升级为 Agentic。 */
  private resolveAutoRoute(
    query: string,
    fastPathSufficient: boolean,
  ): 'simple' | 'agentic' {
    if (!fastPathSufficient) return 'agentic';
    return this.shouldUseAgentic(query) ? 'agentic' : 'simple';
  }

  private shouldUseAgentic(query: string): boolean {
    const normalized = query.normalize('NFKC').toLowerCase();
    const complexPatterns = [
      /对比|比较|区别|差异|优缺点/,
      /为什么|原因|影响|风险|评估|分析/,
      /多跳|关联|关系|上下游|依赖|链路/,
      /分别.*(什么|哪些|如何)|哪些.*分别/,
      /规划|步骤|方案|策略|拆解/,
      /联网|最新|实时|新闻|今天|当前/,
      /compare|difference|trade[- ]?off|analy[sz]e|why|plan|strategy|latest|current/,
    ];
    return complexPatterns.some((pattern) => pattern.test(normalized));
  }

  /**
   * 规范化扩展查询：确保恰好 3 条，不足用原问题补齐
   */
  private normalizeQueries(original: string, list: unknown): string[] {
    const out = (Array.isArray(list) ? list : [])
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean);
    while (out.length < this.maxAugmentedQueries) out.push(original);
    return out.slice(0, this.maxAugmentedQueries);
  }

  private buildSubQuestions(
    original: string,
    queries: string[],
    limit = this.maxSubQuestions,
  ): AgenticSubQuestion[] {
    // 「某某是什么／是谁」这类原子事实问句无需被扩成多个验收项；否则联网已找到原问题证据，
    // 仍可能因一个额外的延伸问题未覆盖而整体拒答。
    const questions = this.isAtomicFactQuestion(original)
      ? [original]
      : [
          original,
          ...this.normalizeQueries(original, queries).filter(
            (query) => query !== original,
          ),
        ];
    return questions.slice(0, limit).map((question, index) => ({
      id: `subq-${index + 1}`,
      question,
      // 当前规划器生成互补问题；保留依赖字段，支持后续有向多跳计划。
      dependsOn: index === 0 ? [] : ['subq-1'],
      status: 'planned',
      evidenceIds: [],
      retrievalAttempts: 0,
      sufficient: false,
      reason: '',
    }));
  }

  private isAtomicFactQuestion(query: string): boolean {
    const normalized = query.trim();
    const isBareEntity =
      normalized.length >= 2 &&
      normalized.length <= 16 &&
      !/[，。！？；：、,.!?]/.test(normalized) &&
      !/(对比|比较|区别|差异|为什么|原因|影响|风险|评估|分析|关联|关系|上下游|依赖|链路|方案|步骤|规划)/.test(
        normalized,
      );
    return (
      isBareEntity ||
      (normalized.length <= 24 &&
        /(?:是什么|是谁|指什么|在哪里|什么时候)$/.test(normalized))
    );
  }

  private getSubQuestionLimit(config?: RunnableConfig): number {
    const configurable = config?.configurable as unknown as
      | Record<string, unknown>
      | undefined;
    const configured = configurable?.subQuestionLimit;
    if (typeof configured === 'number' && Number.isFinite(configured)) {
      return Math.min(
        this.maxSubQuestions,
        Math.max(1, Math.trunc(configured)),
      );
    }
    return this.maxSubQuestions;
  }

  private async retrieveGraphEvidence(
    query: string,
    userId?: string,
    config?: RunnableConfig,
  ): Promise<RetrievedChunk[]> {
    if (
      !this.graphSearchEnabled ||
      !this.graphService?.isEnabled() ||
      !this.toolPolicy.decide('graph_search_tool', this.pluginPolicy(config, 'agentic')).allowed ||
      !userId ||
      !/[关系关联上下游依赖多跳分别]/.test(query)
    ) {
      return [];
    }
    try {
      const result = await this.executeAgenticTool(
        'graph_search_tool',
        this.threadIdFromConfig(config),
        userId,
        { query },
        () => this.withTimeout(this.graphService!.queryGraph(query, userId), 4_000, 'GraphRAG sub-question search'),
        config,
      );
      return result.facts.map((fact, index) => ({
        id: `graph:${fact.sourceId}:${fact.source}:${fact.target}:${index}`,
        content: `${fact.sourceLabel}（${fact.source}）—${fact.relationship}→${fact.targetLabel}（${fact.target}）\n来源：${fact.sourceId}`,
        docId: fact.sourceId,
        chunkIndex: index,
        bm25Score: 0,
        cosineScore: 0,
        totalScore: Math.max(0.1, fact.confidence * 0.2),
        retrievalSource: 'expansion',
        contextRole: 'hit',
      }));
    } catch (err) {
      this.logger.warn(
        `GraphRAG sub-question search skipped: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private intConfig(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const value = this.configService.get<number>(key) ?? fallback;
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(value)));
  }

  private async executeAgenticTool<T>(
    toolName: string,
    threadId: string,
    ownerUserId: string | undefined,
    input: unknown,
    execute: () => Promise<T>,
    config?: RunnableConfig,
  ): Promise<T> {
    if (!this.toolExecution || !threadId) return execute();
    const result = await this.toolExecution.execute({
      toolName,
      threadId,
      ownerUserId,
      actor: 'agentic_rag',
      ...this.pluginPolicy(config, 'agentic'),
      input,
      execute,
    });
    if (!result.output) throw new Error(result.error ?? `${toolName} 被阻断或未返回结果`);
    return result.output;
  }

  private pluginPolicy(config: RunnableConfig | undefined, mode: 'simple' | 'auto' | 'agentic' | 'production') {
    const retrieveOptions = config?.configurable?.retrieveOptions as RetrieveOptions | undefined;
    return {
      mode,
      pluginKeys: retrieveOptions?.pluginKeys,
      allowedToolNames: retrieveOptions?.pluginTools,
    };
  }

  private threadIdFromConfig(config?: RunnableConfig): string {
    const value = config?.configurable?.thread_id;
    return typeof value === 'string' ? value : '';
  }

  private userIdFromConfig(config?: RunnableConfig): string | undefined {
    const value = config?.configurable?.userId;
    return typeof value === 'string' && value ? value : undefined;
  }

  private runIdFromConfig(config?: RunnableConfig): string | undefined {
    const retrieveOptions = config?.configurable?.retrieveOptions as RetrieveOptions | undefined;
    return retrieveOptions?.runtimeRunId;
  }

  private numberConfig(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const value = this.configService.get<number>(key) ?? fallback;
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timeout after ${ms}ms`)),
        ms,
      );
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 使用 deepagents 做 agentic 检索规划。
   */
  private async planQueriesWithDeepAgent(query: string): Promise<string[]> {
    try {
      const agent = await this.withTimeout(
        this.getDeepAgent(),
        3_000,
        'DeepAgent initialization',
      );
      const formatted = await deepAgentQueryPlanUserPrompt.format({ query });
      const result = await this.withTimeout(
        agent.invoke({
          messages: [
            {
              role: 'user',
              content: formatted,
            },
          ],
        }),
        8_000,
        'DeepAgent query planning',
      );

      return this.extractQueriesFromDeepAgentResult(result);
    } catch (err) {
      this.logger.warn(
        `DeepAgent query planning failed, fallback to structured output: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private async getDeepAgent(): Promise<{
    invoke: (input: unknown) => Promise<unknown>;
  }> {
    const modelName = this.llmProvider.getActiveProviderName();
    const cached = this.deepAgents.get(modelName);
    if (cached) {
      return cached;
    }

    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport = new Function(
      'specifier',
      'return import(specifier)',
    ) as (specifier: string) => Promise<{
      createDeepAgent: (params: {
        model: ReturnType<LlmProvider['getModel']>;
        systemPrompt: string;
      }) => { invoke: (input: unknown) => Promise<unknown> };
    }>;
    const { createDeepAgent } = await dynamicImport('deepagents');

    const deepAgent = createDeepAgent({
      model: this.llmProvider.getModel(),
      systemPrompt: deepAgentQueryPlanSystemPrompt,
    });

    this.deepAgents.set(modelName, deepAgent);
    return deepAgent;
  }

  private extractQueriesFromDeepAgentResult(result: unknown): string[] {
    const content = this.extractLastMessageText(result);
    const jsonText = content.match(/\{[\s\S]*\}/)?.[0] ?? content;
    const parsed = JSON.parse(jsonText) as { queries?: unknown };
    return Array.isArray(parsed.queries)
      ? parsed.queries.filter(
          (item): item is string => typeof item === 'string',
        )
      : [];
  }

  private extractLastMessageText(result: unknown): string {
    const maybeMessages = (result as { messages?: unknown }).messages;
    if (!Array.isArray(maybeMessages) || maybeMessages.length === 0) {
      return '';
    }
    const last = maybeMessages[maybeMessages.length - 1] as {
      content?: unknown;
    };
    if (typeof last.content === 'string') {
      return last.content;
    }
    if (Array.isArray(last.content)) {
      return last.content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object' && 'text' in part) {
            const text = (part as Record<'text', unknown>).text;
            if (typeof text === 'string') {
              return text;
            }
          }
          return '';
        })
        .join('');
    }
    return '';
  }
}
