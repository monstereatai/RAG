import { BadRequestException, Logger } from '@nestjs/common';
import { LlmProvider } from '../../providers/llm/llm.provider';
import type { RetrieveOptions } from '../contracts/rag-types';
import type { RetrievedChunk } from '../evidence/retrieval.types';
import type { EvidenceAssessment } from '../evidence/evidence-bundle';
import { EvidencePolicyService } from '../evidence/evidence-policy.service';
import { GroundedAnswerGenerationService } from '../generation/grounded-answer-generation.service';
import {
  type AgenticFastPathCapability,
  type AgenticRetrievalCapability,
  type AgenticSimpleAnswerCapability,
  type AgenticSupportingEvidenceCapability,
} from '../contracts/agentic-rag-capabilities';
import {
  type AgenticResumeContext,
  type AgenticSubQuestion,
  type AgenticArtifact,
} from './agentic-rag.state';
import {
  createFallbackQueryPlan,
  type QueryTaskType,
} from '../planning/query-plan';
import type { RetrievalExecutionPlan } from '../contracts/retrieval-execution-plan';
import { retrievalProfileForTaskType } from '../retrieval/context-builder';
import { BadCaseFlywheelService } from '../prompts/bad-case-flywheel.service';
import { BochaSearchService } from '../../tools/bocha-search.service';
import { DashScopeRerankService } from '../../tools/dashscope-rerank.service';
import { ToolExecutionPolicyService } from '../../tools/tool-execution-policy.service';
import {
  executeWithToolTimeout,
  ToolExecutionService,
} from '../../tools/tool-execution.service';
import { DocumentPermissionService } from '../../modules/document/document-permission.service';
import { countTextTokens } from '../../modules/document/chunking.util';
import { RunnableConfig } from '@langchain/core/runnables';
import { ConfigService } from '@nestjs/config';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { RedisCheckpointer } from '../../providers/langgraph-checkpointer/redis-checkpointer';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { SecurityAuditService } from '../../modules/metrics/security-audit.service';
import { TracingService } from '../../modules/tracing/tracing.service';
import { AgenticArtifactStoreService } from './agentic-artifact-store.service';
import { AgenticAnswerGenerationService } from './agentic-answer-generation.service';
import { AgentLoopService } from '../../modules/agent-loop/agent-loop.service';
import { hasExplicitRetrievalScope } from './agentic-rag-planning';

export class AgenticRagBase {
  protected readonly logger = new Logger('AgenticRagService');
  protected app: any;
  protected readonly checkpointer: RedisCheckpointer;
  protected readonly answerGenerationService: AgenticAnswerGenerationService;

  protected readonly confidenceThreshold: number;
  protected readonly maxRetries: number;
  protected readonly maxRetrievalQueries: number;
  protected readonly maxSubQuestions: number;
  protected readonly maxRetrievedChunks: number;
  protected readonly maxWebSearchResults: number;
  protected readonly maxRerankTopN: number;
  protected readonly webSearchFallbackEnabled: boolean;
  protected readonly rerankEnabled: boolean;
  protected readonly sufficiencyFastPathEnabled: boolean;
  protected readonly reflectionFastPathEnabled: boolean;
  constructor(
    protected readonly configService: ConfigService,
    protected readonly llmProvider: LlmProvider,
    protected readonly retrievalCapability: AgenticRetrievalCapability,
    protected readonly fastPathCapability: AgenticFastPathCapability,
    protected readonly simpleAnswerCapability: AgenticSimpleAnswerCapability,
    protected readonly supportingEvidenceCapability: AgenticSupportingEvidenceCapability,
    protected readonly bochaSearchService: BochaSearchService,
    protected readonly dashScopeRerankService: DashScopeRerankService,
    protected readonly toolPolicy: ToolExecutionPolicyService,
    protected readonly badCaseFlywheel: BadCaseFlywheelService,
    protected readonly metricsService: MetricsService,
    protected readonly tracingService: TracingService,
    protected readonly redisProvider: RedisProvider,
    agentLoop: AgentLoopService,
    protected readonly evidencePolicy: EvidencePolicyService,
    protected readonly toolExecution?: ToolExecutionService,
    protected readonly securityAudit?: SecurityAuditService,
    protected readonly documentPermissions?: DocumentPermissionService,
    protected readonly artifactStore?: AgenticArtifactStoreService,
    answerGenerationService?: AgenticAnswerGenerationService,
  ) {
    this.answerGenerationService =
      answerGenerationService ??
      new AgenticAnswerGenerationService(
        llmProvider,
        new GroundedAnswerGenerationService(
          llmProvider,
          this.evidencePolicy,
          this.configService,
        ),
        this.evidencePolicy,
        badCaseFlywheel,
        agentLoop,
        this.retrievalCapability,
      );
    this.confidenceThreshold = this.numberConfig(
      'agentic.confidenceThreshold',
      0.7,
      0,
      1,
    );
    this.maxRetries = this.intConfig('agentic.maxRetries', 2, 0, 5);
    this.maxRetrievalQueries = this.intConfig(
      'agentic.maxRetrievalQueries',
      4,
      1,
      8,
    );
    this.maxSubQuestions = this.intConfig('agentic.maxSubQuestions', 3, 1, 5);
    this.maxRetrievedChunks = this.intConfig(
      'agentic.maxRetrievedChunks',
      5,
      1,
      12,
    );
    this.maxWebSearchResults = this.intConfig(
      'agentic.maxWebSearchResults',
      5,
      0,
      10,
    );
    this.maxRerankTopN = this.intConfig('agentic.maxRerankTopN', 5, 1, 10);
    this.webSearchFallbackEnabled =
      this.configService.get<boolean>('agentic.webSearchFallbackEnabled') ??
      true;
    this.rerankEnabled =
      this.configService.get<boolean>('agentic.rerankEnabled') ?? true;
    this.sufficiencyFastPathEnabled =
      this.configService.get<boolean>('agentic.sufficiencyFastPathEnabled') ??
      true;
    this.reflectionFastPathEnabled =
      this.configService.get<boolean>('agentic.reflectionFastPathEnabled') ??
      true;
    this.checkpointer = new RedisCheckpointer(
      this.redisProvider,
      86400 * 7,
      undefined,
      this.configService.get<boolean>('core.requireDependencies') === true ||
        this.configService.get<string>('nodeEnv') === 'production',
    );
  }

  protected isAgenticRoute(value: unknown): value is 'simple' | 'agentic' {
    return value === 'simple' || value === 'agentic';
  }

  protected isSubQuestions(value: unknown): value is AgenticSubQuestion[] {
    return Array.isArray(value);
  }

  protected isArtifacts(value: unknown): value is AgenticArtifact[] {
    return Array.isArray(value);
  }

  protected isResumeContext(value: unknown): value is AgenticResumeContext {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const context = value as Record<string, unknown>;
    const retrieveOptions = this.recordOf(context.retrieveOptions);
    return (
      Array.isArray(context.history) &&
      Array.isArray(context.memoryMessages) &&
      typeof context.runtimeRunId === 'string' &&
      context.runtimeRunId.trim().length > 0 &&
      retrieveOptions?.runtimeRunId === context.runtimeRunId &&
      Boolean(retrieveOptions)
    );
  }

  /** 直连 Agentic 的兼容入口也只生成保守单查询计划，不再自行做意图识别。 */
  protected resolveExecutionPlan(
    query: string,
    options: RetrieveOptions,
  ): RetrievalExecutionPlan {
    if (options.executionPlan) return options.executionPlan;
    const queryPlan = options.queryPlan ?? createFallbackQueryPlan(query);
    return {
      planVersion: 2,
      sourcePolicy: options.sourcePolicy ?? 'local_only',
      queries: [{ text: query.trim(), kind: 'original', weight: 1 }],
      profile:
        options.profile ?? retrievalProfileForTaskType(queryPlan.taskType),
      useGraph: false,
      scope: options.scope,
      scopeRestricted: hasExplicitRetrievalScope(options.scope),
      reasonCode: 'internal_evidence_required',
    };
  }

  protected recordOf(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  }

  protected getSubQuestionLimit(config?: RunnableConfig): number {
    const configurable = config?.configurable as unknown as
      | Record<string, unknown>
      | undefined;
    const configured = configurable?.subQuestionLimit;
    if (typeof configured === 'number' && Number.isFinite(configured)) {
      return Math.min(
        this.maxSubQuestions,
        Math.max(1, Math.trunc(configured)),
      );
    }
    return this.maxSubQuestions;
  }

  protected intConfig(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const value = this.configService.get<number>(key) ?? fallback;
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(value)));
  }

  protected limitToolContextText(value: string, maxCharacters: number): string {
    if (maxCharacters <= 0) return '';
    if (value.length <= maxCharacters) return value;
    return `${value.slice(0, maxCharacters - 1)}…`;
  }

  protected async executeAgenticTool<T>(
    toolName: string,
    threadId: string,
    ownerUserId: string | undefined,
    input: unknown,
    execute: (signal?: AbortSignal) => Promise<T>,
    config?: RunnableConfig,
  ): Promise<T> {
    const executionContext = this.pluginPolicy(config, 'agentic');
    const decision = this.toolPolicy.decide(toolName, executionContext);
    if (!decision.allowed || !decision.entry) {
      throw new Error(decision.reason);
    }
    if (!this.toolExecution || !threadId) {
      return executeWithToolTimeout(
        toolName,
        decision.entry.timeoutMs,
        execute,
        config?.configurable?.abortSignal as AbortSignal | undefined,
      );
    }
    const result = await this.toolExecution.execute({
      toolName,
      threadId,
      ownerUserId,
      actor: 'agentic_rag',
      ...executionContext,
      input,
      execute: (signal) => execute(signal),
    });
    if (!result.output)
      throw new Error(result.error ?? `${toolName} 被阻断或未返回结果`);
    return result.output;
  }

  protected pluginPolicy(
    config: RunnableConfig | undefined,
    mode: 'simple' | 'auto' | 'agentic' | 'production',
  ) {
    const retrieveOptions = config?.configurable?.retrieveOptions as
      | RetrieveOptions
      | undefined;
    return {
      mode,
      pluginKeys: retrieveOptions?.pluginKeys,
      allowedToolNames: retrieveOptions?.pluginTools,
    };
  }

  protected threadIdFromConfig(config?: RunnableConfig): string {
    const value: unknown = config?.configurable?.thread_id;
    return typeof value === 'string' ? value : '';
  }

  protected userIdFromConfig(config?: RunnableConfig): string | undefined {
    const value: unknown = config?.configurable?.userId;
    return typeof value === 'string' && value ? value : undefined;
  }

  protected runIdFromConfig(config?: RunnableConfig): string | undefined {
    const retrieveOptions = config?.configurable?.retrieveOptions as
      | RetrieveOptions
      | undefined;
    return retrieveOptions?.runtimeRunId;
  }

  /** Run 的取消标记由 AgentRunsService 写入 Redis；节点边界检查可避免继续发起新工具调用。 */
  protected async isCancellationRequested(
    config?: RunnableConfig,
  ): Promise<boolean> {
    const abortSignal = config?.configurable?.abortSignal as
      | AbortSignal
      | undefined;
    if (abortSignal?.aborted) return true;
    const threadId = this.threadIdFromConfig(config);
    const runId = this.runIdFromConfig(config);
    if (!threadId || !runId) return false;
    const marker = await this.redisProvider.get?.(
      `agent-loop:cancel:${threadId}:${runId}`,
    );
    return marker === 'cancelled';
  }

  protected watchRunCancellation(
    threadId: string,
    runId?: string,
    parentSignal?: AbortSignal,
  ) {
    const controller = new AbortController();
    const signal = parentSignal
      ? AbortSignal.any([parentSignal, controller.signal])
      : controller.signal;
    const cancelKey = runId
      ? `agent-loop:cancel:${threadId}:${runId}`
      : undefined;
    let cancellationObserved = false;
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    let pollInFlight: Promise<void> | undefined;

    const poll = async () => {
      if (stopped || signal.aborted || !cancelKey) return;
      if (pollInFlight) return pollInFlight;
      pollInFlight = (async () => {
        try {
          if (
            this.redisProvider.isEnabled() &&
            (await this.redisProvider.get(cancelKey)) === 'cancelled'
          ) {
            cancellationObserved = true;
            controller.abort();
            return;
          }
        } catch (error) {
          this.logger.debug(
            `Run cancellation marker check failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (!stopped && !signal.aborted) {
          timer = setTimeout(() => void poll(), 500);
          timer.unref();
        }
      })();
      try {
        await pollInFlight;
      } finally {
        pollInFlight = undefined;
      }
    };

    const ready = poll();
    return {
      signal,
      ready,
      checkNow: poll,
      wasCancelled: () => cancellationObserved,
      dispose: () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      },
    };
  }

  /** 用户中断或超时不能被节点的“降级继续”逻辑吞掉。 */
  protected async rethrowIfAbortedOrCancelled(
    error: unknown,
    config?: RunnableConfig,
  ): Promise<void> {
    const errorLike = error as { name?: string; code?: string } | null;
    const isAbortError =
      errorLike?.name === 'AbortError' ||
      errorLike?.name === 'TimeoutError' ||
      errorLike?.code === 'ABORT_ERR';
    const response =
      error instanceof BadRequestException ? error.getResponse() : undefined;
    const isCancelledException =
      typeof response === 'object' &&
      response !== null &&
      'code' in response &&
      response.code === 'AGENT_RUN_CANCELLED';

    if (
      isAbortError ||
      isCancelledException ||
      (await this.isCancellationRequested(config))
    ) {
      throw error;
    }
  }

  protected numberConfig(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const value = this.configService.get<number>(key) ?? fallback;
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }

  protected rankEvidenceChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
    return this.evidencePolicy.rankEvidenceChunks(chunks);
  }

  /**
   * 在 Agentic 评估调用前只裁检索证据，保留问题、答案和 Prompt 固定指令。
   * 超限时按检索分从低到高移除完整片段，避免把证据内容截成失去语义的碎片。
   */
  protected async fitEvidenceToPromptBudget(
    chunks: RetrievedChunk[],
    maxChunkCharacters: number,
    formatMessages: (context: string) => Promise<Array<{ content: unknown }>>,
  ): Promise<{
    context: string;
    withinBudget: boolean;
    estimatedInputTokens: number;
    maxInputTokens: number;
    removedChunks: number;
  }> {
    const maxInputTokens = this.getMaxInputTokens();
    const retained = chunks.map((chunk) => ({ chunk }));
    let context = '';
    let estimatedInputTokens = 0;
    let withinBudget = false;

    while (true) {
      context = retained
        .map(
          ({ chunk }, index) =>
            `[片段 ${index + 1}] ${chunk.content.slice(0, maxChunkCharacters)}`,
        )
        .join('\n\n');
      const messages = await formatMessages(context);
      const promptText = messages
        .map(({ content }) =>
          typeof content === 'string' ? content : JSON.stringify(content),
        )
        .join('\n');
      estimatedInputTokens =
        (await countTextTokens(promptText)) + messages.length * 4;
      if (estimatedInputTokens <= maxInputTokens) {
        withinBudget = true;
        break;
      }
      if (retained.length === 0) break;

      let lowestScoreIndex = 0;
      for (let index = 1; index < retained.length; index += 1) {
        if (
          (retained[index].chunk.totalScore ?? 0) <
          (retained[lowestScoreIndex].chunk.totalScore ?? 0)
        ) {
          lowestScoreIndex = index;
        }
      }
      retained.splice(lowestScoreIndex, 1);
    }

    return {
      context,
      withinBudget,
      estimatedInputTokens,
      maxInputTokens,
      removedChunks: chunks.length - retained.length,
    };
  }

  protected getMaxInputTokens(
    task: 'fast' | 'reasoning' | 'structured' = 'structured',
  ): number {
    const configuredWindow = Number(
      this.configService.get<number>('llm.contextWindowTokens'),
    );
    const contextWindow =
      Number.isFinite(configuredWindow) && configuredWindow > 0
        ? configuredWindow
        : 32_768;
    const activeProvider = this.llmProvider.getActiveProviderName();
    const providers = [
      activeProvider,
      this.llmProvider.getRoutePolicy(task, activeProvider).fallback,
    ].filter((provider): provider is NonNullable<typeof provider> =>
      Boolean(provider),
    );
    const outputBudget = Math.max(
      4_096,
      ...providers.map((provider) => {
        const configuredOutput = Number(
          this.configService.get<number>(`llm.${provider}.maxTokens`),
        );
        return Math.max(
          Number.isFinite(configuredOutput) && configuredOutput > 0
            ? configuredOutput
            : 4_096,
          this.llmProvider.getRoutePolicy(task, provider).maxTokens,
        );
      }),
    );
    const safetyMargin = Math.max(256, Math.ceil(contextWindow * 0.1));
    return Math.max(1, contextWindow - outputBudget - safetyMargin);
  }

  protected assessRetrievedChunks(
    query: string,
    chunks: RetrievedChunk[],
    taskType?: QueryTaskType,
    requiredAspects: string[] = [],
  ): EvidenceAssessment {
    if (requiredAspects.length === 0) {
      return this.evidencePolicy.assessRetrievedChunks(query, chunks, taskType);
    }
    return this.evidencePolicy.assessRetrievedChunks(
      query,
      chunks,
      taskType,
      requiredAspects,
    );
  }

  protected buildEvidenceFirstAnswer(
    query: string,
    chunks: RetrievedChunk[],
  ): string | null {
    return this.evidencePolicy.buildEvidenceFirstAnswer(query, chunks);
  }

  protected async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timeout after ${ms}ms`)),
        ms,
      );
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  protected composeSignal(signal: AbortSignal | undefined, timeoutMs: number) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  }
}
