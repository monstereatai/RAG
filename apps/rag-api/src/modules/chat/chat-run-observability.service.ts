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
import type { ChatMode, RetrievalScopeDto } from './chat.dto';
import { getPromptVersion } from '../../rag/prompts/prompt-registry';
import type { AgentRuntimeService } from '../agent-runtime/agent-runtime.service';
import type { ChatContextAudit } from './chat-runtime.types';

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
  scope?: RetrievalScopeDto;
  knowledgeBaseKey?: string;
  approvalRequired: boolean;
  useLongTermMemory: boolean;
  hasSupplementalEvidence: boolean;
  model?: string;
  trustedAdminPrincipal?: boolean;
  departmentIds?: string[];
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
      schemaVersion: 3,
      mode: input.mode,
      threadId: input.threadId,
      queryHash: hash(input.query),
      queryLength: input.query.length,
      role: input.role,
      rolePresetId: input.rolePresetId ?? null,
      scope: input.scope ?? null,
      knowledgeBaseKey: input.knowledgeBaseKey ?? null,
      approvalRequired: input.approvalRequired,
      useLongTermMemory: input.useLongTermMemory,
      hasSupplementalEvidence: input.hasSupplementalEvidence,
      model: input.model ?? null,
      trustedAdminPrincipal: input.trustedAdminPrincipal === true,
      departmentIds: input.departmentIds ?? [],
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
        queryPlanner: getPromptVersion('rag.query_plan'),
        answer: getPromptVersion('rag.generate_answer'),
        sufficiency: getPromptVersion('agentic.sufficiency'),
        reflection: getPromptVersion('agentic.reflection'),
        memoryClassifier: getPromptVersion('memory.classifier'),
        shortTermSummaryCompaction: getPromptVersion(
          'memory.summary_compaction',
        ),
        shortTermSummaryRecovery: getPromptVersion('memory.summary_recovery'),
      },
      promptPath: {
        routeMode: input.mode,
        selectedRouteAtSnapshot: null,
        routeResolvedBy: 'agentic_rag.fast_path',
        common: ['rag.query_plan'],
        queryPlanConditional:
          '命中本地快速路径或预算保护时不调用该提示词，使用本地保守计划。',
        simple: {
          prompts: ['rag.generate_answer'],
          conditional: '仅在进入 grounded LLM 生成分支时调用。',
        },
        agentic: {
          prompts: [
            'agentic.sufficiency',
            'rag.generate_answer',
            'agentic.reflection',
          ],
          conditional: '仅在后续 routing event 选择 agentic 路径时调用。',
        },
      },
      memoryPromptPath: {
        classifier:
          '仅首次执行 conversation.memory.persist 的分类步骤时调用；复用 outbox 分类结果时不重新调用。',
        summaryCompaction: '仅短期记忆压缩实际触发且通过预算检查后调用。',
        summaryRecovery:
          '仅持久摘要缺失且恢复流程需要 LLM 时调用；读取已有摘要不代表使用了当前版本。',
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

  async recordPreparedContext(
    runId: string,
    input: {
      runtimePlan?: Awaited<
        ReturnType<AgentRuntimeService['createPlanWithSkills']>
      >['plan'];
      audit: ChatContextAudit;
      requestSnapshot: RequestSnapshotInput;
    },
  ): Promise<void> {
    await this.agentRuns?.recordRuntimeEvent(runId, {
      eventType: 'agent.plan.created',
      target: input.runtimePlan?.planId,
      payload: input.runtimePlan,
    });
    await this.agentRuns?.recordRuntimeEvent(runId, {
      eventType: 'context.policy.selected',
      target: 'short-term-memory',
      payload: {
        messageSafetyCap: input.audit.messageSafetyCap,
        planningHistoryTokenBudget: input.audit.planningHistoryTokenBudget,
        requestHistoryTokenBudget: input.audit.requestHistoryTokenBudget,
        systemContextTokenBudget: input.audit.systemContextTokenBudget,
        systemContextEstimatedTokens: input.audit.systemContextEstimatedTokens,
        systemContextOverflowTokens: input.audit.systemContextOverflowTokens,
        systemContextDroppedSources: input.audit.systemContextDroppedSources,
        skillContextsInjected: input.audit.skillContextsInjected,
        skillContextsDropped: input.audit.skillContextsDropped,
        loadedTurns: input.audit.loadedTurns,
        summaryLoaded: input.audit.summaryLoaded,
      },
    });
    if (input.runtimePlan?.selectedSkills.length) {
      await this.agentRuns?.recordRuntimeEvent(runId, {
        eventType: 'skill.selected',
        target: 'skill-system',
        payload: {
          skills: input.runtimePlan.selectedSkills,
          versions: input.runtimePlan.selectedSkillVersions,
          injected: input.audit.skillContextsInjected,
          dropped: input.audit.skillContextsDropped,
        },
      });
    }
    await this.agentRuns?.recordRuntimeEvent(runId, {
      eventType: 'request.snapshot',
      target: 'model_request',
      payload: this.requestSnapshot(input.requestSnapshot),
    });
  }

  async recordMemoryContextLoaded(
    runId: string,
    audit: ChatContextAudit,
  ): Promise<void> {
    await this.agentRuns?.recordRuntimeEvent(runId, {
      eventType: 'memory.context.loaded',
      target: 'short_term_memory',
      payload: {
        recentTurns: audit.recentTurns,
        truncatedHistory: audit.truncatedHistory,
        summaryLoaded: audit.summaryLoaded,
        systemContextDroppedSources: audit.systemContextDroppedSources,
      },
    });
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
