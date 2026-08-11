import { Injectable, Logger, Optional } from '@nestjs/common';
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
import { BadCaseFlywheelService } from '../prompts/bad-case-flywheel.service';
import { BochaSearchService } from '../../tools/bocha-search.service';
import { DashScopeRerankService } from '../../tools/dashscope-rerank.service';
import { StateGraph, START, END } from '@langchain/langgraph';
import { RunnableConfig } from '@langchain/core/runnables';
import { ConfigService } from '@nestjs/config';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { RedisCheckpointer } from '../../providers/langgraph-checkpointer/redis-checkpointer';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { TracingService } from '../../modules/tracing/tracing.service';
import { GraphService } from '../../modules/graph/graph.service';

/**
 * Agentic RAG 服务
 *
 * 工作流 (LangGraph)：START → queryAugment → retrieval → sufficiency → (rerank | webSearchFallback → rerank) → generate → reflection → (retrieval | END)
 */
@Injectable()
export class AgenticRagService {
  private readonly logger = new Logger(AgenticRagService.name);
  private readonly deepAgents = new Map<
    string,
    { invoke: (input: unknown) => Promise<unknown> }
  >();
  private app: any;

  private readonly confidenceThreshold: number;
  private readonly maxRetries: number;
  private readonly maxAugmentedQueries: number;
  private readonly maxRetrievalQueries: number;
  private readonly maxSubQuestions: number;
  private readonly maxRetrievedChunks: number;
  private readonly maxWebSearchResults: number;
  private readonly maxRerankTopN: number;
  private readonly maxAutoQueryLength: number;
  private readonly webSearchFallbackEnabled: boolean;
  private readonly rerankEnabled: boolean;
  private readonly graphSearchEnabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly llmProvider: LlmProvider,
    private readonly karpathyRagService: KarpathyRagService,
    private readonly bochaSearchService: BochaSearchService,
    private readonly dashScopeRerankService: DashScopeRerankService,
    private readonly semanticExampleSelector: SemanticExampleSelector,
    private readonly badCaseFlywheel: BadCaseFlywheelService,
    private readonly metricsService: MetricsService,
    private readonly tracingService: TracingService,
    private readonly redisProvider: RedisProvider,
    @Optional() private readonly graphService?: GraphService,
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
    this.maxAutoQueryLength = this.intConfig(
      'agentic.maxAutoQueryLength',
      500,
      80,
      4000,
    );
    this.webSearchFallbackEnabled =
      this.configService.get<boolean>('agentic.webSearchFallbackEnabled') ??
      true;
    this.rerankEnabled =
      this.configService.get<boolean>('agentic.rerankEnabled') ?? true;
    this.graphSearchEnabled =
      this.configService.get<boolean>('agentic.graphSearchEnabled') ?? true;
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
      checkpointer: new RedisCheckpointer(this.redisProvider),
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
    return { augmentedQueries: queries, subQuestions };
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
          const graphChunks = await this.retrieveGraphEvidence(q, userId);
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
    if (chunks.length === 0) {
      this.metricsService.observeAgentEmptyRetrieval(state.route || 'agentic');
    }
    return {
      retrievedChunks: chunks,
      subQuestions: [...updatedSubQuestions, ...remainingSubQuestions],
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
      const topScore = Math.max(
        ...state.retrievedChunks.map((chunk) => chunk.totalScore),
        0,
      );
      const sufficient = topScore >= 0.2;
      const reason = `充分性 LLM 评估失败，按 topScore=${topScore.toFixed(2)} 启发式判断`;
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
      !this.bochaSearchService.isEnabled()
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
      const searchResults = await Promise.all(
        searchQuestions.map(async (item) => ({
          question: item.question,
          results:
            this.maxWebSearchResults > 0
              ? await this.bochaSearchService.search(
                  item.question,
                  this.maxWebSearchResults,
                )
              : [],
        })),
      );
      const webIdsByQuestion = new Map<string, string[]>();
      const webChunks = searchResults.flatMap(({ results }) =>
        results.map((result, index) => {
          const parts = [
            `标题：${result.title}`,
            `来源：${result.siteName ?? result.url}`,
            result.datePublished ? `发布时间：${result.datePublished}` : '',
            result.summary ? `摘要：${result.summary}` : '',
            result.snippet ? `片段：${result.snippet}` : '',
            `URL：${result.url}`,
          ].filter(Boolean);

          return {
            id: `web:${result.url}`,
            content: parts.join('\n'),
            docId: result.url,
            chunkIndex: index,
            bm25Score: 0,
            cosineScore: 0,
            totalScore: 0.15,
          } satisfies RetrievedChunk;
        }),
      );
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
        retrievedChunks: [...state.retrievedChunks, ...webChunks].slice(
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

    if (!this.rerankEnabled || !this.dashScopeRerankService.isEnabled()) {
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
      const chunks = await this.dashScopeRerankService.rerank(
        state.query,
        state.retrievedChunks,
        this.maxRerankTopN,
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
    const badCaseMatches = await this.withTimeout(
      this.badCaseFlywheel.retrieveMatches(state.query, 2),
      2_000,
      'Bad case selection',
    ).catch(() => []);
    const badCasePrompt = badCaseMatches.length
      ? this.badCaseFlywheel.formatPrompt(badCaseMatches)
      : '';
    const generationMemory = badCasePrompt
      ? [...memoryMessages, { role: 'system', content: badCasePrompt }]
      : memoryMessages;
    const strongBadCase = badCaseMatches.find(
      (match) => match.mode === 'exact' || match.mode === 'correction',
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
      );
      onEvent?.({ type: 'citation', data: state.retrievedChunks });
      return {
        answer,
        retrievalSufficient: true,
        retrievalReason: `命中已审核 Bad Case 纠错证据（${strongBadCase.mode}，${strongBadCase.score.toFixed(3)}）`,
      };
    }

    if (state.retrievedChunks.length === 0 || !state.retrievalSufficient) {
      const reason =
        state.retrievedChunks.length === 0
          ? '没有检索到任何可用片段'
          : state.retrievalReason || '检索不足';
      const ans = await this.karpathyRagService.generateModelFallbackAnswer(
        state.query,
        reason,
        history,
        generationMemory,
        (token) => onEvent?.({ type: 'token', data: token }),
      );
      onEvent?.({ type: 'citation', data: [] });
      return {
        answer: ans,
        retrievedChunks: [],
        retrievalSufficient: false,
        retrievalReason: `${reason}；已使用模型兜底回答`,
      };
    }

    const context = state.retrievedChunks
      .map((c, i) => `[片段 ${i + 1}]\n${sanitizeUntrustedContext(c.content)}`)
      .join('\n\n---\n\n');

    const model = this.llmProvider.getModel();
    const messages = await generateAnswerPrompt.formatMessages({
      context,
      query: state.query,
      history,
      memory: generationMemory,
    });
    const stream = await model.stream(messages);
    let answer = '';
    for await (const chunk of stream) {
      const token =
        typeof chunk.content === 'string'
          ? chunk.content
          : JSON.stringify(chunk.content);
      if (!token) continue;
      answer += token;
      onEvent?.({ type: 'token', data: token });
    }
    answer = this.karpathyRagService.addVersionConflictNotice(
      answer,
      state.retrievedChunks,
    );

    const citationGate = this.karpathyRagService.validateAnswerCitationSupport(
      answer,
      state.retrievedChunks,
    );
    if (!citationGate.sufficient) {
      if (citationGate.reason === '答案缺少显式片段引用') {
        const fallbackAnswer = this.karpathyRagService.buildExtractiveAnswer(
          state.query,
          state.retrievedChunks,
        );
        if (fallbackAnswer) {
          const fallbackGate =
            this.karpathyRagService.validateAnswerCitationSupport(
              fallbackAnswer,
              state.retrievedChunks,
            );
          if (fallbackGate.sufficient) {
            onEvent?.({ type: 'token', data: fallbackAnswer });
            onEvent?.({ type: 'citation', data: state.retrievedChunks });
            return {
              answer: fallbackAnswer,
              retrievalSufficient: true,
              retrievalReason: 'LLM 答案引用不足，已回退为片段抽取式回答',
            };
          }
        }
      }

      const safeAnswer = this.karpathyRagService.unsupportedReliableAnswer();
      onEvent?.({ type: 'token', data: safeAnswer });
      onEvent?.({ type: 'citation', data: [] });
      return {
        answer: safeAnswer,
        retrievedChunks: [],
        retrievalSufficient: false,
        retrievalReason: citationGate.reason,
        passed: true,
      };
    }

    onEvent?.({ type: 'citation', data: state.retrievedChunks });
    return { answer };
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
          confidence: 1,
          passed: true,
          retryCount: state.retryCount,
          reason: '检索不足时已使用模型兜底，不再按引用支撑标准重试',
        },
      });
      return { confidence: 1, passed: true, retryCount: state.retryCount };
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

    // 如果已经有审批结果（从 resume 恢复），直接返回
    if (
      state.humanApproval === 'approved' ||
      state.humanApproval === 'rejected'
    ) {
      this.logger.log(`Human approval already set: ${state.humanApproval}`);
      onEvent?.({
        type: 'resume',
        data: {
          approval: state.humanApproval,
          answer: state.answer,
        },
      });
      return {};
    }

    // 不启用中断时直接跳过
    if (!enableInterrupt) {
      return { humanApproval: 'approved' };
    }

    // 触发中断：推送 interrupt 事件让前端展示审批 UI
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

    return {
      humanApproval: 'pending',
      interruptReason: reason,
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

    // 用审批结果更新状态并继续执行
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const finalState = (await this.app.invoke(
      {
        humanApproval: approval,
        interruptReason: feedback ?? '',
      },
      {
        configurable: {
          thread_id: threadId,
          onEvent,
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
          ? fastPathGate?.sufficient
            ? 'simple'
            : 'agentic'
          : this.classifyRoute(query, mode);
    observedRoute = route;
    onEvent?.({ type: 'routing', data: { mode, route } });
    if (fastPathGate) {
      onEvent?.({
        type: 'sufficiency',
        data: {
          sufficient: fastPathGate.sufficient,
          reason: fastPathGate.reason,
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
        retrieveOptions,
      );
      onEvent?.({ type: 'citation', data: result.references });
      onEvent?.({ type: 'final', data: result });
      return {
        answer: result.answer,
        references: result.references,
        route: 'simple',
        confidence: 1,
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
    const approvedCorrection = await this.tryApprovedBadCaseCorrection(
      query,
      onEvent,
      history,
      memoryMessages,
      fastPathGate.sufficient,
    );
    if (approvedCorrection) {
      return approvedCorrection;
    }

    if (!this.karpathyRagService.hasIndexedChunks(userId)) {
      const reason = '当前用户没有已索引的知识库片段';
      const answer = await this.karpathyRagService.generateModelFallbackAnswer(
        query,
        reason,
        history,
        memoryMessages,
        (token) => onEvent?.({ type: 'token', data: token }),
      );
      const result = {
        answer,
        references: [],
        route: 'agentic' as const,
        confidence: 1,
        retryCount: 0,
        retrievalSufficient: false,
        retrievalReason: `${reason}；已使用模型兜底回答`,
        obsidianPaths: obsidianContext.hits.map((hit) => hit.path),
      };
      onEvent?.({ type: 'retrieval', data: [] });
      onEvent?.({
        type: 'sufficiency',
        data: {
          sufficient: false,
          reason: result.retrievalReason,
        },
      });
      onEvent?.({ type: 'citation', data: [] });
      onEvent?.({ type: 'final', data: result });
      return result;
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
          fastPathChunks: fastPathGate.chunks,
          subQuestionLimit:
            mode === 'auto'
              ? Math.min(this.maxSubQuestions, 2)
              : this.maxSubQuestions,
        },
      },
    )) as AgenticRagStateType;

    // 如果人工审批处于 pending 状态，返回中间结果（前端需调用 resume）
    if (finalState.humanApproval === 'pending') {
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
    onEvent?.({ type: 'final', data: result });
    return result;
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

  private recordOf(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  }

  private async tryApprovedBadCaseCorrection(
    query: string,
    onEvent: SseCallback | undefined,
    history: Array<{ role: 'human' | 'ai'; content: string }>,
    memoryMessages: Array<{ role: string; content: string }>,
    currentEvidenceSufficient: boolean,
  ): Promise<{
    answer: string;
    references: RetrievedChunk[];
    route: 'agentic';
    confidence: number;
    retryCount: number;
    retrievalSufficient: boolean;
    retrievalReason: string;
  } | null> {
    if (currentEvidenceSufficient) return null;
    const matches = await this.withTimeout(
      this.badCaseFlywheel.retrieveMatches(query, 2),
      2_000,
      'Bad case preflight selection',
    ).catch(() => []);
    const match = matches.find(
      (item) => item.mode === 'exact' || item.mode === 'correction',
    );
    if (!match) return null;
    const correction = this.karpathyRagService.extractCorrectedAnswer(
      match.text,
    );
    if (!correction) return null;
    const answer = await this.karpathyRagService.generateCorrectionAnswer(
      query,
      correction,
      history,
      memoryMessages,
      (token) => onEvent?.({ type: 'token', data: token }),
    );
    const retrievalReason = `命中已审核 Bad Case 纠错证据（${match.mode}，${match.score.toFixed(3)}）`;
    const result = {
      answer,
      references: [],
      route: 'agentic' as const,
      confidence: 1,
      retryCount: 0,
      retrievalSufficient: true,
      retrievalReason,
    };
    onEvent?.({ type: 'retrieval', data: [] });
    onEvent?.({
      type: 'sufficiency',
      data: { sufficient: true, reason: retrievalReason },
    });
    onEvent?.({ type: 'citation', data: [] });
    onEvent?.({ type: 'final', data: result });
    return result;
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
    if (query.length > this.maxAutoQueryLength) return 'simple';
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
    const normalized = [
      original,
      ...this.normalizeQueries(original, queries).filter(
        (query) => query !== original,
      ),
    ];
    return normalized.slice(0, limit).map((question, index) => ({
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
  ): Promise<RetrievedChunk[]> {
    if (
      !this.graphSearchEnabled ||
      !this.graphService?.isEnabled() ||
      !userId ||
      !/[关系关联上下游依赖多跳分别]/.test(query)
    ) {
      return [];
    }
    try {
      const result = await this.withTimeout(
        this.graphService.queryGraph(query, userId),
        4_000,
        'GraphRAG sub-question search',
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
