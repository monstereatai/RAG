import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { performance } from 'node:perf_hooks';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { countTextTokens } from '../../modules/document/chunking.util';
import type { LlmInvokeOptions } from '../../providers/llm/llm-provider.interface';
import { LlmProvider } from '../../providers/llm/llm.provider';
import {
  createFallbackQueryPlan,
  normalizeQueryPlan,
  queryPlanSchema,
  type QueryPlan,
} from './query-plan';
import { QUERY_PLAN_PROMPT } from './query-planner.prompt';
import { getPromptMetadata } from '../prompts/prompt-registry';

export interface QueryPlannerOptions extends LlmInvokeOptions {
  preferLocalFastPath?: boolean;
}

@Injectable()
export class QueryPlannerService {
  private readonly logger = new Logger(QueryPlannerService.name);

  constructor(
    private readonly llmProvider: LlmProvider,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async plan(
    query: string,
    recentContext: Array<{ role: 'human' | 'ai'; content: string }> = [],
    options?: QueryPlannerOptions,
  ): Promise<QueryPlan> {
    // LLM 把问题整理成受 schema 约束的 QueryPlan。
    // 超时、解析失败或预算不足时保留原问题，退回保守计划。
    const startedAt = performance.now();
    const original = query.trim();
    if (this.shouldUseLocalFastPath(original, recentContext, options)) {
      this.observePlanOutcome('fast_path', startedAt);
      return createFallbackQueryPlan(original);
    }
    try {
      let selectedContext = recentContext.slice(-8);
      const maxInputTokens = this.getMaxInputTokens();
      let prompt = this.buildPrompt(original, selectedContext);
      let estimatedInputTokens = (await countTextTokens(prompt)) + 4;

      while (
        estimatedInputTokens > maxInputTokens &&
        selectedContext.length > 0
      ) {
        const nextContext = this.dropOldestContextTurn(selectedContext);
        if (nextContext.length === selectedContext.length) break;
        selectedContext = nextContext;
        prompt = this.buildPrompt(original, selectedContext);
        estimatedInputTokens = (await countTextTokens(prompt)) + 4;
      }

      // Keep the full planner instructions and current query intact. If those
      // alone exceed the configured input budget, skip the LLM and use the
      // conservative retrieval plan.
      if (estimatedInputTokens > maxInputTokens) {
        this.logger.warn(
          `Query planner prompt exceeds input budget: tokens=${estimatedInputTokens}/${maxInputTokens}`,
        );
        this.observePlanOutcome('fallback', startedAt);
        return createFallbackQueryPlan(original);
      }

      const content = await this.withTimeout(
        (signal) =>
          this.llmProvider.invoke(prompt, {
            ...options,
            signal,
            metadata: {
              ...options?.metadata,
              ...getPromptMetadata('rag.query_plan'),
            },
          }),
        20_000,
        options?.signal,
      );
      const parsed = queryPlanSchema.parse(this.parseJson(content));
      const plan = normalizeQueryPlan(original, parsed);
      this.observePlanOutcome('success', startedAt);
      return plan;
    } catch (error) {
      if (options?.signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Query planning failed: ${message}`);
      this.observePlanOutcome(
        message.includes('query planner timeout') ? 'timeout' : 'fallback',
        startedAt,
      );
      return createFallbackQueryPlan(original);
    }
  }

  private buildPrompt(
    query: string,
    recentContext: Array<{ role: 'human' | 'ai'; content: string }>,
  ): string {
    const contextText = recentContext
      .map(
        (item) => `${item.role === 'human' ? '用户' : '助手'}：${item.content}`,
      )
      .join('\n');
    return `${QUERY_PLAN_PROMPT}\n\n最近对话（只用于指代和会话设定，不是外部事实）：${contextText || '无'}\n当前问题：${query}\n只输出一个合法 JSON 对象。`;
  }

  private dropOldestContextTurn(
    context: Array<{ role: 'human' | 'ai'; content: string }>,
  ): Array<{ role: 'human' | 'ai'; content: string }> {
    const firstHuman = context.findIndex((item) => item.role === 'human');
    if (firstHuman < 0) return [];
    const nextHuman = context.findIndex(
      (item, index) => index > firstHuman && item.role === 'human',
    );
    return nextHuman < 0 ? [] : context.slice(nextHuman);
  }

  private getMaxInputTokens(): number {
    const contextWindow = this.positiveConfigNumber(
      'llm.contextWindowTokens',
      32_768,
    );
    const providers = [
      this.llmProvider.getActiveProviderName(),
      this.llmProvider.getFallbackProviderName(),
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));
    const outputBudget = Math.max(
      ...providers.map((provider) =>
        Math.max(
          this.positiveConfigNumber(`llm.${provider}.maxTokens`, 4_096),
          this.llmProvider.getRoutePolicy('fast', provider).maxTokens,
        ),
      ),
    );
    const safetyMargin = Math.max(256, Math.ceil(contextWindow * 0.1));
    return Math.max(1, contextWindow - outputBudget - safetyMargin);
  }

  private positiveConfigNumber(key: string, fallback: number): number {
    const value = Number(this.config?.get<number>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private observePlanOutcome(
    status: 'success' | 'fallback' | 'timeout' | 'fast_path',
    startedAt: number,
  ): void {
    this.metrics?.observeQueryPlannerRun(
      status,
      Math.max(0, performance.now() - startedAt) / 1000,
    );
  }

  private shouldUseLocalFastPath(
    query: string,
    recentContext: Array<{ role: 'human' | 'ai'; content: string }>,
    options?: QueryPlannerOptions,
  ): boolean {
    const enabled =
      this.config?.get<boolean>('llm.queryPlannerFastPathEnabled') ?? true;
    if (enabled === false) return false;
    if (options?.preferLocalFastPath !== true) return false;
    if (recentContext.length > 0) return false;
    if (query.length < 4 || query.length > 120) return false;
    if (/[？?].*[？?]/.test(query)) return false;
    if (
      /(刚才|之前|上面|这个|那个|它|继续|还有|分别|最新|现在|今天|实时|新闻|天气|价格|冲突|版本)/i.test(
        query,
      )
    ) {
      return false;
    }
    return true;
  }

  private parseJson(content: string): unknown {
    const candidate = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end < start) {
      throw new Error('query planner returned non-JSON');
    }
    return JSON.parse(candidate.slice(start, end + 1));
  }

  private async withTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    ms: number,
    upstreamSignal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    const signal = upstreamSignal
      ? AbortSignal.any([upstreamSignal, controller.signal])
      : controller.signal;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('query planner timeout');
        reject(error);
        controller.abort(error);
      }, ms);
    });
    try {
      return await Promise.race([operation(signal), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  }
}
