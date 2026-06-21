import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  register,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly httpRequestsTotal = new Counter({
    name: 'rag_http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'] as const,
  });

  private readonly httpRequestDuration = new Histogram({
    name: 'rag_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.05, 0.1, 0.3, 0.8, 1.5, 3, 5, 10, 30],
  });

  private readonly retrievalHitsTotal = new Counter({
    name: 'rag_retrieval_hits_total',
    help: 'Total retrieved chunks by retrieval source',
    labelNames: ['source', 'mode'] as const,
  });

  private readonly llmCallsTotal = new Counter({
    name: 'rag_llm_calls_total',
    help: 'Total LLM calls',
    labelNames: ['provider', 'status'] as const,
  });

  private readonly llmCallDuration = new Histogram({
    name: 'rag_llm_call_duration_seconds',
    help: 'LLM call duration in seconds',
    labelNames: ['provider', 'status'] as const,
    buckets: [0.1, 0.3, 0.8, 1.5, 3, 5, 10, 30],
  });

  private readonly llmTokensEstimatedTotal = new Counter({
    name: 'rag_llm_tokens_estimated_total',
    help: 'Estimated LLM tokens based on text length',
    labelNames: ['provider', 'direction'] as const,
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

  observeLlmCall(
    provider: string,
    status: 'success' | 'fallback' | 'error',
    durationSeconds: number,
    inputTokensEstimated: number,
    outputTokensEstimated: number,
  ): void {
    const labels = { provider, status };
    this.llmCallsTotal.inc(labels);
    this.llmCallDuration.observe(labels, durationSeconds);
    if (inputTokensEstimated > 0) {
      this.llmTokensEstimatedTotal.inc(
        { provider, direction: 'input' },
        inputTokensEstimated,
      );
    }
    if (outputTokensEstimated > 0) {
      this.llmTokensEstimatedTotal.inc(
        { provider, direction: 'output' },
        outputTokensEstimated,
      );
    }
  }

  contentType(): string {
    return register.contentType;
  }

  metrics(): Promise<string> {
    return register.metrics();
  }
}
