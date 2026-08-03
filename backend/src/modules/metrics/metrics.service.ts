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

  contentType(): string {
    return register.contentType;
  }

  metrics(): Promise<string> {
    return register.metrics();
  }
}
