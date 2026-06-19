import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmProvider } from '../../providers/llm/llm.provider';
import {
  KarpathyRagService,
  RetrievedChunk,
} from '../karpathy/karpathy-rag.service';
import { SseCallback } from './sse-event';
import { AgenticRagState, type AgenticRagStateType } from './agentic-rag.state';
import { generateAnswerPrompt } from '../prompts/rag.prompts';
import {
  classifyComplexityPrompt,
  queryAugmentPrompt,
  reflectionPrompt,
  sufficiencyPrompt,
  deepAgentQueryPlanSystemPrompt,
  deepAgentQueryPlanUserPrompt,
} from '../prompts/agentic.prompts';
import { queryAugmentFewShotPrompt } from '../prompts/few-shot.examples';
import { SemanticExampleSelector } from '../prompts/semantic-example.selector';
import { BochaSearchService } from '../../tools/bocha-search.service';
import { DashScopeRerankService } from '../../tools/dashscope-rerank.service';
import { StateGraph, START, END } from '@langchain/langgraph';
import { RunnableConfig } from '@langchain/core/runnables';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { RedisCheckpointer } from '../../providers/langgraph-checkpointer/redis-checkpointer';

/**
 * Agentic RAG 服务
 *
 * 工作流 (LangGraph)：START → queryAugment → retrieval → sufficiency → (rerank | webSearchFallback → rerank) → generate → reflection → (retrieval | END)
 */
@Injectable()
export class AgenticRagService {
  private readonly logger = new Logger(AgenticRagService.name);
  private deepAgent: { invoke: (input: unknown) => Promise<unknown> } | null =
    null;
  private app: any;

  /** Reflection 阈值，低于此值触发重试 */
  private readonly confidenceThreshold = 0.7;
  /** 最大重试次数 */
  private readonly maxRetries = 2;

  constructor(
    private readonly llmProvider: LlmProvider,
    private readonly karpathyRagService: KarpathyRagService,
    private readonly bochaSearchService: BochaSearchService,
    private readonly dashScopeRerankService: DashScopeRerankService,
    private readonly semanticExampleSelector: SemanticExampleSelector,
    private readonly redisProvider: RedisProvider,
  ) {
    this.initGraph();
  }

  /**
   * 初始化 LangGraph 状态图
   */
  private initGraph() {
    const workflow = new StateGraph(AgenticRagState)
      .addNode('queryAugment', this.queryAugmentNode.bind(this))
      .addNode('retrieval', this.retrievalNode.bind(this))
      .addNode('sufficiency', this.sufficiencyNode.bind(this))
      .addNode('webSearchFallback', this.webSearchFallbackNode.bind(this))
      .addNode('rerank', this.rerankNode.bind(this))
      .addNode('generate', this.generateNode.bind(this))
      .addNode('reflection', this.reflectionNode.bind(this));

    workflow.addEdge(START, 'queryAugment');
    workflow.addEdge('queryAugment', 'retrieval');
    workflow.addEdge('retrieval', 'sufficiency');

    workflow.addConditionalEdges(
      'sufficiency',
      (state) => {
        return state.retrievalSufficient ? 'rerank' : 'webSearchFallback';
      },
      {
        rerank: 'rerank',
        webSearchFallback: 'webSearchFallback',
      },
    );

    workflow.addEdge('webSearchFallback', 'rerank');
    workflow.addEdge('rerank', 'generate');
    workflow.addEdge('generate', 'reflection');

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
   * auto 模式下由 LLM 判断问题复杂度
   */
  async routeNode(
    state: AgenticRagStateType,
    mode: 'simple' | 'agentic' | 'auto',
  ): Promise<Partial<AgenticRagStateType>> {
    let route: 'simple' | 'agentic';

    if (mode === 'auto') {
      route = await this.classifyQueryComplexity(state.query);
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
          .length(3)
          .describe(
            '恰好 3 条中文检索问句：不同角度改写或扩写；保留专有名词、订单号等字面信息',
          ),
      });

      try {
        const structured = model.withStructuredOutput(schema);
        const chain = queryAugmentPrompt.pipe(structured);

        // 优先使用语义示例选择器（从 Milvus 检索相关示例）
        let fewShotBlock = await this.semanticExampleSelector.selectAndFormat(
          state.query,
          2,
          'query_augment',
        );

        // 若语义选择器返回空（Milvus 未就绪），回退到静态 few-shot
        if (!fewShotBlock) {
          fewShotBlock = await queryAugmentFewShotPrompt.format({});
        }

        const raw = await chain.invoke({
          query: state.query,
          few_shot_block: fewShotBlock,
        });
        queries = this.normalizeQueries(state.query, raw.queries);
        this.logger.log(`Augmented queries: ${JSON.stringify(queries)}`);
      } catch (err) {
        this.logger.warn(
          `Query augment failed, fallback to original: ${(err as Error).message}`,
        );
        queries = [state.query];
      }
    }

    onEvent?.({ type: 'query_augment', data: queries });
    return { augmentedQueries: queries };
  }

  /**
   * 检索节点：原始问题做一次混合检索，扩展问题走 BM25 检索，合并去重。
   */
  async retrievalNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    const userId = config?.configurable?.userId as string | undefined;
    const queries =
      state.augmentedQueries.length > 0
        ? [state.query, ...state.augmentedQueries]
        : [state.query];

    this.logger.log(
      `Retrieving with ${queries.length} queries (1 hybrid + BM25 fallback) for userId=${userId ?? 'none'}`,
    );

    const allResults: RetrievedChunk[][] = [];
    for (const [index, q] of queries.entries()) {
      try {
        const results =
          index === 0
            ? await this.karpathyRagService.retrieve(q, {}, userId)
            : await this.karpathyRagService.retrieveBm25Only(q, userId);
        allResults.push(results);
      } catch (err) {
        this.logger.warn(
          `Retrieve failed for query "${q.slice(0, 30)}": ${(err as Error).message}`,
        );
        allResults.push([]);
      }
    }

    const fusedMap = new Map<string, RetrievedChunk>();
    for (const results of allResults) {
      for (const chunk of results) {
        const existing = fusedMap.get(chunk.id);
        if (!existing || chunk.totalScore > existing.totalScore) {
          fusedMap.set(chunk.id, chunk);
        }
      }
    }

    const chunks = Array.from(fusedMap.values())
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, 5);

    this.logger.log(
      `Retrieved ${chunks.length} unique chunks from ${queries.length} queries`,
    );

    onEvent?.({ type: 'retrieval', data: chunks });
    return { retrievedChunks: chunks, answer: '', passed: false };
  }

  /**
   * 检索充分性评估
   */
  async sufficiencyNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    if (state.retrievedChunks.length === 0) {
      const res = {
        retrievalSufficient: false,
        retrievalReason: '没有检索到任何可用片段',
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

    if (!this.bochaSearchService.isEnabled()) {
      this.logger.warn(
        'Retrieval insufficient but Bocha web_search is disabled',
      );
      const reason = `${state.retrievalReason || '检索不足'}；BOCHA_API_KEY 未配置，已跳过联网兜底`;
      onEvent?.({
        type: 'web_search',
        data: {
          count: 0,
          enabled: false,
          reason,
        },
      });
      return {
        retrievalReason: reason,
        webSearchCount: 0,
      };
    }

    try {
      const results = await this.bochaSearchService.search(state.query, 5);
      const webChunks = results.map((result, index) => {
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
      });

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
        retrievedChunks: [...state.retrievedChunks, ...webChunks].slice(0, 8),
        retrievalReason: reason,
        webSearchCount: webChunks.length,
      };
    } catch (err) {
      const reason = `Bocha web_search 调用失败：${(err as Error).message}`;
      this.logger.warn(reason);
      const fallbackReason = `${state.retrievalReason || '检索不足'}；${reason}`;
      onEvent?.({
        type: 'web_search',
        data: {
          count: 0,
          enabled: this.bochaSearchService.isEnabled(),
          reason: fallbackReason,
        },
      });
      return {
        retrievalReason: fallbackReason,
        webSearchCount: 0,
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
          enabled: this.dashScopeRerankService.isEnabled(),
          reranked: false,
          count: state.retrievedChunks.length,
        },
      });
      return { reranked: false };
    }

    if (!this.dashScopeRerankService.isEnabled()) {
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
        5,
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

    if (state.retrievedChunks.length === 0) {
      const ans = '未找到相关内容，请先上传文档。';
      onEvent?.({ type: 'token', data: ans });
      onEvent?.({ type: 'citation', data: [] });
      return { answer: ans };
    }

    const context = state.retrievedChunks
      .map((c, i) => `[片段 ${i + 1}]\n${c.content}`)
      .join('\n\n---\n\n');

    const model = this.llmProvider.getModel();
    const messages = await generateAnswerPrompt.formatMessages({
      context,
      query: state.query,
      history,
      memory: memoryMessages,
    });
    const stream = await model.stream(messages);
    let answer = '';
    for await (const chunk of stream) {
      const token =
        typeof chunk.content === 'string'
          ? chunk.content
          : JSON.stringify(chunk.content);
      answer += token;
      onEvent?.({ type: 'token', data: token });
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
   * 条件路由：reflection 后决定重试还是结束
   */
  reflectionRouter(state: AgenticRagStateType): 'retry' | 'end' {
    if (state.passed) {
      return 'end';
    }
    if (state.retryCount >= this.maxRetries) {
      this.logger.warn(`Max retries (${this.maxRetries}) reached, ending`);
      return 'end';
    }
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
  ): Promise<{
    answer: string;
    references: RetrievedChunk[];
    route: 'simple' | 'agentic';
    confidence: number;
    retryCount: number;
    retrievalSufficient?: boolean;
    retrievalReason?: string;
  }> {
    const route =
      mode === 'simple' ? 'simple' : await this.classifyRoute(query, mode);
    onEvent?.({ type: 'routing', data: { mode, route } });

    if (route === 'simple') {
      const result = await this.karpathyRagService.answer(
        query,
        history,
        userId,
        memoryMessages,
      );
      onEvent?.({ type: 'citation', data: result.references });
      onEvent?.({ type: 'final', data: result });
      return {
        answer: result.answer,
        references: result.references,
        route: 'simple',
        confidence: 1,
        retryCount: 0,
      };
    }

    // 通过 LangGraph StateGraph 执行 agentic 流程
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const finalState = (await this.app.invoke(
      {
        query,
        route: 'agentic',
        augmentedQueries: [],
        retrievedChunks: [],
        retrievalSufficient: false,
        retrievalReason: '',
        answer: '',
        confidence: 0,
        retryCount: 0,
        passed: false,
      },
      {
        configurable: {
          thread_id: threadId,
          onEvent,
          history,
          userId,
          memoryMessages,
        },
      },
    )) as AgenticRagStateType;

    const result = {
      answer: finalState.answer,
      references: finalState.retrievedChunks,
      route: 'agentic' as const,
      confidence: finalState.confidence,
      retryCount: finalState.retryCount,
      retrievalSufficient: finalState.retrievalSufficient,
      retrievalReason: finalState.retrievalReason,
    };
    onEvent?.({ type: 'final', data: result });
    return result;
  }

  /**
   * auto 模式下用 LLM 判断问题复杂度
   */
  private async classifyRoute(
    query: string,
    mode: 'simple' | 'agentic' | 'auto',
  ): Promise<'simple' | 'agentic'> {
    if (mode === 'simple') return 'simple';
    if (mode === 'agentic') return 'agentic';
    return this.classifyQueryComplexity(query);
  }

  /**
   * 用 LLM 判断问题复杂度
   */
  private async classifyQueryComplexity(
    query: string,
  ): Promise<'simple' | 'agentic'> {
    const model = this.llmProvider.getModel();

    const schema = z.object({
      complexity: z
        .enum(['simple', 'complex'])
        .describe(
          '问题复杂度：simple=单一事实查询，complex=多跳推理/对比/分析',
        ),
    });

    try {
      const structured = model.withStructuredOutput(schema);
      const chain = classifyComplexityPrompt.pipe(structured);
      const result = await chain.invoke({ query });
      return result.complexity === 'complex' ? 'agentic' : 'simple';
    } catch (err) {
      this.logger.warn(
        `Complexity classification failed, fallback to simple: ${(err as Error).message}`,
      );
      return 'simple';
    }
  }

  /**
   * 规范化扩展查询：确保恰好 3 条，不足用原问题补齐
   */
  private normalizeQueries(original: string, list: unknown): string[] {
    const out = (Array.isArray(list) ? list : [])
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean);
    while (out.length < 3) out.push(original);
    return out.slice(0, 3);
  }

  /**
   * 使用 deepagents 做 agentic 检索规划。
   */
  private async planQueriesWithDeepAgent(query: string): Promise<string[]> {
    try {
      const agent = await this.getDeepAgent();
      const formatted = await deepAgentQueryPlanUserPrompt.format({ query });
      const result = await agent.invoke({
        messages: [
          {
            role: 'user',
            content: formatted,
          },
        ],
      });

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
    if (this.deepAgent) {
      return this.deepAgent;
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

    this.deepAgent = createDeepAgent({
      model: this.llmProvider.getModel(),
      systemPrompt: deepAgentQueryPlanSystemPrompt,
    });

    return this.deepAgent;
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
