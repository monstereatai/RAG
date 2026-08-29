import { ChatService } from './chat.service';

describe('ChatService', () => {
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
