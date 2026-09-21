import { ChatService } from './chat.service';

describe('ChatService', () => {
  it('只分类一次，并让显式 Simple 保持在 Karpathy 线性引擎内', async () => {
    const classify = jest.fn().mockResolvedValue({
      intent: 'objective_fact',
      confidence: 0.99,
      standaloneQuery: '1+1 等于多少？',
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
      reason: '稳定公共知识',
      ambiguity: { detected: false, confidence: 1, senses: [] },
    });
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
    const run = jest.fn();
    const conversationService = {
      create: jest.fn().mockResolvedValue('thread-1'),
      getRecentHistory: jest.fn().mockResolvedValue([]),
      addMessage: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ChatService(
      { answer, unsupportedReliableAnswer: () => '证据不足' } as never,
      { run } as never,
      conversationService as never,
      {
        searchHistory: jest.fn().mockResolvedValue([]),
        indexConversation: jest.fn(),
      } as never,
      {
        searchMemory: jest.fn().mockResolvedValue({ systemMessage: null }),
        classifyAndPersist: jest.fn(),
      } as never,
      {
        getContext: jest.fn().mockResolvedValue({
          systemMessage: {
            content: '【历史摘要】小明先是一只狗，后来又是一只猫，最后是一条鱼',
          },
          recentTurns: [
            { role: 'user', content: '小明是一只狗' },
            { role: 'user', content: '小明是一只猫' },
            { role: 'user', content: '小明是一条鱼' },
          ],
          truncatedHistory: false,
        }),
        addTurn: jest.fn(),
      } as never,
      {
        estimateTextTokens: () => 1,
        estimateCostUsd: () => 0,
        traceRagAnswer: jest.fn(),
      } as never,
      {
        create: jest.fn((value) => value),
        save: jest.fn().mockResolvedValue(undefined),
      } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { classify } as never,
    );

    const events: Array<{ type: string }> = [];
    await service.chat(
      { query: '1+1 等于多少？', mode: 'simple' },
      'user-1',
      (event) => events.push(event),
    );

    expect(conversationService.create).toHaveBeenCalledWith(
      '1+1 等于多少？',
      'simple',
      'user-1',
    );
    expect(classify).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    expect(answer).toHaveBeenCalledWith(
      '1+1 等于多少？',
      expect.any(Array),
      'user-1',
      expect.any(Array),
      expect.any(Function),
      expect.objectContaining({
        sourcePolicy: 'direct_answer',
        queryIntent: expect.objectContaining({ requiresGraph: false }),
      }),
    );
    const memoryMessages = answer.mock.calls[0][3] as Array<{
      content: string;
    }>;
    expect(memoryMessages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining('小明是一只狗'),
        }),
      ]),
    );
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['citation', 'token', 'final']),
    );
    expect(events.findIndex((event) => event.type === 'citation')).toBeLessThan(
      events.findIndex((event) => event.type === 'token'),
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
      getRecentHistory: jest.fn().mockResolvedValue([
        { role: 'human', content: 'PostgreSQL 的旧问题' },
        { role: 'ai', content: 'PostgreSQL 的旧回答' },
      ]),
      addMessage: jest.fn().mockResolvedValue(undefined),
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
    };
    const queryLogRepo = {
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ChatService(
      {
        answer,
        unsupportedReliableAnswer: () => '证据不足',
      } as never,
      {} as never,
      conversationService as never,
      {
        searchHistory: jest.fn().mockResolvedValue([]),
        indexConversation: jest.fn(),
      } as never,
      {
        searchMemory: jest.fn().mockResolvedValue({ systemMessage: null }),
        classifyAndPersist: jest.fn(),
      } as never,
      shortTermMemory as never,
      {
        estimateTextTokens: () => 1,
        estimateCostUsd: () => 0,
        traceRagAnswer: jest.fn(),
      } as never,
      queryLogRepo as never,
    );

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
    const queryLogRepo = {
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };
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
    const service = new ChatService(
      { unsupportedReliableAnswer: () => '证据不足' } as never,
      { run: agenticRun } as never,
      {
        getRecentHistory: jest.fn().mockResolvedValue([]),
        addMessage,
      } as never,
      {
        searchHistory: jest.fn().mockResolvedValue([]),
        indexConversation: jest.fn(),
      } as never,
      {
        searchMemory: jest.fn().mockResolvedValue({ systemMessage: null }),
      } as never,
      {
        getContext: jest.fn().mockResolvedValue({
          systemMessage: null,
          recentTurns: [],
          truncatedHistory: false,
        }),
        addTurn: jest.fn().mockResolvedValue(undefined),
      } as never,
      {
        estimateTextTokens: () => 1,
        estimateCostUsd: () => 0,
        traceRagAnswer: jest.fn(),
      } as never,
      queryLogRepo as never,
      undefined,
      agentRuns as never,
      agentGoals as never,
    );
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
    );
    expect(addMessage).toHaveBeenCalledTimes(1);
    expect(addMessage).toHaveBeenCalledWith(
      'thread-1',
      'human',
      '请生成待审批方案',
      'user-1',
      expect.objectContaining({ pendingApproval: true, runId: 'run-1' }),
    );
    expect(queryLogRepo.save).not.toHaveBeenCalled();
    expect(agentRuns.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'waiting_approval' }),
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
    const queryLogRepo = {
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };
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
    const service = new ChatService(
      { unsupportedReliableAnswer: () => '证据不足' } as never,
      { resumeGraph } as never,
      {
        get: jest.fn().mockResolvedValue({
          messages: [
            {
              role: 'human',
              content: '请生成方案',
              metadata: {
                pendingApproval: true,
                runId: 'run-1',
                mode: 'agentic',
                queryIntent: {
                  contextMode: 'none',
                  sourcePolicy: 'local_only',
                  action: 'retrieve',
                  entities: [],
                },
              },
            },
          ],
        }),
        addMessage,
      } as never,
      {
        indexConversation: jest.fn(),
      } as never,
      {
        classifyAndPersist: jest.fn(),
      } as never,
      {
        addTurn: jest.fn().mockResolvedValue(undefined),
      } as never,
      {
        estimateTextTokens: () => 1,
        estimateCostUsd: () => 0,
        traceRagAnswer: jest.fn(),
      } as never,
      queryLogRepo as never,
      undefined,
      agentRuns as never,
      agentGoals as never,
    );

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
    expect(addMessage).toHaveBeenCalledTimes(1);
    expect(addMessage).toHaveBeenCalledWith(
      'thread-1',
      'ai',
      '已批准的正式答案',
      'user-1',
      expect.any(Object),
    );
    expect(queryLogRepo.save).toHaveBeenCalledTimes(1);
    expect(agentRuns.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'completed' }),
    );
    expect(response.answer).toBe('已批准的正式答案');
    expect(response.executionState).toMatchObject({
      phase: 'completed',
      paused: false,
    });
  });
});
