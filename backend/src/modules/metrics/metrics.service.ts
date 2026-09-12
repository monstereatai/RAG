import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  register,
} from 'prom-client';

/**
 * 命名规范（Prometheus 官方约定）：
 * - counter 一律 `_total` 结尾；histogram 由 client 库自动展开 `_bucket` / `_sum` / `_count`
 * - 时间单位一律 `_seconds`，不使用毫秒
 * - label 只保留低基数维度（method / route / status / provider / model / stage …）；
 *   user_id、request_id、query 原文等高基数维度禁止进 label，应放日志或 trace
 * - histogram 的 buckets 必须覆盖真实量级；最大桶小于真实 P99 会让 P99 被截断到最大桶
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly httpRequestsTotal = new Counter({
    name: 'rag_http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'] as const,
  });

  /**
   * 请求耗时直方图（RED 的 Duration）。
   * 桶覆盖 50ms ~ 120s：RAG 的 SSE 问答和 Agent 多轮循环会跑到几十秒，
   * 若最大桶只到 30s，所有超时/长尾请求都会落进 +Inf，P99 会被严重低估。
   */
  private readonly httpRequestDuration = new Histogram({
    name: 'rag_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [
      0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1, 1.5, 2, 3, 5, 8, 10, 15, 30, 60, 120,
    ],
  });

  private readonly retrievalHitsTotal = new Counter({
    name: 'rag_retrieval_hits_total',
    help: 'Total retrieved chunks by retrieval source',
    labelNames: ['source', 'mode'] as const,
  });

  /** 召回条数：每次检索各阶段实际召回的 chunk 数分布，用于看召回是否被截断。 */
  private readonly retrievalRecalledChunks = new Histogram({
    name: 'rag_retrieval_recalled_chunks',
    help: 'Recalled chunk count per retrieval stage',
    labelNames: ['stage', 'source'] as const,
    buckets: [1, 2, 3, 5, 8, 12, 20, 30, 50],
  });

  /** 检索各阶段耗时：向量检索、BM25、Rerank、邻居扩展、图谱。 */
  private readonly retrievalDuration = new Histogram({
    name: 'rag_retrieval_duration_seconds',
    help: 'Retrieval stage duration in seconds',
    labelNames: ['stage', 'status'] as const,
    buckets: [
      0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1.5, 3, 5, 10,
    ],
  });

  private readonly retrievalContextChunks = new Histogram({
    name: 'rag_retrieval_context_chunks',
    help: 'Number of chunks retained in the final RAG context',
    labelNames: ['intent'] as const,
    buckets: [1, 2, 4, 6, 8, 12, 20],
  });

  private readonly retrievalContextCharacters = new Histogram({
    name: 'rag_retrieval_context_characters',
    help: 'Final RAG context size in characters',
    labelNames: ['intent'] as const,
    buckets: [500, 1000, 2000, 4000, 6000, 8000, 12000],
  });

  private readonly retrievalExpandedTotal = new Counter({
    name: 'rag_retrieval_expanded_chunks_total',
    help: 'Total neighbor or same-section chunks added to context candidates',
    labelNames: ['intent'] as const,
  });

  private readonly llmCallsTotal = new Counter({
    name: 'rag_llm_calls_total',
    help: 'Total LLM calls by provider, model and status',
    labelNames: ['provider', 'model', 'status'] as const,
  });

  /** LLM 单次耗时：桶覆盖 100ms ~ 60s，temperature 采样与长文生成会长尾。 */
  private readonly llmCallDuration = new Histogram({
    name: 'rag_llm_call_duration_seconds',
    help: 'LLM call duration in seconds',
    labelNames: ['provider', 'model', 'status'] as const,
    buckets: [
      0.1, 0.3, 0.5, 0.8, 1, 1.5, 2, 3, 5, 8, 10, 15, 20, 30, 45, 60,
    ],
  });

  /** token 消耗：type 区分 prompt / completion，便于分别核算成本。 */
  private readonly llmTokensEstimatedTotal = new Counter({
    name: 'rag_llm_tokens_estimated_total',
    help: 'Estimated LLM tokens by prompt/completion',
    labelNames: ['provider', 'model', 'type'] as const,
  });

  /** 缓存命中：result 只取 hit / miss，命中率用 rate(...{result="hit"}) / rate(...[w]) 计算。 */
  private readonly cacheRequestsTotal = new Counter({
    name: 'rag_cache_requests_total',
    help: 'Cache lookups by cache name and result',
    labelNames: ['cache', 'result'] as const,
  });

  private readonly cacheOperationDuration = new Histogram({
    name: 'rag_cache_operation_duration_seconds',
    help: 'Cache operation duration in seconds',
    labelNames: ['cache', 'operation'] as const,
    buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  });

  private readonly agentNodeDuration = new Histogram({
    name: 'rag_agent_node_duration_seconds',
    help: 'LangGraph node duration in seconds',
    labelNames: ['node', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.3, 0.8, 1.5, 3, 5, 10, 30],
  });

  private readonly agentFirstTokenDuration = new Histogram({
    name: 'rag_agent_first_token_duration_seconds',
    help: 'Agent time to first streamed token in seconds',
    labelNames: ['route'] as const,
    buckets: [0.05, 0.1, 0.3, 0.8, 1.5, 3, 5, 10, 30],
  });

  private readonly agentToolCallsTotal = new Counter({
    name: 'rag_agent_tool_calls_total',
    help: 'Agent tool calls by name and status',
    labelNames: ['tool', 'status'] as const,
  });

  private readonly agentLoopTerminationsTotal = new Counter({
    name: 'rag_agent_loop_terminations_total',
    help: 'Agent loop decisions and termination reasons',
    labelNames: ['reason'] as const,
  });

  private readonly agentEmptyRetrievalTotal = new Counter({
    name: 'rag_agent_empty_retrieval_total',
    help: 'Agent retrieval stages returning no chunks',
    labelNames: ['route'] as const,
  });

  private readonly scheduledJobRunsTotal = new Counter({
    name: 'rag_scheduled_job_runs_total',
    help: 'Scheduled job runs by task kind and status',
    labelNames: ['task_kind', 'status'] as const,
  });

  private readonly scheduledJobDuration = new Histogram({
    name: 'rag_scheduled_job_duration_seconds',
    help: 'Scheduled job execution duration in seconds',
    labelNames: ['task_kind', 'status'] as const,
    buckets: [0.1, 0.5, 1, 3, 5, 10, 30, 60, 120],
  });

  private readonly dangerousQueriesTotal = new Counter({
    name: 'rag_dangerous_queries_blocked_total',
    help: 'Blocked high-risk user queries by matched policy',
    labelNames: ['pattern', 'route'] as const,
  });

  onModuleInit(): void {
    collectDefaultMetrics({ register, prefix: 'rag_' });
  }

  observeHttpRequest(
    method: string,
    route: string,
    status: number,
    durationSeconds: number,
  ): void {
    const labels = { method, route, status: String(status) };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, durationSeconds);
  }

  observeRetrievalHits(source: string, mode: string, count: number): void {
    if (count <= 0) return;
    this.retrievalHitsTotal.inc({ source, mode }, count);
  }

  /** 记录单次检索阶段的耗时，status 用于区分正常返回与超时/报错降级。 */
  observeRetrievalStage(
    stage: string,
    status: 'success' | 'error',
    durationSeconds: number,
  ): void {
    this.retrievalDuration.observe(
      { stage: stage || 'unknown', status },
      durationSeconds,
    );
  }

  /** 记录某阶段召回条数（0 也记录，便于发现召回为空的情况）。 */
  observeRetrievalRecalled(
    stage: string,
    source: string,
    count: number,
  ): void {
    this.retrievalRecalledChunks.observe(
      { stage: stage || 'unknown', source: source || 'unknown' },
      count,
    );
  }

  observeRetrievalContext(
    intent: string,
    retainedChunks: number,
    expandedChunks: number,
    contextCharacters: number,
  ): void {
    this.retrievalContextChunks.observe({ intent }, retainedChunks);
    this.retrievalContextCharacters.observe({ intent }, contextCharacters);
    if (expandedChunks > 0) {
      this.retrievalExpandedTotal.inc({ intent }, expandedChunks);
    }
  }

  observeLlmCall(
    provider: string,
    model: string,
    status: 'success' | 'fallback' | 'error',
    durationSeconds: number,
    promptTokensEstimated: number,
    completionTokensEstimated: number,
  ): void {
    const labels = {
      provider: provider || 'unknown',
      model: model || 'unknown',
      status,
    };
    this.llmCallsTotal.inc(labels);
    this.llmCallDuration.observe(labels, durationSeconds);
    if (promptTokensEstimated > 0) {
      this.llmTokensEstimatedTotal.inc(
        { provider: labels.provider, model: labels.model, type: 'prompt' },
        promptTokensEstimated,
      );
    }
    if (completionTokensEstimated > 0) {
      this.llmTokensEstimatedTotal.inc(
        { provider: labels.provider, model: labels.model, type: 'completion' },
        completionTokensEstimated,
      );
    }
  }

  observeCacheRequest(cache: string, hit: boolean): void {
    this.cacheRequestsTotal.inc({
      cache: cache || 'unknown',
      result: hit ? 'hit' : 'miss',
    });
  }

  observeCacheOperation(
    cache: string,
    operation: 'get' | 'set' | 'del',
    durationSeconds: number,
  ): void {
    this.cacheOperationDuration.observe(
      { cache: cache || 'unknown', operation },
      durationSeconds,
    );
  }

  observeAgentNode(
    node: string,
    status: 'success' | 'error',
    durationSeconds: number,
  ): void {
    this.agentNodeDuration.observe({ node, status }, durationSeconds);
  }

  observeAgentFirstToken(route: string, durationSeconds: number): void {
    this.agentFirstTokenDuration.observe({ route }, durationSeconds);
  }

  observeAgentToolCall(tool: string, success: boolean): void {
    this.agentToolCallsTotal.inc({
      tool: tool || 'unknown',
      status: success ? 'success' : 'error',
    });
  }

  observeAgentLoopDecision(reason: string): void {
    this.agentLoopTerminationsTotal.inc({ reason });
  }

  observeAgentEmptyRetrieval(route: string): void {
    this.agentEmptyRetrievalTotal.inc({ route });
  }

  observeScheduledJob(
    taskKind: string,
    status: 'completed' | 'failed',
    durationSeconds: number,
  ): void {
    const labels = { task_kind: taskKind || 'unknown', status };
    this.scheduledJobRunsTotal.inc(labels);
    this.scheduledJobDuration.observe(labels, durationSeconds);
  }

  observeDangerousQuery(pattern: string, route: string): void {
    this.dangerousQueriesTotal.inc({
      pattern: pattern || 'unknown',
      route: route || 'unknown',
    });
  }

  contentType(): string {
    return register.contentType;
  }

  metrics(): Promise<string> {
    return register.metrics();
  }
}
