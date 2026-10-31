import type { RetrieveOptions } from '../contracts/rag-types';
import { createFallbackQueryPlan } from '../planning/query-plan';
import type { AgenticRagStateType } from './agentic-rag.state';
import {
  chunk,
  createService,
  serviceMock,
} from './agentic-rag.service.test-utils';

describe('AgenticRagService budget boundaries', () => {
  it('keeps a public QueryPlan on retrieval when a stale execution plan says direct-answer', async () => {
    const { service, ragService, llmProvider } = createService();
    const prefetchedFastPath = {
      retrieval: { chunks: [], diagnostics: {}, profile: {} },
      obsidianHits: [],
    } as never;
    ragService.assessFastPath.mockResolvedValue({
      sufficient: true,
      reason: '已有本地证据',
      chunks: [],
      obsidianHits: [],
      prefetchedFastPath,
    });
    ragService.answer.mockResolvedValue({
      answer: '通过本地证据回答。',
      references: [],
      retrievalSufficient: true,
    });
    const invoke = jest.fn();
    (llmProvider as unknown as { invoke: jest.Mock }).invoke = invoke;
    const assessFastPath = serviceMock(ragService, 'assessFastPath');
    const answer = serviceMock(ragService, 'answer');
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
    const { service, ragService } = createService();
    const retrieve = jest
      .fn()
      .mockResolvedValue([
        chunk('candidate-original', 0.9),
        chunk('candidate-subquery', 0.8),
      ]);
    ragService.retrieve = retrieve;
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

    expect(result.humanApproval).toBe('pending');
    expect(result.executionState?.paused).toBe(true);
    expect(result.executionState?.lastNode).toBe('approvalPending');
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
    const { service, ragService } = createService();
    const retrieve = serviceMock(ragService, 'retrieve');
    retrieve.mockResolvedValue([]);
    (ragService.retrieveBm25Only as jest.Mock).mockResolvedValue([]);
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
              runtimeRunId: 'run-legacy',
              retrieveOptions: {
                queryIntent: legacyQueryIntent,
                runtimeRunId: 'run-legacy',
              },
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
});
