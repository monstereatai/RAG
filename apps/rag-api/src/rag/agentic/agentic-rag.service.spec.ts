import type { RagService } from '../rag.service';
import type { RetrieveOptions } from '../contracts/rag-types';
import { createFallbackQueryPlan } from '../planning/query-plan';
import { chunk, createService } from './agentic-rag.service.test-utils';
import type { AgenticRagServiceInternals } from './agentic-rag.service.test-utils';

describe('AgenticRagService budget boundaries', () => {
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

  it('delegates ranking, sufficiency, and evidence-first answers to Evidence Policy', () => {
    const { service, evidencePolicy } = createService();
    const chunks = [
      {
        id: 'evidence-1',
        content: '证据',
        docId: 'doc-1',
        chunkIndex: 0,
        bm25Score: 0.4,
        cosineScore: 0.4,
        totalScore: 0.4,
      },
    ];

    const internals = service as unknown as AgenticRagServiceInternals;
    const evidenceMocks = evidencePolicy as unknown as {
      rankEvidenceChunks: jest.Mock;
      assessRetrievedChunks: jest.Mock;
      buildEvidenceFirstAnswer: jest.Mock;
    };
    internals.rankEvidenceChunks(chunks);
    internals.assessRetrievedChunks('问题', chunks, 'lookup');
    internals.buildEvidenceFirstAnswer('问题', chunks);

    expect(evidenceMocks.rankEvidenceChunks).toHaveBeenCalledWith(chunks);
    expect(evidenceMocks.assessRetrievedChunks).toHaveBeenCalledWith(
      '问题',
      chunks,
      'lookup',
    );
    expect(evidenceMocks.buildEvidenceFirstAnswer).toHaveBeenCalledWith(
      '问题',
      chunks,
    );
  });

  it('passes request cancellation into evidence synthesis fallback', async () => {
    const { service, llmProvider } = createService();
    const invoke = jest.fn().mockResolvedValue('结论[片段1]');
    (llmProvider as any).invoke = invoke;
    (llmProvider as any).getActiveProviderName = jest
      .fn()
      .mockReturnValue('qwen');
    const controller = new AbortController();

    const internals = service as unknown as AgenticRagServiceInternals;
    await expect(
      internals.answerGenerationService.synthesizeEvidenceAnswer(
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
    const { service, ragService } = createService();
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

    expect(ragService.assessFastPath).not.toHaveBeenCalled();
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
    const { service, ragService, llmProvider } = createService();
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
    }) as unknown as jest.MockedFunction<RagService['assessFastPath']>;
    const answer = jest.fn().mockResolvedValue({
      answer: '附件资料给出的结果。',
      references: [attachment],
      retrievalSufficient: true,
    }) as unknown as jest.MockedFunction<RagService['answer']>;
    ragService.assessFastPath = assessFastPath;
    ragService.answer = answer;
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
});
