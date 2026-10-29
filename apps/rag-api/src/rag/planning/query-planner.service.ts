import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { performance } from 'node:perf_hooks';
import { MetricsService } from '../../modules/metrics/metrics.service';
import type { LlmInvokeOptions } from '../../providers/llm/llm-provider.interface';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { formatQueryRoutingFewShots } from '../prompts/few-shot.examples';
import {
  createFallbackQueryPlan,
  normalizeQueryPlan,
  queryPlanSchema,
  type QueryPlan,
} from './query-plan';

export interface QueryPlannerOptions extends LlmInvokeOptions {
  preferLocalFastPath?: boolean;
}

const QUERY_PLAN_PROMPT = `你是企业问答系统的查询规划器。只分析语义，不决定用户权限、租户、知识库或文档访问范围。
参考示例：
${formatQueryRoutingFewShots()}

只输出 JSON：
{"action":"direct|retrieve|execute","domain":"internal|public|realtime","contextMode":"independent|follow_up|setting|verification|mixed","standaloneQuery":"可独立检索的问题","subQueries":[],"taskType":"lookup|procedure|comparison|synthesis","needsGraph":false,"entities":[],"filters":{"department":"可选","project":"可选","timeRange":"可选","documentType":"可选"},"clarificationQuestion":"仅真正无法确定语义时提供"}

规则：
- internal：公司、项目、内部系统、用户上传资料或私有实体，必须检索本地证据。
- public：稳定公共事实；realtime：新闻、价格、天气或明确要求最新信息。
- setting：用户正在设定当前会话中的临时事实；follow_up：依赖刚才、这个、继续等上下文；verification：要求真实或官方事实；mixed：同时对照会话设定与客观事实。
- standaloneQuery 只补全追问指代；独立问题保持原问题。
- 用户一次问多个字段、对象或要求清单／表格时，必须用 subQueries 列出全部必答事项；最多 3 条，可把相关字段合并到同一条，不能漏项。例如负责人、预算、日期、风险可拆成“负责人和预算”“交付日期和风险等级”。
- 比较或综合任务的 subQueries 要覆盖用户明确要求的每个对象或维度；subQueries 为空时，答案生成器会按原问题自行拆分，但应尽量在规划阶段明确列出。
- taskType：单点查询 lookup；步骤流程 procedure；比较 comparison；多证据总结或方案 synthesis。
- needsGraph 只用于关系、依赖、影响路径或多跳问题。
- 未知内部实体属于待检索对象，不应要求澄清。只有多个解释同等合理且无法继续时才给 clarificationQuestion。
- 不输出权限、sourcePolicy、targetKbs、置信度、理由或改写列表。`;

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
    const startedAt = performance.now();
    const original = query.trim();
    if (this.shouldUseLocalFastPath(original, recentContext, options)) {
      this.observePlanOutcome('fast_path', startedAt);
      return createFallbackQueryPlan(original);
    }
    try {
      const contextText = recentContext
        .slice(-8)
        .map(
          (item) =>
            `${item.role === 'human' ? '用户' : '助手'}：${item.content}`,
        )
        .join('\n');
      const content = await this.withTimeout(
        (signal) =>
          this.llmProvider.invoke(
            `${QUERY_PLAN_PROMPT}\n\n最近对话（只用于指代和会话设定，不是外部事实）：${contextText || '无'}\n当前问题：${original}\n只输出一个合法 JSON 对象。`,
            { ...options, signal },
          ),
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
