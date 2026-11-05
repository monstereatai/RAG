import { BadRequestException } from '@nestjs/common';
import type { RetrieveOptions } from '../contracts/rag-types';
import { SseCallback } from './sse-event';
import { type AgenticRagStateType } from './agentic-rag.state';
import {
  createFallbackQueryPlan,
  shouldClarifyQueryPlan,
} from '../planning/query-plan';
import { detectDangerousQuery } from '../prompts/prompt-injection.guard';
import { agenticPromptDefinitions } from '../prompts/agentic.prompts';
import { getPromptMetadata } from '../prompts/prompt-registry';
import { countTextTokens } from '../../modules/document/chunking.util';
import { RunnableConfig } from '@langchain/core/runnables';
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../contracts/request-context';
import {
  buildExplicitSubQuestions,
  hasExplicitScopeFilter,
  requiresAgenticPlan,
  resolveAgenticRoute,
} from './agentic-rag-planning';
import { AgenticRagResume } from './agentic-rag.resume';
import type { AgenticRagRunResult } from './agentic-rag.types';

function hasInterruptingTasks(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const tasks: unknown = Reflect.get(snapshot, 'tasks');
  if (!Array.isArray(tasks)) return false;
  return tasks.some((task) => {
    if (!task || typeof task !== 'object') return false;
    const interrupts: unknown = Reflect.get(task, 'interrupts');
    return Array.isArray(interrupts) && interrupts.length > 0;
  });
}

export class AgenticRagExecution extends AgenticRagResume {
  /**
   * 完整执行 Agentic RAG 工作流（带 SSE 回调）
   */
  /**
   * 运行一次可回放的深度问答。`onEvent` 是唯一的流式出口，因此此处统一记录
   * 首 Token 延迟、工具成功率并向前端转发，避免节点各自发送不一致事件。
   */
  async run(
    query: string,
    mode: 'simple' | 'agentic' | 'auto',
    onEvent?: SseCallback,
    history: Array<{ role: 'human' | 'ai'; content: string }> = [],
    threadId = 'default-thread',
    userId?: string,
    memoryMessages: Array<{ role: string; content: string }> = [],
    enableInterrupt = false,
    retrieveOptions: RetrieveOptions = {},
    executionOptions: { signal?: AbortSignal } = {},
  ): Promise<AgenticRagRunResult> {
    const cancellation = this.watchRunCancellation(
      threadId,
      retrieveOptions.runtimeRunId,
      executionOptions.signal,
    );
    try {
      await cancellation.ready;
      const result = await this.runInternal(
        query,
        mode,
        onEvent,
        history,
        threadId,
        userId,
        memoryMessages,
        enableInterrupt,
        retrieveOptions,
        { ...executionOptions, signal: cancellation.signal },
      );
      await cancellation.checkNow();
      if (executionOptions.signal?.aborted) {
        throw executionOptions.signal.reason ?? new Error('Agent run aborted');
      }
      if (cancellation.wasCancelled()) {
        throw new BadRequestException({
          code: 'AGENT_RUN_CANCELLED',
          message: '运行已取消，不再执行后续节点。',
        });
      }
      return result;
    } catch (error) {
      if (cancellation.wasCancelled()) {
        throw new BadRequestException({
          code: 'AGENT_RUN_CANCELLED',
          message: '运行已取消，不再执行后续节点。',
        });
      }
      throw error;
    } finally {
      cancellation.dispose();
    }
  }

  protected async runInternal(
    query: string,
    mode: 'simple' | 'agentic' | 'auto',
    onEvent?: SseCallback,
    history: Array<{ role: 'human' | 'ai'; content: string }> = [],
    threadId = 'default-thread',
    userId?: string,
    memoryMessages: Array<{ role: string; content: string }> = [],
    enableInterrupt = false,
    retrieveOptions: RetrieveOptions = {},
    executionOptions: { signal?: AbortSignal } = {},
  ): Promise<AgenticRagRunResult> {
    if (executionOptions.signal?.aborted) {
      throw (
        executionOptions.signal.reason ??
        new BadRequestException({
          code: 'AGENT_RUN_CANCELLED',
          message: '运行已取消，不再执行后续节点。',
        })
      );
    }
    retrieveOptions.signal = executionOptions.signal;
    const dangerousFindings = detectDangerousQuery(query);
    if (dangerousFindings.length > 0) {
      for (const finding of dangerousFindings) {
        this.metricsService.observeDangerousQuery(finding.pattern, 'agentic');
        this.securityAudit?.record({
          pattern: finding.pattern,
          route: 'agentic',
          query,
        });
      }
      throw new BadRequestException({
        code: 'DANGEROUS_QUERY_BLOCKED',
        message: '检测到高风险破坏性操作请求，已阻止进入 Agent、检索和工具链。',
        patterns: dangerousFindings.map((finding) => finding.pattern),
      });
    }
    const requestStartedAt = Date.now();
    const downstreamOnEvent = onEvent;
    let firstTokenRecorded = false;
    let observedRoute = mode;
    onEvent = (event) => {
      if (event.type === 'token' && !firstTokenRecorded) {
        firstTokenRecorded = true;
        this.metricsService.observeAgentFirstToken(
          observedRoute,
          (Date.now() - requestStartedAt) / 1000,
        );
      }
      if (event.type === 'tool_call') {
        const data = this.recordOf(event.data);
        this.metricsService.observeAgentToolCall(
          typeof data.name === 'string' ? data.name : 'unknown',
          data.success !== false && !data.error,
        );
      }
      downstreamOnEvent?.(event);
    };
    // 系统能力/公共事实/多问题边界由统一 QueryPlan 表达；执行策略由后端 Policy 生成。
    const queryPlan =
      retrieveOptions.queryPlan ?? createFallbackQueryPlan(query);
    let executionPlan =
      retrieveOptions.executionPlan ??
      this.resolveExecutionPlan(query, retrieveOptions);
    const requestedSourcePolicy = retrieveOptions.sourcePolicy;
    const supplementalEvidencePresent = Boolean(
      retrieveOptions.supplementalEvidence?.length,
    );
    const scopeRestricted =
      executionPlan.scopeRestricted === true ||
      hasExplicitScopeFilter(executionPlan.scope) ||
      hasExplicitScopeFilter(retrieveOptions.scope) ||
      supplementalEvidencePresent;
    const queryRequiresLocalEvidence =
      queryPlan.domain === 'internal' ||
      (queryPlan.domain === 'public' && queryPlan.action !== 'direct') ||
      ['setting', 'follow_up', 'mixed'].includes(queryPlan.contextMode);
    const mustUseLocalEvidence =
      requestedSourcePolicy === 'local_only' ||
      scopeRestricted ||
      queryRequiresLocalEvidence;
    const effectiveSourcePolicy = mustUseLocalEvidence
      ? 'local_only'
      : executionPlan.sourcePolicy;
    const effectiveScope = executionPlan.scope ?? retrieveOptions.scope;
    executionPlan = {
      ...executionPlan,
      sourcePolicy: effectiveSourcePolicy,
      scope: effectiveScope,
      scopeRestricted,
      ...(mustUseLocalEvidence
        ? { reasonCode: 'internal_evidence_required' as const }
        : {}),
    };
    retrieveOptions.knowledgeOnly = effectiveSourcePolicy === 'local_only';
    retrieveOptions.sourcePolicy = effectiveSourcePolicy;
    retrieveOptions.executionPlan = executionPlan;
    if (retrieveOptions.requestContext) {
      retrieveOptions.requestContext = {
        ...retrieveOptions.requestContext,
        queryPlan,
        executionPlan,
        sourcePolicy: effectiveSourcePolicy,
        scope: effectiveScope,
      };
    }
    const multiIntent = queryPlan.subQueries.length > 0;
    const routeMetadata = {
      action: queryPlan.action,
      domain: queryPlan.domain,
      contextMode: queryPlan.contextMode,
      sourcePolicy: effectiveSourcePolicy,
      taskType: queryPlan.taskType,
      entities: queryPlan.entities,
      needsGraph: executionPlan.useGraph,
      filters: queryPlan.filters,
      queries: executionPlan.queries,
      reason: executionPlan.reasonCode,
    };
    retrieveOptions.needsSynthesis = queryPlan.taskType === 'synthesis';
    retrieveOptions.entities = queryPlan.entities;
    retrieveOptions.queryPlan = queryPlan;
    if (!retrieveOptions.requestContext) {
      const maxSteps =
        this.configService.get<number>('agentRun.maxSteps') ?? 18;
      const maxToolCalls =
        this.configService.get<number>('agentRun.maxToolCalls') ?? 24;
      retrieveOptions.requestContext = {
        requestId: randomUUID(),
        userId: userId ?? 'anonymous',
        tenantId: retrieveOptions.tenantId,
        threadId,
        query,
        mode,
        queryPlan,
        executionPlan,
        sourcePolicy: effectiveSourcePolicy,
        scope: retrieveOptions.scope,
        deadlineAt:
          Date.now() +
          (this.configService.get<number>('agentRun.timeoutMs') ?? 120_000),
        budget: {
          maxSteps,
          maxToolCalls,
          remainingSteps: maxSteps,
          remainingToolCalls: maxToolCalls,
        },
      } satisfies RequestContext;
    }
    if (
      shouldClarifyQueryPlan(queryPlan) &&
      !retrieveOptions.forceAgenticRoute
    ) {
      const answer =
        queryPlan.clarificationQuestion ??
        '这个问题存在多种可能含义。请补充具体对象、项目或业务场景。';
      onEvent?.({
        type: 'routing',
        data: { mode, route: 'clarify', reason: 'ambiguous_query' },
      });
      onEvent?.({
        type: 'sufficiency',
        data: { sufficient: false, reason: '多义词语境不足，先澄清词义' },
      });
      onEvent?.({ type: 'token', data: answer });
      const direct = {
        answer,
        references: [],
        retrievalSufficient: false,
        retrievalReason: '多义词语境不足，先澄清词义',
      };
      onEvent?.({ type: 'citation', data: [] });
      onEvent?.({ type: 'final', data: direct });
      return {
        ...direct,
        route: 'simple' as const,
        confidence: 0.5,
        retryCount: 0,
        evidenceCoverage: [],
      };
    }
    if (
      // Auto 的职责是先用 Fast Path 判断是否已有本地证据，再在两个引擎间路由。
      // 这里提前直答会绕过本地证据，导致同一个问题在 Auto 下被模型误判为公共知识；
      // Simple 才允许在明确 direct_answer 边界内跳过检索。
      (mode === 'simple' || mode === 'auto') &&
      queryPlan.action === 'direct' &&
      !multiIntent &&
      !supplementalEvidencePresent &&
      !scopeRestricted &&
      queryPlan.domain === 'public' &&
      (queryPlan.contextMode === 'independent' ||
        queryPlan.contextMode === 'verification') &&
      executionPlan.sourcePolicy === 'direct_answer' &&
      retrieveOptions.sourcePolicy !== 'local_only'
    ) {
      const modelName = this.llmProvider.getActiveProviderName();
      const prompt = agenticPromptDefinitions.directAnswer.replace(
        '{query}',
        query,
      );
      const estimatedInputTokens = (await countTextTokens(prompt)) + 4;
      const maxInputTokens = this.getMaxInputTokens('fast');
      if (estimatedInputTokens > maxInputTokens) {
        this.logger.warn(
          `Direct answer skipped because its protected prompt exceeds the input budget: tokens=${estimatedInputTokens}/${maxInputTokens}`,
        );
      } else {
        onEvent?.({
          type: 'routing',
          data: { mode, route: 'simple', reason: 'system_capability_direct' },
        });
        onEvent?.({
          type: 'sufficiency',
          data: {
            sufficient: true,
            reason: '客观事实问答，直接回答',
          },
        });
        let answer: string;
        try {
          answer = await this.llmProvider.invoke(prompt, {
            signal: this.composeSignal(retrieveOptions.signal, 30_000),
            metadata: getPromptMetadata('agentic.direct_answer'),
          });
          if (!answer.trim()) {
            throw new Error('LLM returned an empty direct answer');
          }
        } catch {
          const message = '模型未返回有效内容，请切换模型后重试。';
          this.logger.warn(
            `Direct answer failed for provider=${modelName}; returning controlled error`,
          );
          onEvent?.({
            type: 'error',
            data: { code: 'LLM_UNAVAILABLE', message, provider: modelName },
          });
          onEvent?.({ type: 'token', data: message });
          const failed = {
            answer: message,
            references: [],
            retrievalSufficient: false,
            retrievalReason: '模型服务调用失败',
          };
          onEvent?.({ type: 'citation', data: [] });
          onEvent?.({ type: 'final', data: failed });
          return {
            ...failed,
            route: 'simple' as const,
            confidence: 0,
            retryCount: 0,
            evidenceCoverage: [],
          };
        }
        for (const token of this.splitAnswerTokens(answer)) {
          onEvent?.({ type: 'token', data: token });
        }
        const direct = {
          answer,
          references: [],
          retrievalSufficient: true,
          retrievalReason: '客观事实问答，直接回答',
        };
        onEvent?.({ type: 'citation', data: [] });
        onEvent?.({ type: 'final', data: direct });
        return {
          ...direct,
          route: 'simple' as const,
          confidence: 1,
          retryCount: 0,
        };
      }
    }
    // Auto 先检查快速路径的证据；不足时升级到 Agentic 状态图。
    const fastPathGate =
      !multiIntent && mode === 'auto'
        ? await this.fastPathCapability.assessFastPath(
            query,
            userId,
            retrieveOptions,
          )
        : null;
    const route = resolveAgenticRoute({
      mode,
      queryPlan,
      allowConversationStateAnswer: Boolean(
        retrieveOptions.allowConversationStateAnswer,
      ),
      multiIntent,
      fastPathSufficient: Boolean(fastPathGate?.sufficient),
    });
    observedRoute = route;
    onEvent?.({
      type: 'routing',
      data: {
        mode,
        route,
        ...routeMetadata,
        ...(multiIntent
          ? { reason: 'multi_intent_query', subQueries: queryPlan.subQueries }
          : {}),
      },
    });
    if (fastPathGate) {
      onEvent?.({
        type: 'sufficiency',
        data: {
          sufficient: fastPathGate.sufficient,
          reason: fastPathGate.reason,
          taskComplexity: requiresAgenticPlan(queryPlan),
          obsidianPaths: fastPathGate.obsidianHits.map((hit) => hit.path),
          ragReferences: fastPathGate.chunks.map((chunk) => chunk.id),
        },
      });
    }
  // cd： simple链路
    if (route === 'simple') {
      const result = await this.simpleAnswerCapability.answer(
        query,
        history,
        userId,
        memoryMessages,
        (token) => onEvent?.({ type: 'token', data: token }),
        fastPathGate
          ? {
              ...retrieveOptions,
              prefetchedFastPath: fastPathGate.prefetchedFastPath,
              governedDirectAnswer: true,
            }
          : retrieveOptions,
      );
      onEvent?.({ type: 'citation', data: result.references });
      onEvent?.({ type: 'final', data: result });
      return {
        answer: result.answer,
        references: result.references,
        route: 'simple',
        // 检索不足时即使安全返回了友好说明，也不能向 API／页面宣称结论满置信。
        confidence: result.retrievalSufficient ? 1 : 0,
        retryCount: 0,
        retrievalSufficient: result.retrievalSufficient,
        retrievalReason: result.retrievalReason,
        obsidianPaths: result.obsidianPaths,
        evidenceCoverage: [],
      };
    }

    const obsidianContext = {
      hits: fastPathGate?.obsidianHits ?? [],
      context: this.supportingEvidenceCapability.formatObsidianContext(
        fastPathGate?.obsidianHits ?? [],
      ),
    };
    if (obsidianContext.context) {
      memoryMessages = [
        ...memoryMessages,
        {
          role: 'system',
          content: `Obsidian 长期知识优先上下文：\n${obsidianContext.context}`,
        },
      ];
      onEvent?.({
        type: 'meta',
        data: {
          obsidianPaths: obsidianContext.hits.map((hit) => hit.path),
        },
      });
    }

    // 只有 route 为 agentic 才运行状态图：按计划取证并检查充分性，再按需补证、重排和生成答案。
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const finalState = (await this.app.invoke(
      {
        query,
        route: 'agentic',
        augmentedQueries:
          queryPlan.action === 'retrieve'
            ? Array.from(
                new Set(
                  executionPlan.queries
                    .map((item) => item.text)
                    .filter((text) => text !== query),
                ),
              )
            : [],
        subQuestions: multiIntent
          ? buildExplicitSubQuestions(
              queryPlan.subQueries,
              this.maxSubQuestions,
            )
          : [],
        retrievedChunks: [],
        retrievalSufficient: false,
        retrievalReason: '',
        webSearchAttempted: false,
        webSearchCount: 0,
        answer: '',
        confidence: 0,
        retryCount: 0,
        passed: false,
        humanApproval: null,
        interruptReason: '',
        artifacts: [],
        executionState: {
          consumedSteps: 0,
          consumedToolCalls: 0,
          remainingSteps:
            this.configService.get<number>('agentRun.maxSteps') ?? 18,
          remainingToolCalls:
            this.configService.get<number>('agentRun.maxToolCalls') ?? 24,
        },
        resumeContext: {
          userId,
          history,
          memoryMessages,
          retrieveOptions,
          runtimeRunId: retrieveOptions.runtimeRunId ?? '',
        },
      },
      {
        configurable: {
          thread_id: threadId,
          onEvent,
          history,
          userId,
          memoryMessages,
          enableInterrupt,
          retrieveOptions,
          abortSignal: executionOptions.signal,
          runtimeRunId: retrieveOptions.runtimeRunId,
          fastPathChunks: fastPathGate?.chunks ?? [],
          fastPathBundle: fastPathGate?.prefetchedFastPath.evidenceBundle,
          prefetchedFastPath: fastPathGate?.prefetchedFastPath,
          subQuestionLimit:
            mode === 'auto'
              ? Math.min(this.maxSubQuestions, 2)
              : this.maxSubQuestions,
        },
      },
    )) as AgenticRagStateType;

    // 原生 interrupt 不以业务字段伪造暂停状态；从保存的图任务读取中断标记。
    const getGraphState: unknown = Reflect.get(this.app, 'getState');
    if (typeof getGraphState !== 'function') {
      throw new Error('Agentic graph state lookup is unavailable.');
    }
    const graphSnapshot: unknown = await Reflect.apply(
      getGraphState,
      this.app,
      [{ configurable: { thread_id: threadId } }],
    );
    const interrupted = hasInterruptingTasks(graphSnapshot);
    const obsidianPaths = Array.from(
      new Set([
        ...obsidianContext.hits.map((hit) => hit.path),
        ...finalState.retrievedChunks
          .filter((chunk) => chunk.retrievalSource === 'obsidian')
          .map((chunk) => chunk.id.replace(/^obsidian:/u, '')),
      ]),
    );
    if (interrupted) {
      const pausedSnapshot = await this.getRunSnapshot(threadId);
      return {
        answer: finalState.answer,
        references: finalState.retrievedChunks,
        route: 'agentic' as const,
        confidence: 0,
        retryCount: 0,
        retrievalSufficient: finalState.retrievalSufficient,
        retrievalReason: finalState.retrievalReason,
        obsidianPaths,
        interrupted: true,
        executionState: {
          ...finalState.executionState,
          checkpointId: pausedSnapshot.checkpointId ?? undefined,
          paused: true,
          lastNode: 'humanApprovalNode',
        },
      };
    }

    const result = {
      answer: finalState.answer,
      references: finalState.retrievedChunks,
      route: 'agentic' as const,
      confidence: finalState.confidence,
      retryCount: finalState.retryCount,
      retrievalSufficient: finalState.retrievalSufficient,
      retrievalReason: finalState.retrievalReason,
      obsidianPaths,
      evidenceCoverage: finalState.subQuestions.map((item) => ({
        id: item.id,
        query: item.question,
        covered: item.sufficient && item.evidenceIds.length > 0,
        evidenceIds: item.evidenceIds,
      })),
      executionState: finalState.executionState,
    };
    await this.artifactStore?.saveRunArtifacts(
      threadId,
      userId,
      finalState.artifacts,
    );
    onEvent?.({ type: 'final', data: result });
    return result;
  }

  protected splitAnswerTokens(answer: string): string[] {
    return answer.match(/.{1,24}/gs) ?? [];
  }

  protected observedNode(
    name: string,
    handler: (
      state: AgenticRagStateType,
      config?: RunnableConfig,
    ) => Promise<Partial<AgenticRagStateType>>,
  ) {
    return async (state: AgenticRagStateType, config?: RunnableConfig) => {
      const startedAt = Date.now();
      const startedAtDate = new Date();
      const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
      try {
        if (await this.isCancellationRequested(config)) {
          throw new BadRequestException({
            code: 'AGENT_RUN_CANCELLED',
            message: '运行已取消，不再执行后续节点。',
          });
        }
        const result = await handler(state, config);
        if (await this.isCancellationRequested(config)) {
          throw new BadRequestException({
            code: 'AGENT_RUN_CANCELLED',
            message: '运行已取消，当前节点结果不再进入后续步骤。',
          });
        }
        const durationMs = Date.now() - startedAt;
        this.metricsService.observeAgentNode(
          name,
          'success',
          durationMs / 1000,
        );
        this.recordAgentNodeTrace(
          config,
          name,
          'success',
          durationMs,
          startedAtDate,
        );
        onEvent?.({
          type: 'node_timing',
          data: { node: name, status: 'success', durationMs },
        });
        const current = state.executionState ?? {
          consumedSteps: 0,
          consumedToolCalls: 0,
        };
        const nextExecutionState = {
          ...current,
          consumedSteps: current.consumedSteps + 1,
          remainingSteps:
            typeof current.remainingSteps === 'number'
              ? Math.max(0, current.remainingSteps - 1)
              : undefined,
          lastNode: name,
        };
        onEvent?.({
          type: 'meta',
          data: { executionState: nextExecutionState },
        });
        return { ...result, executionState: nextExecutionState };
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        this.metricsService.observeAgentNode(name, 'error', durationMs / 1000);
        this.recordAgentNodeTrace(
          config,
          name,
          'error',
          durationMs,
          startedAtDate,
        );
        onEvent?.({
          type: 'node_timing',
          data: {
            node: name,
            status: 'error',
            durationMs,
            error: (error as Error).message,
          },
        });
        throw error;
      }
    };
  }

  protected recordAgentNodeTrace(
    config: RunnableConfig | undefined,
    node: string,
    status: 'success' | 'error',
    durationMs: number,
    startedAt: Date,
  ): void {
    const threadId = config?.configurable?.thread_id as unknown;
    if (typeof threadId !== 'string' || !threadId) return;

    const trace = this.tracingService.recordAgentNode({
      threadId,
      node,
      status,
      durationMs,
      startedAt,
    });
    if (trace.alert === 'span_limit') {
      this.metricsService.observeAgentLoopDecision('span_limit_warning');
    }
  }
}
