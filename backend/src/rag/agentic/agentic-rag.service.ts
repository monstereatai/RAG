import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmProvider } from '../../providers/llm/llm.provider';
import {
  KarpathyRagService,
  RetrievedChunk,
} from '../karpathy/karpathy-rag.service';
import { SseCallback } from './sse-event';
import type { AgenticRagStateType } from './agentic-rag.state';
import { generateAnswerPrompt } from '../prompts/rag.prompts';
import {
  classifyComplexityPrompt,
  queryAugmentPrompt,
  reflectionPrompt,
} from '../prompts/agentic.prompts';
import { queryAugmentFewShotPrompt } from '../prompts/few-shot.examples';
import { BochaSearchService } from '../../tools/bocha-search.service';
import { DashScopeRerankService } from '../../tools/dashscope-rerank.service';

/**
 * Agentic RAG 服务
 *
 * 工作流：router → query_augment → retrieval → generate → reflection → (retry|end)
 *
 * M2 验收：
 * - agentic 模式触发 ≥2 轮检索（query_augment 生成多角度问句 + reflection 重试）
 * - auto 模式根据问题复杂度自动选择 simple/agentic
 * - SSE 流式推送 routing/token/retrieval/citation/final 事件
 * - Reflection 低置信度触发重新检索，最多重试 2 次
 */
@Injectable()
export class AgenticRagService {
  private readonly logger = new Logger(AgenticRagService.name);
  private deepAgent: { invoke: (input: unknown) => Promise<unknown> } | null =
    null;

  /** Reflection 阈值，低于此值触发重试 */
  private readonly confidenceThreshold = 0.7;
  /** 最大重试次数 */
  private readonly maxRetries = 2;

  constructor(
    private readonly llmProvider: LlmProvider,
    private readonly karpathyRagService: KarpathyRagService,
    private readonly bochaSearchService: BochaSearchService,
    private readonly dashScopeRerankService: DashScopeRerankService,
  ) {}

  /**
   * 路由节点：判断走 simple 还是 agentic
   * auto 模式下由 LLM 判断问题复杂度
   */
  async routeNode(
    state: AgenticRagStateType,
    mode: 'simple' | 'agentic' | 'auto',
  ): Promise<Partial<AgenticRagStateType>> {
    let route: 'simple' | 'agentic';

    if (mode === 'auto') {
      // 用 LLM 判断问题复杂度
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
  ): Promise<Partial<AgenticRagStateType>> {
    const deepAgentQueries = await this.planQueriesWithDeepAgent(state.query);
    if (deepAgentQueries.length > 0) {
      const queries = this.normalizeQueries(state.query, deepAgentQueries);
      this.logger.log(`DeepAgent planned queries: ${JSON.stringify(queries)}`);
      return { augmentedQueries: queries };
    }

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
      // 预格式化 few-shot 示例块，注入到 system 消息
      const fewShotBlock = await queryAugmentFewShotPrompt.format({});
      const raw = await chain.invoke({
        query: state.query,
        few_shot_block: fewShotBlock,
      });
      const queries = this.normalizeQueries(state.query, raw.queries);
      this.logger.log(`Augmented queries: ${JSON.stringify(queries)}`);
      return { augmentedQueries: queries };
    } catch (err) {
      this.logger.warn(
        `Query augment failed, fallback to original: ${(err as Error).message}`,
      );
      return { augmentedQueries: [state.query] };
    }
  }

  /**
   * 检索节点：原始问题做一次混合检索，扩展问题走 BM25 检索，合并去重。
   * 这样保留多角度召回，同时避免 agentic 模式连续触发多次 Milvus search。
   */
  async retrievalNode(
    state: AgenticRagStateType,
  ): Promise<Partial<AgenticRagStateType>> {
    const queries =
      state.augmentedQueries.length > 0
        ? [state.query, ...state.augmentedQueries]
        : [state.query];

    this.logger.log(
      `Retrieving with ${queries.length} queries (1 hybrid + BM25 fallback)`,
    );

    const allResults: RetrievedChunk[][] = [];
    for (const [index, q] of queries.entries()) {
      try {
        const results =
          index === 0
            ? await this.karpathyRagService.retrieve(q)
            : this.karpathyRagService.retrieveBm25Only(q);
        allResults.push(results);
      } catch (err) {
        this.logger.warn(
          `Retrieve failed for query "${q.slice(0, 30)}": ${(err as Error).message}`,
        );
        allResults.push([]);
      }
    }

    // 按 chunkId 去重，分数取最大值
    const fusedMap = new Map<string, RetrievedChunk>();
    for (const results of allResults) {
      for (const chunk of results) {
        const existing = fusedMap.get(chunk.id);
        if (!existing || chunk.totalScore > existing.totalScore) {
          fusedMap.set(chunk.id, chunk);
        }
      }
    }

    // 按总分排序，取 Top-5
    const chunks = Array.from(fusedMap.values())
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, 5);

    this.logger.log(
      `Retrieved ${chunks.length} unique chunks from ${queries.length} queries`,
    );
    return { retrievedChunks: chunks };
  }

  /**
   * 检索充分性评估：生成前判断 chunks 是否足够支撑回答。
   * 后续接入 Bocha web_search 时，可在 insufficient 分支触发联网补充。
   */
  async sufficiencyNode(
    state: AgenticRagStateType,
  ): Promise<Partial<AgenticRagStateType>> {
    if (state.retrievedChunks.length === 0) {
      return {
        retrievalSufficient: false,
        retrievalReason: '没有检索到任何可用片段',
      };
    }

    const model = this.llmProvider.getModel();
    const schema = z.object({
      sufficient: z.boolean().describe('检索片段是否足够直接支撑回答用户问题'),
      reason: z.string().describe('中文评估理由'),
    });

    try {
      const structured = model.withStructuredOutput(schema);
      const context = state.retrievedChunks
        .map((c, i) => `[片段 ${i + 1}] ${c.content.slice(0, 500)}`)
        .join('\n\n');
      const result = await structured.invoke([
        {
          role: 'system',
          content: [
            '你是 RAG 检索充分性评估器。',
            '判断给定检索片段是否足够支撑后续回答用户问题。',
            '只要片段包含直接答案、核心事实或足够上下文，就判定 sufficient=true。',
            '如果片段明显无关、为空、只包含泛泛背景而不能回答问题，则判定 sufficient=false。',
            '只输出结构化字段 sufficient 和 reason。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `用户问题：${state.query}\n\n检索片段：\n${context}`,
        },
      ]);

      this.logger.log(
        `Retrieval sufficiency: sufficient=${result.sufficient}, reason=${result.reason}`,
      );

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
      return {
        retrievalSufficient: sufficient,
        retrievalReason: reason,
      };
    }
  }

  /**
   * 联网兜底：当本地检索不足时，调用 Bocha Web Search 补充外部上下文。
   */
  async webSearchFallbackNode(
    state: AgenticRagStateType,
  ): Promise<Partial<AgenticRagStateType> & { webSearchCount: number }> {
    if (state.retrievalSufficient) {
      return { webSearchCount: 0 };
    }

    if (!this.bochaSearchService.isEnabled()) {
      this.logger.warn(
        'Retrieval insufficient but Bocha web_search is disabled',
      );
      return {
        retrievalReason: `${state.retrievalReason || '检索不足'}；BOCHA_API_KEY 未配置，已跳过联网兜底`,
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
      return {
        retrievedChunks: [...state.retrievedChunks, ...webChunks].slice(0, 8),
        retrievalReason: `${state.retrievalReason || '检索不足'}；已通过 Bocha web_search 补充 ${webChunks.length} 条结果`,
        webSearchCount: webChunks.length,
      };
    } catch (err) {
      const reason = `Bocha web_search 调用失败：${(err as Error).message}`;
      this.logger.warn(reason);
      return {
        retrievalReason: `${state.retrievalReason || '检索不足'}；${reason}`,
        webSearchCount: 0,
      };
    }
  }

  /**
   * 二次排序：有 RERANK_API_KEY 时调用 DashScope Rerank；未配置时保持原排序。
   */
  async rerankNode(
    state: AgenticRagStateType,
  ): Promise<Partial<AgenticRagStateType> & { reranked: boolean }> {
    if (state.retrievedChunks.length < 2) {
      return { reranked: false };
    }

    if (!this.dashScopeRerankService.isEnabled()) {
      return { reranked: false };
    }

    try {
      const chunks = await this.dashScopeRerankService.rerank(
        state.query,
        state.retrievedChunks,
        5,
      );
      return { retrievedChunks: chunks, reranked: true };
    } catch (err) {
      this.logger.warn(`DashScope rerank skipped: ${(err as Error).message}`);
      return { reranked: false };
    }
  }

  /**
   * 生成节点：基于检索结果生成答案
   */
  async generateNode(
    state: AgenticRagStateType,
    onToken?: (token: string) => void,
  ): Promise<Partial<AgenticRagStateType>> {
    if (state.retrievedChunks.length === 0) {
      return { answer: '未找到相关内容，请先上传文档。' };
    }

    const context = state.retrievedChunks
      .map((c, i) => `[片段 ${i + 1}]\n${c.content}`)
      .join('\n\n---\n\n');

    // 流式生成
    const model = this.llmProvider.getModel();
    const messages = await generateAnswerPrompt.formatMessages({
      context,
      query: state.query,
      history: [], // Agentic 模式暂不支持多轮历史
    });
    const stream = await model.stream(messages);
    let answer = '';
    for await (const chunk of stream) {
      const token =
        typeof chunk.content === 'string'
          ? chunk.content
          : JSON.stringify(chunk.content);
      answer += token;
      onToken?.(token);
    }

    return { answer };
  }

  /**
   * Reflection 节点：评估答案置信度，决定是否重试
   */
  async reflectionNode(
    state: AgenticRagStateType,
  ): Promise<Partial<AgenticRagStateType>> {
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

      return {
        confidence: result.confidence,
        passed,
        retryCount,
      };
    } catch (err) {
      this.logger.warn(
        `Reflection failed, assume passed: ${(err as Error).message}`,
      );
      return { confidence: 1, passed: true, retryCount: state.retryCount + 1 };
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
  ): Promise<{
    answer: string;
    references: RetrievedChunk[];
    route: 'simple' | 'agentic';
    confidence: number;
    retryCount: number;
    retrievalSufficient?: boolean;
    retrievalReason?: string;
  }> {
    // 1. 路由
    const route =
      mode === 'simple' ? 'simple' : await this.classifyRoute(query, mode);
    onEvent?.({ type: 'routing', data: { mode, route } });

    if (route === 'simple') {
      // simple 模式直接走 KarpathyRag
      const result = await this.karpathyRagService.answer(query);
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

    // 2. agentic 模式：query_augment → retrieval → generate → reflection → (retry|end)
    let state: AgenticRagStateType = {
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
    };

    // query_augment
    const augmentResult = await this.queryAugmentNode(state);
    state = { ...state, ...augmentResult };
    onEvent?.({ type: 'query_augment', data: state.augmentedQueries });

    // 循环：retrieval → generate → reflection，最多 maxRetries+1 次
    while (true) {
      // retrieval
      const retrievalResult = await this.retrievalNode(state);
      state = { ...state, ...retrievalResult };
      onEvent?.({ type: 'retrieval', data: state.retrievedChunks });

      // sufficiency
      const sufficiencyResult = await this.sufficiencyNode(state);
      state = { ...state, ...sufficiencyResult };
      onEvent?.({
        type: 'sufficiency',
        data: {
          sufficient: state.retrievalSufficient,
          reason: state.retrievalReason,
        },
      });

      if (!state.retrievalSufficient) {
        const webSearchResult = await this.webSearchFallbackNode(state);
        const { webSearchCount, ...statePatch } = webSearchResult;
        state = { ...state, ...statePatch };
        onEvent?.({
          type: 'web_search',
          data: {
            count: webSearchCount,
            enabled: this.bochaSearchService.isEnabled(),
            reason: state.retrievalReason,
          },
        });
      }

      const rerankResult = await this.rerankNode(state);
      const { reranked, ...rerankPatch } = rerankResult;
      state = { ...state, ...rerankPatch };
      onEvent?.({
        type: 'rerank',
        data: {
          enabled: this.dashScopeRerankService.isEnabled(),
          reranked,
          count: state.retrievedChunks.length,
        },
      });

      // generate（流式 token）
      const generateResult = await this.generateNode(state, (token) => {
        onEvent?.({ type: 'token', data: token });
      });
      state = { ...state, ...generateResult };

      // citation
      onEvent?.({ type: 'citation', data: state.retrievedChunks });

      // reflection
      const reflectionResult = await this.reflectionNode(state);
      state = { ...state, ...reflectionResult };
      onEvent?.({
        type: 'reflection',
        data: {
          confidence: state.confidence,
          passed: state.passed,
          retryCount: state.retryCount,
        },
      });

      // 路由决策
      const action = this.reflectionRouter(state);
      if (action === 'end') {
        break;
      }
      // retry：重试时清空答案，保留 augmentedQueries
      state = { ...state, answer: '', passed: false };
    }

    const result = {
      answer: state.answer,
      references: state.retrievedChunks,
      route: 'agentic' as const,
      confidence: state.confidence,
      retryCount: state.retryCount,
      retrievalSufficient: state.retrievalSufficient,
      retrievalReason: state.retrievalReason,
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
   * Nest 当前是 CommonJS 编译，需保留原生 dynamic import，避免 require() 加载 ESM-only 依赖时报错。
   */
  private async planQueriesWithDeepAgent(query: string): Promise<string[]> {
    try {
      const agent = await this.getDeepAgent();
      const result = await agent.invoke({
        messages: [
          {
            role: 'user',
            content: [
              '请为下面的 RAG 问题规划 3 条中文检索问句。',
              '只返回 JSON，不要 Markdown，不要解释。',
              'JSON 格式：{"queries":["问题1","问题2","问题3"]}',
              `原始问题：${query}`,
            ].join('\n'),
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
      systemPrompt: [
        '你是 RAG 检索规划 Agent。',
        '你的任务是把用户问题拆成 3 条互补的中文检索问句。',
        '不要回答用户问题，不要调用不必要的工具。',
        '必须只输出 JSON：{"queries":["...","...","..."]}',
      ].join('\n'),
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
