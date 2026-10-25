import { ConfigService } from '@nestjs/config';
import { AgenticRagService } from './agentic-rag.service';
import type { LlmProvider } from '../../providers/llm/llm.provider';
import type {
  KarpathyRagService,
  RetrieveOptions,
} from '../karpathy/karpathy-rag.service';
import type { BochaSearchService } from '../../tools/bocha-search.service';
import type { DashScopeRerankService } from '../../tools/dashscope-rerank.service';
import { createFallbackQueryPlan } from '../planning/query-plan';
import type { RedisProvider } from '../../providers/redis/redis.provider';
import type { AgenticRagStateType } from './agentic-rag.state';
import type { ObsidianSearchHit } from '../../modules/obsidian/obsidian-knowledge.service';
import type { PrefetchedFastPath } from '../karpathy/karpathy-rag.service';

describe('AgenticRagService budget boundaries', () => {
  function createService(overrides: Record<string, unknown> = {}) {
    const config = {
      get: jest.fn((key: string) => {
        const defaults: Record<string, unknown> = {
          'agentic.confidenceThreshold': 0.7,
          'agentic.maxRetries': 1,
          'agentic.maxAugmentedQueries': 2,
          'agentic.maxRetrievalQueries': 2,
          'agentic.maxSubQuestions': 2,
          'agentic.maxRetrievedChunks': 2,
          'agentic.maxWebSearchResults': 1,
          'agentic.maxRerankTopN': 2,
          'agentic.maxAutoQueryLength': 20,
          'agentic.webSearchFallbackEnabled': true,
          'agentic.rerankEnabled': true,
        };
        return key in overrides ? overrides[key] : defaults[key];
      }),
    } as unknown as ConfigService;

    const getModelMock = jest.fn();
    const llmProvider = {
      getModel: getModelMock,
    } as unknown as LlmProvider;
    const karpathyRagService = {
      answerDirect: jest.fn().mockResolvedValue(null),
      assessFastPath: jest.fn(),
      answer: jest.fn(),
      formatObsidianContext: jest.fn().mockReturnValue(''),
      retrieve: jest.fn(),
      retrieveBm25Only: jest.fn(),
      getObsidianContext: jest
        .fn()
        .mockResolvedValue({ hits: [], context: '' }),
      resolveObsidianSourceEvidence: jest.fn().mockResolvedValue({
        chunks: [],
        mappedDocIds: new Set<string>(),
        sourceNotePaths: new Set<string>(),
      }),
      toReviewedEvidenceChunks: jest.fn().mockReturnValue([]),
      toObsidianChunks: jest.fn().mockReturnValue([]),
      hasIndexedChunks: jest.fn().mockReturnValue(true),
      unsupportedReliableAnswer: jest
        .fn()
        .mockReturnValue('知识库片段不足以支撑可靠回答，暂不生成确定结论。'),
    } as unknown as jest.Mocked<KarpathyRagService>;
    const bochaSearchService = {
      isEnabled: jest.fn().mockReturnValue(false),
    } as unknown as BochaSearchService;
    const dashScopeRerankService = {
      isEnabled: jest.fn().mockReturnValue(false),
    } as unknown as DashScopeRerankService;
    const toolPolicy = { decide: jest.fn().mockReturnValue({ allowed: true }) };
    const badCaseFlywheel = {
      selectPrompt: jest.fn().mockResolvedValue(''),
      retrieveMatches: jest.fn().mockResolvedValue([]),
    };
    const metricsService = {
      observeAgentNode: jest.fn(),
      observeAgentFirstToken: jest.fn(),
      observeAgentToolCall: jest.fn(),
      observeAgentLoopDecision: jest.fn(),
      observeAgentEmptyRetrieval: jest.fn(),
    };
    const tracingService = {
      recordAgentNode: jest.fn().mockReturnValue({}),
    };
    const redisProvider = {} as RedisProvider;
    const agentLoop = { run: jest.fn() };

    const service = new AgenticRagService(
      config,
      llmProvider,
      karpathyRagService,
      bochaSearchService,
      dashScopeRerankService,
      toolPolicy,
      badCaseFlywheel as never,
      metricsService as never,
      tracingService as never,
      redisProvider,
      agentLoop as never,
    );

    return {
      service,
      karpathyRagService,
      llmProvider,
      getModelMock,
      badCaseFlywheel,
    };
  }

  it('routes Auto from the structured plan and evidence sufficiency', () => {
    const { service } = createService();
    const resolveAutoRoute = (
      service as unknown as {
        resolveAutoRoute(
          plan: ReturnType<typeof createFallbackQueryPlan>,
          sufficient: boolean,
        ): 'simple' | 'agentic';
      }
    ).resolveAutoRoute.bind(service);
    const comparisonPlan = {
      ...createFallbackQueryPlan('请分析'),
      taskType: 'comparison' as const,
    };
    const lookupPlan = createFallbackQueryPlan('资料里说了什么？');

    expect(resolveAutoRoute(comparisonPlan, true)).toBe('agentic');
    expect(resolveAutoRoute(lookupPlan, true)).toBe('simple');
    expect(resolveAutoRoute(lookupPlan, false)).toBe('agentic');
  });

  it('passes request cancellation into evidence synthesis fallback', async () => {
    const { service, llmProvider } = createService();
    const invoke = jest.fn().mockResolvedValue('结论[片段1]');
    (llmProvider as any).invoke = invoke;
    (llmProvider as any).getActiveProviderName = jest
      .fn()
      .mockReturnValue('qwen');
    const controller = new AbortController();

    await expect(
      (service as any).synthesizeEvidenceAnswer(
        '问题',
        [{ content: '证据' }],
        controller.signal,
      ),
    ).resolves.toBe('结论[片段1]');

    expect(invoke).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    controller.abort();
  });

  it('keeps an explicitly selected agentic request on the state machine', async () => {
    const { service, karpathyRagService } = createService();
    const invoke = jest.fn().mockResolvedValue({
      answer: '已完成深度处理。',
      retrievedChunks: [],
      retrievalSufficient: true,
      retrievalReason: '状态机已完成',
      confidence: 1,
      retryCount: 0,
      subQuestions: [],
      artifacts: [],
      executionState: { remainingSteps: 1, remainingToolCalls: 1 },
    });
    (
      service as unknown as { app: { invoke: jest.Mock; getState: jest.Mock } }
    ).app = {
      invoke,
      getState: jest.fn().mockResolvedValue({ tasks: [] }),
    };

    await expect(
      service.run(
        'React 是什么？',
        'agentic',
        undefined,
        [],
        'thread-1',
        undefined,
        [],
        false,
        {
          queryIntent: {
            intent: 'objective_fact',
            contextMode: 'none',
            historyPolicy: 'context_only',
            confidence: 1,
            standaloneQuery: 'React 是什么？',
            multiIntent: false,
            subQueries: [],
            action: 'direct_answer',
            sourcePolicy: 'direct_answer',
            needsSynthesis: false,
            requiresGraph: false,
            targetKbs: ['general'],
            queryType: 'public_knowledge',
            entities: [],
            filters: {
              department: null,
              project: null,
              timeRange: null,
              documentType: null,
            },
            rewriteQueries: [],
            reason: '稳定公共事实',
            ambiguity: { detected: false, confidence: 1, senses: [] },
          },
        },
      ),
    ).resolves.toMatchObject({ route: 'agentic' });

    expect(karpathyRagService.assessFastPath).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('routes execute plans through Agentic even when the requested mode is simple', async () => {
    const { service } = createService();
    const invoke = jest.fn().mockResolvedValue({
      answer: '任务已执行。',
      retrievedChunks: [],
      retrievalSufficient: true,
      retrievalReason: '状态机已完成',
      confidence: 1,
      retryCount: 0,
      subQuestions: [],
      artifacts: [],
      executionState: { remainingSteps: 1, remainingToolCalls: 1 },
    });
    (
      service as unknown as { app: { invoke: jest.Mock; getState: jest.Mock } }
    ).app = {
      invoke,
      getState: jest.fn().mockResolvedValue({ tasks: [] }),
    };
    const queryPlan = {
      ...createFallbackQueryPlan('生成一份报告'),
      action: 'execute' as const,
    };

    await expect(
      service.run(
        '生成一份报告',
        'simple',
        undefined,
        [],
        'thread-1',
        'user-1',
        [],
        false,
        { queryPlan, allowConversationStateAnswer: true },
      ),
    ).resolves.toMatchObject({ answer: '任务已执行。', route: 'agentic' });

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('forces an explicitly scoped Agentic execution plan to local-only', async () => {
    const { service } = createService();
    let capturedRetrieveOptions: RetrieveOptions | undefined;
    const invoke = jest.fn(
      (
        _input: unknown,
        options: { configurable?: { retrieveOptions?: RetrieveOptions } },
      ) => {
        capturedRetrieveOptions = options.configurable?.retrieveOptions;
        return Promise.resolve({
          answer: '已按项目范围完成检索。',
          retrievedChunks: [],
          retrievalSufficient: true,
          retrievalReason: '状态机已完成',
          confidence: 1,
          retryCount: 0,
          subQuestions: [],
          artifacts: [],
          executionState: { remainingSteps: 1, remainingToolCalls: 1 },
        });
      },
    );
    (
      service as unknown as { app: { invoke: jest.Mock; getState: jest.Mock } }
    ).app = {
      invoke,
      getState: jest.fn().mockResolvedValue({ tasks: [] }),
    };
    const scope = { projectId: 'project-private' };
    const queryPlan = {
      ...createFallbackQueryPlan('查项目资料'),
      domain: 'realtime' as const,
    };
    const executionPlan = {
      planVersion: 2 as const,
      sourcePolicy: 'web_allowed' as const,
      queries: [{ text: '查项目资料', kind: 'original' as const, weight: 1 }],
      profile: {
        intent: 'lookup' as const,
        candidateDepth: 8,
        finalTopK: 4,
        neighborWindow: 0,
        sameSectionLimit: 0,
        contextCharacterBudget: 3500,
        maxChunksPerDocument: 2,
      },
      useGraph: false,
      scope,
      scopeRestricted: false,
      reasonCode: 'realtime_web_allowed' as const,
    };
    const requestContext = {
      requestId: 'request-1',
      userId: 'user-1',
      threadId: 'thread-1',
      query: '查项目资料',
      mode: 'agentic' as const,
      queryPlan,
      executionPlan,
      sourcePolicy: 'web_allowed' as const,
      scope,
      deadlineAt: Date.now() + 60_000,
      budget: {
        maxSteps: 5,
        maxToolCalls: 2,
        remainingSteps: 5,
        remainingToolCalls: 2,
      },
    };

    await service.run(
      '查项目资料',
      'agentic',
      undefined,
      [],
      'thread-1',
      'user-1',
      [],
      false,
      {
        queryPlan,
        executionPlan,
        requestContext,
        scope,
        sourcePolicy: 'web_allowed',
      },
    );

    expect(capturedRetrieveOptions).toBeDefined();
    expect(capturedRetrieveOptions?.sourcePolicy).toBe('local_only');
    expect(capturedRetrieveOptions?.knowledgeOnly).toBe(true);
    expect(capturedRetrieveOptions?.executionPlan).toMatchObject({
      sourcePolicy: 'local_only',
      scopeRestricted: true,
      scope,
    });
    expect(capturedRetrieveOptions?.requestContext).toMatchObject({
      sourcePolicy: 'local_only',
      executionPlan: {
        sourcePolicy: 'local_only',
        scopeRestricted: true,
      },
      scope,
    });
  });

  it('does not use a direct-answer shortcut when current-turn attachments are evidence', async () => {
    const { service, karpathyRagService, llmProvider } = createService();
    const attachment = {
      ...chunk('attachment:1:1', 0.9),
      retrievalSource: 'attachment' as const,
    };
    const prefetchedFastPath = {
      retrieval: { chunks: [attachment], diagnostics: {}, profile: {} },
      obsidianHits: [],
    } as never;
    const assessFastPath = jest.fn().mockResolvedValue({
      sufficient: true,
      reason: '附件证据充分',
      chunks: [attachment],
      obsidianHits: [],
      prefetchedFastPath,
    }) as unknown as jest.MockedFunction<KarpathyRagService['assessFastPath']>;
    const answer = jest.fn().mockResolvedValue({
      answer: '附件资料给出的结果。',
      references: [attachment],
      retrievalSufficient: true,
    }) as unknown as jest.MockedFunction<KarpathyRagService['answer']>;
    karpathyRagService.assessFastPath = assessFastPath;
    karpathyRagService.answer = answer;
    const invoke = jest.fn();
    (llmProvider as unknown as { invoke: jest.Mock }).invoke = invoke;
    const queryPlan = {
      ...createFallbackQueryPlan('请根据附件核对这个公开事实'),
      action: 'direct' as const,
      domain: 'public' as const,
    };
    const executionPlan = {
      planVersion: 2 as const,
      sourcePolicy: 'direct_answer' as const,
      queries: [
        {
          text: '请根据附件核对这个公开事实',
          kind: 'original' as const,
          weight: 1,
        },
      ],
      profile: {
        intent: 'lookup' as const,
        candidateDepth: 8,
        finalTopK: 4,
        neighborWindow: 0,
        sameSectionLimit: 0,
        contextCharacterBudget: 3500,
        maxChunksPerDocument: 2,
      },
      useGraph: false,
      scopeRestricted: false,
      reasonCode: 'stable_public_direct' as const,
    };

    await expect(
      service.run(
        '请根据附件核对这个公开事实',
        'auto',
        undefined,
        [],
        'thread-1',
        'user-1',
        [],
        false,
        {
          queryPlan,
          executionPlan,
          sourcePolicy: 'direct_answer',
          supplementalEvidence: [attachment],
        },
      ),
    ).resolves.toMatchObject({
      answer: '附件资料给出的结果。',
      route: 'simple',
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(assessFastPath).toHaveBeenCalledWith(
      '请根据附件核对这个公开事实',
      'user-1',
      expect.objectContaining({
        sourcePolicy: 'local_only',
        knowledgeOnly: true,
        supplementalEvidence: [attachment],
      }),
    );
    expect(answer).toHaveBeenCalledWith(
      '请根据附件核对这个公开事实',
      [],
      'user-1',
      [],
      expect.any(Function),
      expect.objectContaining({ prefetchedFastPath }),
    );
  });

  it('keeps a public QueryPlan on retrieval when a stale execution plan says direct-answer', async () => {
    const { service, karpathyRagService, llmProvider } = createService();
    const prefetchedFastPath = {
      retrieval: { chunks: [], diagnostics: {}, profile: {} },
      obsidianHits: [],
    } as never;
    karpathyRagService.assessFastPath.mockResolvedValue({
      sufficient: true,
      reason: '已有本地证据',
      chunks: [],
      obsidianHits: [],
      prefetchedFastPath,
    });
    karpathyRagService.answer.mockResolvedValue({
      answer: '通过本地证据回答。',
      references: [],
      retrievalSufficient: true,
    });
    const invoke = jest.fn();
    (llmProvider as unknown as { invoke: jest.Mock }).invoke = invoke;
    const assessFastPath = serviceMock(karpathyRagService, 'assessFastPath');
    const answer = serviceMock(karpathyRagService, 'answer');
    const query = '核对这个公开事实';
    const queryPlan = {
      ...createFallbackQueryPlan(query),
      action: 'retrieve' as const,
      domain: 'public' as const,
    };
    const executionPlan = {
      planVersion: 2 as const,
      sourcePolicy: 'direct_answer' as const,
      queries: [{ text: query, kind: 'original' as const, weight: 1 }],
      profile: {
        intent: 'lookup' as const,
        candidateDepth: 8,
        finalTopK: 4,
        neighborWindow: 0,
        sameSectionLimit: 0,
        contextCharacterBudget: 3500,
        maxChunksPerDocument: 2,
      },
      useGraph: false,
      scopeRestricted: false,
      reasonCode: 'stable_public_direct' as const,
    };

    await expect(
      service.run(
        query,
        'auto',
        undefined,
        [],
        'thread-1',
        'user-1',
        [],
        false,
        {
          queryPlan,
          executionPlan,
        },
      ),
    ).resolves.toMatchObject({ answer: '通过本地证据回答。', route: 'simple' });

    expect(invoke).not.toHaveBeenCalled();
    expect(assessFastPath).toHaveBeenCalledWith(
      query,
      'user-1',
      expect.objectContaining({
        sourcePolicy: 'local_only',
        knowledgeOnly: true,
      }),
    );
    expect(answer).toHaveBeenCalled();
  });

  it('retrieves one shared candidate bundle from every execution-plan query', async () => {
    const { service, karpathyRagService } = createService();
    const retrieve = jest
      .fn()
      .mockResolvedValue([
        chunk('candidate-original', 0.9),
        chunk('candidate-subquery', 0.8),
      ]);
    karpathyRagService.retrieve = retrieve;
    const executionPlan = {
      planVersion: 2 as const,
      sourcePolicy: 'local_only' as const,
      queries: [
        { text: '原始问题', kind: 'original' as const, weight: 1 },
        { text: '独立化问题', kind: 'standalone' as const, weight: 0.85 },
        { text: '计划子问题', kind: 'sub_query' as const, weight: 0.7 },
      ],
      profile: {
        intent: 'lookup' as const,
        candidateDepth: 8,
        finalTopK: 4,
        neighborWindow: 0,
        sameSectionLimit: 0,
        contextCharacterBudget: 3500,
        maxChunksPerDocument: 2,
      },
      useGraph: false,
      scopeRestricted: false,
      reasonCode: 'internal_evidence_required' as const,
    };
    const subQuestions = ['计划子问题 A', '计划子问题 B'].map(
      (question, index) => ({
        id: `q${index + 1}`,
        question,
        dependsOn: [],
        status: 'planned' as const,
        evidenceIds: [],
        retrievalAttempts: 0,
        sufficient: false,
        reason: '',
      }),
    );

    const result = await service.retrievalNode(
      {
        query: '原始问题',
        augmentedQueries: [],
        subQuestions,
      } as unknown as AgenticRagStateType,
      {
        configurable: { retrieveOptions: { executionPlan }, userId: 'user-1' },
      },
    );

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledWith(
      '原始问题',
      expect.objectContaining({ executionPlan }),
      'user-1',
    );
    expect(result.subQuestions?.map((item) => item.evidenceIds)).toEqual([
      ['candidate-original', 'candidate-subquery'],
      ['candidate-original', 'candidate-subquery'],
    ]);
  });

  it('persists the pending approval state before entering the native interrupt node', async () => {
    const { service } = createService();

    const result = await service.approvalPendingNode(
      {
        executionState: {
          consumedSteps: 4,
          consumedToolCalls: 1,
          remainingSteps: 14,
          remainingToolCalls: 23,
        },
      } as AgenticRagStateType,
      { configurable: { enableInterrupt: true } },
    );

    expect(result).toEqual({
      humanApproval: 'pending',
      executionState: expect.objectContaining({
        paused: true,
        lastNode: 'approvalPending',
      }),
    });
  });

  it('recognizes a cancellation marker at the run boundary', async () => {
    const { service } = createService();
    (
      service as unknown as { redisProvider: { get: jest.Mock } }
    ).redisProvider = {
      get: jest.fn().mockResolvedValue('cancelled'),
    };
    const isCancellationRequested = (
      service as unknown as {
        isCancellationRequested: (config: unknown) => Promise<boolean>;
      }
    ).isCancellationRequested.bind(service);

    await expect(
      isCancellationRequested({
        configurable: {
          thread_id: 'thread-1',
          retrieveOptions: { runtimeRunId: 'run-1' },
        },
      }),
    ).resolves.toBe(true);
  });

  it('restores a legacy queryIntent from a checkpoint and passes its plan to retrieval', async () => {
    const { service, karpathyRagService } = createService();
    const retrieve = serviceMock(karpathyRagService, 'retrieve');
    retrieve.mockResolvedValue([]);
    (karpathyRagService.retrieveBm25Only as jest.Mock).mockResolvedValue([]);
    const legacyQueryIntent = {
      intent: 'objective_fact',
      contextMode: 'factual_verification',
      standaloneQuery: '核对 Alpha 和 Beta',
      multiIntent: true,
      subQueries: ['Alpha 的结论', 'Beta 的结论'],
      action: 'retrieve',
      needsSynthesis: true,
      requiresGraph: true,
      queryType: 'multi_intent',
      entities: ['Alpha', 'Beta'],
      filters: {},
    };
    const serviceWithCheckpointer = service as unknown as {
      checkpointer: { getTuple: jest.Mock };
      getResumeContext: (
        threadId: string,
      ) => Promise<{ retrieveOptions: RetrieveOptions }>;
      retrievalNode: (
        state: AgenticRagStateType,
        config: { configurable: { retrieveOptions: RetrieveOptions } },
      ) => Promise<unknown>;
    };
    serviceWithCheckpointer.checkpointer = {
      getTuple: jest.fn().mockResolvedValue({
        checkpoint: {
          channel_values: {
            query: '综合比较 Alpha 和 Beta',
            resumeContext: {
              history: [],
              memoryMessages: [],
              retrieveOptions: { queryIntent: legacyQueryIntent },
            },
          },
        },
      }),
    };

    const getResumeContext =
      serviceWithCheckpointer.getResumeContext.bind(service);
    const resumeContext = await getResumeContext('thread-legacy');
    const restoredOptions = resumeContext.retrieveOptions;

    expect(restoredOptions.queryPlan).toMatchObject({
      taskType: 'synthesis',
      needsGraph: true,
      entities: ['Alpha', 'Beta'],
      subQueries: ['Alpha 的结论', 'Beta 的结论'],
    });
    expect(restoredOptions.needsSynthesis).toBe(true);
    expect(restoredOptions.entities).toEqual(['Alpha', 'Beta']);
    expect(restoredOptions.executionPlan?.useGraph).toBe(true);

    const retrievalNode = serviceWithCheckpointer.retrievalNode.bind(service);
    await retrievalNode(
      {
        query: '综合比较 Alpha 和 Beta',
        augmentedQueries: [],
        subQuestions: [
          {
            id: 'q1',
            question: '综合比较 Alpha 和 Beta',
            dependsOn: [],
            status: 'planned',
            evidenceIds: [],
            retrievalAttempts: 0,
            sufficient: false,
            reason: '',
          },
        ],
        badCaseMatches: [],
      } as unknown as AgenticRagStateType,
      {
        configurable: {
          retrieveOptions: restoredOptions,
        },
      },
    );

    const [retrievedQuery, retrievedOptions, userId] = retrieve.mock
      .calls[0] as [string, RetrieveOptions, string | undefined] | [];
    expect(retrievedQuery).toBe('综合比较 Alpha 和 Beta');
    expect(retrievedOptions?.queryPlan).toMatchObject({
      taskType: 'synthesis',
      entities: ['Alpha', 'Beta'],
    });
    expect(retrievedOptions?.needsSynthesis).toBe(true);
    expect(retrievedOptions?.entities).toEqual(['Alpha', 'Beta']);
    expect(retrievedOptions?.executionPlan?.useGraph).toBe(true);
    expect(userId).toBeUndefined();
  });

  it('uses only explicitly planned sub-questions without keyword inference', () => {
    const { service } = createService();

    const questions = (
      service as unknown as {
        buildSubQuestions(
          original: string,
          queries: string[],
          limit?: number,
        ): Array<{ question: string }>;
      }
    ).buildSubQuestions(
      '资料库里面的陈达出现在第几章节，他的花名叫什么',
      ['陈达第几回出场', '陈达的花名是什么'],
      2,
    );

    expect(questions.map((item) => item.question)).toEqual([
      '资料库里面的陈达出现在第几章节，他的花名叫什么',
      '陈达第几回出场',
    ]);
  });

  it('keeps explicit multi-question boundaries as independent retrieval units', () => {
    const { service } = createService();

    expect(
      (
        service as unknown as {
          buildExplicitSubQuestions(
            questions: string[],
          ): Array<{ question: string }>;
        }
      ).buildExplicitSubQuestions(['React 是什么？', '1+1 等于多少？']),
    ).toEqual([
      expect.objectContaining({ question: 'React 是什么？' }),
      expect.objectContaining({ question: '1+1 等于多少？' }),
    ]);
  });

  it('uses the Hybrid Fast Path as Auto direct-answer evidence instead of a second direct lookup', async () => {
    const { service, karpathyRagService } = createService();
    const prefetchedFastPath = {
      retrieval: { chunks: [], diagnostics: {}, profile: {} },
      obsidianHits: [],
    } as never;
    karpathyRagService.assessFastPath.mockResolvedValue({
      sufficient: true,
      reason: '结构化状态证据充分',
      chunks: [],
      obsidianHits: [],
      prefetchedFastPath,
    });
    karpathyRagService.answer.mockResolvedValue({
      answer: 'ACT100 已上线。',
      references: [],
      retrievalSufficient: true,
      retrievalReason: '结构化状态证据充分',
    });

    await expect(
      service.run('ACT100 的状态是什么？', 'auto'),
    ).resolves.toMatchObject({
      answer: 'ACT100 已上线。',
      route: 'simple',
      retrievalSufficient: true,
    });
    expect(karpathyRagService.answerDirect).not.toHaveBeenCalled();
    expect(karpathyRagService.assessFastPath).toHaveBeenCalledTimes(1);
    expect(karpathyRagService.answer).toHaveBeenCalledWith(
      'ACT100 的状态是什么？',
      [],
      undefined,
      [],
      expect.any(Function),
      expect.objectContaining({ prefetchedFastPath }),
    );
  });

  it('reuses a sufficient Base Case Fast Path result in Auto simple route', async () => {
    const { service, karpathyRagService } = createService();
    const reviewedChunk = chunk('reviewed-bad-case:feedback-1', 0.96);
    const prefetchedFastPath = {
      retrieval: {
        chunks: [],
        diagnostics: {},
        profile: {},
      },
      obsidianHits: [],
      badCaseMatches: [
        {
          id: 'feedback-1',
          query: '韦水春是谁',
          text: '正确处理标准：韦水春是临床病理工作人员。',
          score: 0.96,
          mode: 'correction',
        },
      ],
    } as never;
    karpathyRagService.assessFastPath.mockResolvedValue({
      sufficient: true,
      reason: 'Base Case 证据充分',
      chunks: [reviewedChunk],
      obsidianHits: [],
      prefetchedFastPath,
    });
    karpathyRagService.answer.mockResolvedValue({
      answer: '韦水春是临床病理工作人员。',
      references: [reviewedChunk],
      retrievalSufficient: true,
      retrievalReason: 'Base Case 证据充分',
    });

    await expect(service.run('韦水春是谁', 'auto')).resolves.toMatchObject({
      answer: '韦水春是临床病理工作人员。',
      route: 'simple',
      retrievalSufficient: true,
    });
    expect(karpathyRagService.answer.mock.calls[0]).toEqual([
      '韦水春是谁',
      [],
      undefined,
      [],
      expect.any(Function),
      expect.objectContaining({ prefetchedFastPath }),
    ]);
  });

  it('caps retrieval query count and returned chunks', async () => {
    const { service, karpathyRagService } = createService();
    karpathyRagService.retrieve.mockResolvedValue([
      chunk('c1', 0.9),
      chunk('c2', 0.8),
    ]);
    karpathyRagService.retrieveBm25Only.mockResolvedValue([
      chunk('c3', 0.7),
      chunk('c4', 0.6),
    ]);

    const state = {
      query: '请分析差旅制度',
      augmentedQueries: ['扩展 A', '扩展 B', '扩展 C'],
    } as AgenticRagStateType;

    const result = await service.retrievalNode(state, {
      configurable: { userId: 'user-1' },
    });

    expect(karpathyRagService.retrieve.mock.calls).toHaveLength(1);
    expect(
      karpathyRagService.retrieve.mock.calls[0]?.[1]?.executionPlan?.queries?.map(
        (item: { text: string }) => item.text,
      ) ?? [],
    ).toEqual(['请分析差旅制度']);
    expect(karpathyRagService.retrieveBm25Only.mock.calls).toHaveLength(0);
    expect(result.retrievedChunks?.map((item) => item.id)).toEqual([
      'c1',
      'c2',
    ]);
    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'evidence_bundle',
          producer: 'retrieval',
        }),
      ]),
    );
  });

  it('merges planned correction and Obsidian evidence into explicit agentic retrieval', async () => {
    const { service, karpathyRagService } = createService();
    const reviewed = chunk('reviewed', 0.96);
    const obsidian = chunk('obsidian', 0.82);
    karpathyRagService.retrieve.mockResolvedValue([chunk('formal', 0.9)]);
    karpathyRagService.toReviewedEvidenceChunks.mockReturnValue([reviewed]);
    karpathyRagService.getObsidianContext.mockResolvedValue({
      hits: [
        {
          path: 'notes/rag.md',
          type: 'note',
          title: '人工笔记',
          content: '人工补充内容',
          score: 0.8,
          tags: [],
        },
      ],
      context: 'Obsidian context',
    });
    karpathyRagService.toObsidianChunks.mockReturnValue([obsidian]);

    const result = await service.retrievalNode(
      {
        query: '请分析活动方案风险',
        augmentedQueries: [],
        badCaseMatches: [
          {
            id: 'bad-case-1',
            query: '活动方案风险',
            text: '正确处理标准：先核对风险清单。',
            score: 0.96,
            mode: 'correction',
          },
        ],
      } as unknown as AgenticRagStateType,
      { configurable: { userId: 'user-1' } },
    );

    expect(karpathyRagService.getObsidianContext).toHaveBeenCalledWith(
      '请分析活动方案风险',
      'user-1',
      undefined,
    );
    expect(karpathyRagService.toObsidianChunks).toHaveBeenCalledWith([
      expect.objectContaining({ path: 'notes/rag.md', type: 'note' }),
    ]);
    expect(result.retrievedChunks?.map((item) => item.id)).toEqual(
      expect.arrayContaining(['reviewed', 'formal']),
    );
  });

  it('uses source-note hits to retrieve original chunks without keeping their summaries as evidence', async () => {
    const { service, karpathyRagService } = createService();
    const sourceHit: ObsidianSearchHit = {
      path: 'notes/source.md',
      type: 'note',
      isSourceNote: true,
      ragDocId: 'source-doc',
      title: '来源摘要',
      content: '摘要里有结论，但原文才是证据。',
      score: 0.9,
      tags: [],
    };
    const legacySourceHit: ObsidianSearchHit = {
      path: 'notes/legacy-source.md',
      type: 'note',
      isSourceNote: true,
      title: '旧来源摘要',
      content: '旧摘要没有 rag_doc_id，也不能作为证据。',
      score: 0.8,
      tags: [],
    };
    const manualHit: ObsidianSearchHit = {
      path: 'notes/manual.md',
      type: 'note',
      title: '人工补充',
      content: '人工维护的补充内容。',
      score: 0.7,
      tags: [],
    };
    const raw = {
      ...chunk('source-raw', 0.9),
      docId: 'source-doc',
      content: '原文：发布前必须由业务负责人复核。',
    };
    karpathyRagService.retrieve.mockResolvedValue([]);
    karpathyRagService.retrieveBm25Only.mockResolvedValue([]);
    karpathyRagService.getObsidianContext.mockResolvedValue({
      hits: [sourceHit, legacySourceHit, manualHit],
      context: 'source and manual notes',
    });
    karpathyRagService.resolveObsidianSourceEvidence.mockResolvedValue({
      chunks: [raw],
      mappedDocIds: new Set(['source-doc']),
      sourceNotePaths: new Set(['notes/source.md', 'notes/legacy-source.md']),
    });
    karpathyRagService.toObsidianChunks.mockImplementation((hits) =>
      hits.map((hit) => chunk(`obsidian:${hit.path}`, 0.3)),
    );

    const result = await service.retrievalNode(
      {
        query: '发布前必须由谁复核？',
        augmentedQueries: [],
      } as unknown as AgenticRagStateType,
      { configurable: { userId: 'user-1' } },
    );

    expect(
      karpathyRagService.resolveObsidianSourceEvidence,
    ).toHaveBeenCalledWith(
      '发布前必须由谁复核？',
      [sourceHit, legacySourceHit, manualHit],
      'user-1',
      {},
    );
    expect(karpathyRagService.toObsidianChunks).toHaveBeenCalledWith([
      manualHit,
    ]);
    expect(result.retrievedChunks).toContainEqual(raw);
    expect(result.retrievedChunks?.map((item) => item.id)).not.toContain(
      'obsidian:notes/source.md',
    );
    expect(result.subQuestions?.[0].evidenceIds).toContain('source-raw');
    expect(
      result.artifacts?.find((artifact) => artifact.type === 'evidence_bundle')
        ?.payload,
    ).toMatchObject({ chunkIds: expect.arrayContaining(['source-raw']) });
  });

  it('reuses fast-path evidence when agentic retrieval starts', async () => {
    const { service, karpathyRagService } = createService();
    const retrieve = serviceMock(karpathyRagService, 'retrieve');
    const getObsidianContext = serviceMock(
      karpathyRagService,
      'getObsidianContext',
    );
    const toReviewedEvidenceChunks = serviceMock(
      karpathyRagService,
      'toReviewedEvidenceChunks',
    );
    const toObsidianChunks = serviceMock(
      karpathyRagService,
      'toObsidianChunks',
    );
    karpathyRagService.retrieve.mockResolvedValue([chunk('c2', 0.8)]);
    const prefetchedFastPath = {
      retrieval: { chunks: [], diagnostics: {}, profile: {} },
      obsidianHits: [
        {
          path: 'notes/fast-path.md',
          type: 'note',
          title: '快速路径补充',
          content: '快速路径中的人工补充。',
          score: 0.8,
          tags: [],
        },
      ],
      badCaseMatches: [
        {
          id: 'feedback-1',
          query: '原始问题',
          text: '正确处理标准：复用已有纠正证据。',
          score: 0.95,
          mode: 'correction',
        },
      ],
    } as unknown as PrefetchedFastPath;
    karpathyRagService.toObsidianChunks.mockReturnValue([
      chunk('obsidian:notes/fast-path.md', 0.8),
    ]);

    const result = await service.retrievalNode(
      {
        query: '原始问题',
        augmentedQueries: ['扩展问题'],
        subQuestions: [
          {
            id: 'subq-1',
            question: '原始问题',
            dependsOn: [],
            status: 'planned',
            evidenceIds: [],
            retrievalAttempts: 0,
            sufficient: false,
            reason: '',
          },
          {
            id: 'subq-2',
            question: '扩展问题',
            dependsOn: ['subq-1'],
            status: 'planned',
            evidenceIds: [],
            retrievalAttempts: 0,
            sufficient: false,
            reason: '',
          },
        ],
      } as unknown as AgenticRagStateType,
      {
        configurable: {
          userId: 'user-1',
          fastPathChunks: [chunk('c1', 0.9)],
          prefetchedFastPath,
          subQuestionLimit: 2,
        },
      },
    );

    expect(retrieve).not.toHaveBeenCalled();
    expect(getObsidianContext).not.toHaveBeenCalled();
    expect(toReviewedEvidenceChunks).toHaveBeenCalledWith(
      prefetchedFastPath.badCaseMatches,
    );
    expect(toObsidianChunks).toHaveBeenCalledWith(
      prefetchedFastPath.obsidianHits,
    );
    expect(result.retrievedChunks?.map((item) => item.id)).toEqual(['c1']);
  });

  it('reuses Fast Path Bad Case candidates during query planning', async () => {
    const { service, badCaseFlywheel } = createService();
    const prefetchedFastPath = {
      retrieval: { chunks: [], diagnostics: {}, profile: {} },
      obsidianHits: [],
      badCaseMatches: [
        {
          id: 'feedback-1',
          query: '原始问题',
          text: '正确处理标准：复用已有纠正证据。',
          score: 0.95,
          mode: 'correction',
        },
      ],
    } as unknown as PrefetchedFastPath;

    const result = await service.prepareQueriesNode(
      {
        query: '原始问题',
        augmentedQueries: ['原始问题'],
        subQuestions: [],
      } as unknown as AgenticRagStateType,
      {
        configurable: {
          userId: 'user-1',
          prefetchedFastPath,
          subQuestionLimit: 1,
        },
      },
    );

    expect(badCaseFlywheel.retrieveMatches).not.toHaveBeenCalled();
    expect(
      (result as unknown as { badCaseMatches?: unknown[] }).badCaseMatches,
    ).toBe(prefetchedFastPath.badCaseMatches);
  });

  it('does not reject a sufficient original evidence bundle after planning one subquestion', async () => {
    const { service, karpathyRagService } = createService();
    const evidence = chunk('c1', 0.9);

    const result = await service.sufficiencyNode(
      {
        query: '资料库当中，帮我总结李逵',
        retrievedChunks: [evidence],
        subQuestions: [
          {
            id: 'subq-1',
            question: '李逵的资料总结',
            dependsOn: [],
            status: 'retrieved',
            evidenceIds: ['c1'],
            retrievalAttempts: 1,
            sufficient: false,
            reason: '',
          },
        ],
      } as unknown as AgenticRagStateType,
      {
        configurable: {
          fastPathBundle: {
            query: '资料库当中，帮我总结李逵',
            chunks: [evidence],
            sourcePolicy: 'local_only',
            assessment: {
              sufficient: true,
              reason: '重排语义相关度通过阈值',
              evaluatedQuery: '资料库当中，帮我总结李逵',
            },
          },
        },
      },
    );

    expect(result).toMatchObject({ retrievalSufficient: true });
  });

  it('blocks reflection when the answer contract is invalid', async () => {
    const { service, getModelMock } = createService();
    const result = await service.reflectionNode({
      query: '原始问题',
      answer: '没有可验证引用的答案',
      retrievedChunks: [chunk('c1', 0.9)],
      retrievalSufficient: true,
      retryCount: 0,
      artifacts: [
        {
          id: 'answer_contract:test',
          type: 'answer_contract',
          version: 1,
          producer: 'generate',
          createdAt: new Date().toISOString(),
          payload: {
            answer: '没有可验证引用的答案',
            citationSupported: false,
            subQuestionCoverage: 0,
            valid: false,
            reason: '答案缺少显式片段引用',
          },
        },
      ],
    } as unknown as AgenticRagStateType);

    expect(result).toMatchObject({
      confidence: 0,
      passed: false,
      retryCount: 1,
    });
    expect(result.reflectionFeedback).toContain('答案契约校验未通过');
    expect(getModelMock).not.toHaveBeenCalled();
  });

  function chunk(id: string, totalScore: number) {
    return {
      id,
      docId: `doc-${id}`,
      chunkIndex: 1,
      content: `content ${id}`,
      bm25Score: totalScore,
      cosineScore: 0,
      totalScore,
      score: totalScore,
    };
  }
});

function serviceMock<K extends keyof KarpathyRagService>(
  service: jest.Mocked<KarpathyRagService>,
  method: K,
): jest.Mock {
  return service[method] as unknown as jest.Mock;
}
