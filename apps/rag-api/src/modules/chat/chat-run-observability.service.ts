import { Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  LangfuseProvider,
  type RagTraceEvent,
} from '../../providers/observability/langfuse.provider';
import { AgentRunsService } from '../agent-runs/agent-runs.service';
import { DingTalkProvider } from '../../providers/notify/dingtalk.provider';
import type { RetrievalProfile } from '../../rag/retrieval/context-builder';
import type { SseEvent } from '../../rag/agentic/sse-event';
import type { ChatMode } from './chat.dto';

type RunRoute = 'simple' | 'agentic';

type RunUsage = {
  modelCallsEstimated: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  source: 'estimated_from_completed_nodes';
};

type TraceAnswerInput = {
  userId: string;
  query: string;
  mode: string;
  route: string;
  model?: string;
  threadId: string;
  startTime: number;
  answer: string;
  references: Array<{
    docId: string;
    chunkIndex: number;
    totalScore: number;
  }>;
  refused: boolean;
  events?: RagTraceEvent[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    source?: string;
  };
};

type RequestSnapshotInput = {
  query: string;
  mode: ChatMode;
  rolePresetId?: string;
  role: string;
  retrievalProfile?: RetrievalProfile;
  historyCount: number;
  memoryEnabled: boolean;
  threadId: string;
  pluginKeys?: string[];
  pluginTools?: string[];
  runtimePlan?: unknown;
};

@Injectable()
export class ChatRunObservabilityService {
  constructor(
    private readonly langfuseProvider: LangfuseProvider,
    @Optional() private readonly agentRuns?: AgentRunsService,
    @Optional() private readonly dingTalk?: DingTalkProvider,
  ) {}

  /** Provider 只提供文本结果时，按已完成的模型节点估算 usage。 */
  estimateRunUsage(
    query: string,
    answer: string,
    route: RunRoute,
    events?: RagTraceEvent[],
  ): RunUsage {
    const modelNodes = new Set(['generate', 'reflection']);
    const completedModelNodes = (events ?? []).flatMap((event) => {
      if (event.type !== 'node_timing') return [];
      const data = asRecord(event.data);
      const node = typeof data?.node === 'string' ? data.node : undefined;
      return data?.status === 'success' && node && modelNodes.has(node)
        ? [node]
        : [];
    });
    const modelCallsEstimated =
      1 + (route === 'agentic' ? completedModelNodes.length : 0);
    const queryTokens = this.langfuseProvider.estimateTextTokens(query);
    const answerTokens = this.langfuseProvider.estimateTextTokens(answer);
    const reflectionCount = completedModelNodes.filter(
      (node) => node === 'reflection',
    ).length;
    const inputTokens =
      queryTokens * modelCallsEstimated + answerTokens * reflectionCount;
    return {
      modelCallsEstimated,
      inputTokens,
      outputTokens: answerTokens,
      costUsd: this.langfuseProvider.estimateCostUsd(inputTokens, answerTokens),
      source: 'estimated_from_completed_nodes',
    };
  }

  estimateCostUsd(inputTokens: number, outputTokens: number): number {
    return this.langfuseProvider.estimateCostUsd(inputTokens, outputTokens);
  }

  traceAnswer(params: TraceAnswerInput): void {
    const inputTokens =
      params.usage?.inputTokens ??
      this.langfuseProvider.estimateTextTokens(params.query);
    const outputTokens =
      params.usage?.outputTokens ??
      this.langfuseProvider.estimateTextTokens(params.answer);
    this.langfuseProvider.traceRagAnswer({
      userId: params.userId,
      threadId: params.threadId,
      query: params.query,
      answer: params.answer,
      mode: params.mode,
      route: params.route,
      model: params.model,
      latencyMs: Date.now() - params.startTime,
      citationCount: params.references.length,
      refused: params.refused,
      references: params.references.map((ref) => ({
        docId: ref.docId,
        chunkIndex: ref.chunkIndex,
        totalScore: ref.totalScore,
      })),
      events: params.events,
      inputTokensEstimated: inputTokens,
      outputTokensEstimated: outputTokens,
      costUsdEstimated:
        params.usage?.costUsd ??
        this.langfuseProvider.estimateCostUsd(inputTokens, outputTokens),
      usageSource:
        params.usage?.source === 'provider_reported_tokens'
          ? 'provider_reported'
          : 'estimated',
    });
    // 钉钉问答推送（fire-and-forget，threadId 白名单过滤）
    void this.dingTalk?.forwardRagAnswer({
      threadId: params.threadId,
      query: params.query,
      answer: params.answer,
      mode: params.mode,
      latencyMs: Date.now() - params.startTime,
      citationCount: params.references.length,
    });
  }

  requestSnapshot(input: RequestSnapshotInput) {
    const hash = (value: string) =>
      createHash('sha256').update(value).digest('hex').slice(0, 16);
    return {
      schemaVersion: 1,
      mode: input.mode,
      threadId: input.threadId,
      queryHash: hash(input.query),
      queryLength: input.query.length,
      role: input.role,
      rolePresetId: input.rolePresetId ?? null,
      retrievalProfile: input.retrievalProfile
        ? {
            intent: input.retrievalProfile.intent,
            candidateDepth: input.retrievalProfile.candidateDepth,
            finalTopK: input.retrievalProfile.finalTopK,
            neighborWindow: input.retrievalProfile.neighborWindow,
            contextCharacterBudget:
              input.retrievalProfile.contextCharacterBudget,
          }
        : null,
      promptVersions: {
        roleContext: 'role-presets/v1',
        memory: 'short-term-memory/v1',
        answer: input.mode === 'simple' ? 'linear_rag/v1' : 'agentic/v1',
      },
      historyCount: input.historyCount,
      memoryEnabled: input.memoryEnabled,
      pluginKeys: input.pluginKeys ?? [],
      pluginTools: input.pluginTools ?? [],
      runtimePlan: input.runtimePlan ?? null,
      toolPolicy:
        input.mode === 'agentic' || input.mode === 'auto'
          ? 'tool-registry/v1'
          : null,
    };
  }

  toTraceEvent(event: SseEvent): RagTraceEvent {
    return {
      type: event.type,
      data: event.type === 'token' ? undefined : event.data,
      timestamp: new Date().toISOString(),
    };
  }

  async recordTraceTimeline(
    runId: string,
    events: RagTraceEvent[],
    route: string,
  ): Promise<void> {
    for (const event of events) {
      const data = asRecord(event.data);
      if (event.type === 'routing') {
        await this.agentRuns?.recordRuntimeEvent(runId, {
          eventType: 'route.selected',
          target: typeof data?.route === 'string' ? data.route : route,
          payload: data,
        });
        continue;
      }
      if (event.type === 'node_timing') {
        const node = typeof data?.node === 'string' ? data.node : 'unknown';
        await this.agentRuns?.updateCurrentNode(runId, node, data);
        await this.agentRuns?.recordRuntimeEvent(runId, {
          eventType: data?.success === false ? 'node.failed' : 'node.completed',
          target: node,
          payload: data,
        });
        continue;
      }
      if (
        [
          'retrieval',
          'sufficiency',
          'web_search',
          'rerank',
          'reflection',
        ].includes(event.type)
      ) {
        await this.agentRuns?.recordRuntimeEvent(runId, {
          eventType: `${event.type}.completed`,
          target: event.type,
          payload: data ?? event.data,
        });
      }
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
