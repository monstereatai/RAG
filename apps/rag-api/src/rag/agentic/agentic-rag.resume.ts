import { BadRequestException } from '@nestjs/common';
import type { RetrieveOptions } from '../contracts/rag-types';
import type { RetrievedChunk } from '../evidence/retrieval.types';
import { SseCallback } from './sse-event';
import {
  type AgenticRagStateType,
  type AgenticResumeContext,
  type AgenticSubQuestion,
  type AgenticArtifact,
} from './agentic-rag.state';
import { adaptStoredQueryPlan } from '../planning/query-plan';
import { Command, interrupt } from '@langchain/langgraph';
import { RunnableConfig } from '@langchain/core/runnables';
import { AgenticRagEvidence } from './agentic-rag.evidence';

export class AgenticRagResume extends AgenticRagEvidence {
  /**
   * 人工审批节点：当 enableInterrupt=true 时暂停图执行，等待用户审批
   * 如果 enableInterrupt=false（默认），直接标记为 approved 跳过
   */
  async humanApprovalNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    await Promise.resolve();
    const enableInterrupt = config?.configurable?.enableInterrupt as
      | boolean
      | undefined;
    if (!enableInterrupt) return { humanApproval: 'approved' };

    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    let retrievedChunks = state.retrievedChunks;
    let permissionChanged = false;
    const userId = config?.configurable?.userId as string | undefined;
    const retrieveOptions = config?.configurable?.retrieveOptions as
      | RetrieveOptions
      | undefined;
    if (retrievedChunks.length > 0) {
      if (userId && this.documentPermissions) {
        const allowedDocIds = await this.documentPermissions.getAllowedDocIds(
          userId,
          retrieveOptions?.roles ?? [],
          retrieveOptions?.departmentIds ?? [],
          retrieveOptions?.tenantId,
          retrieveOptions?.trustedAdminPrincipal,
        );
        retrievedChunks = retrievedChunks.filter((chunk) =>
          allowedDocIds.has(chunk.docId),
        );
      } else {
        retrievedChunks = [];
      }
      permissionChanged =
        retrievedChunks.length !== state.retrievedChunks.length;
    }
    const answer = permissionChanged ? '' : state.answer;

    // LangGraph 原生中断会持久化当前图状态；恢复时该节点从开头重跑，
    // 因此中断前只发送只读事件，绝不执行外部副作用。
    const reason = `答案生成完成，等待人工审批（confidence 将在后续 reflection 评估）`;
    this.logger.log(`Human approval interrupt: ${reason}`);
    onEvent?.({
      type: 'interrupt',
      data: {
        reason,
        answer,
        references: retrievedChunks,
        threadId: (config?.configurable?.thread_id as string) ?? '',
      },
    });
    const review = interrupt<
      {
        reason: string;
        answer: string;
        references: RetrievedChunk[];
        threadId: string;
      },
      { approval: 'approved' | 'rejected'; feedback?: string }
    >({
      reason,
      answer,
      references: retrievedChunks,
      threadId: (config?.configurable?.thread_id as string) ?? '',
    });
    return {
      humanApproval: review.approval,
      retrievedChunks,
      ...(permissionChanged
        ? {
            answer: '',
            retrievalSufficient: false,
            retrievalReason: '审批期间资料权限发生变化，需要重新检索',
            artifacts: state.artifacts.filter(
              (artifact) => artifact.type !== 'answer_contract',
            ),
          }
        : {}),
      interruptReason: review.feedback ?? '',
      executionState: {
        ...state.executionState,
        paused: false,
        lastNode: 'humanApprovalNode',
      },
    };
  }

  /**
   * 原生 interrupt 不会提交同一节点中 interrupt 之后的返回值，因此 pending
   * 必须由前置节点单独写入 Checkpoint，供 API、Run 和前端在断线后恢复判断。
   */
  approvalPendingNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    const enableInterrupt = config?.configurable?.enableInterrupt as
      | boolean
      | undefined;
    if (!enableInterrupt) {
      return Promise.resolve({ humanApproval: 'approved' });
    }
    return Promise.resolve({
      humanApproval: 'pending',
      executionState: {
        ...state.executionState,
        paused: true,
        lastNode: 'approvalPending',
      },
    });
  }

  /**
   * 恢复被人工审批中断的图执行
   * @param threadId 会话 ID
   * @param approval 审批结果：'approved' 或 'rejected'
   * @param feedback 可选的用户反馈
   * @param onEvent SSE 事件回调
   */
  async resumeGraph(
    threadId: string,
    approval: 'approved' | 'rejected',
    feedback?: string,
    onEvent?: SseCallback,
    tenantId?: string,
    expectedRunId?: string,
  ): Promise<{
    answer: string;
    references: RetrievedChunk[];
    confidence: number;
    retryCount: number;
    approved: boolean;
    executionState: AgenticRagStateType['executionState'];
  }> {
    this.logger.log(
      `Resuming graph for thread=${threadId}, approval=${approval}`,
    );

    const before = await this.getRunSnapshot(threadId);
    if (!before.available)
      throw new BadRequestException('未找到可恢复的检查点');
    if (!expectedRunId || before.runtimeRunId !== expectedRunId) {
      throw new BadRequestException('审批请求与当前运行检查点不匹配');
    }
    if (!before.paused)
      throw new BadRequestException('当前运行不在等待审批状态');
    if (
      (before.executionState?.remainingSteps ??
        this.configService.get<number>('agentRun.maxSteps') ??
        18) <= 0
    ) {
      throw new BadRequestException('检查点剩余步骤预算已耗尽，不能继续恢复');
    }
    const resumeContext = await this.getResumeContext(threadId, tenantId);
    if (resumeContext.runtimeRunId !== expectedRunId) {
      throw new BadRequestException('审批上下文与目标运行记录不匹配');
    }
    // 使用 Command 恢复原生 interrupt，不能用普通输入重新 invoke。恢复时必须
    // 重新带上原始用户、权限 scope、插件策略和预算，不能以空上下文重放。
    const cancellation = this.watchRunCancellation(
      threadId,
      resumeContext.runtimeRunId,
    );
    try {
      await cancellation.ready;
      if (cancellation.signal.aborted) {
        throw new BadRequestException({
          code: 'AGENT_RUN_CANCELLED',
          message: '运行已取消，不再执行后续节点。',
        });
      }
      resumeContext.retrieveOptions.signal = cancellation.signal;
      onEvent?.({
        type: 'resume',
        data: {
          threadId,
          checkpointId: before.checkpointId,
          executionState: before.executionState,
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const finalState = (await this.app.invoke(
        new Command({ resume: { approval, feedback } }),
        {
          configurable: {
            thread_id: threadId,
            onEvent,
            enableInterrupt: true,
            userId: resumeContext.userId,
            history: resumeContext.history,
            memoryMessages: resumeContext.memoryMessages,
            retrieveOptions: resumeContext.retrieveOptions,
            abortSignal: cancellation.signal,
            runtimeRunId: resumeContext.runtimeRunId,
          },
        },
      )) as AgenticRagStateType;
      await cancellation.checkNow();
      if (cancellation.wasCancelled()) {
        throw new BadRequestException({
          code: 'AGENT_RUN_CANCELLED',
          message: '运行已取消，不再执行后续节点。',
        });
      }

      const result = {
        answer: finalState.answer,
        references: finalState.retrievedChunks,
        confidence: finalState.confidence,
        retryCount: finalState.retryCount,
        approved: approval === 'approved',
        executionState: finalState.executionState,
      };

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

  protected async getResumeContext(
    threadId: string,
    tenantId?: string,
  ): Promise<AgenticResumeContext> {
    const tuple = await this.checkpointer.getTuple({
      configurable: { thread_id: threadId },
    });
    const context = tuple?.checkpoint.channel_values.resumeContext;
    if (!this.isResumeContext(context)) {
      throw new BadRequestException('检查点缺少可恢复的授权上下文');
    }
    const checkpointValues = tuple?.checkpoint.channel_values;
    const checkpointQuery =
      checkpointValues && typeof checkpointValues.query === 'string'
        ? checkpointValues.query
        : '';
    const retrieveOptions = {
      ...context.retrieveOptions,
    } as RetrieveOptions & {
      queryIntent?: unknown;
      planVersion?: unknown;
    };
    const queryPlan = retrieveOptions.queryPlan
      ? adaptStoredQueryPlan(
          retrieveOptions.queryPlan,
          checkpointQuery,
          retrieveOptions.planVersion,
        )
      : adaptStoredQueryPlan(
          retrieveOptions.queryIntent,
          checkpointQuery,
          retrieveOptions.planVersion,
        );
    retrieveOptions.queryPlan = queryPlan;
    retrieveOptions.needsSynthesis = queryPlan.taskType === 'synthesis';
    retrieveOptions.entities = queryPlan.entities;

    const executionPlan =
      retrieveOptions.executionPlan ??
      this.resolveExecutionPlan(checkpointQuery, retrieveOptions);
    retrieveOptions.executionPlan = {
      ...executionPlan,
      useGraph: executionPlan.useGraph || queryPlan.needsGraph,
    };
    const requestedTenant = tenantId?.trim();
    if (requestedTenant) {
      const checkpointTenant = retrieveOptions.tenantId?.trim();
      if (!checkpointTenant || checkpointTenant !== requestedTenant) {
        throw new BadRequestException('检查点租户与当前身份不匹配');
      }
    }
    return { ...context, retrieveOptions };
  }

  /**
   * 读取一次 Agentic 运行的最新检查点，供 Agent 运营后台审计。
   * 只返回已定义的状态字段，避免把 Redis 内部 checkpoint 结构直接暴露给后台。
   */
  async getRunSnapshot(threadId: string): Promise<{
    available: boolean;
    threadId: string;
    checkpointId: string | null;
    updatedAt: string | null;
    runtimeRunId: string | null;
    query: string | null;
    route: 'simple' | 'agentic' | null;
    subQuestions: AgenticSubQuestion[];
    artifacts: AgenticArtifact[];
    retrievalSufficient: boolean | null;
    retrievalReason: string | null;
    retryCount: number | null;
    passed: boolean | null;
    paused: boolean;
    executionState: AgenticRagStateType['executionState'] | null;
  }> {
    const tuple = await this.checkpointer.getTuple({
      configurable: { thread_id: threadId },
    });
    if (!tuple) {
      const persistedArtifacts =
        (await this.artifactStore?.loadRunArtifacts(threadId)) ?? [];
      return {
        available: false,
        threadId,
        checkpointId: null,
        updatedAt: null,
        runtimeRunId: null,
        query: null,
        route: null,
        subQuestions: [],
        artifacts: persistedArtifacts,
        retrievalSufficient: null,
        retrievalReason: null,
        retryCount: null,
        passed: null,
        paused: false,
        executionState: null,
      };
    }

    const values = tuple.checkpoint.channel_values;
    const resumeContext = this.recordOf(values.resumeContext);
    const checkpointArtifacts = this.isArtifacts(values.artifacts)
      ? values.artifacts
      : [];
    const persistedArtifacts =
      (await this.artifactStore?.loadRunArtifacts(threadId)) ?? [];
    const artifacts = [...checkpointArtifacts];
    for (const artifact of persistedArtifacts) {
      if (!artifacts.some((item) => item.id === artifact.id))
        artifacts.push(artifact);
    }
    return {
      available: true,
      threadId,
      checkpointId:
        (tuple.config.configurable?.checkpoint_id as string | undefined) ??
        null,
      updatedAt: tuple.checkpoint.ts ?? null,
      runtimeRunId:
        typeof resumeContext?.runtimeRunId === 'string'
          ? resumeContext.runtimeRunId
          : null,
      query: typeof values.query === 'string' ? values.query : null,
      route: this.isAgenticRoute(values.route) ? values.route : null,
      subQuestions: this.isSubQuestions(values.subQuestions)
        ? values.subQuestions
        : [],
      artifacts,
      retrievalSufficient:
        typeof values.retrievalSufficient === 'boolean'
          ? values.retrievalSufficient
          : null,
      retrievalReason:
        typeof values.retrievalReason === 'string'
          ? values.retrievalReason
          : null,
      retryCount:
        typeof values.retryCount === 'number' ? values.retryCount : null,
      passed: typeof values.passed === 'boolean' ? values.passed : null,
      paused: values.humanApproval === 'pending',
      executionState:
        (values.executionState as
          | AgenticRagStateType['executionState']
          | undefined) ?? null,
    };
  }

  /**
   * 旧接口只有 Thread ID，不能恢复原运行的用户、租户、资料范围和审批参数。
   * 保留路由以便旧客户端得到明确错误，但拒绝以空权限上下文盲目重跑。
   */
  retryRun(_threadId: string, _onEvent?: SseCallback): Promise<never> {
    void _threadId;
    void _onEvent;
    return Promise.reject(
      new BadRequestException(
        '旧版 Thread 重跑入口已停用，请使用 run-center/:id/retry 运行记录入口',
      ),
    );
  }

  /**
   * 条件路由：reflection 后决定重试还是结束
   */
  reflectionRouter(
    state: AgenticRagStateType,
  ): 'generate' | 'retrieval' | 'end' {
    if (state.passed) {
      this.metricsService.observeAgentLoopDecision('passed');
      return 'end';
    }
    // Reflection 在判定失败时已经把本次评估计入 retryCount；允许配置的重试次数真正执行。
    if (state.retryCount > this.maxRetries) {
      this.logger.warn(`Max retries (${this.maxRetries}) reached, ending`);
      this.metricsService.observeAgentLoopDecision('max_retries');
      return 'end';
    }
    this.metricsService.observeAgentLoopDecision('retry');
    return state.retryTarget === 'retrieval' ? 'retrieval' : 'generate';
  }
}
