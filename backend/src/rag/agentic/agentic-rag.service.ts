import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { z } from 'zod';
import { LlmProvider } from '../../providers/llm/llm.provider';
import type {
  RetrieveOptions,
  PrefetchedFastPath,
} from '../contracts/rag-types';
import type { RetrievedChunk } from '../evidence/retrieval.types';
import { EvidencePolicyService } from '../evidence/evidence-policy.service';
import { GroundedAnswerGenerationService } from '../generation/grounded-answer-generation.service';
import {
  AGENTIC_FAST_PATH_CAPABILITY,
  AGENTIC_RETRIEVAL_CAPABILITY,
  AGENTIC_SIMPLE_ANSWER_CAPABILITY,
  AGENTIC_SUPPORTING_EVIDENCE_CAPABILITY,
  type AgenticFastPathCapability,
  type AgenticRetrievalCapability,
  type AgenticSimpleAnswerCapability,
  type AgenticSupportingEvidenceCapability,
} from '../contracts/agentic-rag-capabilities';
import { SseCallback } from './sse-event';
import {
  AgenticRagState,
  type AgenticRagStateType,
  type AgenticResumeContext,
  type AgenticSubQuestion,
  createAgenticArtifact,
  type AgenticArtifact,
  type AnswerContractArtifactPayload,
} from './agentic-rag.state';
import {
  adaptStoredQueryPlan,
  createFallbackQueryPlan,
  isObjectiveKnowledgePlan,
  shouldClarifyQueryPlan,
  type QueryPlan,
  type QueryTaskType,
} from '../planning/query-plan';
import type { RetrievalExecutionPlan } from '../contracts/retrieval-execution-plan';
import { retrievalProfileForTaskType } from '../retrieval/context-builder';
import { detectDangerousQuery } from '../prompts/prompt-injection.guard';
import {
  reflectionPrompt,
  sufficiencyPrompt,
} from '../prompts/agentic.prompts';
import {
  BadCaseFlywheelService,
  type BadCaseMatch,
} from '../prompts/bad-case-flywheel.service';
import { BochaSearchService } from '../../tools/bocha-search.service';
import { DashScopeRerankService } from '../../tools/dashscope-rerank.service';
import { ToolExecutionPolicyService } from '../../tools/tool-execution-policy.service';
import { ToolExecutionService } from '../../tools/tool-execution.service';
import { DocumentPermissionService } from '../../modules/document/document-permission.service';
import {
  Command,
  interrupt,
  StateGraph,
  START,
  END,
} from '@langchain/langgraph';
import { RunnableConfig } from '@langchain/core/runnables';
import { ConfigService } from '@nestjs/config';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { RedisCheckpointer } from '../../providers/langgraph-checkpointer/redis-checkpointer';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { SecurityAuditService } from '../../modules/metrics/security-audit.service';
import { TracingService } from '../../modules/tracing/tracing.service';
import { AgenticArtifactStoreService } from './agentic-artifact-store.service';
import { AgenticAnswerGenerationService } from './agentic-answer-generation.service';
import { randomUUID } from 'node:crypto';
import { AgentLoopService } from '../../modules/agent-loop/agent-loop.service';
import type { RequestContext } from '../contracts/request-context';
import {
  appliesToQuery,
  type EvidenceBundle,
} from '../evidence/evidence-bundle';
import {
  buildExplicitSubQuestions,
  buildSubQuestions,
  hasExplicitRetrievalScope,
  hasExplicitScopeFilter,
  requiresAgenticPlan,
  resolveAutoRoute,
} from './agentic-rag-planning';

/**
 * 深度问答的 LangGraph 状态机。
 *
 * 它只在显式 Agentic 或 Auto 的充分性／复杂度门禁要求升级时运行：
 * 查询增强 → 并发检索 → 证据充分性判断 → 按需网页补证／重排 → 生成 → 反思重试。
 * 每个节点将状态和事件写入检查点，支持中断后的受控恢复，而非盲目重新执行副作用。
 */
@Injectable()
export class AgenticRagService {
  private readonly logger = new Logger(AgenticRagService.name);
  private app: any;
  private readonly checkpointer: RedisCheckpointer;
  private readonly answerGenerationService: AgenticAnswerGenerationService;

  private readonly confidenceThreshold: number;
  private readonly maxRetries: number;
  private readonly maxRetrievalQueries: number;
  private readonly maxSubQuestions: number;
  private readonly maxRetrievedChunks: number;
  private readonly maxWebSearchResults: number;
  private readonly maxRerankTopN: number;
  private readonly webSearchFallbackEnabled: boolean;
  private readonly rerankEnabled: boolean;
  private readonly sufficiencyFastPathEnabled: boolean;
  private readonly reflectionFastPathEnabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly llmProvider: LlmProvider,
    @Inject(AGENTIC_RETRIEVAL_CAPABILITY)
    private readonly retrievalCapability: AgenticRetrievalCapability,
    @Inject(AGENTIC_FAST_PATH_CAPABILITY)
    private readonly fastPathCapability: AgenticFastPathCapability,
    @Inject(AGENTIC_SIMPLE_ANSWER_CAPABILITY)
    private readonly simpleAnswerCapability: AgenticSimpleAnswerCapability,
    @Inject(AGENTIC_SUPPORTING_EVIDENCE_CAPABILITY)
    private readonly supportingEvidenceCapability: AgenticSupportingEvidenceCapability,
    private readonly bochaSearchService: BochaSearchService,
    private readonly dashScopeRerankService: DashScopeRerankService,
    private readonly toolPolicy: ToolExecutionPolicyService,
    private readonly badCaseFlywheel: BadCaseFlywheelService,
    private readonly metricsService: MetricsService,
    private readonly tracingService: TracingService,
    private readonly redisProvider: RedisProvider,
    agentLoop: AgentLoopService,
    private readonly evidencePolicy: EvidencePolicyService,
    @Optional() private readonly toolExecution?: ToolExecutionService,
    @Optional() private readonly securityAudit?: SecurityAuditService,
    @Optional()
    private readonly documentPermissions?: DocumentPermissionService,
    @Optional() private readonly artifactStore?: AgenticArtifactStoreService,
    @Optional() answerGenerationService?: AgenticAnswerGenerationService,
  ) {
    this.answerGenerationService =
      answerGenerationService ??
      new AgenticAnswerGenerationService(
        llmProvider,
        new GroundedAnswerGenerationService(llmProvider, this.evidencePolicy),
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
    this.initGraph();
  }

  /**
   * 初始化 LangGraph 状态图
   */
  private initGraph() {
    // 保留 queryAugment 节点 id 以恢复旧 checkpoint；节点只整理 QueryPlan 结果，不再调用扩写模型。
    const workflow = new StateGraph(AgenticRagState)
      .addNode(
        'queryAugment',
        // 保留 LangGraph 节点 id，旧 checkpoint 恢复时仍能找到原节点。
        this.observedNode('queryAugment', this.prepareQueriesNode.bind(this)),
      )
      .addNode(
        'retrieval',
        this.observedNode('retrieval', this.retrievalNode.bind(this)),
      )
      .addNode(
        'sufficiency',
        this.observedNode('sufficiency', this.sufficiencyNode.bind(this)),
      )
      .addNode(
        'webSearchFallback',
        this.observedNode(
          'webSearchFallback',
          this.webSearchFallbackNode.bind(this),
        ),
      )
      .addNode(
        'rerank',
        this.observedNode('rerank', this.rerankNode.bind(this)),
      )
      .addNode(
        'generate',
        this.observedNode('generate', this.generateNode.bind(this)),
      )
      .addNode(
        'humanApprovalNode',
        this.observedNode(
          'humanApprovalNode',
          this.humanApprovalNode.bind(this),
        ),
      )
      .addNode(
        'approvalPending',
        this.observedNode(
          'approvalPending',
          this.approvalPendingNode.bind(this),
        ),
      )
      .addNode(
        'reflection',
        this.observedNode('reflection', this.reflectionNode.bind(this)),
      );

    workflow.addEdge(START, 'queryAugment');
    workflow.addEdge('queryAugment', 'retrieval');
    workflow.addEdge('retrieval', 'sufficiency');

    workflow.addConditionalEdges(
      'sufficiency',
      (state) => {
        if (state.retrievalSufficient || state.webSearchAttempted) {
          return 'rerank';
        }
        return 'webSearchFallback';
      },
      {
        rerank: 'rerank',
        webSearchFallback: 'webSearchFallback',
      },
    );

    workflow.addEdge('webSearchFallback', 'sufficiency');
    workflow.addEdge('rerank', 'generate');
    // 先单独持久化 pending 状态，再进入原生 interrupt。这样进程中断后仍能
    // 从 Checkpoint 判断“等待审批”，恢复不会依赖瞬态 SSE 事件。
    workflow.addEdge('generate', 'approvalPending');
    workflow.addEdge('approvalPending', 'humanApprovalNode');

    // humanApprovalNode → reflection（approved/skipped）或 END（rejected）
    workflow.addConditionalEdges(
      'humanApprovalNode',
      (state) => {
        if (state.humanApproval === 'rejected') return END;
        return 'reflection';
      },
      {
        reflection: 'reflection',
        [END]: END,
      },
    );

    workflow.addConditionalEdges(
      'reflection',
      (state) => {
        const action = this.reflectionRouter(state);
        return action === 'retry' ? 'retrieval' : END;
      },
      {
        retrieval: 'retrieval',
        [END]: END,
      },
    );

    this.app = workflow.compile({
      checkpointer: this.checkpointer,
    });
  }

  /**
   * 路由决策：判断走 simple 还是 agentic
   * auto 模式下只在明确复杂问题时走 agentic
   */
  routeNode(
    state: AgenticRagStateType,
    mode: 'simple' | 'agentic' | 'auto',
    config?: RunnableConfig,
  ): Partial<AgenticRagStateType> {
    const retrieveOptions = (config?.configurable?.retrieveOptions ??
      {}) as RetrieveOptions;
    const queryPlan =
      retrieveOptions.queryPlan ?? createFallbackQueryPlan(state.query);
    let route: 'simple' | 'agentic';

    if (mode === 'auto') {
      route = resolveAutoRoute(queryPlan, state.retrievalSufficient);
    } else {
      route = mode;
    }

    this.logger.log(
      `Route decision: ${route} (mode=${mode}, query="${state.query.slice(0, 50)}")`,
    );
    return { route };
  }

  resolveAutoRoute(
    queryPlan: ReturnType<typeof createFallbackQueryPlan>,
    fastPathSufficient: boolean,
  ): 'simple' | 'agentic' {
    return resolveAutoRoute(queryPlan, fastPathSufficient);
  }

  buildSubQuestions(
    original: string,
    queries: string[],
    limit: number,
  ): ReturnType<typeof buildSubQuestions> {
    return buildSubQuestions(original, queries, limit);
  }

  buildExplicitSubQuestions(
    questions: string[],
    maxSubQuestions: number,
  ): ReturnType<typeof buildExplicitSubQuestions> {
    return buildExplicitSubQuestions(questions, maxSubQuestions);
  }

  /** 将 QueryPlan 整理成 Agentic 状态节点使用的查询与子问题清单。 */
  async prepareQueriesNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    const userId = config?.configurable?.userId as string | undefined;
    const retrieveOptions = (config?.configurable?.retrieveOptions ??
      {}) as RetrieveOptions;
    const prefetchedFastPath = config?.configurable?.prefetchedFastPath as
      | PrefetchedFastPath
      | undefined;
    const badCaseMatchesPromise = retrieveOptions.executionPlan?.scopeRestricted
      ? Promise.resolve([] as BadCaseMatch[])
      : prefetchedFastPath?.badCaseMatches
        ? Promise.resolve(prefetchedFastPath.badCaseMatches)
        : this.withTimeout(
            this.badCaseFlywheel.retrieveMatches(state.query, 2, userId),
            2_000,
            'Bad case candidate retrieval',
          ).catch(() => [] as BadCaseMatch[]);
    const queryPlan =
      retrieveOptions.queryPlan ?? createFallbackQueryPlan(state.query);
    const plannedQueries = retrieveOptions.executionPlan?.queries.map(
      (item) => item.text,
    ) ?? [state.query, ...queryPlan.subQueries];
    const queries = Array.from(
      new Set([state.query, ...plannedQueries, ...state.augmentedQueries]),
    )
      .filter(Boolean)
      .slice(0, this.maxRetrievalQueries);
    const plannedSubQuestions =
      state.subQuestions?.length > 0
        ? state.subQuestions
        : queryPlan.subQueries.length > 0
          ? buildExplicitSubQuestions(
              queryPlan.subQueries,
              this.maxSubQuestions,
            )
          : buildExplicitSubQuestions([state.query], this.maxSubQuestions);
    const subQuestions = plannedSubQuestions.slice(
      0,
      this.getSubQuestionLimit(config),
    );
    onEvent?.({
      type: 'query_augment',
      data: { queries, subQuestions },
    });
    const artifact = createAgenticArtifact(
      'subquestion_plan',
      'prepareQueries',
      {
        query: state.query,
        subQuestions,
      },
    );
    onEvent?.({ type: 'artifact', data: artifact });
    return {
      augmentedQueries: queries,
      subQuestions,
      badCaseMatches: await badCaseMatchesPromise,
      artifacts: [artifact],
    };
  }

  /** Agentic 只负责多步推理；底层候选由统一计划检索一次性召回和融合。 */
  async retrievalNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    const userId = config?.configurable?.userId as string | undefined;
    const retrieveOptions = (config?.configurable?.retrieveOptions ??
      {}) as RetrieveOptions;
    const fastPathChunks = (config?.configurable?.fastPathChunks ??
      []) as RetrievedChunk[];
    const prefetchedFastPath = config?.configurable?.prefetchedFastPath as
      | PrefetchedFastPath
      | undefined;
    const subQuestionLimit = this.getSubQuestionLimit(config);
    const plannedSubQuestions =
      state.subQuestions?.length > 0
        ? state.subQuestions
        : buildSubQuestions(
            state.query,
            state.augmentedQueries,
            subQuestionLimit,
          );
    const boundedSubQuestions = plannedSubQuestions.slice(
      0,
      Math.min(subQuestionLimit, this.maxRetrievalQueries),
    );
    const executionPlan =
      retrieveOptions.executionPlan ??
      this.resolveExecutionPlan(state.query, retrieveOptions);
    const formalRetrieval = fastPathChunks.length
      ? Promise.resolve(fastPathChunks)
      : this.retrievalCapability
          .retrieve(
            state.query,
            {
              ...retrieveOptions,
              executionPlan,
              rankingQuery: state.query,
            },
            userId,
          )
          .catch((error: unknown) => {
            this.logger.warn(
              `Unified retrieval failed: ${(error as Error).message}`,
            );
            return [] as RetrievedChunk[];
          });
    const retrievedSubQuestionsPromise = formalRetrieval.then((chunks) =>
      boundedSubQuestions.map((subQuestion) => ({
        ...subQuestion,
        status:
          chunks.length > 0 ? ('retrieved' as const) : ('needs_more' as const),
        evidenceIds: chunks.map((chunk) => chunk.id),
        retrievalAttempts: subQuestion.retrievalAttempts + 1,
        results: chunks,
      })),
    );

    // 统一 Hybrid 结果、已审核纠错证据和 Obsidian 读取并发准备；Auto 预取结果不重查。
    this.logger.log(
      `Retrieving ${boundedSubQuestions.length}/${plannedSubQuestions.length} sub-questions with hybrid search for userId=${userId ?? 'none'}`,
    );

    const [retrievedSubQuestions, reviewedBaseCaseChunks, obsidianContext] =
      await Promise.all([
        retrievedSubQuestionsPromise,
        Promise.resolve(
          this.supportingEvidenceCapability.toReviewedEvidenceChunks(
            state.badCaseMatches?.length
              ? state.badCaseMatches
              : (prefetchedFastPath?.badCaseMatches ?? []),
          ),
        ),
        retrieveOptions.executionPlan?.scopeRestricted
          ? Promise.resolve({ hits: [], context: '' })
          : prefetchedFastPath?.obsidianHits
            ? Promise.resolve({
                hits: prefetchedFastPath.obsidianHits,
                context:
                  this.supportingEvidenceCapability.formatObsidianContext(
                    prefetchedFastPath.obsidianHits,
                  ),
              })
            : this.supportingEvidenceCapability
                .getObsidianContext(
                  state.query,
                  userId,
                  retrieveOptions.scope?.role,
                )
                .catch(() => ({ hits: [], context: '' })),
      ]);
    const sourceResolution =
      await this.supportingEvidenceCapability.resolveObsidianSourceEvidence(
        state.query,
        obsidianContext.hits,
        userId,
        retrieveOptions,
      );
    const obsidianEvidenceHits = obsidianContext.hits.filter(
      (hit) => !sourceResolution.sourceNotePaths.has(hit.path),
    );
    const obsidianChunks =
      this.supportingEvidenceCapability.toObsidianChunks(obsidianEvidenceHits);
    const allResults = retrievedSubQuestions.map((item) => item.results);
    const updatedSubQuestions: AgenticSubQuestion[] = retrievedSubQuestions.map(
      ({ results, ...subQuestion }) => {
        void results;
        return subQuestion;
      },
    );
    if (sourceResolution.chunks.length > 0 && updatedSubQuestions.length > 0) {
      const queryIndex = updatedSubQuestions.findIndex(
        (item) => item.question === state.query,
      );
      const primaryIndex = queryIndex >= 0 ? queryIndex : 0;
      const primaryQuestion = updatedSubQuestions[primaryIndex];
      const sourceIds = sourceResolution.chunks.map((chunk) => chunk.id);
      updatedSubQuestions[primaryIndex] = {
        ...primaryQuestion,
        evidenceIds: [
          ...new Set([...sourceIds, ...primaryQuestion.evidenceIds]),
        ],
        status: 'retrieved',
      };
    }

    const formalChunkMap = new Map<string, RetrievedChunk>();
    for (const chunk of [...allResults.flat(), ...sourceResolution.chunks]) {
      const existing = formalChunkMap.get(chunk.id);
      if (
        !existing ||
        this.rankEvidenceChunks([existing, chunk])[0] === chunk
      ) {
        formalChunkMap.set(chunk.id, chunk);
      }
    }
    const formalChunks = Array.from(formalChunkMap.values());
    const formalEvidenceSufficient =
      formalChunks.length > 0 &&
      this.assessRetrievedChunks(
        state.query,
        formalChunks,
        retrieveOptions.queryPlan?.taskType,
      ).sufficient;
    // 与 Simple/Auto 的统一证据策略保持一致：正式 RAG 已足够时，Obsidian
    // 只能作为可观测补充，不能挤占正式片段；正式 RAG 不足时才纳入长期笔记兜底。
    const baselineCandidates = [
      ...fastPathChunks,
      ...reviewedBaseCaseChunks,
      ...sourceResolution.chunks,
      ...(formalEvidenceSufficient ? [] : obsidianChunks),
    ];
    const baselineMap = new Map<string, RetrievedChunk>();
    for (const chunk of baselineCandidates) {
      const existing = baselineMap.get(chunk.id);
      if (
        !existing ||
        this.rankEvidenceChunks([existing, chunk])[0] === chunk
      ) {
        baselineMap.set(chunk.id, chunk);
      }
    }
    const baselineChunks = Array.from(baselineMap.values());
    const resultIds = new Set(
      [...allResults.flat(), ...baselineChunks].map((chunk) => chunk.id),
    );
    const remainingSubQuestions = plannedSubQuestions
      .slice(boundedSubQuestions.length)
      .map((item) => ({ ...item, status: 'needs_more' as const }));

    const fusedMap = new Map<string, RetrievedChunk>();
    for (const chunk of baselineChunks) {
      fusedMap.set(chunk.id, chunk);
    }
    for (const results of allResults) {
      for (const chunk of results) {
        const existing = fusedMap.get(chunk.id);
        if (
          !existing ||
          this.rankEvidenceChunks([existing, chunk])[0] === chunk
        ) {
          fusedMap.set(chunk.id, chunk);
        }
      }
    }

    const allFusedChunks = Array.from(fusedMap.values());
    const rankedChunks = this.rankEvidenceChunks(allFusedChunks);
    // 结构化事实答案会在后续引用门禁阶段优先使用确定性抽取。先把该答案
    // 实际引用的片段保留到 maxRetrievedChunks，避免多文档场景中无关高分片段
    // 把“薪资／OKR／版本”这类跨 chunk 事实挤掉。
    const deterministicAnswer = this.buildEvidenceFirstAnswer(
      state.query,
      allFusedChunks,
    );
    const deterministicChunks = deterministicAnswer
      ? [...deterministicAnswer.matchAll(/\[片段\s*(\d+)\]/g)]
          .map((match) => allFusedChunks[Number(match[1]) - 1])
          .filter((chunk): chunk is RetrievedChunk => Boolean(chunk))
      : [];
    const requiredIds = updatedSubQuestions
      .map((item) => item.evidenceIds[0])
      .filter((id): id is string => Boolean(id));
    const requiredChunks = requiredIds
      .map((id) => fusedMap.get(id))
      .filter((chunk): chunk is RetrievedChunk => Boolean(chunk));
    const chunks = Array.from(
      new Map(
        [...requiredChunks, ...deterministicChunks, ...rankedChunks].map(
          (chunk) => [chunk.id, chunk],
        ),
      ).values(),
    ).slice(0, this.maxRetrievedChunks);

    this.logger.log(
      `Retrieved ${chunks.length} unique chunks from ${boundedSubQuestions.length} sub-questions`,
    );

    onEvent?.({
      type: 'retrieval',
      data: {
        chunks,
        subQuestions: [...updatedSubQuestions, ...remainingSubQuestions].map(
          (item) => ({ ...item, evidenceCount: item.evidenceIds.length }),
        ),
        evidenceCount: resultIds.size,
      },
    });
    const previousArtifacts = (state.artifacts ?? []).filter(
      (artifact) => artifact.type !== 'evidence_bundle',
    );
    const evidenceArtifact = createAgenticArtifact(
      'evidence_bundle',
      'retrieval',
      {
        query: state.query,
        chunkIds: chunks.map((chunk) => chunk.id),
        subQuestions: [...updatedSubQuestions, ...remainingSubQuestions].map(
          ({ id, question, evidenceIds, status }) => ({
            id,
            question,
            evidenceIds,
            status,
          }),
        ),
        webSearchCount: 0,
      },
    );
    onEvent?.({ type: 'artifact', data: evidenceArtifact });
    if (chunks.length === 0) {
      this.metricsService.observeAgentEmptyRetrieval(state.route || 'agentic');
    }
    return {
      retrievedChunks: chunks,
      subQuestions: [...updatedSubQuestions, ...remainingSubQuestions],
      artifacts: [...previousArtifacts, evidenceArtifact],
      webSearchAttempted: false,
      webSearchCount: 0,
      answer: '',
      passed: false,
    };
  }

  /**
   * 检索充分性评估
   */
  async sufficiencyNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    const retrieveOptions = (config?.configurable?.retrieveOptions ??
      {}) as RetrieveOptions;
    const subQuestions = state.subQuestions?.length
      ? state.subQuestions
      : buildSubQuestions(
          state.query,
          state.augmentedQueries,
          this.getSubQuestionLimit(config),
        );
    const fastPathBundle = config?.configurable?.fastPathBundle as
      | EvidenceBundle
      | undefined;
    // 对单一原问题，Fast Path 已经完成了权限过滤、混合检索和语义充分性判断。
    // Agentic 的“拆题”只是执行细节，不能使用不同问法把该结论推翻。
    if (
      fastPathBundle &&
      appliesToQuery(fastPathBundle, state.query) &&
      fastPathBundle.assessment.sufficient &&
      subQuestions.length <= 1
    ) {
      const reason = `复用统一证据包：${fastPathBundle.assessment.reason}`;
      const resolvedSubQuestions = subQuestions.map((subQuestion) => ({
        ...subQuestion,
        sufficient: true,
        status: 'sufficient' as const,
        reason,
        evidenceIds:
          subQuestion.evidenceIds.length > 0
            ? subQuestion.evidenceIds
            : fastPathBundle.chunks.map((chunk) => chunk.id),
      }));
      onEvent?.({
        type: 'sufficiency',
        data: { sufficient: true, reason, evidenceBundle: true },
      });
      return {
        retrievedChunks:
          state.retrievedChunks.length > 0
            ? state.retrievedChunks
            : fastPathBundle.chunks,
        retrievalSufficient: true,
        retrievalReason: reason,
        subQuestions: resolvedSubQuestions,
      };
    }
    const chunksById = new Map(
      state.retrievedChunks.map((chunk) => [chunk.id, chunk]),
    );
    const deterministicEvidenceAnswer = this.buildEvidenceFirstAnswer(
      state.query,
      state.retrievedChunks,
    );
    // 这些答案由当前 state 的结构化片段和固定字段匹配生成，引用编号也在同一
    // 批片段内；不再让一次不稳定的“语义充分性”判定把确定性证据重新打回不足。
    const deterministicEvidenceGate = Boolean(deterministicEvidenceAnswer);
    const evaluatedSubQuestions = subQuestions.map((subQuestion) => {
      const evidence = subQuestion.evidenceIds
        .map((id) => chunksById.get(id))
        .filter((chunk): chunk is RetrievedChunk => Boolean(chunk));
      const gate = this.assessRetrievedChunks(
        subQuestion.question,
        evidence,
        retrieveOptions.queryPlan?.taskType,
      );
      return {
        ...subQuestion,
        sufficient: gate.sufficient || deterministicEvidenceGate,
        status:
          gate.sufficient || deterministicEvidenceGate
            ? ('sufficient' as const)
            : ('needs_more' as const),
        reason: deterministicEvidenceGate
          ? '结构化证据可直接回答，保留当前片段进入生成与引用门禁'
          : gate.reason,
      };
    });
    const unresolved = evaluatedSubQuestions.filter((item) => !item.sufficient);

    if (state.retrievedChunks.length === 0 || unresolved.length > 0) {
      const res = {
        retrievalSufficient: false,
        retrievalReason:
          state.retrievedChunks.length === 0
            ? '没有检索到任何可用片段'
            : `仍有 ${unresolved.length} 个子问题缺少直接证据：${unresolved.map((item) => item.question).join('；')}`,
        subQuestions: evaluatedSubQuestions,
      };
      onEvent?.({
        type: 'sufficiency',
        data: {
          sufficient: res.retrievalSufficient,
          reason: res.retrievalReason,
        },
      });
      return res;
    }

    const localGate = this.assessRetrievedChunks(
      state.query,
      state.retrievedChunks,
      retrieveOptions.queryPlan?.taskType,
    );
    if (!localGate.sufficient) {
      onEvent?.({
        type: 'sufficiency',
        data: {
          sufficient: false,
          reason: localGate.reason,
        },
      });
      return {
        retrievalSufficient: false,
        retrievalReason: localGate.reason,
        subQuestions: evaluatedSubQuestions,
      };
    }

    if (
      this.sufficiencyFastPathEnabled &&
      evaluatedSubQuestions.every((item) => item.sufficient)
    ) {
      const reason =
        '本地质量门禁与子问题证据均已通过，跳过冗余的模型充分性判断';
      onEvent?.({
        type: 'sufficiency',
        data: { sufficient: true, reason, fastPath: true },
      });
      return {
        retrievalSufficient: true,
        retrievalReason: reason,
        subQuestions: evaluatedSubQuestions.map((item) => ({
          ...item,
          sufficient: true,
          status: 'sufficient' as const,
        })),
      };
    }

    const model = this.llmProvider.getModel();
    const schema = z.object({
      sufficient: z.boolean().describe('检索片段是否足够直接支撑回答用户问题'),
      reason: z.string().describe('中文评估理由'),
    });

    try {
      const structured = model.withStructuredOutput(schema);
      const chain = sufficiencyPrompt.pipe(structured);
      const context = state.retrievedChunks
        .map((c, i) => `[片段 ${i + 1}] ${c.content.slice(0, 500)}`)
        .join('\n\n');
      const result = await chain.invoke(
        {
          query: state.query,
          context,
        },
        {
          signal: config?.configurable?.abortSignal as AbortSignal | undefined,
        },
      );

      this.logger.log(
        `Retrieval sufficiency: sufficient=${result.sufficient}, reason=${result.reason}`,
      );

      const deterministicAnswer = deterministicEvidenceAnswer;
      const sufficient = result.sufficient || Boolean(deterministicAnswer);
      const resolvedReason =
        sufficient && !result.sufficient && deterministicAnswer
          ? '结构化证据可直接回答，保留当前片段进入生成与引用门禁'
          : result.reason;

      onEvent?.({
        type: 'sufficiency',
        data: {
          sufficient,
          reason: resolvedReason,
        },
      });

      return {
        retrievalSufficient: sufficient,
        retrievalReason: resolvedReason,
        subQuestions: evaluatedSubQuestions.map((item) => ({
          ...item,
          sufficient: sufficient && item.sufficient,
          status: sufficient && item.sufficient ? 'sufficient' : 'needs_more',
        })),
      };
    } catch (err) {
      // 结构化充分性判断失败时复用统一质量门禁；不能再用更高的硬编码分数阈值，
      // 否则已通过关键词覆盖的网页证据会因 0.15 < 0.20 被错误拒答。
      const fallbackGate = this.assessRetrievedChunks(
        state.query,
        state.retrievedChunks,
        retrieveOptions.queryPlan?.taskType,
      );
      const sufficient = fallbackGate.sufficient;
      const reason = `充分性 LLM 评估失败，按检索质量门禁判断：${fallbackGate.reason}`;
      this.logger.warn(`${reason}: ${(err as Error).message}`);

      onEvent?.({
        type: 'sufficiency',
        data: {
          sufficient,
          reason,
        },
      });

      return {
        retrievalSufficient: sufficient,
        retrievalReason: reason,
        subQuestions: evaluatedSubQuestions,
      };
    }
  }

  /**
   * 联网兜底
   */
  async webSearchFallbackNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType> & { webSearchCount: number }> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    const retrieveOptions = (config?.configurable?.retrieveOptions ??
      {}) as RetrieveOptions;
    if (
      retrieveOptions.knowledgeOnly ||
      retrieveOptions.sourcePolicy !== 'web_allowed'
    ) {
      const reason = `${state.retrievalReason || '本地检索不足'}；当前问题限定使用资料库，已跳过联网搜索`;
      onEvent?.({
        type: 'web_search',
        data: { count: 0, enabled: false, reason },
      });
      return {
        retrievalReason: reason,
        webSearchCount: 0,
        webSearchAttempted: true,
      };
    }
    if (state.retrievalSufficient) {
      return { webSearchCount: 0 };
    }

    if (
      !this.webSearchFallbackEnabled ||
      !this.bochaSearchService.isEnabled() ||
      !this.toolPolicy.decide(
        'bocha_web_search',
        this.pluginPolicy(config, 'agentic'),
      ).allowed
    ) {
      this.logger.warn(
        'Retrieval insufficient but Bocha web_search is disabled or budgeted off',
      );
      const reason = `${state.retrievalReason || '检索不足'}；联网兜底未启用或 BOCHA_API_KEY 未配置，已跳过`;
      onEvent?.({
        type: 'web_search',
        data: {
          count: 0,
          enabled:
            this.webSearchFallbackEnabled &&
            this.bochaSearchService.isEnabled(),
          reason,
        },
      });
      return {
        retrievalReason: reason,
        webSearchCount: 0,
        webSearchAttempted: true,
      };
    }

    try {
      const subQuestions = state.subQuestions?.length
        ? state.subQuestions
        : buildSubQuestions(
            state.query,
            state.augmentedQueries,
            this.getSubQuestionLimit(config),
          );
      const unresolved = subQuestions.filter((item) => !item.sufficient);
      const searchQuestions = unresolved.length
        ? unresolved.slice(0, this.getSubQuestionLimit(config))
        : [{ question: state.query }];
      const threadId = this.threadIdFromConfig(config);
      const searchResults = await Promise.all(
        searchQuestions.map(async (item) => ({
          question: item.question,
          results:
            this.maxWebSearchResults > 0
              ? await this.executeAgenticTool(
                  'bocha_web_search',
                  threadId,
                  this.userIdFromConfig(config),
                  { question: item.question, count: this.maxWebSearchResults },
                  () =>
                    this.bochaSearchService.search(
                      item.question,
                      this.maxWebSearchResults,
                      config?.configurable?.abortSignal as
                        | AbortSignal
                        | undefined,
                    ),
                  config,
                )
              : [],
        })),
      );
      const webIdsByQuestion = new Map<string, string[]>();
      const webChunks: RetrievedChunk[] = [];
      const maxResultsPerQuestion = Math.max(
        ...searchResults.map(({ results }) => results.length),
        0,
      );
      // 轮转合并：候选上限较小时，先保证每个子问题至少保留一条网页证据，再补充同题的更多结果。
      for (
        let resultIndex = 0;
        resultIndex < maxResultsPerQuestion;
        resultIndex += 1
      ) {
        for (const { results } of searchResults) {
          const result = results[resultIndex];
          if (!result) continue;
          const parts = [
            `标题：${result.title}`,
            `来源：${result.siteName ?? result.url}`,
            result.datePublished ? `发布时间：${result.datePublished}` : '',
            result.summary ? `摘要：${result.summary}` : '',
            result.snippet ? `片段：${result.snippet}` : '',
            `URL：${result.url}`,
          ].filter(Boolean);

          webChunks.push({
            id: `web:${result.url}`,
            content: parts.join('\n'),
            docId: result.url,
            chunkIndex: resultIndex,
            bm25Score: 0,
            cosineScore: 0,
            totalScore: 0.15,
          });
        }
      }
      for (const { question, results } of searchResults) {
        webIdsByQuestion.set(
          question,
          results.map((result) => `web:${result.url}`),
        );
      }

      this.logger.log(`Bocha web_search returned ${webChunks.length} results`);
      const reason = `${state.retrievalReason || '检索不足'}；已通过 Bocha web_search 补充 ${webChunks.length} 条结果`;
      onEvent?.({
        type: 'web_search',
        data: {
          count: webChunks.length,
          enabled: true,
          reason,
        },
      });
      return {
        // 本地召回已占满上限时，网页补证必须优先进入后续重排和引用阶段，不能在末尾被 slice 丢弃。
        retrievedChunks: [...webChunks, ...state.retrievedChunks].slice(
          0,
          this.maxRetrievedChunks,
        ),
        subQuestions: subQuestions.map((item) => ({
          ...item,
          evidenceIds: [
            ...item.evidenceIds,
            ...(webIdsByQuestion.get(item.question) ?? []),
          ],
          status: webIdsByQuestion.has(item.question)
            ? ('retrieved' as const)
            : item.status,
        })),
        retrievalReason: reason,
        webSearchCount: webChunks.length,
        webSearchAttempted: true,
      };
    } catch (err) {
      const reason = `Bocha web_search 调用失败：${(err as Error).message}`;
      this.logger.warn(reason);
      const fallbackReason = `${state.retrievalReason || '检索不足'}；${reason}`;
      onEvent?.({
        type: 'web_search',
        data: {
          count: 0,
          enabled:
            this.webSearchFallbackEnabled &&
            this.bochaSearchService.isEnabled(),
          reason: fallbackReason,
        },
      });
      return {
        retrievalReason: fallbackReason,
        webSearchCount: 0,
        webSearchAttempted: true,
      };
    }
  }

  /**
   * 二次排序
   */
  async rerankNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType> & { reranked: boolean }> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    if (state.retrievedChunks.length < 2) {
      onEvent?.({
        type: 'rerank',
        data: {
          enabled:
            this.rerankEnabled && this.dashScopeRerankService.isEnabled(),
          reranked: false,
          count: state.retrievedChunks.length,
        },
      });
      return { reranked: false };
    }

    if (
      !this.rerankEnabled ||
      !this.dashScopeRerankService.isEnabled() ||
      !this.toolPolicy.decide(
        'dashscope_rerank',
        this.pluginPolicy(config, 'agentic'),
      ).allowed
    ) {
      onEvent?.({
        type: 'rerank',
        data: {
          enabled: false,
          reranked: false,
          count: state.retrievedChunks.length,
        },
      });
      return { reranked: false };
    }

    try {
      const chunks = await this.executeAgenticTool(
        'dashscope_rerank',
        this.threadIdFromConfig(config),
        this.userIdFromConfig(config),
        {
          query: state.query,
          candidateCount: state.retrievedChunks.length,
          topN: this.maxRerankTopN,
        },
        () =>
          this.dashScopeRerankService.rerank(
            state.query,
            state.retrievedChunks,
            this.maxRerankTopN,
            config?.configurable?.abortSignal as AbortSignal | undefined,
          ),
        config,
      );
      const originalScoreById = new Map(
        state.retrievedChunks.map((chunk) => [chunk.id, chunk.totalScore]),
      );
      const rerankedChunks = chunks.map((chunk) => ({
        ...chunk,
        totalScore: originalScoreById.get(chunk.id) ?? chunk.totalScore,
        rerankScore: chunk.totalScore,
      }));
      onEvent?.({
        type: 'rerank',
        data: {
          enabled: true,
          reranked: true,
          count: chunks.length,
        },
      });
      return {
        retrievedChunks: this.rankEvidenceChunks(rerankedChunks),
        reranked: true,
      };
    } catch (err) {
      this.logger.warn(`DashScope rerank skipped: ${(err as Error).message}`);
      onEvent?.({
        type: 'rerank',
        data: {
          enabled: true,
          reranked: false,
          count: state.retrievedChunks.length,
        },
      });
      return { reranked: false };
    }
  }

  /**
   * 生成节点：基于检索结果生成答案
   */
  async generateNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    return this.answerGenerationService.generate(state, {
      onEvent: config?.configurable?.onEvent as SseCallback | undefined,
      history: (config?.configurable?.history ?? []) as Array<{
        role: 'human' | 'ai';
        content: string;
      }>,
      memoryMessages: (config?.configurable?.memoryMessages ?? []) as Array<{
        role: string;
        content: string;
      }>,
      retrieveOptions: (config?.configurable?.retrieveOptions ??
        {}) as RetrieveOptions,
      userId: this.userIdFromConfig(config),
      threadId: this.threadIdFromConfig(config),
      runId: this.runIdFromConfig(config),
      buildEvidenceFirstAnswer: (query, chunks) =>
        this.buildEvidenceFirstAnswer(query, chunks),
    });
  }

  /**
   * Reflection 节点：评估答案置信度，决定是否重试
   */
  async reflectionNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    if (!state.retrievalSufficient) {
      onEvent?.({
        type: 'reflection',
        data: {
          // 安全降级代表「没有编造答案」，不是「答案结论可信」。
          confidence: 0,
          passed: true,
          retryCount: state.retryCount,
          reason: '本地与联网证据不足时已进入安全降级，不再生成无证据答案',
        },
      });
      return { confidence: 0, passed: true, retryCount: state.retryCount };
    }

    const answerContract = [...(state.artifacts ?? [])]
      .reverse()
      .find((artifact) => artifact.type === 'answer_contract');
    const contractPayload = answerContract?.payload as
      | AnswerContractArtifactPayload
      | undefined;
    if (contractPayload && !contractPayload.valid) {
      const retryCount = state.retryCount + 1;
      const reason = `答案契约校验未通过：${contractPayload.reason}`;
      onEvent?.({
        type: 'reflection',
        data: {
          confidence: 0,
          passed: false,
          retryCount,
          reason,
        },
      });
      return {
        confidence: 0,
        passed: false,
        retryCount,
        reflectionFeedback: reason.slice(0, 500),
      };
    }

    if (
      this.reflectionFastPathEnabled &&
      contractPayload?.valid === true &&
      contractPayload.citationSupported === true &&
      contractPayload.subQuestionCoverage >= 1
    ) {
      onEvent?.({
        type: 'reflection',
        data: {
          confidence: 0.9,
          passed: true,
          retryCount: state.retryCount,
          reason: '答案契约和引用覆盖已通过，跳过冗余的模型反思调用',
          fastPath: true,
        },
      });
      return {
        confidence: 0.9,
        passed: true,
        retryCount: state.retryCount,
      };
    }

    const model = this.llmProvider.getModel();

    const schema = z.object({
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe(
          '答案置信度 0~1：是否完整回答了问题、是否有引用支撑、是否编造',
        ),
      reason: z.string().describe('评估理由（中文）'),
    });

    try {
      const structured = model.withStructuredOutput(schema);
      const chain = reflectionPrompt.pipe(structured);
      const result = await chain.invoke(
        {
          query: state.query,
          context: state.retrievedChunks
            .map((c, i) => `[片段 ${i + 1}] ${c.content.slice(0, 800)}`)
            .join('\n'),
          answer: state.answer,
        },
        {
          signal: config?.configurable?.abortSignal as AbortSignal | undefined,
        },
      );

      const passed = result.confidence >= this.confidenceThreshold;
      const retryCount = state.retryCount + 1;

      this.logger.log(
        `Reflection: confidence=${result.confidence.toFixed(2)}, passed=${passed}, retry=${retryCount}/${this.maxRetries}, reason=${result.reason}`,
      );

      onEvent?.({
        type: 'reflection',
        data: {
          confidence: result.confidence,
          passed,
          retryCount,
          reason: result.reason,
        },
      });

      return {
        confidence: result.confidence,
        passed,
        retryCount,
        reflectionFeedback: passed
          ? ''
          : `答案需要补充或修正：${result.reason}`.slice(0, 500),
      };
    } catch (err) {
      this.logger.warn(
        `Reflection failed, treat confidence as unknown and retry safely: ${(err as Error).message}`,
      );
      const retryCount = state.retryCount + 1;
      onEvent?.({
        type: 'reflection',
        data: {
          confidence: 0,
          passed: false,
          retryCount,
          reason: '反思评估失败，不能确认答案可信度',
        },
      });
      return {
        confidence: 0,
        passed: false,
        retryCount,
        reflectionFeedback:
          '反思评估失败，请重新核对原问题的每个要求并逐项作答。',
      };
    }
  }

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
  async approvalPendingNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    const enableInterrupt = config?.configurable?.enableInterrupt as
      | boolean
      | undefined;
    if (!enableInterrupt) return { humanApproval: 'approved' };
    return {
      humanApproval: 'pending',
      executionState: {
        ...state.executionState,
        paused: true,
        lastNode: 'approvalPending',
      },
    };
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
    if (!before.paused)
      throw new BadRequestException('当前运行不在等待审批状态');
    if (
      (before.executionState?.remainingSteps ??
        this.configService.get<number>('agentRun.maxSteps') ??
        18) <= 0
    ) {
      throw new BadRequestException('检查点剩余步骤预算已耗尽，不能继续恢复');
    }
    onEvent?.({
      type: 'resume',
      data: {
        threadId,
        checkpointId: before.checkpointId,
        executionState: before.executionState,
      },
    });

    const resumeContext = await this.getResumeContext(threadId, tenantId);
    // 使用 Command 恢复原生 interrupt，不能用普通输入重新 invoke。恢复时必须
    // 重新带上原始用户、权限 scope、插件策略和预算，不能以空上下文重放。
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
          runtimeRunId: resumeContext.runtimeRunId,
        },
      },
    )) as AgenticRagStateType;

    const result = {
      answer: finalState.answer,
      references: finalState.retrievedChunks,
      confidence: finalState.confidence,
      retryCount: finalState.retryCount,
      approved: approval === 'approved',
      executionState: finalState.executionState,
    };

    return result;
  }

  private async getResumeContext(
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

  /** 重新执行当前 Thread 的 Agentic 全链路，保留同一会话用于对比前后 Artifact。 */
  async retryRun(threadId: string, onEvent?: SseCallback) {
    const snapshot = await this.getRunSnapshot(threadId);
    if (!snapshot.available || !snapshot.query) {
      throw new Error('未找到可重新执行的 Agentic Thread');
    }
    return this.run(snapshot.query, 'agentic', onEvent, [], threadId);
  }

  /**
   * 条件路由：reflection 后决定重试还是结束
   */
  reflectionRouter(state: AgenticRagStateType): 'retry' | 'end' {
    if (state.passed) {
      this.metricsService.observeAgentLoopDecision('passed');
      return 'end';
    }
    if (state.retryCount >= this.maxRetries) {
      this.logger.warn(`Max retries (${this.maxRetries}) reached, ending`);
      this.metricsService.observeAgentLoopDecision('max_retries');
      return 'end';
    }
    this.metricsService.observeAgentLoopDecision('retry');
    return 'retry';
  }

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
  ): Promise<{
    answer: string;
    references: RetrievedChunk[];
    route: 'simple' | 'agentic';
    confidence: number;
    retryCount: number;
    retrievalSufficient?: boolean;
    retrievalReason?: string;
    obsidianPaths?: string[];
    interrupted?: boolean;
    evidenceCoverage?: Array<{
      id: string;
      query: string;
      covered: boolean;
      evidenceIds: string[];
    }>;
    executionState?: AgenticRagStateType['executionState'];
  }> {
    if (executionOptions.signal?.aborted) {
      throw new BadRequestException({
        code: 'AGENT_RUN_CANCELLED',
        message: '运行已取消，不再执行后续节点。',
      });
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
    if (shouldClarifyQueryPlan(queryPlan)) {
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
      const prompt = `你正在回答一个可由通用知识直接判断的客观事实问题。请独立计算或依据可靠通用知识直接回答，不要使用历史对话、用户未验证的说法或知识库片段，不要声称资料不足，也不要添加引用标记。用户问题：${query}`;
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
    // Auto 的 Fast Path 只用于选择执行引擎，并把首轮证据交给升级后的 Agentic 复用。
    // 显式 Agentic 直接进入状态机，按 QueryPlan 取证。
    const fastPathGate =
      !multiIntent && mode === 'auto'
        ? await this.fastPathCapability.assessFastPath(
            query,
            userId,
            retrieveOptions,
          )
        : null;
    const route =
      queryPlan.action === 'execute'
        ? 'agentic'
        : mode === 'simple'
          ? 'simple'
          : mode === 'agentic'
            ? 'agentic'
            : retrieveOptions.allowConversationStateAnswer
              ? 'simple'
              : queryPlan.contextMode === 'mixed'
                ? 'simple'
                : isObjectiveKnowledgePlan(queryPlan)
                  ? 'simple'
                  : multiIntent
                    ? 'agentic'
                    : resolveAutoRoute(
                        queryPlan,
                        Boolean(fastPathGate?.sufficient),
                      );
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

    // 通过 LangGraph StateGraph 执行 agentic 流程
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
          runtimeRunId: retrieveOptions.runtimeRunId,
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const graphSnapshot = await this.app.getState({
      configurable: { thread_id: threadId },
    });
    const interrupted =
      Array.isArray(graphSnapshot?.tasks) &&
      graphSnapshot.tasks.some(
        (task: { interrupts?: unknown[] }) =>
          Array.isArray(task.interrupts) && task.interrupts.length > 0,
      );
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

  private splitAnswerTokens(answer: string): string[] {
    return answer.match(/.{1,24}/gs) ?? [];
  }

  private observedNode(
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

  private recordAgentNodeTrace(
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

  private isAgenticRoute(value: unknown): value is 'simple' | 'agentic' {
    return value === 'simple' || value === 'agentic';
  }

  private isSubQuestions(value: unknown): value is AgenticSubQuestion[] {
    return Array.isArray(value);
  }

  private isArtifacts(value: unknown): value is AgenticArtifact[] {
    return Array.isArray(value);
  }

  private isResumeContext(value: unknown): value is AgenticResumeContext {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const context = value as Record<string, unknown>;
    return (
      Array.isArray(context.history) &&
      Array.isArray(context.memoryMessages) &&
      Boolean(
        context.retrieveOptions &&
        typeof context.retrieveOptions === 'object' &&
        !Array.isArray(context.retrieveOptions),
      )
    );
  }

  /** 直连 Agentic 的兼容入口也只生成保守单查询计划，不再自行做意图识别。 */
  private resolveExecutionPlan(
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

  private recordOf(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  }

  private getSubQuestionLimit(config?: RunnableConfig): number {
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

  private intConfig(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const value = this.configService.get<number>(key) ?? fallback;
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(value)));
  }

  private async executeAgenticTool<T>(
    toolName: string,
    threadId: string,
    ownerUserId: string | undefined,
    input: unknown,
    execute: () => Promise<T>,
    config?: RunnableConfig,
  ): Promise<T> {
    if (!this.toolExecution || !threadId) return execute();
    const result = await this.toolExecution.execute({
      toolName,
      threadId,
      ownerUserId,
      actor: 'agentic_rag',
      ...this.pluginPolicy(config, 'agentic'),
      input,
      execute,
    });
    if (!result.output)
      throw new Error(result.error ?? `${toolName} 被阻断或未返回结果`);
    return result.output;
  }

  private pluginPolicy(
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

  private threadIdFromConfig(config?: RunnableConfig): string {
    const value = config?.configurable?.thread_id;
    return typeof value === 'string' ? value : '';
  }

  private userIdFromConfig(config?: RunnableConfig): string | undefined {
    const value = config?.configurable?.userId;
    return typeof value === 'string' && value ? value : undefined;
  }

  private runIdFromConfig(config?: RunnableConfig): string | undefined {
    const retrieveOptions = config?.configurable?.retrieveOptions as
      | RetrieveOptions
      | undefined;
    return retrieveOptions?.runtimeRunId;
  }

  /** Run 的取消标记由 AgentRunsService 写入 Redis；节点边界检查可避免继续发起新工具调用。 */
  private async isCancellationRequested(
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

  private numberConfig(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const value = this.configService.get<number>(key) ?? fallback;
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }

  private rankEvidenceChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
    return this.evidencePolicy.rankEvidenceChunks(chunks);
  }

  private assessRetrievedChunks(
    query: string,
    chunks: RetrievedChunk[],
    taskType?: QueryTaskType,
  ): { sufficient: boolean; reason: string } {
    return this.evidencePolicy.assessRetrievedChunks(query, chunks, taskType);
  }

  private buildEvidenceFirstAnswer(
    query: string,
    chunks: RetrievedChunk[],
  ): string | null {
    return this.evidencePolicy.buildEvidenceFirstAnswer(query, chunks);
  }

  private async withTimeout<T>(
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

  private composeSignal(signal: AbortSignal | undefined, timeoutMs: number) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  }
}
