import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RAG_QUERY_CAPABILITY,
  type RagQueryCapability,
} from '../../rag/contracts/rag-capabilities';
import { AgenticRagService } from '../../rag/agentic/agentic-rag.service';
import { ConversationService } from './conversation.service';
import { MemoryService } from '../memory/memory.service';
import { ShortTermMemoryService } from '../memory/short-term-memory.service';
import { ChatDto, type ChatMode, type ChatResponse } from './chat.dto';
import type {
  ChatPluginComposition,
  PreparedChatContext,
} from './chat-context-builder';
import { ChatQueryLogService } from './chat-query-log.service';
import type { RagTraceEvent } from '../../providers/observability/langfuse.provider';
import type { SseEvent } from '../../rag/agentic/sse-event';
import { AgentRunsService } from '../agent-runs/agent-runs.service';
import { AgentGoalService } from '../agent-runs/agent-goal.service';
import type { RetrievalExecutionPlan } from '../../rag/planning/retrieval-policy.service';
import {
  adaptStoredQueryPlan,
  QUERY_PLAN_VERSION,
  type QueryPlan,
} from '../../rag/planning/query-plan';
import { RetrievalPolicyService } from '../../rag/planning/retrieval-policy.service';
import type {
  ChatEventCallback,
  ChatExecutionOptions,
  AggregatedLlmUsage,
  FinalizableChatResult,
} from './chat-runtime.types';
import { ChatRunObservabilityService } from './chat-run-observability.service';

@Injectable()
export class ChatLifecycleService {
  protected readonly logger = new Logger(ChatLifecycleService.name);

  constructor(
    @Inject(RAG_QUERY_CAPABILITY)
    protected readonly ragService: RagQueryCapability,
    protected readonly agenticRagService: AgenticRagService,
    protected readonly conversationService: ConversationService,
    protected readonly memoryService: MemoryService,
    protected readonly shortTermMemory: ShortTermMemoryService,
    protected readonly chatQueryLogService: ChatQueryLogService,
    protected readonly retrievalPolicy: RetrievalPolicyService,
    protected readonly runObservability: ChatRunObservabilityService,
    @Optional() protected readonly agentRuns?: AgentRunsService,
    @Optional() protected readonly agentGoals?: AgentGoalService,
    @Optional() protected readonly config?: ConfigService,
  ) {}

  async startRun(input: {
    req: ChatDto;
    userId: string;
    threadId: string;
    mode: ChatMode;
    executionOptions?: ChatExecutionOptions;
    pluginComposition?: ChatPluginComposition;
    context: PreparedChatContext;
  }): Promise<Awaited<ReturnType<AgentRunsService['start']>> | undefined> {
    const {
      req,
      userId,
      threadId,
      mode,
      executionOptions,
      pluginComposition,
      context,
    } = input;
    const { queryPlan, executionPlan, runtimePlan, history, audit } = context;
    const run = await this.agentRuns?.start({
      threadId,
      userId,
      tenantId: executionOptions?.tenantId,
      mode,
      maxSteps: this.config?.get<number>('agentRun.maxSteps') ?? 18,
      maxToolCalls: this.config?.get<number>('agentRun.maxToolCalls') ?? 24,
      maxDelegations: this.config?.get<number>('agentRun.maxDelegations') ?? 6,
    });
    if (run) {
      await this.agentRuns?.recordRuntimeEvent(run.id, {
        eventType: 'query.plan.created',
        target: 'query_planner',
        payload: {
          planVersion: QUERY_PLAN_VERSION,
          queryPlan,
          executionPlan: this.executionPlanSummary(executionPlan),
        },
      });
      await this.agentGoals?.activate({
        threadId,
        runId: run.id,
        tenantId: run.tenantId?.trim() || 'legacy',
        actor: mode,
        objective: req.query,
        maxRounds: run.maxSteps,
      });
      await this.runObservability.recordPreparedContext(run.id, {
        runtimePlan,
        audit,
        requestSnapshot: {
          query: req.query,
          mode,
          rolePresetId: req.rolePresetId,
          role: audit.role,
          scope: req.scope,
          knowledgeBaseKey: req.knowledgeBaseKey,
          approvalRequired: req.approvalRequired === true,
          useLongTermMemory: req.useLongTermMemory !== false,
          hasSupplementalEvidence: audit.hasSupplementalEvidence,
          model: executionOptions?.model,
          trustedAdminPrincipal: executionOptions?.trustedAdminPrincipal,
          departmentIds: executionOptions?.departmentIds,
          retrievalProfile: executionPlan.profile,
          historyCount: history.length,
          memoryEnabled: audit.memoryEnabled,
          threadId,
          pluginKeys: pluginComposition?.pluginKeys ?? [],
          pluginTools: pluginComposition?.toolNames ?? [],
          runtimePlan,
        },
      });
    }
    if (audit.memoryCandidates || audit.sessionMemoryCandidates) {
      this.logger.debug(
        `Memory candidates loaded: user=${audit.memoryCandidates}, session=${audit.sessionMemoryCandidates}`,
      );
    }
    if (threadId && !audit.objectiveFactQuery) {
      if (audit.summaryLoaded) {
        this.logger.debug(
          `Short-term memory injected: ${audit.recentTurns} recent turns, truncated=${audit.truncatedHistory}`,
        );
      }
      if (run) {
        await this.runObservability.recordMemoryContextLoaded(run.id, audit);
      }
    }
    if (audit.historySearchCount > 0) {
      this.logger.debug(
        `History context injected: ${audit.historySearchCount} relevant conversations`,
      );
    }
    return run;
  }

  async finalizeChatResult(input: {
    result: FinalizableChatResult;
    mode: ChatMode;
    route: 'simple' | 'agentic';
    req: ChatDto;
    userId: string;
    threadId: string;
    startTime: number;
    queryPlan: QueryPlan;
    executionPlan: RetrievalExecutionPlan;
    run: Awaited<ReturnType<AgentRunsService['start']>> | undefined;
    onEvent?: ChatEventCallback;
    model?: string;
    traceEvents?: RagTraceEvent[];
    executionState?: ChatResponse['executionState'];
    includeUserMessage?: boolean;
    actualUsage?: AggregatedLlmUsage;
    tenantId?: string;
  }): Promise<ChatResponse> {
    // Simple 和 Agentic 在此汇合：同一最终答案与引用用于会话、Query Log、运行审计和完成事件。
    const result = input.result;
    if (result.interrupted) {
      return this.finalizeInterruptedChat(input);
    }
    const refused =
      result.answer === this.ragService.unsupportedReliableAnswer();

    await this.persistConversationResult({
      threadId: input.threadId,
      userId: input.userId,
      query: input.req.query,
      answer: result.answer,
      tenantId: input.tenantId,
      historyTokenBudget: this.shortTermMemory.getAvailableHistoryTokenBudget(
        input.req.query,
        input.executionPlan.profile.contextCharacterBudget,
        input.model,
      ),
      includeUserMessage: input.includeUserMessage,
      skipLongTermMemory:
        input.queryPlan.contextMode !== 'independent' &&
        input.queryPlan.contextMode !== 'verification',
      skipMem0Memory: input.req.useLongTermMemory === false,
      metadata: {
        planVersion: QUERY_PLAN_VERSION,
        queryPlan: input.queryPlan,
        executionPlanSummary: this.executionPlanSummary(input.executionPlan),
        contextMode: input.queryPlan.contextMode,
        entities: input.queryPlan.entities,
        source: 'session_context',
      },
      answerMetadata: {
        route: input.route,
        confidence: result.confidence,
        retryCount: result.retryCount,
        retrievalSufficient: result.retrievalSufficient,
        retrievalReason: result.retrievalReason,
        references: result.references,
        contextMode: input.queryPlan.contextMode,
      },
    });

    const queryLogId = await this.chatQueryLogService.logQuery({
      userId: input.userId,
      query: input.req.query,
      mode: input.mode,
      threadId: input.threadId,
      startTime: input.startTime,
      refused,
      citationCount: result.references.length,
      hasAnswer: result.answer.length > 0,
      answer: result.answer,
      references: result.references,
    });

    if (input.run) {
      await this.agentRuns?.recordRuntimeEvent?.(input.run.id, {
        eventType: 'route.selected',
        target: input.route,
        payload: { requestedMode: input.mode, route: input.route },
      });
      await this.agentRuns?.recordRuntimeEvent(input.run.id, {
        eventType: 'retrieval.completed',
        target: input.route === 'simple' ? 'linear_rag' : 'agentic_rag',
        payload: {
          references: result.references.length,
          sufficient: result.retrievalSufficient,
          reason: result.retrievalReason,
          retryCount: result.retryCount,
        },
      });
    }

    for (const event of input.traceEvents ?? []) {
      if (
        input.run &&
        (event.type === 'tool_call' ||
          event.type === 'node_start' ||
          event.type === 'node_end')
      ) {
        const data = event.data as Record<string, unknown> | undefined;
        const actionName =
          typeof data?.name === 'string' ? data.name : event.type;
        const riskLevel = /write|delete|send|publish|deploy/i.test(actionName)
          ? 'high'
          : 'low';
        await this.agentRuns?.recordAction(input.run.id, {
          name: actionName,
          actionType: event.type,
          status: data?.error ? 'failed' : 'success',
          riskLevel,
          requiresApproval: riskLevel === 'high',
          input: data,
          output: data,
        });
      }
    }
    if (input.run && input.traceEvents?.length) {
      await this.runObservability.recordTraceTimeline(
        input.run.id,
        input.traceEvents,
        input.route,
      );
    }

    const estimatedUsage = this.runObservability.estimateRunUsage(
      input.req.query,
      result.answer,
      input.route,
      input.traceEvents,
    );
    const usage =
      input.actualUsage &&
      (input.actualUsage.inputTokens > 0 || input.actualUsage.outputTokens > 0)
        ? {
            ...estimatedUsage,
            modelCallsEstimated: input.actualUsage.calls,
            inputTokens: input.actualUsage.inputTokens,
            outputTokens: input.actualUsage.outputTokens,
            costUsd: this.runObservability.estimateCostUsd(
              input.actualUsage.inputTokens,
              input.actualUsage.outputTokens,
            ),
            source: 'provider_reported_tokens' as const,
          }
        : estimatedUsage;
    if (input.run) {
      await this.agentRuns?.recordRuntimeEvent(input.run.id, {
        eventType: 'cost.estimated',
        target: input.route,
        payload: usage,
      });
      await this.agentRuns?.finish(input.run.id, {
        queryLogId,
        route: input.route,
        status: 'completed',
        retryCount: result.retryCount,
        costUsd: usage.costUsd,
        requiresApproval:
          usage.costUsd >
          (this.config?.get<number>('agentRun.budgetUsd') ?? 0.2),
        resultSummary: result.answer.slice(0, 2000),
      });
      await this.agentGoals?.update({
        threadId: input.threadId,
        runId: input.run.id,
        tenantId: input.run.tenantId?.trim() || 'legacy',
        actor: input.mode,
        objective: input.req.query,
        maxRounds: input.run.maxSteps,
        status: refused ? 'blocked' : 'completed',
        reason: refused ? result.retrievalReason : undefined,
      });
    }

    this.runObservability.traceAnswer({
      userId: input.userId,
      query: input.req.query,
      mode: input.mode,
      route: input.route,
      threadId: input.threadId,
      startTime: input.startTime,
      answer: result.answer,
      references: result.references,
      refused,
      model: input.model,
      events: input.traceEvents,
      usage,
    });

    const response: ChatResponse = {
      answer: result.answer,
      references: result.references,
      mode: input.mode,
      route: input.route,
      confidence: result.confidence,
      retryCount: result.retryCount,
      retrievalSufficient: result.retrievalSufficient,
      retrievalReason: result.retrievalReason,
      evidenceCoverage: result.evidenceCoverage,
      executionState:
        input.executionState ??
        (result.executionState
          ? { phase: 'completed', ...result.executionState }
          : undefined),
      threadId: input.threadId,
      queryLogId,
      runId: input.run?.id,
    };
    input.onEvent?.({ type: 'final', data: response });
    return response;
  }

  protected async finalizeInterruptedChat(input: {
    result: FinalizableChatResult;
    mode: ChatMode;
    route: 'simple' | 'agentic';
    req: ChatDto;
    userId: string;
    threadId: string;
    startTime: number;
    queryPlan: QueryPlan;
    executionPlan: RetrievalExecutionPlan;
    run: Awaited<ReturnType<AgentRunsService['start']>> | undefined;
    onEvent?: ChatEventCallback;
    model?: string;
    traceEvents?: RagTraceEvent[];
    executionState?: ChatResponse['executionState'];
    tenantId?: string;
  }): Promise<ChatResponse> {
    const executionState = {
      phase: 'approval' as const,
      consumedSteps: input.result.executionState?.consumedSteps ?? 0,
      consumedToolCalls: input.result.executionState?.consumedToolCalls ?? 0,
      remainingSteps: input.result.executionState?.remainingSteps,
      remainingToolCalls: input.result.executionState?.remainingToolCalls,
      checkpointId: input.result.executionState?.checkpointId,
      paused: true,
      lastNode: input.result.executionState?.lastNode ?? 'humanApprovalNode',
    };
    const userMessageId = await this.addConversationMessage(
      input.threadId,
      'human',
      input.req.query,
      input.userId,
      {
        pendingApproval: true,
        runId: input.run?.id,
        mode: input.mode,
        planVersion: QUERY_PLAN_VERSION,
        queryPlan: input.queryPlan,
        executionPlanSummary: this.executionPlanSummary(input.executionPlan),
        skipLongTermMemory:
          input.queryPlan.contextMode !== 'independent' &&
          input.queryPlan.contextMode !== 'verification',
        useLongTermMemory: input.req.useLongTermMemory !== false,
        model: input.model,
        checkpointId: executionState.checkpointId,
      },
      input.tenantId,
    );
    void this.shortTermMemory
      .addTurn(input.threadId, 'user', input.req.query, userMessageId)
      .catch((error: unknown) => {
        this.logger.warn(
          `Short-term memory update failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });

    if (input.run) {
      await this.agentRuns?.recordRuntimeEvent(input.run.id, {
        eventType: 'approval.requested',
        target: 'humanApprovalNode',
        payload: {
          checkpointId: executionState.checkpointId,
          remainingSteps: executionState.remainingSteps,
          remainingToolCalls: executionState.remainingToolCalls,
        },
      });
      if (input.traceEvents?.length) {
        await this.runObservability.recordTraceTimeline(
          input.run.id,
          input.traceEvents,
          input.route,
        );
      }
      await this.agentRuns?.finish(input.run.id, {
        route: input.route,
        status: 'waiting_approval',
        retryCount: input.result.retryCount,
        requiresApproval: true,
        resultSummary: '已生成草稿，等待人工审批。',
      });
      await this.agentGoals?.update({
        threadId: input.threadId,
        runId: input.run.id,
        tenantId: input.run.tenantId?.trim() || 'legacy',
        actor: input.mode,
        objective: input.req.query,
        maxRounds: input.run.maxSteps,
        status: 'paused',
        reason: '等待人工审批',
      });
    }

    return {
      answer: input.result.answer,
      references: input.result.references,
      mode: input.mode,
      route: input.route,
      confidence: input.result.confidence,
      retryCount: input.result.retryCount,
      retrievalSufficient: input.result.retrievalSufficient,
      retrievalReason: input.result.retrievalReason,
      evidenceCoverage: input.result.evidenceCoverage,
      executionState,
      threadId: input.threadId,
      runId: input.run?.id,
    };
  }

  async resume(
    threadId: string,
    approval: 'approved' | 'rejected',
    feedback: string | undefined,
    userId: string,
    tenantId?: string,
    onEvent?: ChatEventCallback,
  ): Promise<ChatResponse> {
    const conversation = await this.getConversation(threadId, userId, tenantId);
    if (!conversation) {
      throw new BadRequestException('未找到可恢复的会话或无权访问');
    }
    const pending = [...conversation.messages].reverse().find((message) => {
      const metadata = this.asRecord(message.metadata);
      return message.role === 'human' && metadata?.pendingApproval === true;
    });
    const metadata = this.asRecord(pending?.metadata);
    if (!pending || !metadata) {
      throw new BadRequestException('当前会话没有等待审批的请求');
    }
    const runId =
      typeof metadata.runId === 'string' ? metadata.runId : undefined;
    const run = runId
      ? await this.agentRuns?.get(runId, tenantId)
      : await this.agentRuns?.findLatestByThread(threadId, tenantId);
    if (!this.agentRuns || !runId || !run) {
      throw new BadRequestException('审批请求缺少运行记录，无法安全恢复');
    }
    if (run.userId !== userId) {
      throw new BadRequestException('无权恢复其他用户的运行');
    }
    if (run.status !== 'waiting_approval') {
      throw new BadRequestException('当前运行不在等待审批状态');
    }

    const queryPlan = adaptStoredQueryPlan(
      metadata.queryPlan ?? metadata.queryIntent,
      pending.content,
      metadata.planVersion,
    );
    const executionPlan = this.retrievalPolicy.build(
      pending.content,
      queryPlan,
    );
    const mode = this.asChatMode(metadata.mode) ?? 'agentic';
    const traceEvents: RagTraceEvent[] = [];
    const resumeEvent = (event: SseEvent) => {
      traceEvents.push(this.runObservability.toTraceEvent(event));
      if (event.type !== 'final') onEvent?.(event);
    };
    // CAS 状态转换防止同一审批被并发提交两次；之后发生的执行错误会收口为失败。
    await this.agentRuns.beginResume(run.id);
    let result;
    try {
      result = await this.agenticRagService.resumeGraph(
        threadId,
        approval,
        feedback,
        resumeEvent,
        tenantId,
        run.id,
      );
    } catch (error) {
      const errorResponse =
        error instanceof BadRequestException ? error.getResponse() : undefined;
      const explicitlyCancelled =
        typeof errorResponse === 'object' &&
        errorResponse !== null &&
        'code' in errorResponse &&
        errorResponse.code === 'AGENT_RUN_CANCELLED';
      await this.finishFailedRun(
        run,
        pending.content,
        mode,
        error,
        explicitlyCancelled ? 'cancelled' : 'failed',
      );
      throw error;
    }
    const startTime = Date.now();

    if (approval === 'rejected') {
      const rejectionAnswer = feedback?.trim()
        ? `本次草稿未获批准：${feedback.trim()}`
        : '本次草稿未获批准，未写入正式答案。';
      const rejectionMessageId = await this.addConversationMessage(
        threadId,
        'ai',
        rejectionAnswer,
        userId,
        {
          approval: 'rejected',
          runId: run?.id,
          planVersion: QUERY_PLAN_VERSION,
          queryPlan,
          executionPlanSummary: this.executionPlanSummary(executionPlan),
        },
        tenantId,
      );
      void this.shortTermMemory
        .addTurn(threadId, 'assistant', rejectionAnswer, rejectionMessageId)
        .catch((error: unknown) => {
          this.logger.warn(
            `Short-term memory update failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      const queryLogId = await this.chatQueryLogService.logQuery({
        userId,
        query: pending.content,
        mode,
        threadId,
        startTime,
        refused: true,
        citationCount: 0,
        hasAnswer: false,
        answer: rejectionAnswer,
        references: [],
      });
      if (run) {
        await this.runObservability.recordTraceTimeline(
          run.id,
          traceEvents,
          'agentic',
        );
        await this.agentRuns?.finish(run.id, {
          route: 'agentic',
          status: 'completed',
          queryLogId,
          requiresApproval: true,
          resultSummary: rejectionAnswer,
        });
        await this.agentGoals?.update({
          threadId,
          runId: run.id,
          tenantId: run.tenantId?.trim() || 'legacy',
          actor: mode,
          objective: pending.content,
          maxRounds: run.maxSteps,
          status: 'blocked',
          reason: feedback?.trim() || '人工审批拒绝',
        });
      }
      const response: ChatResponse = {
        answer: rejectionAnswer,
        references: [],
        mode,
        route: 'agentic',
        confidence: 0,
        retryCount: result.retryCount,
        retrievalSufficient: false,
        retrievalReason: '人工审批拒绝',
        executionState: {
          phase: 'completed',
          consumedSteps: result.executionState.consumedSteps,
          consumedToolCalls: result.executionState.consumedToolCalls,
          remainingSteps: result.executionState.remainingSteps,
          remainingToolCalls: result.executionState.remainingToolCalls,
          checkpointId: result.executionState.checkpointId,
          paused: false,
          lastNode: result.executionState.lastNode,
        },
        threadId,
        queryLogId,
        runId: run?.id,
      };
      onEvent?.({ type: 'final', data: response });
      return response;
    }

    return this.finalizeChatResult({
      result: this.ensureNonEmptyAnswer({
        answer: result.answer,
        references: result.references,
        confidence: result.confidence,
        retryCount: result.retryCount,
        executionState: result.executionState,
      }),
      mode,
      route: 'agentic',
      req: {
        query: pending.content,
        mode,
        useLongTermMemory: metadata.useLongTermMemory !== false,
      },
      userId,
      threadId,
      startTime,
      queryPlan,
      executionPlan,
      run,
      onEvent,
      model: typeof metadata.model === 'string' ? metadata.model : undefined,
      traceEvents,
      executionState: {
        phase: 'completed',
        ...result.executionState,
        paused: false,
      },
      includeUserMessage: false,
      tenantId,
    });
  }

  protected createConversation(
    query: string,
    mode: ChatMode,
    userId: string,
    tenantId?: string,
  ): Promise<string> {
    return tenantId?.trim()
      ? this.conversationService.create(query, mode, userId, tenantId.trim())
      : this.conversationService.create(query, mode, userId);
  }

  protected getConversationHistory(
    threadId: string,
    maxTurns: number,
    userId: string,
    tenantId?: string,
  ) {
    return tenantId?.trim()
      ? this.conversationService.getRecentHistory(
          threadId,
          maxTurns,
          userId,
          tenantId.trim(),
        )
      : this.conversationService.getRecentHistory(threadId, maxTurns, userId);
  }

  protected getConversation(
    threadId: string,
    userId: string,
    tenantId?: string,
  ) {
    return tenantId?.trim()
      ? this.conversationService.get(threadId, userId, tenantId.trim())
      : this.conversationService.get(threadId, userId);
  }

  protected addConversationMessage(
    threadId: string,
    role: 'human' | 'ai',
    content: string,
    userId: string,
    metadata?: Record<string, unknown>,
    tenantId?: string,
  ) {
    return tenantId?.trim()
      ? this.conversationService.addMessage(
          threadId,
          role,
          content,
          userId,
          metadata,
          tenantId.trim(),
        )
      : this.conversationService.addMessage(
          threadId,
          role,
          content,
          userId,
          metadata,
        );
  }

  protected async persistConversationResult(input: {
    threadId: string;
    userId: string;
    query: string;
    answer: string;
    tenantId?: string;
    historyTokenBudget?: number;
    includeUserMessage?: boolean;
    skipLongTermMemory?: boolean;
    skipMem0Memory?: boolean;
    metadata?: Record<string, unknown>;
    answerMetadata?: Record<string, unknown>;
  }): Promise<void> {
    const persistedMessageIds = await this.conversationService.addCompletedTurn(
      {
        threadId: input.threadId,
        query: input.query,
        answer: input.answer,
        userId: input.userId,
        tenantId: input.tenantId,
        queryMetadata: input.metadata,
        answerMetadata: input.answerMetadata,
        includeUserMessage: input.includeUserMessage,
        indexConversation: !input.skipLongTermMemory,
        persistMem0Memory:
          !input.skipLongTermMemory &&
          !input.skipMem0Memory &&
          this.memoryService.isEnabled(),
      },
    );
    void this.shortTermMemory
      .addTurns(
        input.threadId,
        [
          ...(input.includeUserMessage !== false
            ? [
                {
                  role: 'user' as const,
                  content: input.query,
                  messageId: persistedMessageIds.userMessageId,
                },
              ]
            : []),
          {
            role: 'assistant' as const,
            content: input.answer,
            messageId: persistedMessageIds.assistantMessageId,
          },
        ],
        input.historyTokenBudget,
      )
      .catch((error: unknown) => {
        this.logger.warn(
          `Short-term memory update failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  ensureNonEmptyAnswer<
    T extends {
      answer: string;
      retrievalSufficient?: boolean;
      retrievalReason?: string;
    },
  >(result: T): T {
    const answer = result.answer?.trim();
    if (answer) return { ...result, answer };

    this.logger.error('Answer pipeline completed without usable model content');
    return {
      ...result,
      answer: '模型未返回有效内容，请切换模型后重试。',
      retrievalSufficient: false,
      retrievalReason: '模型未返回有效内容',
    };
  }

  executionPlanSummary(plan: RetrievalExecutionPlan) {
    return {
      planVersion: plan.planVersion,
      sourcePolicy: plan.sourcePolicy,
      queries: plan.queries,
      useGraph: plan.useGraph,
      scopeRestricted: plan.scopeRestricted,
      reasonCode: plan.reasonCode,
      retrievalIntent: plan.profile.intent,
    };
  }

  async finishFailedRun(
    run: Awaited<ReturnType<AgentRunsService['start']>> | undefined,
    objective: string,
    mode: ChatMode,
    error: unknown,
    status: 'failed' | 'cancelled' = 'failed',
  ): Promise<void> {
    if (!run) return;
    const reason = error instanceof Error ? error.message : String(error);
    await this.agentRuns?.finish(run.id, {
      status,
      errorMessage: reason.slice(0, 2_000),
      ...(status === 'cancelled'
        ? { cancelledAt: new Date(), cancelReason: reason.slice(0, 500) }
        : {}),
      resultSummary:
        status === 'cancelled'
          ? '运行已取消，未生成可用回答。'
          : '运行失败，未生成可用回答。',
    });
    await this.agentGoals?.update({
      threadId: run.threadId,
      runId: run.id,
      tenantId: run.tenantId?.trim() || 'legacy',
      actor: mode,
      objective,
      maxRounds: run.maxSteps,
      status: 'blocked',
      reason,
    });
  }

  protected asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  protected asChatMode(value: unknown): ChatMode | undefined {
    return value === 'simple' || value === 'auto' || value === 'agentic'
      ? value
      : undefined;
  }
}
