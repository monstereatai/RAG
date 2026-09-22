import {
  Injectable,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { KarpathyRagService } from '../../rag/karpathy/karpathy-rag.service';
import { AgenticRagService } from '../../rag/agentic/agentic-rag.service';
import { ConversationService } from './conversation.service';
import { ConversationEmbeddingService } from './conversation-embedding.service';
import { MemoryService } from '../memory/memory.service';
import { ShortTermMemoryService } from '../memory/short-term-memory.service';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';
import { ChatDto, type ChatMode } from './chat.dto';
import type { ChatResponse } from './chat.dto';
import {
  LangfuseProvider,
  type RagTraceEvent,
} from '../../providers/observability/langfuse.provider';
import type { SseEvent } from '../../rag/agentic/sse-event';
import { resolveRoleContext } from './role-presets';
import { KnowledgeBaseProfileEntity } from '../../providers/db/entities/knowledge-base-profile.entity';
import {
  detectRetrievalProfile,
  type RetrievalProfile,
} from '../../rag/karpathy/context-builder';
import { AgentRunsService } from '../agent-runs/agent-runs.service';
import { AgentGoalService } from '../agent-runs/agent-goal.service';
import { createHash } from 'node:crypto';
import { PluginRuntimeService } from '../plugin-runtime/plugin-runtime.service';
import { AgentRuntimeService } from '../agent-runtime/agent-runtime.service';
import { LlmProvider } from '../../providers/llm/llm.provider';
import type { LlmUsage } from '../../providers/llm/llm-provider.interface';
import { detectDangerousQuery } from '../../rag/prompts/prompt-injection.guard';
import { MetricsService } from '../metrics/metrics.service';
import { SecurityAuditService } from '../metrics/security-audit.service';
import {
  buildContextPolicyMessage,
  buildContextualRetrievalQuery,
  formatUntrustedHistoryContext,
  hasRelatedSessionSetting,
  isObjectiveFactQuery,
  selectHistoryForQuery,
} from '../../rag/prompts/context-policy';
import { QueryIntentRouter } from '../../rag/prompts/query-intent-router';
import type { QueryIntent } from '../../rag/prompts/query-intent-router';
import type { ChatEventCallback, RequestContext } from './chat-runtime.types';
import { DingTalkProvider } from '../../providers/notify/dingtalk.provider';
import {
  redactAuditText,
  redactAuditValue,
} from '../../common/security/audit-redaction';

type FinalizableChatResult = {
  answer: string;
  references: ChatResponse['references'];
  confidence?: number;
  retryCount?: number;
  retrievalSufficient?: boolean;
  retrievalReason?: string;
  evidenceCoverage?: ChatResponse['evidenceCoverage'];
  executionState?: ChatResponse['executionState'];
  interrupted?: boolean;
};

type ChatExecutionOptions = {
  model?: string;
  signal?: AbortSignal;
  tenantId?: string;
};

type AggregatedLlmUsage = LlmUsage & { calls: number };

@Injectable()
export class ChatService {
  /**
   * 问答主编排入口：只负责准备上下文、选择执行模式和记录审计；
   * 检索细节下沉到 KarpathyRagService，复杂推理下沉到 AgenticRagService。
   */
  private readonly logger = new Logger(ChatService.name);
  private lastQueryLogRetentionSweepAt = 0;

  constructor(
    private readonly karpathyRagService: KarpathyRagService,
    private readonly agenticRagService: AgenticRagService,
    private readonly conversationService: ConversationService,
    private readonly conversationEmbeddingService: ConversationEmbeddingService,
    private readonly memoryService: MemoryService,
    private readonly shortTermMemory: ShortTermMemoryService,
    private readonly langfuseProvider: LangfuseProvider,
    @InjectRepository(QueryLogEntity)
    private readonly queryLogRepo: Repository<QueryLogEntity>,
    @Optional()
    @InjectRepository(KnowledgeBaseProfileEntity)
    private readonly knowledgeBaseProfileRepo?: Repository<KnowledgeBaseProfileEntity>,
    @Optional() private readonly agentRuns?: AgentRunsService,
    @Optional() private readonly agentGoals?: AgentGoalService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly plugins?: PluginRuntimeService,
    @Optional() private readonly runtime?: AgentRuntimeService,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly securityAudit?: SecurityAuditService,
    @Optional() private readonly queryIntentRouter?: QueryIntentRouter,
    @Optional() private readonly dingTalk?: DingTalkProvider,
    @Optional() private readonly llmProvider?: LlmProvider,
  ) {}

  /**
   * 执行一轮问答。
   *
   * 先确定当前请求可见的历史并完成一次语义分类，再并发准备其余独立上下文；
   * 全部就绪后进入 Simple／Auto／Agentic 的单一执行主干，避免不同模式得到
   * 不一致的会话上下文。
   */
  async chat(
    req: ChatDto,
    userId: string,
    onEvent?: ChatEventCallback,
    executionOptions?: ChatExecutionOptions,
  ): Promise<ChatResponse> {
    if (!req.query || req.query.trim().length === 0) {
      throw new BadRequestException('query is required');
    }
    const dangerousFindings = detectDangerousQuery(req.query);
    if (dangerousFindings.length > 0) {
      for (const finding of dangerousFindings) {
        this.metrics?.observeDangerousQuery(finding.pattern, 'chat');
        this.securityAudit?.record({
          pattern: finding.pattern,
          route: 'chat',
          userId,
          query: req.query,
        });
      }
      throw new BadRequestException({
        code: 'DANGEROUS_QUERY_BLOCKED',
        message: '检测到高风险破坏性操作请求，已阻止进入问答和工具链。',
        patterns: dangerousFindings.map((finding) => finding.pattern),
      });
    }

    const startTime = Date.now();
    const actualUsage: AggregatedLlmUsage = {
      inputTokens: 0,
      outputTokens: 0,
      calls: 0,
    };
    const collectUsage = (usage: LlmUsage) => {
      actualUsage.inputTokens += Math.max(0, usage.inputTokens);
      actualUsage.outputTokens += Math.max(0, usage.outputTokens);
      actualUsage.calls += 1;
    };
    const runWithUsage = <T>(callback: () => Promise<T>) =>
      this.llmProvider?.runWithUsage?.(collectUsage, callback) ?? callback();
    const mode: ChatMode = req.mode ?? 'auto';
    let queryIntent: QueryIntent = {
      intent: 'general' as const,
      contextMode: 'none' as const,
      historyPolicy: 'context_only' as const,
      confidence: 0,
      standaloneQuery: req.query,
      multiIntent: false,
      subQueries: [],
      action: 'retrieve' as const,
      sourcePolicy: 'local_only' as const,
      needsSynthesis: false,
      requiresGraph: false,
      targetKbs: ['general'],
      queryType: 'private_entity' as const,
      entities: [],
      filters: {
        department: null,
        project: null,
        timeRange: null,
        documentType: null,
      },
      rewriteQueries: [],
      reason: '语义路由不可用，保守使用本地检索',
      ambiguity: { detected: false, confidence: 0, senses: [] },
    } satisfies QueryIntent;
    // 插件策略与会话创建互不依赖，先并发完成请求准备。
    const [pluginComposition, threadId] = await Promise.all([
      req.pluginKeys?.length && this.plugins
        ? this.plugins.resolve(req.pluginKeys, mode)
        : Promise.resolve(undefined),
      req.threadId
        ? Promise.resolve(req.threadId)
        : this.createConversation(
            req.query,
            mode,
            userId,
            executionOptions?.tenantId,
          ),
    ]);
    // 先准备本轮可见历史，再做唯一一次语义分类。这样路由器看到的上下文
    // 与后续生成阶段一致，避免先按空历史分类、再按完整历史重新分类。
    const shortTermContext = await this.shortTermMemory.getContext(threadId);
    let history = req.history ?? [];
    if (!req.history) {
      history =
        shortTermContext.recentTurns.length > 0
          ? shortTermContext.recentTurns.map((turn) => ({
              role:
                turn.role === 'assistant'
                  ? ('ai' as const)
                  : ('human' as const),
              content: turn.content,
            }))
          : await this.getConversationHistory(
              threadId,
              5,
              userId,
              executionOptions?.tenantId,
            );
    }
    if (this.queryIntentRouter) {
      queryIntent = await this.queryIntentRouter.classify(req.query, history, {
        onUsage: collectUsage,
      });
    }
    const shouldSearchHistory = Boolean(req.threadId);
    // 事实／定义问题不应携带会话中的用户断言；以语义路由为主，词法判断只作路由失败时的保守兜底。
    const objectiveFactQuery =
      queryIntent.intent === 'objective_fact' ||
      queryIntent.intent === 'system_capability' ||
      queryIntent.queryType === 'public_knowledge' ||
      isObjectiveFactQuery(req.query);
    const [memoryResult, historySearch, runtimePlan, retrievalProfile] =
      await Promise.all([
        // Mem0 长期记忆与短期记忆互不依赖，可以并发检索。
        objectiveFactQuery
          ? Promise.resolve({
              userMemories: [],
              sessionMemories: [],
              systemMessage: null,
            })
          : this.memoryService.searchMemory(req.query, userId, threadId),
        // 相关历史问答向量检索也不依赖本轮短期窗口，可以并发执行。
        shouldSearchHistory && !objectiveFactQuery
          ? this.conversationEmbeddingService.searchHistory(
              req.query,
              2,
              userId,
            )
          : Promise.resolve([]),
        this.runtime
          ? this.runtime.createPlan({ objective: req.query, mode })
          : Promise.resolve(undefined),
        this.resolveRetrievalProfile(
          req.query,
          req.knowledgeBaseKey ??
            req.scope?.projectId ??
            req.scope?.documentType,
        ),
      ]);
    const unfilteredHistory = history;
    if (
      unfilteredHistory.length > 0 &&
      isObjectiveFactQuery(req.query) &&
      hasRelatedSessionSetting(req.query, unfilteredHistory)
    ) {
      queryIntent = {
        ...queryIntent,
        contextMode: 'mixed',
        action: 'retrieve',
        sourcePolicy: 'local_only',
        queryType: 'private_entity',
        reason: '同一实体存在冲突会话设定，先回答客观事实再补充历史',
      };
    }
    history = selectHistoryForQuery(req.query, unfilteredHistory, {
      preserveConflicts:
        queryIntent.contextMode === 'factual_verification' ||
        queryIntent.contextMode === 'mixed',
    });
    if (queryIntent.contextMode === 'conversation_setting') {
      // 当前这条临时设定尚未持久化，先作为状态投影的最后一条有效陈述，
      // 确保“鸡”更新为“南瓜”时不会仍回答上一轮状态。
      history = [...history, { role: 'human', content: req.query }];
    }
    const conversationStateUpdate =
      history.length > 0 &&
      ['conversation_setting', 'context_follow_up'].includes(
        queryIntent.contextMode,
      );
    const maxSteps = this.config?.get<number>('agentRun.maxSteps') ?? 18;
    const maxToolCalls =
      this.config?.get<number>('agentRun.maxToolCalls') ?? 24;
    const requestContext: RequestContext = {
      requestId: randomUUID(),
      userId,
      tenantId: executionOptions?.tenantId,
      threadId,
      query: req.query,
      mode,
      queryIntent,
      sourcePolicy: conversationStateUpdate
        ? 'local_only'
        : queryIntent.sourcePolicy,
      scope: req.scope,
      deadlineAt:
        Date.now() +
        (this.config?.get<number>('agentRun.timeoutMs') ?? 120_000),
      budget: {
        maxSteps,
        maxToolCalls,
        remainingSteps: maxSteps,
        remainingToolCalls: maxToolCalls,
      },
    };
    onEvent?.({
      type: 'thread',
      data: { threadId, requestId: requestContext.requestId },
    });
    onEvent?.({
      type: 'routing',
      data: {
        mode,
        route: mode === 'simple' ? 'simple' : 'pending',
        requestId: requestContext.requestId,
      },
    });
    const bufferedTokens: string[] = [];
    const publishEvent: ChatEventCallback = (event) => {
      if (event.type === 'token') {
        const token =
          typeof event.data === 'string'
            ? event.data
            : event.data == null
              ? ''
              : (JSON.stringify(event.data) ?? '');
        bufferedTokens.push(token);
        return;
      }
      onEvent?.(event);
    };
    const flushBufferedTokens = (finalAnswer?: string) => {
      const streamedAnswer = bufferedTokens.join('');
      const tokens =
        finalAnswer !== undefined && streamedAnswer !== finalAnswer
          ? [finalAnswer]
          : bufferedTokens;
      for (const token of tokens) {
        onEvent?.({ type: 'token', data: token });
      }
      bufferedTokens.length = 0;
    };
    const contextualRetrievalQuery = buildContextualRetrievalQuery(
      req.query,
      history,
    );
    const memoryMessages: Array<{ role: string; content: string }> = [];
    memoryMessages.push({
      role: 'system',
      content: buildContextPolicyMessage(),
    });
    const roleContext = resolveRoleContext(req.rolePresetId, req.scope?.role);
    memoryMessages.push({
      role: 'system',
      content: roleContext.systemMessage,
    });
    const retrievalScope = {
      ...req.scope,
      role: roleContext.role,
    };
    const retrievalOptions = {
      scope: retrievalScope,
      requestContext,
      queryIntent,
      sourcePolicy: conversationStateUpdate
        ? 'local_only'
        : queryIntent.sourcePolicy,
      tenantId: executionOptions?.tenantId,
      knowledgeOnly:
        queryIntent.sourcePolicy === 'local_only' || conversationStateUpdate,
      allowConversationStateAnswer: conversationStateUpdate,
      needsSynthesis: queryIntent.needsSynthesis,
      entities: queryIntent.entities,
      ...(retrievalProfile ? { profile: retrievalProfile } : {}),
      ...(pluginComposition
        ? {
            pluginKeys: pluginComposition.pluginKeys,
            pluginTools: pluginComposition.toolNames,
          }
        : {}),
    };
    // 运行审计先于模型调用创建，确保失败、降级和中断也能在运行中心回放。
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
      await this.agentGoals?.activate({
        threadId,
        runId: run.id,
        actor: mode,
        objective: req.query,
        maxRounds: run.maxSteps,
      });
      await this.agentRuns?.recordRuntimeEvent(run.id, {
        eventType: 'agent.plan.created',
        target: runtimePlan?.planId,
        payload: runtimePlan,
      });
      await this.agentRuns?.recordRuntimeEvent(run.id, {
        eventType: 'context.policy.selected',
        target: 'context-engineering',
        payload: runtimePlan?.contextPolicy,
      });
      if (runtimePlan?.selectedSkills.length) {
        await this.agentRuns?.recordRuntimeEvent(run.id, {
          eventType: 'skill.selected',
          target: 'skill-system',
          payload: { skills: runtimePlan.selectedSkills },
        });
      }
      await this.agentRuns?.recordRuntimeEvent(run.id, {
        eventType: 'request.snapshot',
        target: 'model_request',
        payload: this.requestSnapshot({
          query: req.query,
          mode,
          rolePresetId: req.rolePresetId,
          role: roleContext.role ?? 'business-owner',
          retrievalProfile,
          historyCount: history.length,
          memoryEnabled: Boolean(memoryResult.systemMessage),
          threadId,
          pluginKeys: pluginComposition?.pluginKeys ?? [],
          pluginTools: pluginComposition?.toolNames ?? [],
          runtimePlan,
        }),
      });
    }
    if (memoryResult.systemMessage) {
      memoryMessages.push({
        role: 'system',
        content: memoryResult.systemMessage.content as string,
      });
      this.logger.debug(
        `Memory injected: user=${memoryResult.userMemories.length}, session=${memoryResult.sessionMemories.length}`,
      );
    }

    // Redis 短期记忆注入：最近 N 轮对话 + 历史摘要
    if (threadId && !objectiveFactQuery) {
      if (shortTermContext.systemMessage) {
        memoryMessages.push({
          role: 'system',
          content: shortTermContext.systemMessage.content as string,
        });
        this.logger.debug(
          `Short-term memory injected: ${shortTermContext.recentTurns.length} recent turns, truncated=${shortTermContext.truncatedHistory}`,
        );
      }
      if (run) {
        await this.agentRuns?.recordRuntimeEvent(run.id, {
          eventType: 'memory.context.loaded',
          target: 'short_term_memory',
          payload: {
            recentTurns: shortTermContext.recentTurns.length,
            truncatedHistory: shortTermContext.truncatedHistory,
            summaryLoaded: Boolean(shortTermContext.systemMessage),
          },
        });
      }
    }

    // 对话历史向量化搜索结果已与短期／长期记忆并发取得，此处只负责格式化注入。
    if (historySearch.length > 0) {
      const historyContext = formatUntrustedHistoryContext(historySearch);
      // 将历史对话上下文作为额外的 system 消息注入
      memoryMessages.push({
        role: 'system',
        content: historyContext,
      });
      this.logger.debug(
        `History context injected: ${historySearch.length} relevant conversations`,
      );
    }

    if (mode === 'simple') {
      let result;
      try {
        // 显式 Simple 是用户选择的执行上限：公共直答、多问题或歧义都不能
        // 借由 Agentic 入口绕回状态图。Karpathy 负责固定线性取证和最终校验。
        const answerOptions = {
          ...retrievalOptions,
          signal: executionOptions?.signal,
          retrievalQuery: contextualRetrievalQuery,
          adaptiveVectorSearch: true,
          karpathyDirectAnswer: true,
        };
        const executeSimple = () =>
          onEvent
            ? this.karpathyRagService.answer(
                req.query,
                history,
                userId,
                memoryMessages,
                (token: string) => publishEvent({ type: 'token', data: token }),
                answerOptions,
              )
            : this.karpathyRagService.answer(
                req.query,
                history,
                userId,
                memoryMessages,
                undefined,
                answerOptions,
              );
        result = await runWithUsage(
          () =>
            this.llmProvider?.runWithSignal(
              executionOptions?.signal,
              executeSimple,
            ) ?? executeSimple(),
        );
      } catch (error) {
        await this.finishFailedRun(run, req.query, mode, error);
        throw error;
      }
      result = this.ensureNonEmptyAnswer(result);

      onEvent?.({
        type: 'routing',
        data: { mode, route: 'simple', requestId: requestContext.requestId },
      });
      onEvent?.({
        type: 'retrieval',
        data: {
          references: result.references.length,
          sufficient: result.retrievalSufficient,
        },
      });
      onEvent?.({ type: 'citation', data: result.references });
      flushBufferedTokens(result.answer);
      return this.finalizeChatResult({
        result,
        mode,
        route: 'simple',
        req,
        userId,
        threadId,
        startTime,
        queryIntent,
        run,
        onEvent,
        model: executionOptions?.model,
        traceEvents: [
          {
            type: 'citation',
            data: result.references,
            timestamp: new Date().toISOString(),
          },
          {
            type: 'final',
            data: { route: 'simple', referenceCount: result.references.length },
            timestamp: new Date().toISOString(),
          },
        ],
        executionState: {
          phase: 'completed',
          consumedSteps: 1,
          consumedToolCalls: 0,
          remainingSteps: Math.max(0, requestContext.budget.maxSteps - 1),
          remainingToolCalls: requestContext.budget.remainingToolCalls,
        },
        actualUsage,
        tenantId: executionOptions?.tenantId,
      });
    }

    // agentic / auto 模式走 AgenticRagService
    const traceEvents: RagTraceEvent[] = [];
    let result;
    try {
      const agenticExecutionOptions = executionOptions?.signal
        ? { signal: executionOptions.signal }
        : undefined;
      const executeAgentic = () =>
        this.agenticRagService.run(
          req.query,
          mode,
          (event) => {
            traceEvents.push(this.toTraceEvent(event));
            if (event.type !== 'final') publishEvent(event);
          },
          history,
          threadId,
          userId,
          memoryMessages,
          req.approvalRequired === true,
          {
            ...retrievalOptions,
            retrievalQuery: contextualRetrievalQuery,
            runtimeRunId: run?.id,
          },
          ...(agenticExecutionOptions ? [agenticExecutionOptions] : []),
        );
      result = await runWithUsage(
        () =>
          this.llmProvider?.runWithSignal(
            executionOptions?.signal,
            executeAgentic,
          ) ?? executeAgentic(),
      );
    } catch (error) {
      await this.finishFailedRun(run, req.query, mode, error);
      throw error;
    }
    result = this.ensureNonEmptyAnswer(result);
    flushBufferedTokens(result.answer);

    return this.finalizeChatResult({
      result,
      mode,
      route: result.route,
      req,
      userId,
      threadId,
      startTime,
      queryIntent,
      run: run ?? undefined,
      onEvent,
      model: executionOptions?.model,
      traceEvents,
      actualUsage,
      tenantId: executionOptions?.tenantId,
    });
  }

  private async finalizeChatResult(input: {
    result: FinalizableChatResult;
    mode: ChatMode;
    route: 'simple' | 'agentic';
    req: ChatDto;
    userId: string;
    threadId: string;
    startTime: number;
    queryIntent: QueryIntent;
    run: Awaited<ReturnType<AgentRunsService['start']>> | undefined;
    onEvent?: ChatEventCallback;
    model?: string;
    traceEvents?: RagTraceEvent[];
    executionState?: ChatResponse['executionState'];
    includeUserMessage?: boolean;
    actualUsage?: AggregatedLlmUsage;
    tenantId?: string;
  }): Promise<ChatResponse> {
    const result = input.result;
    if (result.interrupted) {
      return this.finalizeInterruptedChat(input);
    }
    const refused =
      result.answer === this.karpathyRagService.unsupportedReliableAnswer();

    await this.persistConversationResult({
      threadId: input.threadId,
      userId: input.userId,
      query: input.req.query,
      answer: result.answer,
      tenantId: input.tenantId,
      includeUserMessage: input.includeUserMessage,
      skipLongTermMemory:
        input.queryIntent.contextMode !== 'none' &&
        input.queryIntent.contextMode !== 'factual_verification',
      metadata: {
        contextMode: input.queryIntent.contextMode,
        entities: input.queryIntent.entities,
        source: 'session_context',
      },
      answerMetadata: {
        route: input.route,
        confidence: result.confidence,
        retryCount: result.retryCount,
        retrievalSufficient: result.retrievalSufficient,
        retrievalReason: result.retrievalReason,
        references: result.references,
        contextMode: input.queryIntent.contextMode,
      },
    });

    const queryLogId = await this.logQuery({
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
        target: input.route === 'simple' ? 'karpathy_rag' : 'agentic_rag',
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
      await this.recordTraceTimeline(
        input.run.id,
        input.traceEvents,
        input.route,
      );
    }

    const estimatedUsage = this.estimateRunUsage(
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
            costUsd: this.langfuseProvider.estimateCostUsd(
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
        actor: input.mode,
        objective: input.req.query,
        maxRounds: input.run.maxSteps,
        status: refused ? 'blocked' : 'completed',
        reason: refused ? result.retrievalReason : undefined,
      });
    }

    this.traceAnswer({
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

  /**
   * 审批暂停不是最终回答：仅保存用户请求与检查点关联，不写草稿答案、Query Log
   * 或长期记忆。恢复后由 resume() 走同一套终态审计收口。
   */
  private async finalizeInterruptedChat(input: {
    result: FinalizableChatResult;
    mode: ChatMode;
    route: 'simple' | 'agentic';
    req: ChatDto;
    userId: string;
    threadId: string;
    startTime: number;
    queryIntent: QueryIntent;
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
    await this.addConversationMessage(
      input.threadId,
      'human',
      input.req.query,
      input.userId,
      {
        pendingApproval: true,
        runId: input.run?.id,
        mode: input.mode,
        queryIntent: input.queryIntent,
        skipLongTermMemory:
          input.queryIntent.contextMode !== 'none' &&
          input.queryIntent.contextMode !== 'factual_verification',
        model: input.model,
        checkpointId: executionState.checkpointId,
      },
      input.tenantId,
    );
    void this.shortTermMemory.addTurn(input.threadId, 'user', input.req.query);

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
        await this.recordTraceTimeline(
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

  /** 审批恢复统一回到 Chat 编排层，禁止 Controller 直接绕过审计与权限边界。 */
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
    if (run?.userId && run.userId !== userId) {
      throw new BadRequestException('无权恢复其他用户的运行');
    }
    if (run && run.status !== 'waiting_approval') {
      throw new BadRequestException('当前运行不在等待审批状态');
    }

    const queryIntent = this.asQueryIntent(metadata.queryIntent);
    const mode = this.asChatMode(metadata.mode) ?? 'agentic';
    const traceEvents: RagTraceEvent[] = [];
    const resumeEvent = (event: SseEvent) => {
      traceEvents.push(this.toTraceEvent(event));
      if (event.type !== 'final') onEvent?.(event);
    };
    const result = tenantId?.trim()
      ? await this.agenticRagService.resumeGraph(
          threadId,
          approval,
          feedback,
          resumeEvent,
          tenantId,
        )
      : await this.agenticRagService.resumeGraph(
          threadId,
          approval,
          feedback,
          resumeEvent,
        );
    const startTime = Date.now();

    if (approval === 'rejected') {
      const rejectionAnswer = feedback?.trim()
        ? `本次草稿未获批准：${feedback.trim()}`
        : '本次草稿未获批准，未写入正式答案。';
      await this.addConversationMessage(
        threadId,
        'ai',
        rejectionAnswer,
        userId,
        { approval: 'rejected', runId: run?.id },
        tenantId,
      );
      const queryLogId = await this.logQuery({
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
        await this.recordTraceTimeline(run.id, traceEvents, 'agentic');
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
      req: { query: pending.content, mode },
      userId,
      threadId,
      startTime,
      queryIntent,
      run: run ?? undefined,
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

  async logQuery(params: {
    userId: string;
    query: string;
    mode: string;
    threadId: string;
    startTime: number;
    refused: boolean;
    citationCount: number;
    hasAnswer: boolean;
    answer: string;
    references: unknown[];
  }): Promise<string | undefined> {
    const id = randomUUID();
    try {
      await this.queryLogRepo.save(
        this.queryLogRepo.create({
          id,
          userId: params.userId ?? null,
          query: redactAuditText(params.query).slice(0, 2000),
          mode: params.mode as 'simple' | 'agentic' | 'auto',
          threadId: params.threadId ?? null,
          refused: params.refused,
          citationCount: params.citationCount,
          latencyMs: Date.now() - params.startTime,
          hasAnswer: params.hasAnswer,
          answer: redactAuditText(params.answer).slice(0, 20_000),
          retrievalSnapshot: JSON.stringify(
            redactAuditValue(params.references),
          ).slice(0, 100_000),
        }),
      );
      this.scheduleQueryLogRetentionSweep();
      return id;
    } catch (err) {
      this.logger.warn(`Failed to log query: ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * ChatService 直接写入 query_logs，不能依赖仅由运营 QueryLogService 触发的清理。
   * 保持低频触发，清理失败只记录日志，不影响回答主链路。
   */
  private scheduleQueryLogRetentionSweep(): void {
    const now = Date.now();
    if (now - this.lastQueryLogRetentionSweepAt < 60 * 60 * 1000) return;
    this.lastQueryLogRetentionSweepAt = now;
    const repo = this.queryLogRepo as unknown as {
      createQueryBuilder?: () => {
        delete: () => unknown;
      };
    };
    if (typeof repo.createQueryBuilder !== 'function') return;
    void this.purgeExpiredQueryLogs().catch((error: unknown) => {
      this.logger.warn(
        `Failed to purge expired query logs: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  private async purgeExpiredQueryLogs(): Promise<void> {
    const retentionDays = Math.min(
      Math.max(
        Number(this.config?.get<number>('queryLog.retentionDays') ?? 180),
        1,
      ),
      3650,
    );
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    await this.queryLogRepo
      .createQueryBuilder()
      .delete()
      .from(QueryLogEntity)
      .where('createdAt < :cutoff', { cutoff })
      .execute();
  }

  private createConversation(
    query: string,
    mode: ChatMode,
    userId: string,
    tenantId?: string,
  ): Promise<string> {
    return tenantId?.trim()
      ? this.conversationService.create(query, mode, userId, tenantId.trim())
      : this.conversationService.create(query, mode, userId);
  }

  private getConversationHistory(
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

  private getConversation(threadId: string, userId: string, tenantId?: string) {
    return tenantId?.trim()
      ? this.conversationService.get(threadId, userId, tenantId.trim())
      : this.conversationService.get(threadId, userId);
  }

  private addConversationMessage(
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

  /** 两个执行引擎共用同一份会话、记忆与历史向量收口，避免分支漏写。 */
  private async persistConversationResult(input: {
    threadId: string;
    userId: string;
    query: string;
    answer: string;
    tenantId?: string;
    includeUserMessage?: boolean;
    skipLongTermMemory?: boolean;
    metadata?: Record<string, unknown>;
    answerMetadata?: Record<string, unknown>;
  }): Promise<void> {
    if (input.includeUserMessage !== false) {
      await this.addConversationMessage(
        input.threadId,
        'human',
        input.query,
        input.userId,
        input.metadata,
        input.tenantId,
      );
    }
    await this.addConversationMessage(
      input.threadId,
      'ai',
      input.answer,
      input.userId,
      input.answerMetadata,
      input.tenantId,
    );
    if (input.includeUserMessage !== false) {
      void this.shortTermMemory.addTurn(input.threadId, 'user', input.query);
    }
    void this.shortTermMemory.addTurn(
      input.threadId,
      'assistant',
      input.answer,
    );
    if (!input.skipLongTermMemory) {
      void this.memoryService.classifyAndPersist(
        input.userId,
        input.threadId,
        input.query,
        input.answer,
      );
      void this.conversationEmbeddingService.indexConversation(
        input.threadId,
        input.query,
        input.answer,
        input.userId,
      );
    }
  }

  /**
   * 空回答不是成功结果：禁止写入会话、记忆、日志和 SSE 结束事件，避免前端只剩运行轨迹。
   */
  private ensureNonEmptyAnswer<
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

  private async resolveRetrievalProfile(
    query: string,
    key?: string,
  ): Promise<RetrievalProfile | undefined> {
    const detected = detectRetrievalProfile(query);
    if (!key?.trim()) return undefined;
    const config = await this.knowledgeBaseProfileRepo?.findOne({
      where: { key: key.trim(), workspaceId: 'default', status: 'enabled' },
    });
    if (!config?.retrievalConfig) return detected;
    try {
      const overrides = JSON.parse(
        config.retrievalConfig,
      ) as Partial<RetrievalProfile>;
      return { ...detected, ...overrides, intent: detected.intent };
    } catch {
      this.logger.warn(`Invalid retrievalConfig for knowledge base ${key}`);
      return detected;
    }
  }

  /**
   * Provider 当前只提供文本结果，不能稳定取得所有模型的真实 usage；这里按实际
   * 完成的模型节点汇总估算，并把 estimated 标记写入 Run 事件，避免把它当账单。
   */
  private estimateRunUsage(
    query: string,
    answer: string,
    route: 'simple' | 'agentic',
    events?: RagTraceEvent[],
  ): {
    modelCallsEstimated: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    source: 'estimated_from_completed_nodes';
  } {
    const modelNodes = new Set(['queryAugment', 'generate', 'reflection']);
    const completedModelNodes = (events ?? []).flatMap((event) => {
      if (event.type !== 'node_timing') return [];
      const data = this.asRecord(event.data);
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

  private traceAnswer(params: {
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
  }): void {
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

  private requestSnapshot(input: {
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
  }) {
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
        answer: input.mode === 'simple' ? 'karpathy/v1' : 'agentic/v1',
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

  private toTraceEvent(event: SseEvent): RagTraceEvent {
    return {
      type: event.type,
      data: event.type === 'token' ? undefined : event.data,
      timestamp: new Date().toISOString(),
    };
  }

  private async recordTraceTimeline(
    runId: string,
    events: RagTraceEvent[],
    route: string,
  ): Promise<void> {
    for (const event of events) {
      const data = this.asRecord(event.data);
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

  private async finishFailedRun(
    run: Awaited<ReturnType<AgentRunsService['start']>> | undefined,
    objective: string,
    mode: ChatMode,
    error: unknown,
  ): Promise<void> {
    if (!run) return;
    const reason = error instanceof Error ? error.message : String(error);
    await this.agentRuns?.finish(run.id, {
      status: 'failed',
      errorMessage: reason.slice(0, 2_000),
      resultSummary: '运行失败，未生成可用回答。',
    });
    await this.agentGoals?.update({
      threadId: run.threadId,
      runId: run.id,
      actor: mode,
      objective,
      maxRounds: run.maxSteps,
      status: 'blocked',
      reason,
    });
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private asChatMode(value: unknown): ChatMode | undefined {
    return value === 'simple' || value === 'auto' || value === 'agentic'
      ? value
      : undefined;
  }

  private asQueryIntent(value: unknown): QueryIntent {
    const intent = this.asRecord(value);
    if (
      intent &&
      typeof intent.contextMode === 'string' &&
      typeof intent.sourcePolicy === 'string' &&
      typeof intent.action === 'string'
    ) {
      return intent as unknown as QueryIntent;
    }
    return {
      intent: 'general',
      contextMode: 'none',
      historyPolicy: 'context_only',
      confidence: 0,
      standaloneQuery: '',
      multiIntent: false,
      subQueries: [],
      action: 'retrieve',
      sourcePolicy: 'local_only',
      needsSynthesis: false,
      requiresGraph: false,
      targetKbs: ['general'],
      queryType: 'private_entity',
      entities: [],
      filters: {
        department: null,
        project: null,
        timeRange: null,
        documentType: null,
      },
      rewriteQueries: [],
      reason: '恢复请求缺少原始语义上下文，保守使用本地边界',
      ambiguity: { detected: false, confidence: 0, senses: [] },
    };
  }
}
