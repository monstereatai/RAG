import {
  Injectable,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgenticRagService } from '../../rag/agentic/agentic-rag.service';
import { ConversationService } from './conversation.service';
import { ChatDto, type ChatMode } from './chat.dto';
import type { ChatResponse } from './chat.dto';
import type { RagTraceEvent } from '../../providers/observability/langfuse.provider';
import type { AggregatedLlmUsage } from './chat-runtime.types';
import { ChatLifecycleService } from './chat-lifecycle.service';
import { ChatContextBuilder } from './chat-context-builder';
import { PluginRuntimeService } from '../plugin-runtime/plugin-runtime.service';
import { LlmProvider } from '../../providers/llm/llm.provider';
import type { LlmUsage } from '../../providers/llm/llm-provider.interface';
import { detectDangerousQuery } from '../../rag/prompts/prompt-injection.guard';
import { MetricsService } from '../metrics/metrics.service';
import { SecurityAuditService } from '../metrics/security-audit.service';
import type {
  ChatEventCallback,
  ChatExecutionOptions,
} from './chat-runtime.types';
import { ChatRunObservabilityService } from './chat-run-observability.service';
import { createChatEventRelay } from './chat-event-relay';

@Injectable()
export class ChatService {
  /** 一轮问答的应用编排入口。 */
  protected readonly logger = new Logger(ChatService.name);

  constructor(
    protected readonly agenticRagService: AgenticRagService,
    protected readonly conversationService: ConversationService,
    private readonly chatContextBuilder: ChatContextBuilder,
    private readonly chatLifecycle: ChatLifecycleService,
    private readonly chatRunObservability: ChatRunObservabilityService,
    @Optional() protected readonly config?: ConfigService,
    @Optional() protected readonly plugins?: PluginRuntimeService,
    @Optional() protected readonly metrics?: MetricsService,
    @Optional() protected readonly securityAudit?: SecurityAuditService,
    @Optional() protected readonly llmProvider?: LlmProvider,
  ) {}

  /** 准备上下文、启动 Run、执行统一链路并收口结果。 */
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

    const configuredTimeoutMs =
      this.config?.get<number>('agentRun.timeoutMs') ?? 120_000;
    const timeoutMs = Number.isFinite(configuredTimeoutMs)
      ? Math.max(1, configuredTimeoutMs)
      : 120_000;
    const deadlineAt = Date.now() + timeoutMs;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const requestSignal = executionOptions?.signal
      ? AbortSignal.any([executionOptions.signal, timeoutSignal])
      : timeoutSignal;

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
    // 对外保留旧 mode 字段用于兼容，但不再提供三套执行入口。
    // 所有请求进入同一条问答链路，由 QueryPlan / RetrievalPolicy 做意图路由。
    const requestedMode: ChatMode = req.mode ?? 'auto';
    if (requestedMode !== 'auto' && !executionOptions?.forceAgentic) {
      this.logger.debug(
        `legacy mode ${requestedMode} normalized to intent-routed auto`,
      );
    }
    const mode: ChatMode = executionOptions?.forceAgentic ? 'agentic' : 'auto';
    if (req.threadId) {
      // 会话历史和短期记忆按 threadId 缓存，读取前必须先校验用户与租户归属。
      await this.conversationService.assertAccessible(
        req.threadId,
        userId,
        executionOptions?.tenantId,
      );
    }
    const [pluginComposition, threadId] = await Promise.all([
      req.pluginKeys?.length && this.plugins
        ? this.plugins.resolve(
            req.pluginKeys,
            mode,
            [],
            executionOptions?.tenantId,
          )
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
    const preparedContext = await this.chatContextBuilder.build({
      req,
      userId,
      threadId,
      mode,
      signal: requestSignal,
      deadlineAt,
      executionOptions,
      pluginComposition,
      collectUsage,
    });
    const {
      queryPlan,
      executionPlan,
      requestContext,
      history,
      memoryMessages,
      retrievalOptions,
    } = preparedContext;
    onEvent?.({
      type: 'thread',
      data: { threadId, requestId: requestContext.requestId },
    });
    onEvent?.({
      type: 'routing',
      data: {
        mode,
        route: 'pending',
        requestId: requestContext.requestId,
      },
    });
    const eventRelay = createChatEventRelay(onEvent);
    // 运行记录先于模型调用创建，失败、中断和恢复沿用同一生命周期。
    const run = await this.chatLifecycle.startRun({
      req,
      userId,
      threadId,
      mode,
      executionOptions,
      pluginComposition,
      context: preparedContext,
    });

    // 单一问答链路：ChatService 不再直接执行 Simple，统一交给 AgenticRagService。
    // auto 仅表示“由后端按 QueryPlan、证据充分性和复杂度选择内部执行路径”。
    // AgenticRagService 内部先做意图／证据路由：足够简单则走快速回答，
    // 复杂、多子问题或证据不足则继续深度状态图；不会回到 ChatService 另建流程。
    const traceEvents: RagTraceEvent[] = [];
    let result;
    try {
      const executeAgentic = () =>
        this.agenticRagService.run(
          req.query,
          mode,
          (event) => {
            traceEvents.push(this.chatRunObservability.toTraceEvent(event));
            if (event.type !== 'final') eventRelay.publish(event);
          },
          history,
          threadId,
          userId,
          memoryMessages,
          req.approvalRequired === true,
          {
            ...retrievalOptions,
            runtimeRunId: run?.id,
          },
          { signal: requestSignal },
        );
      result = await runWithUsage(
        () =>
          this.llmProvider?.runWithSignal(requestSignal, executeAgentic) ??
          executeAgentic(),
      );
    } catch (error) {
      const errorResponse =
        error instanceof BadRequestException ? error.getResponse() : undefined;
      const explicitlyCancelled =
        typeof errorResponse === 'object' &&
        errorResponse !== null &&
        'code' in errorResponse &&
        errorResponse.code === 'AGENT_RUN_CANCELLED';
      await this.chatLifecycle.finishFailedRun(
        run,
        req.query,
        mode,
        error,
        executionOptions?.signal?.aborted || explicitlyCancelled
          ? 'cancelled'
          : 'failed',
      );
      throw error;
    }
    // 兜底防线保证答案不是空字符
    result = this.chatLifecycle.ensureNonEmptyAnswer(result);
    eventRelay.finish(result.answer);

    return this.chatLifecycle.finalizeChatResult({
      result,
      mode,
      route: result.route,
      req,
      userId,
      threadId,
      startTime,
      queryPlan,
      executionPlan,
      run: run ?? undefined,
      onEvent,
      model: executionOptions?.model,
      traceEvents,
      actualUsage,
      tenantId: executionOptions?.tenantId,
    });
  }

  async resume(
    threadId: string,
    approval: 'approved' | 'rejected',
    feedback: string | undefined,
    userId: string,
    tenantId?: string,
    onEvent?: ChatEventCallback,
  ): Promise<ChatResponse> {
    return this.chatLifecycle.resume(
      threadId,
      approval,
      feedback,
      userId,
      tenantId,
      onEvent,
    );
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
}
