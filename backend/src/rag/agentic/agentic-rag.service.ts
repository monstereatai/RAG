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

  /** Reflection 阈值，低于此值触发重试 */
  private readonly confidenceThreshold = 0.7;
  /** 最大重试次数 */
  private readonly maxRetries = 2;

  constructor(
    private readonly llmProvider: LlmProvider,
    private readonly karpathyRagService: KarpathyRagService,
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
   * 检索节点：对每条扩展查询独立检索，合并去重
   * 串行检索避免 Milvus 并发超时
   */
  async retrievalNode(
    state: AgenticRagStateType,
  ): Promise<Partial<AgenticRagStateType>> {
    const queries =
      state.augmentedQueries.length > 0
        ? state.augmentedQueries
        : [state.query];

    this.logger.log(`Retrieving with ${queries.length} queries (serial)`);

    // 串行检索（避免 Milvus 并发超时）
    const allResults: RetrievedChunk[][] = [];
    for (const q of queries) {
      try {
        const results = await this.karpathyRagService.retrieve(q);
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
          .map((c, i) => `[片段 ${i + 1}] ${c.content.slice(0, 200)}`)
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
}
