import { ChatService } from './chat.service';

const basePlan = {
  action: 'retrieve',
  domain: 'internal',
  contextMode: 'independent',
  standaloneQuery: '',
  subQueries: [],
  taskType: 'lookup',
  needsGraph: false,
  entities: [],
  filters: {},
} as const;

const baseExecutionPlan = {
  planVersion: 2,
  sourcePolicy: 'local_only',
  queries: [{ text: '', kind: 'original', weight: 1 }],
  profile: {
    intent: 'lookup',
    candidateDepth: 8,
    finalTopK: 4,
    neighborWindow: 0,
    sameSectionLimit: 0,
    contextCharacterBudget: 3500,
    maxChunksPerDocument: 2,
  },
  useGraph: false,
  reasonCode: 'internal_evidence_required',
} as const;

type Deps = Record<string, unknown>;

function createService(overrides: Deps = {}) {
  const deps: Deps = {
    karpathy: {
      answer: jest.fn().mockResolvedValue({
        answer: '回答',
        references: [],
        retrievalSufficient: true,
      }),
      unsupportedReliableAnswer: () => '证据不足',
    },
    agentic: {
      run: jest.fn().mockResolvedValue({
        answer: '回答',
        references: [],
        route: 'agentic',
        confidence: 1,
        retryCount: 0,
        retrievalSufficient: true,
      }),
    },
    conversation: {
      create: jest.fn().mockResolvedValue('thread-1'),
      get: jest.fn().mockResolvedValue({ messages: [] }),
      getRecentHistory: jest.fn().mockResolvedValue([]),
      addMessage: jest.fn().mockResolvedValue(undefined),
      addCompletedTurn: jest.fn().mockResolvedValue({ userMessageId: 'user-message-1', assistantMessageId: 'assistant-message-1' }),
    },
    embedding: {
      searchHistory: jest.fn().mockResolvedValue([]),
      indexConversation: jest.fn(),
    },
    memory: {
      searchMemory: jest.fn().mockResolvedValue({
        userMemories: [],
        sessionMemories: [],
        systemMessage: null,
      }),
      classifyAndPersist: jest.fn().mockResolvedValue(undefined),
    },
    shortTerm: {
      getContext: jest.fn().mockResolvedValue({
        systemMessage: null,
        recentTurns: [],
        truncatedHistory: false,
      }),
      addTurn: jest.fn().mockResolvedValue(undefined),
      addTurns: jest.fn().mockResolvedValue(null),
      getAvailableHistoryTokenBudget: jest.fn().mockReturnValue(8_000),
      limitHistoryToTokenBudget: jest.fn((turns) => turns),
    },
    langfuse: {
      estimateTextTokens: () => 1,
      estimateCostUsd: () => 0,
      traceRagAnswer: jest.fn(),
    },
    queryLog: {
      logQuery: jest.fn().mockResolvedValue(undefined),
    },
    planner: {
      plan: jest.fn().mockResolvedValue(basePlan),
    },
    policy: {
      build: jest.fn().mockReturnValue({
        ...baseExecutionPlan,
        queries: [{ text: '', kind: 'original', weight: 1 }],
      }),
    },
  };
  Object.assign(deps, overrides);
  return new ChatService(
    deps.karpathy as never,
    deps.agentic as never,
    deps.conversation as never,
    deps.embedding as never,
    deps.memory as never,
    deps.shortTerm as never,
    deps.langfuse as never,
    deps.queryLog as never,
    deps.planner as never,
    deps.policy as never,
    undefined,
    deps.agentRuns as never,
    deps.agentGoals as never,
    deps.config as never,
    undefined,
    undefined,
    deps.metrics as never,
    undefined,
    undefined,
    undefined,
  );
}

describe('ChatService', () => {
  it('marks tenant requests restricted so auxiliary evidence sources fail closed', async () => {
    type AnswerOptions = {
      tenantId?: string;
      executionPlan?: { sourcePolicy: string; scopeRestricted: boolean };
    };
    const receivedOptions: AnswerOptions[] = [];
    const answer = jest.fn(
      (
        _query: string,
        _history: unknown[],
        _userId: string,
        _memory: unknown[],
        _onToken: unknown,
        options: AnswerOptions,
      ) => {
        receivedOptions.push(options);
        return Promise.resolve({
          answer: '回答',
          references: [],
          retrievalSufficient: true,
        });
      },
    );
    const build = jest.fn(
      (
        _query: string,
        _plan: unknown,
        _scope: unknown,
        _profile: unknown,
        options: { forceLocal?: boolean },
      ) => ({
        ...baseExecutionPlan,
        sourcePolicy: options.forceLocal ? 'local_only' : 'web_allowed',
        scopeRestricted: Boolean(options.forceLocal),
      }),
    );
    const service = createService({
      karpathy: { answer, unsupportedReliableAnswer: () => '证据不足' },
      policy: { build },
    });

    await service.chat(
      { query: '项目发布规则是什么？', mode: 'simple' },
      'user-1',
      undefined,
      { tenantId: 'tenant-a' },
    );

    expect(build).toHaveBeenCalledWith(
      '项目发布规则是什么？',
      expect.any(Object),
      expect.any(Object),
      undefined,
      expect.objectContaining({ forceLocal: true }),
    );
    expect(answer).toHaveBeenCalledTimes(1);
    expect(receivedOptions[0]).toMatchObject({
      tenantId: 'tenant-a',
      executionPlan: {
        sourcePolicy: 'local_only',
        scopeRestricted: true,
      },
    });
  });

  it('只规划一次，并让显式 Simple 保持在 Karpathy 线性引擎内', async () => {
    const answer = jest
      .fn()
      .mockImplementation(
        (
          _query: string,
          _history: unknown,
          _userId: string,
          _memory: unknown,
          onToken?: (token: string) => void,
        ) => {
          onToken?.('2');
          return Promise.resolve({
            answer: '2',
            references: [],
            route: 'simple',
            confidence: 1,
            retryCount: 0,
            retrievalSufficient: true,
            retrievalReason: '公共知识直接回答',
          });
        },
      );
    const service = createService({
      karpathy: { answer, unsupportedReliableAnswer: () => '证据不足' },
      agentic: { run: jest.fn() },
      planner: {
        plan: jest.fn().mockResolvedValue({
          ...basePlan,
          action: 'direct',
          domain: 'public',
          contextMode: 'independent',
        }),
      },
      policy: {
        build: jest.fn().mockReturnValue({
          ...baseExecutionPlan,
          sourcePolicy: 'direct_answer',
          queries: [{ text: '1+1 等于多少？', kind: 'original', weight: 1 }],
        }),
      },
    });
    const planner = (
      service as unknown as { queryPlanner: { plan: jest.Mock } }
    ).queryPlanner;

    const events: Array<{ type: string }> = [];
    await service.chat(
      { query: '1+1 等于多少？', mode: 'simple' },
      'user-1',
      (event) => events.push(event),
    );

    expect(planner.plan).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledWith(
      '1+1 等于多少？',
      expect.any(Array),
      'user-1',
      expect.any(Array),
      expect.any(Function),
      expect.objectContaining({
        sourcePolicy: 'direct_answer',
        executionPlan: expect.objectContaining({
          queries: expect.any(Array),
        }),
      }),
    );
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['citation', 'token', 'final']),
    );
    expect(events.findIndex((event) => event.type === 'token')).toBeLessThan(
      events.findIndex((event) => event.type === 'citation'),
    );
  });

  it('优先使用 Redis 短期记忆窗口，避免重复注入 PostgreSQL 最近会话', async () => {
    const answer = jest.fn().mockResolvedValue({
      answer: '回答',
      references: [],
      retrievalSufficient: true,
      retrievalReason: '证据充分',
    });
    const conversationService = {
      assertAccessible: jest.fn().mockResolvedValue(true),
      getRecentHistory: jest.fn().mockResolvedValue([
        { role: 'human', content: 'PostgreSQL 的旧问题' },
        { role: 'ai', content: 'PostgreSQL 的旧回答' },
      ]),
      addMessage: jest.fn().mockResolvedValue(undefined),
      addCompletedTurn: jest.fn().mockResolvedValue({ userMessageId: 'user-message-1', assistantMessageId: 'assistant-message-1' }),
    };
    const shortTermMemory = {
      getContext: jest.fn().mockResolvedValue({
        systemMessage: { content: '【历史摘要】早期决策' },
        recentTurns: [
          { role: 'user', content: 'Redis 的最近问题' },
          { role: 'assistant', content: 'Redis 的最近回答' },
        ],
        truncatedHistory: true,
      }),
      addTurn: jest.fn().mockResolvedValue(null),
      addTurns: jest.fn().mockResolvedValue(null),
      getAvailableHistoryTokenBudget: jest.fn().mockReturnValue(8_000),
      limitHistoryToTokenBudget: jest.fn((turns) => turns),
    };
    const service = createService({
      karpathy: { answer, unsupportedReliableAnswer: () => '证据不足' },
      conversation: conversationService,
      shortTerm: shortTermMemory,
      planner: {
        plan: jest.fn().mockResolvedValue({
          ...basePlan,
          contextMode: 'follow_up',
          standaloneQuery: '继续处理活动方案',
        }),
      },
    });

    await service.chat(
      {
        query: '继续处理刚才的活动方案',
        mode: 'simple',
        threadId: 'thread-1',
      },
      'user-1',
    );

    expect(conversationService.getRecentHistory).not.toHaveBeenCalled();
    expect(answer).toHaveBeenCalledWith(
      '继续处理刚才的活动方案',
      [
        { role: 'human', content: 'Redis 的最近问题' },
        { role: 'ai', content: 'Redis 的最近回答' },
      ],
      'user-1',
      expect.arrayContaining([
        expect.objectContaining({ content: '【历史摘要】早期决策' }),
      ]),
      undefined,
      expect.any(Object),
    );
  });

  it('审批暂停只保存待恢复请求，不把草稿当作正式答案收口', async () => {
    const agenticRun = jest.fn().mockResolvedValue({
      answer: '待审批草稿',
      references: [],
      route: 'agentic',
      confidence: 0.8,
      retryCount: 0,
      retrievalSufficient: true,
      interrupted: true,
      executionState: {
        consumedSteps: 4,
        consumedToolCalls: 1,
        remainingSteps: 14,
        remainingToolCalls: 23,
        checkpointId: 'checkpoint-1',
        paused: true,
        lastNode: 'humanApprovalNode',
      },
    });
    const addMessage = jest.fn().mockResolvedValue(undefined);
    const addCompletedTurn = jest.fn().mockResolvedValue({ userMessageId: 'user-message-1', assistantMessageId: 'assistant-message-1' });
    const agentRuns = {
      start: jest.fn().mockResolvedValue({
        id: 'run-1',
        maxSteps: 18,
        maxToolCalls: 24,
      }),
      recordRuntimeEvent: jest.fn().mockResolvedValue(undefined),
      finish: jest.fn().mockResolvedValue(undefined),
    };
    const agentGoals = {
      activate: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const service = createService({
      agentic: { run: agenticRun },
      conversation: {
        assertAccessible: jest.fn().mockResolvedValue(true),
        getRecentHistory: jest.fn().mockResolvedValue([]),
        addMessage,
      },
      agentRuns,
      agentGoals,
    });
    const events: Array<{ type: string }> = [];

    const response = await service.chat(
      {
        query: '请生成待审批方案',
        mode: 'agentic',
        threadId: 'thread-1',
        approvalRequired: true,
      },
      'user-1',
      (event) => events.push(event),
    );

    expect(agenticRun).toHaveBeenCalledWith(
      expect.any(String),
      'agentic',
      expect.any(Function),
      expect.any(Array),
      'thread-1',
      'user-1',
      expect.any(Array),
      true,
      expect.any(Object),
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(addMessage).toHaveBeenCalledTimes(1);
    expect(addMessage).toHaveBeenCalledWith(
      'thread-1',
      'human',
      '请生成待审批方案',
      'user-1',
      expect.objectContaining({ pendingApproval: true, runId: 'run-1' }),
    );
    expect(events.map((event) => event.type)).not.toContain('final');
    expect(response.executionState).toMatchObject({
      phase: 'approval',
      paused: true,
      checkpointId: 'checkpoint-1',
    });
  });

  it('审批通过后复用原请求完成收口，且不重复写入用户消息', async () => {
    const addMessage = jest.fn().mockResolvedValue(undefined);
    const addCompletedTurn = jest.fn().mockResolvedValue({ userMessageId: 'user-message-1', assistantMessageId: 'assistant-message-1' });
    const agentRuns = {
      get: jest.fn().mockResolvedValue({
        id: 'run-1',
        userId: 'user-1',
        status: 'waiting_approval',
        maxSteps: 18,
      }),
      recordRuntimeEvent: jest.fn().mockResolvedValue(undefined),
      finish: jest.fn().mockResolvedValue(undefined),
      recordAction: jest.fn().mockResolvedValue(undefined),
    };
    const agentGoals = { update: jest.fn().mockResolvedValue(undefined) };
    const resumeGraph = jest.fn().mockResolvedValue({
      answer: '已批准的正式答案',
      references: [],
      confidence: 0.9,
      retryCount: 1,
      approved: true,
      executionState: {
        consumedSteps: 6,
        consumedToolCalls: 1,
        remainingSteps: 12,
        remainingToolCalls: 23,
        checkpointId: 'checkpoint-1',
        paused: false,
        lastNode: 'reflection',
      },
    });
    const service = createService({
      karpathy: { unsupportedReliableAnswer: () => '证据不足' },
      agentic: { resumeGraph },
      conversation: {
        get: jest.fn().mockResolvedValue({
          messages: [
            {
              role: 'human',
              content: '请生成方案',
              metadata: {
                pendingApproval: true,
                runId: 'run-1',
                mode: 'agentic',
                planVersion: 2,
                queryPlan: {
                  ...basePlan,
                  action: 'retrieve',
                  domain: 'internal',
                  contextMode: 'independent',
                },
              },
            },
          ],
        }),
        addMessage,
        addCompletedTurn,
      },
      agentRuns,
      agentGoals,
    });

    const response = await service.resume(
      'thread-1',
      'approved',
      undefined,
      'user-1',
    );

    expect(resumeGraph).toHaveBeenCalledWith(
      'thread-1',
      'approved',
      undefined,
      expect.any(Function),
    );
    expect(addCompletedTurn).toHaveBeenCalledTimes(1);
    expect(addCompletedTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        answer: '已批准的正式答案',
        userId: 'user-1',
      }),
    );
    expect(response.answer).toBe('已批准的正式答案');
    expect(response.executionState).toMatchObject({
      phase: 'completed',
      paused: false,
    });
  });
});
