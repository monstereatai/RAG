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
    const answer = jest.fn().mockResolvedValue({
      answer: '2',
      references: [],
      route: 'simple',
      confidence: 1,
      retryCount: 0,
      retrievalSufficient: true,
      retrievalReason: '公共知识直接回答',
    });
    const run = jest.fn();
    const conversationService = {
      getRecentHistory: jest.fn().mockResolvedValue([]),
      addMessage: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ChatService(
      { answer, unsupportedReliableAnswer: () => '证据不足' } as never,
      { run } as never,
      conversationService as never,
      { searchHistory: jest.fn().mockResolvedValue([]), indexConversation: jest.fn() } as never,
      { searchMemory: jest.fn().mockResolvedValue({ systemMessage: null }), classifyAndPersist: jest.fn() } as never,
      { getContext: jest.fn().mockResolvedValue({ recentTurns: [], truncatedHistory: false }), addTurn: jest.fn() } as never,
      { estimateTextTokens: () => 1, estimateCostUsd: () => 0, traceRagAnswer: jest.fn() } as never,
      { create: jest.fn((value) => value), save: jest.fn().mockResolvedValue(undefined) } as never,
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

    await service.chat(
      { query: '1+1 等于多少？', mode: 'simple', threadId: 'thread-1' },
      'user-1',
    );

    expect(classify).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    expect(answer).toHaveBeenCalledWith(
      '1+1 等于多少？',
      expect.any(Array),
      'user-1',
      expect.any(Array),
      undefined,
      expect.objectContaining({
        sourcePolicy: 'direct_answer',
        queryIntent: expect.objectContaining({ requiresGraph: false }),
      }),
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
});
