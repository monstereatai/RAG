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
import { detectDangerousQuery } from '../../rag/prompts/prompt-injection.guard';
import { MetricsService } from '../metrics/metrics.service';
import { SecurityAuditService } from '../metrics/security-audit.service';
import {
  buildContextPolicyMessage,
  formatUntrustedHistoryContext,
  isObjectiveFactQuery,
  selectHistoryForQuery,
} from '../../rag/prompts/context-policy';
import { QueryIntentRouter } from '../../rag/prompts/query-intent-router';
import type { QueryIntent } from '../../rag/prompts/query-intent-router';
import type { ChatEventCallback, RequestContext } from './chat-runtime.types';

@Injectable()
export class ChatService {
  /**
   * 问答主编排入口：只负责准备上下文、选择执行模式和记录审计；
   * 检索细节下沉到 KarpathyRagService，复杂推理下沉到 AgenticRagService。
   */
  private readonly logger = new Logger(ChatService.name);

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
  ) {}

  /**
   * 执行一轮问答。
   *
   * 上下文准备阶段刻意并发：短期窗口、长期记忆、历史问答、运行计划和检索 Profile
   * 没有相互依赖；全部就绪后才进入 Simple／Auto／Agentic 的单一执行主干，避免
   * 让不同模式得到不一致的会话上下文。
   */
  async chat(
    req: ChatDto,
    userId: string,
    onEvent?: ChatEventCallback,
  ): Promise<ChatResponse> {
    if (!req.query || req.query.trim().length === 0) {
      throw new BadRequestException('query is required');
    }
    const dangerousFindings = detectDangerousQuery(req.query);
    if (dangerousFindings.length > 0) {
      for (const finding of dangerousFindings) {
        this.metrics?.observeDangerousQuery(finding.pattern, 'chat');
        this.securityAudit?.record({ pattern: finding.pattern, route: 'chat', userId, query: req.query });
      }
      throw new BadRequestException({
        code: 'DANGEROUS_QUERY_BLOCKED',
        message: '检测到高风险破坏性操作请求，已阻止进入问答和工具链。',
        patterns: dangerousFindings.map((finding) => finding.pattern),
      });
    }

    const startTime = Date.now();
    const mode: ChatMode = req.mode ?? 'auto';
    const queryIntent = this.queryIntentRouter
      ? await this.queryIntentRouter.classify(req.query)
      : ({
          intent: 'general' as const,
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
        } satisfies QueryIntent);
    // 插件策略与会话创建互不依赖，先并发完成请求准备。
    const [pluginComposition, threadId] = await Promise.all([
      req.pluginKeys?.length && this.plugins
        ? this.plugins.resolve(req.pluginKeys, mode)
        : Promise.resolve(undefined),
      req.threadId
        ? Promise.resolve(req.threadId)
        : this.conversationService.create(req.query, 'auto', userId),
    ]);
    const maxSteps = this.config?.get<number>('agentRun.maxSteps') ?? 18;
    const maxToolCalls = this.config?.get<number>('agentRun.maxToolCalls') ?? 24;
    const requestContext: RequestContext = {
      requestId: randomUUID(),
      userId,
      threadId,
      query: req.query,
      mode,
      queryIntent,
      sourcePolicy: queryIntent.sourcePolicy,
      scope: req.scope,
      deadlineAt: Date.now() + (this.config?.get<number>('agentRun.timeoutMs') ?? 120_000),
      budget: {
        maxSteps,
        maxToolCalls,
        remainingSteps: maxSteps,
        remainingToolCalls: maxToolCalls,
      },
    };
    onEvent?.({ type: 'thread', data: { threadId, requestId: requestContext.requestId } });
    onEvent?.({ type: 'routing', data: { mode, route: mode === 'simple' ? 'simple' : 'pending', requestId: requestContext.requestId } });
    const shouldSearchHistory = Boolean(req.threadId);
    const objectiveFactQuery = isObjectiveFactQuery(req.query);
    const [
      shortTermContext,
      memoryResult,
      historySearch,
      runtimePlan,
      retrievalProfile,
    ] = await Promise.all([
      // 短期记忆服务内部统一读取最近窗口和压缩摘要，负责裁剪、回退和去重。
      this.shortTermMemory.getContext(threadId),
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
        ? this.conversationEmbeddingService.searchHistory(req.query, 2, userId)
        : Promise.resolve([]),
      this.runtime
        ? this.runtime.createPlan({ objective: req.query, mode })
        : Promise.resolve(undefined),
      this.resolveRetrievalProfile(
        req.query,
        req.knowledgeBaseKey ?? req.scope?.projectId ?? req.scope?.documentType,
      ),
    ]);
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
          : await this.conversationService.getRecentHistory(
              threadId,
              5,
              userId,
            );
    }
    history = selectHistoryForQuery(req.query, history);
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
      sourcePolicy: queryIntent.sourcePolicy,
      knowledgeOnly: queryIntent.sourcePolicy === 'local_only',
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
    if (threadId) {
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
          adaptiveVectorSearch: true,
          karpathyDirectAnswer: true,
        };
        result = onEvent
          ? await this.karpathyRagService.answer(
              req.query,
              history,
              userId,
              memoryMessages,
              (token: string) => onEvent({ type: 'token', data: token }),
              answerOptions,
            )
          : await this.karpathyRagService.answer(
              req.query,
              history,
              userId,
              memoryMessages,
              undefined,
              answerOptions,
            );
      } catch (error) {
        await this.finishFailedRun(run, req.query, mode, error);
        throw error;
      }

      if (run) {
        await this.agentRuns?.recordRuntimeEvent(run.id, {
          eventType: 'route.selected',
          target: 'simple',
          payload: { requestedMode: mode, route: 'simple' },
        });
        await this.agentRuns?.recordRuntimeEvent(run.id, {
          eventType: 'retrieval.completed',
          target: 'karpathy_rag',
          payload: {
            references: result.references.length,
            sufficient: result.retrievalSufficient,
            reason: result.retrievalReason,
          },
        });
      }
      onEvent?.({ type: 'routing', data: { mode, route: 'simple', requestId: requestContext.requestId } });
      onEvent?.({ type: 'retrieval', data: { references: result.references.length, sufficient: result.retrievalSufficient } });
      onEvent?.({ type: 'citation', data: result.references });

      await this.persistConversationResult({
        threadId,
        userId,
        query: req.query,
        answer: result.answer,
      });

      const queryLogId = await this.logQuery({
        userId,
        query: req.query,
        mode,
        threadId,
        startTime,
        refused:
          result.answer === this.karpathyRagService.unsupportedReliableAnswer(),
        citationCount: result.references.length,
        hasAnswer: result.answer.length > 0,
        answer: result.answer,
        references: result.references,
      });
      const estimatedCostUsd = this.langfuseProvider.estimateCostUsd(
        this.langfuseProvider.estimateTextTokens(req.query),
        this.langfuseProvider.estimateTextTokens(result.answer),
      );
      if (run)
        await this.agentRuns?.finish(run.id, {
          queryLogId,
          route: 'simple',
          status: 'completed',
          costUsd: estimatedCostUsd,
          requiresApproval:
            estimatedCostUsd >
            (this.config?.get<number>('agentRun.budgetUsd') ?? 0.2),
          resultSummary: result.answer.slice(0, 2000),
        });
      if (run) {
        await this.agentGoals?.update({
          threadId,
          runId: run.id,
          actor: mode,
          objective: req.query,
          maxRounds: run.maxSteps,
          status:
            result.answer ===
            this.karpathyRagService.unsupportedReliableAnswer()
              ? 'blocked'
              : 'completed',
          reason:
            result.answer ===
            this.karpathyRagService.unsupportedReliableAnswer()
              ? result.retrievalReason
              : undefined,
        });
      }
      this.traceAnswer({
        userId,
        query: req.query,
        mode,
        route: 'simple',
        threadId,
        startTime,
        answer: result.answer,
        references: result.references,
        refused:
          result.answer === this.karpathyRagService.unsupportedReliableAnswer(),
        events: [
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
      });
      onEvent?.({
        type: 'final',
        data: { ...result, mode: 'simple', route: 'simple', threadId, queryLogId },
      });

      return {
        ...result,
        mode: 'simple',
        route: 'simple',
        threadId,
        queryLogId,
        runId: run?.id,
        executionState: {
          phase: 'completed',
          consumedSteps: 1,
          consumedToolCalls: 0,
          remainingSteps: Math.max(0, requestContext.budget.maxSteps - 1),
          remainingToolCalls: requestContext.budget.remainingToolCalls,
        },
      };
    }

    // agentic / auto 模式走 AgenticRagService
    const traceEvents: RagTraceEvent[] = [];
    let result;
    try {
      result = await this.agenticRagService.run(
        req.query,
        mode,
        (event) => {
          traceEvents.push(this.toTraceEvent(event));
          if (event.type !== 'final') onEvent?.(event);
        },
        history,
        threadId,
        userId,
        memoryMessages,
        false,
        { ...retrievalOptions, runtimeRunId: run?.id },
      );
    } catch (error) {
      await this.finishFailedRun(run, req.query, mode, error);
      throw error;
    }

    await this.persistConversationResult({
      threadId,
      userId,
      query: req.query,
      answer: result.answer,
    });

    const queryLogId = await this.logQuery({
      userId,
      query: req.query,
      mode,
      threadId,
      startTime,
      refused:
        result.answer === this.karpathyRagService.unsupportedReliableAnswer(),
      citationCount: result.references?.length ?? 0,
      hasAnswer: result.answer.length > 0,
      answer: result.answer,
      references: result.references ?? [],
    });
    for (const event of traceEvents) {
      if (
        event.type === 'tool_call' ||
        event.type === 'node_start' ||
        event.type === 'node_end'
      ) {
        const data = event.data as Record<string, unknown> | undefined;
        const actionName =
          typeof data?.name === 'string' ? data.name : event.type;
        const riskLevel = /write|delete|send|publish|deploy/i.test(actionName)
          ? 'high'
          : 'low';
        if (run)
          await this.agentRuns?.recordAction(run.id, {
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
    if (run) {
      await this.recordTraceTimeline(run.id, traceEvents, result.route);
      await this.agentRuns?.recordRuntimeEvent(run.id, {
        eventType: 'retrieval.completed',
        target: 'agentic_rag',
        payload: {
          references: result.references?.length ?? 0,
          sufficient: result.retrievalSufficient,
          reason: result.retrievalReason,
          retryCount: result.retryCount,
        },
      });
    }
    const estimatedCostUsd = this.langfuseProvider.estimateCostUsd(
      this.langfuseProvider.estimateTextTokens(req.query),
      this.langfuseProvider.estimateTextTokens(result.answer),
    );
    if (run)
      await this.agentRuns?.finish(run.id, {
        queryLogId,
        route: result.route,
        status: 'completed',
        retryCount: result.retryCount,
        costUsd: estimatedCostUsd,
        requiresApproval:
          estimatedCostUsd >
          (this.config?.get<number>('agentRun.budgetUsd') ?? 0.2),
        resultSummary: result.answer.slice(0, 2000),
      });
    if (run) {
      await this.agentGoals?.update({
        threadId,
        runId: run.id,
        actor: mode,
        objective: req.query,
        maxRounds: run.maxSteps,
        status:
          result.answer === this.karpathyRagService.unsupportedReliableAnswer()
            ? 'blocked'
            : 'completed',
        reason:
          result.answer === this.karpathyRagService.unsupportedReliableAnswer()
            ? result.retrievalReason
            : undefined,
      });
    }
    this.traceAnswer({
      userId,
      query: req.query,
      mode,
      route: result.route,
      threadId,
      startTime,
      answer: result.answer,
      references: result.references ?? [],
      refused:
        result.answer === this.karpathyRagService.unsupportedReliableAnswer(),
      events: traceEvents,
    });

    onEvent?.({
      type: 'final',
      data: {
        answer: result.answer,
        references: result.references,
        mode,
        route: result.route,
        threadId,
        queryLogId,
      },
    });

    return {
      answer: result.answer,
      references: result.references,
      mode,
      route: result.route,
      confidence: result.confidence,
      retryCount: result.retryCount,
      retrievalSufficient: result.retrievalSufficient,
      retrievalReason: result.retrievalReason,
      evidenceCoverage: result.evidenceCoverage,
      executionState: result.executionState
        ? { phase: 'completed', ...result.executionState }
        : undefined,
      threadId,
      queryLogId,
      runId: run?.id,
    };
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
          query: params.query.slice(0, 2000),
          mode: params.mode as 'simple' | 'agentic' | 'auto',
          threadId: params.threadId ?? null,
          refused: params.refused,
          citationCount: params.citationCount,
          latencyMs: Date.now() - params.startTime,
          hasAnswer: params.hasAnswer,
          answer: params.answer.slice(0, 20_000),
          retrievalSnapshot: JSON.stringify(params.references).slice(
            0,
            100_000,
          ),
        }),
      );
      return id;
    } catch (err) {
      this.logger.warn(`Failed to log query: ${(err as Error).message}`);
      return undefined;
    }
  }

  /** 两个执行引擎共用同一份会话、记忆与历史向量收口，避免分支漏写。 */
  private async persistConversationResult(input: {
    threadId: string;
    userId: string;
    query: string;
    answer: string;
  }): Promise<void> {
    await this.conversationService.addMessage(
      input.threadId,
      'human',
      input.query,
      input.userId,
    );
    await this.conversationService.addMessage(
      input.threadId,
      'ai',
      input.answer,
      input.userId,
    );
    void this.shortTermMemory.addTurn(input.threadId, 'user', input.query);
    void this.shortTermMemory.addTurn(input.threadId, 'assistant', input.answer);
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

  private traceAnswer(params: {
    userId: string;
    query: string;
    mode: string;
    route: string;
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
  }): void {
    const inputTokens = this.langfuseProvider.estimateTextTokens(params.query);
    const outputTokens = this.langfuseProvider.estimateTextTokens(
      params.answer,
    );
    this.langfuseProvider.traceRagAnswer({
      userId: params.userId,
      threadId: params.threadId,
      query: params.query,
      answer: params.answer,
      mode: params.mode,
      route: params.route,
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
      costUsdEstimated: this.langfuseProvider.estimateCostUsd(
        inputTokens,
        outputTokens,
      ),
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
}
