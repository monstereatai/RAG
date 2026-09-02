import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRequire } from 'node:module';
import type { Langfuse as LangfuseClient } from 'langfuse';

const nodeRequire = createRequire(__filename);

export interface RagTracePayload {
  userId?: string;
  threadId?: string;
  query: string;
  answer: string;
  mode: string;
  route?: string;
  model?: string;
  latencyMs: number;
  citationCount: number;
  refused: boolean;
  references: Array<{ docId: string; chunkIndex: number; totalScore: number }>;
  events?: RagTraceEvent[];
  inputTokensEstimated?: number;
  outputTokensEstimated?: number;
  costUsdEstimated?: number;
}

export interface RagTraceEvent {
  type: string;
  data?: unknown;
  timestamp?: string;
}

export interface ProductionWorkflowTracePayload {
  userId?: string;
  threadId: string;
  projectId: string;
  brief: string;
  status: string;
  stepCount: number;
  maxSteps: number;
  approvalMode: string;
  selectedRoles: string[];
  completedRoles: string[];
  pendingApprovalRoles: string[];
  stages: Array<{
    role: string;
    summary: string;
    riskLevel: string;
    evidenceCoverage: number;
    readyForApproval: boolean;
    claims: number;
    supportedClaims: number;
    issues: string[];
    downstreamRisks: string[];
    toolExecutions: Array<{
      tool: string;
      status: string;
      durationMs: number;
      evidenceCount: number;
      fallback?: string;
      error?: string;
    }>;
    completedAt: string;
  }>;
}

export interface ScheduledAnalysisTracePayload {
  jobId: string;
  userId?: string;
  name: string;
  instruction: string;
  window: string;
  dataScopes: string[];
  snapshotCounts: Record<string, number>;
  report: string;
}

@Injectable()
export class LangfuseProvider implements OnModuleDestroy {
  private readonly logger = new Logger(LangfuseProvider.name);
  private readonly client: LangfuseClient | null;
  private readonly inputCostUsdPer1k: number;
  private readonly outputCostUsdPer1k: number;
  private lastFlushAt: string | null = null;
  private lastError: string | null = null;
  private tracesSent = 0;

  constructor(private readonly config: ConfigService) {
    const enabled = this.config.get<boolean>('langfuse.enabled') ?? false;
    const publicKey = this.config.get<string>('langfuse.publicKey') ?? '';
    const secretKey = this.config.get<string>('langfuse.secretKey') ?? '';
    this.inputCostUsdPer1k = Number(
      this.config.get<number>('langfuse.inputCostUsdPer1k') ?? 0,
    );
    this.outputCostUsdPer1k = Number(
      this.config.get<number>('langfuse.outputCostUsdPer1k') ?? 0,
    );

    if (!enabled || !publicKey || !secretKey) {
      this.client = null;
      this.logger.warn('LangFuse disabled or missing keys.');
      return;
    }

    // Keep the optional SDK out of disabled providers and Jest module loading.
    const { Langfuse } = nodeRequire('langfuse') as typeof import('langfuse');
    this.client = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: this.config.get<string>('langfuse.baseUrl'),
    });
    this.logger.log('LangFuse provider initialized.');
  }

  isEnabled(): boolean {
    return !!this.client;
  }

  async smoke(): Promise<{
    enabled: boolean;
    sent: boolean;
    reason?: string;
  }> {
    if (!this.client) {
      return {
        enabled: false,
        sent: false,
        reason: 'langfuse_disabled_or_missing_keys',
      };
    }

    const trace = this.client.trace({
      name: 'rag.observability.smoke',
      input: { query: 'local observability smoke' },
      output: { ok: true },
      metadata: { source: 'backend smoke:langfuse' },
    });
    trace.generation({
      name: 'rag.observability.smoke.generation',
      input: 'local observability smoke',
      output: 'ok',
      model: 'smoke',
      usageDetails: { input: 3, output: 1, total: 4 },
      metadata: { source: 'backend smoke:langfuse' },
    });
    try {
      await this.flush();
      return { enabled: true, sent: true };
    } catch (err) {
      this.lastError = (err as Error).message;
      return { enabled: true, sent: false, reason: 'langfuse_flush_failed' };
    }
  }

  getHealth(): {
    enabled: boolean;
    healthy: boolean;
    lastFlushAt: string | null;
    tracesSent: number;
    lastError: string | null;
  } {
    return {
      enabled: this.isEnabled(),
      healthy: this.isEnabled() && !this.lastError,
      lastFlushAt: this.lastFlushAt,
      tracesSent: this.tracesSent,
      lastError: this.lastError,
    };
  }

  getStatus(): {
    enabled: boolean;
    baseUrl: string;
    hasPublicKey: boolean;
    hasSecretKey: boolean;
  } {
    return {
      enabled: this.isEnabled(),
      baseUrl:
        this.config.get<string>('langfuse.baseUrl') ??
        'https://cloud.langfuse.com',
      hasPublicKey: Boolean(this.config.get<string>('langfuse.publicKey')),
      hasSecretKey: Boolean(this.config.get<string>('langfuse.secretKey')),
    };
  }

  traceRagAnswer(payload: RagTracePayload): void {
    if (!this.client) return;

    try {
      const usage = this.buildUsage(payload);
      const trace = this.client.trace({
        name: 'rag.answer',
        userId: payload.userId,
        sessionId: payload.threadId,
        input: payload.query,
        output: payload.answer,
        metadata: {
          mode: payload.mode,
          route: payload.route,
          model: payload.model,
          latencyMs: payload.latencyMs,
          citationCount: payload.citationCount,
          refused: payload.refused,
          references: payload.references,
          usage,
          events: this.summarizeEvents(payload.events ?? []),
        },
      });
      this.recordEventSpans(trace, payload.events ?? []);
      trace.generation({
        name: 'rag.generate',
        input: payload.query,
        output: payload.answer,
        model: payload.model,
        usageDetails: {
          input: usage.inputTokens,
          output: usage.outputTokens,
          total: usage.totalTokens,
        },
        costDetails: {
          input: usage.inputCostUsd,
          output: usage.outputCostUsd,
          total: usage.totalCostUsd,
        },
        metadata: {
          citationCount: payload.citationCount,
          refused: payload.refused,
          mode: payload.mode,
          route: payload.route,
        },
      });
      this.tracesSent += 1;
      void this.flush();
    } catch (err) {
      this.lastError = (err as Error).message;
      this.logger.warn(`LangFuse trace failed: ${(err as Error).message}`);
    }
  }

  async traceProductionWorkflow(
    payload: ProductionWorkflowTracePayload,
  ): Promise<void> {
    if (!this.client) return;

    try {
      const trace = this.client.trace({
        name: 'agent.production.workflow',
        userId: payload.userId,
        sessionId: payload.threadId,
        input: {
          projectId: payload.projectId,
          brief: payload.brief,
          selectedRoles: payload.selectedRoles,
        },
        output: {
          status: payload.status,
          completedRoles: payload.completedRoles,
          pendingApprovalRoles: payload.pendingApprovalRoles,
        },
        metadata: {
          workflowType: 'production-multi-agent',
          stepCount: payload.stepCount,
          maxSteps: payload.maxSteps,
          approvalMode: payload.approvalMode,
          selectedRoles: payload.selectedRoles,
          completedRoles: payload.completedRoles,
          pendingApprovalRoles: payload.pendingApprovalRoles,
          stageCount: payload.stages.length,
        },
      });

      for (const stage of payload.stages) {
        const stageInput = {
          role: stage.role,
          evidenceCount: stage.toolExecutions.reduce(
            (total, execution) => total + execution.evidenceCount,
            0,
          ),
        };
        const stageOutput = {
          summary: this.compactData(stage.summary),
          riskLevel: stage.riskLevel,
          evidenceCoverage: stage.evidenceCoverage,
          readyForApproval: stage.readyForApproval,
          claims: stage.claims,
          supportedClaims: stage.supportedClaims,
          issues: stage.issues,
          downstreamRisks: stage.downstreamRisks,
        };
        const stageSpan = trace.span({
          name: `agent.production.stage.${stage.role}`,
          input: stageInput,
          output: stageOutput,
          metadata: {
            role: stage.role,
            riskLevel: stage.riskLevel,
            evidenceCoverage: stage.evidenceCoverage,
            completedAt: stage.completedAt,
          },
        });
        for (const execution of stage.toolExecutions) {
          stageSpan.event({
            name: `agent.production.tool.${execution.tool}`,
            input: { tool: execution.tool },
            output: {
              status: execution.status,
              durationMs: execution.durationMs,
              evidenceCount: execution.evidenceCount,
              fallback: execution.fallback,
              error: execution.error,
            },
          });
        }
        trace.generation({
          name: `agent.production.generation.${stage.role}`,
          input: stageInput,
          output: stageOutput,
          model: 'production-workflow-role',
          metadata: {
            role: stage.role,
            toolExecutions: stage.toolExecutions.length,
          },
        });
      }

      trace.event({
        name: 'agent.production.workflow.finished',
        input: {
          status: payload.status,
          stepCount: payload.stepCount,
        },
        output: {
          completedRoles: payload.completedRoles,
          pendingApprovalRoles: payload.pendingApprovalRoles,
        },
      });
      this.tracesSent += 1;
      await this.flush();
    } catch (err) {
      this.lastError = (err as Error).message;
      this.logger.warn(
        `LangFuse production workflow trace failed: ${(err as Error).message}`,
      );
    }
  }

  async traceScheduledAnalysis(
    payload: ScheduledAnalysisTracePayload,
  ): Promise<void> {
    if (!this.client) return;
    try {
      const trace = this.client.trace({
        name: 'agent.scheduled.analysis',
        userId: payload.userId,
        sessionId: payload.jobId,
        input: {
          name: payload.name,
          instruction: payload.instruction,
          window: payload.window,
          dataScopes: payload.dataScopes,
        },
        output: {
          snapshotCounts: payload.snapshotCounts,
          report: payload.report,
        },
        metadata: { taskKind: 'analysis', jobId: payload.jobId },
      });
      trace.generation({
        name: 'agent.scheduled.analysis.report',
        input: payload.snapshotCounts,
        output: payload.report,
        model: 'scheduled-analysis',
        metadata: { window: payload.window, dataScopes: payload.dataScopes },
      });
      this.tracesSent += 1;
      await this.flush();
    } catch (err) {
      this.lastError = (err as Error).message;
      this.logger.warn(
        `LangFuse scheduled analysis trace failed: ${(err as Error).message}`,
      );
    }
  }

  async flush(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.flushAsync();
      this.lastFlushAt = new Date().toISOString();
      this.lastError = null;
    } catch (err) {
      this.lastError = (err as Error).message;
      this.logger.warn(`LangFuse flush failed: ${(err as Error).message}`);
    }
  }

  estimateTextTokens(text: string): number {
    if (!text) return 0;
    const cjkChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const nonCjkChars = Math.max(text.length - cjkChars, 0);
    return Math.ceil(cjkChars * 0.75 + nonCjkChars / 4);
  }

  estimateCostUsd(inputTokens: number, outputTokens: number): number {
    const inputCost = (inputTokens / 1000) * this.inputCostUsdPer1k;
    const outputCost = (outputTokens / 1000) * this.outputCostUsdPer1k;
    return Number((inputCost + outputCost).toFixed(8));
  }

  private buildUsage(payload: RagTracePayload) {
    const inputTokens =
      payload.inputTokensEstimated ?? this.estimateTextTokens(payload.query);
    const outputTokens =
      payload.outputTokensEstimated ?? this.estimateTextTokens(payload.answer);
    const inputCostUsd = Number(
      ((inputTokens / 1000) * this.inputCostUsdPer1k).toFixed(8),
    );
    const outputCostUsd = Number(
      ((outputTokens / 1000) * this.outputCostUsdPer1k).toFixed(8),
    );
    const totalCostUsd =
      payload.costUsdEstimated ??
      Number((inputCostUsd + outputCostUsd).toFixed(8));

    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      inputCostUsd,
      outputCostUsd,
      totalCostUsd,
    };
  }

  private recordEventSpans(
    trace: ReturnType<LangfuseClient['trace']>,
    events: RagTraceEvent[],
  ): void {
    for (const event of events) {
      if (event.type === 'token') continue;
      const name = this.getSpanName(event.type);
      const data = this.compactData(event.data);
      trace.span({
        name,
        input: event.type,
        output: data,
        startTime: event.timestamp ? new Date(event.timestamp) : undefined,
        metadata: {
          type: event.type,
          data,
        },
      });
    }
  }

  private summarizeEvents(events: RagTraceEvent[]) {
    const summary: Record<string, number> = {};
    for (const event of events) {
      summary[event.type] = (summary[event.type] ?? 0) + 1;
    }
    return summary;
  }

  private getSpanName(type: string): string {
    const map: Record<string, string> = {
      routing: 'rag.routing',
      query_augment: 'rag.query_augment',
      retrieval: 'rag.retrieval',
      sufficiency: 'rag.sufficiency',
      web_search: 'rag.web_search',
      rerank: 'rag.rerank',
      tool_call: 'rag.tool_call',
      citation: 'rag.citation',
      reflection: 'rag.reflection',
      final: 'rag.final',
      node_timing: 'rag.node',
    };
    return map[type] ?? `rag.${type}`;
  }

  private compactData(data: unknown): unknown {
    if (Array.isArray(data)) {
      return {
        count: data.length,
        sample: data.slice(0, 5).map((item) => this.compactData(item)),
      };
    }
    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(record)
          .slice(0, 12)
          .map(([key, value]) => [key, this.compactData(value)]),
      );
    }
    if (typeof data === 'string') {
      return data.length > 500 ? `${data.slice(0, 500)}...` : data;
    }
    return data;
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }
}
