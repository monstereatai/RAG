import { IsNull } from 'typeorm';
import { ShortTermMemoryService } from './short-term-memory.service';
import type { ContextMessageCandidate } from '../../rag/contracts/context-budget';

describe('ShortTermMemoryService structured compression', () => {
  it('按模型可用上下文和检索预算动态计算历史预算', () => {
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string | number> = {
          'llm.provider': 'qwen',
          'llm.contextWindowTokens': 16_000,
          'llm.qwen.maxTokens': 4_096,
        };
        return values[key];
      }),
    };
    const service = new ShortTermMemoryService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      config as never,
    );

    const lookupBudget = service.getAvailableHistoryTokenBudget(
      '查一下规则',
      4_000,
    );
    const synthesisBudget = service.getAvailableHistoryTokenBudget(
      '综合这些资料',
      10_000,
    );

    expect(lookupBudget).toBeGreaterThan(synthesisBudget);
    expect(synthesisBudget).toBeGreaterThan(0);
  });

  it('按来源优先级裁剪 system context，并保留完整的安全策略', () => {
    const service = new ShortTermMemoryService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const candidates: ContextMessageCandidate[] = [
      {
        source: 'context_policy',
        role: 'system',
        content: '安全规则',
        priority: Number.MAX_SAFE_INTEGER,
        required: true,
      },
      {
        source: 'role_preset',
        role: 'system',
        content: '岗位规则',
        priority: Number.MAX_SAFE_INTEGER,
        required: true,
      },
      {
        source: 'session_memory',
        role: 'system',
        content: '会话记忆',
        priority: 80,
      },
      {
        source: 'short_term_summary',
        role: 'system',
        content: '历史摘要',
        priority: 60,
      },
      {
        source: 'user_memory',
        role: 'system',
        content: '用户偏好',
        priority: 40,
      },
      {
        source: 'history_search',
        role: 'system',
        content: '历史线索',
        priority: 20,
      },
    ];

    const result = service.budgetSystemContext(candidates, 24);
    const overflow = service.budgetSystemContext(candidates.slice(0, 2), 1);

    expect(result.messages.map(({ source }) => source)).toEqual([
      'context_policy',
      'role_preset',
      'session_memory',
    ]);
    expect(result.droppedSources).toEqual([
      'short_term_summary',
      'user_memory',
      'history_search',
    ]);
    expect(overflow.messages.map(({ content }) => content)).toEqual([
      '安全规则',
      '岗位规则',
    ]);
    expect(overflow.overflowTokens).toBeGreaterThan(0);
  });

  it('长会话按预算保留最近的完整问答轮次', () => {
    const service = new ShortTermMemoryService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const turns = Array.from({ length: 20 }, (_, index) => [
      { role: 'human', content: `用户问题${index}` },
      { role: 'assistant', content: `助手回答${index}` },
    ]).flat();

    const limited = service.limitHistoryToTokenBudget(turns, 32);

    expect(limited).toEqual(turns.slice(-4));
  });

  it('stores a user/assistant pair before making one compression decision', async () => {
    const stored: string[] = [];
    const redis = {
      isEnabled: () => true,
      zrange: jest.fn().mockImplementation((key: string) =>
        Promise.resolve(key.endsWith(':turns') ? [...stored] : []),
      ),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      setRequiredOrThrow: jest.fn().mockResolvedValue(undefined),
      zremRequired: jest.fn().mockResolvedValue(0),
      zremrangebyrank: jest.fn().mockResolvedValue(undefined),
      zadd: jest.fn().mockImplementation((key: string, _score, member) => {
        if (key.endsWith(':turns')) stored.push(member);
        return Promise.resolve();
      }),
      expire: jest.fn().mockResolvedValue(undefined),
      setIfAbsent: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
      renewLock: jest.fn().mockResolvedValue(true),
    };
    const llm = { invoke: jest.fn().mockRejectedValue(new Error('model down')) };
    const service = new ShortTermMemoryService(
      redis as never,
      llm as never,
      { findOne: jest.fn(), update: jest.fn() } as never,
      { find: jest.fn() } as never,
    );

    await service.addTurns(
      'thread-pair',
      [
        { role: 'user', content: '问题内容' },
        { role: 'assistant', content: '回答内容' },
      ],
      1,
    );

    expect(stored).toHaveLength(2);
    expect(redis.zrange).toHaveBeenCalledTimes(2);
    expect(llm.invoke).toHaveBeenCalledTimes(1);
  });

  it('单独写入待审批问题时不触发压缩', async () => {
    const redis = {
      isEnabled: () => true,
      zadd: jest.fn().mockResolvedValue(undefined),
      expire: jest.fn().mockResolvedValue(undefined),
      zrange: jest.fn(),
      setIfAbsent: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };
    const llm = { invoke: jest.fn() };
    const service = new ShortTermMemoryService(
      redis as never,
      llm as never,
      {} as never,
      {} as never,
    );

    await service.addTurn('thread-pending', 'user', '超长问题'.repeat(20_000));

    expect(redis.zrange).not.toHaveBeenCalled();
    expect(llm.invoke).not.toHaveBeenCalled();
  });

  it('stores versioned role/module deltas and keeps recent raw turns', async () => {
    const turns = Array.from({ length: 10 }, (_, index) =>
      JSON.stringify({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `第${index}轮：${'活动规则调整'.repeat(80)}`,
        ts: index,
      }),
    );
    let storedSummary = '';
    const redis = {
      isEnabled: () => true,
      zrange: jest.fn().mockResolvedValue(turns),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      setRequiredOrThrow: jest.fn().mockImplementation((_key, value) => {
        storedSummary = value;
        return Promise.resolve();
      }),
      zremrangebyrank: jest.fn().mockResolvedValue(4),
      zremRequired: jest.fn().mockResolvedValue(4),
      zadd: jest.fn().mockResolvedValue(undefined),
      expire: jest.fn().mockResolvedValue(undefined),
      setIfAbsent: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
      renewLock: jest.fn().mockResolvedValue(true),
    };
    const llm = {
      invoke: jest.fn().mockResolvedValue(
        JSON.stringify({
          schemaVersion: 1,
          changes: [
            {
              role: 'backend',
              module: '抽奖接口',
              before: 'timeout=2000ms',
              after: 'timeout=3000ms',
              version: 'V2',
              effectiveFrom: '2026-08-10',
              evidence: '抽奖接口超时调整为 3000ms',
            },
          ],
          decisions: ['V2 使用新超时配置'],
          openIssues: ['V1 是否同步修改待确认'],
          sourceDigest: '周年庆 V2 接口配置调整。',
        }),
      ),
    };
    const conversationRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ShortTermMemoryService(
      redis as never,
      llm as never,
      conversationRepo as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
    );

    await service.trimAndSummarize('thread-1', 6);

    const parsed = JSON.parse(storedSummary) as {
      schemaVersion: number;
      changes: Array<{ role: string; module: string; version: string }>;
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.changes[0]).toEqual(
      expect.objectContaining({
        role: 'backend',
        module: '抽奖接口',
        version: 'V2',
      }),
    );
    expect(redis.zremRequired).toHaveBeenCalledWith(
      'stm:thread-1:turns',
      ...turns.slice(0, 4),
    );
    expect(conversationRepo.update).toHaveBeenCalledWith(
      'thread-1',
      expect.objectContaining({ contextSummaryVersion: 1 }),
    );
  });

  it('keeps raw turns when structured summarization fails', async () => {
    const turns = Array.from({ length: 8 }, (_, index) =>
      JSON.stringify({
        role: 'user',
        content: `原始规则${index}：${'必须保留'.repeat(100)}`,
        ts: index,
      }),
    );
    let storedSummary = '';
    const redis = {
      isEnabled: () => true,
      zrange: jest.fn().mockResolvedValue(turns),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      setRequiredOrThrow: jest.fn().mockImplementation((_key, value) => {
        storedSummary = value;
        return Promise.resolve();
      }),
      zremrangebyrank: jest.fn().mockResolvedValue(2),
      zremRequired: jest.fn().mockResolvedValue(2),
      zadd: jest.fn().mockResolvedValue(undefined),
      expire: jest.fn().mockResolvedValue(undefined),
      setIfAbsent: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
      renewLock: jest.fn().mockResolvedValue(true),
    };
    const service = new ShortTermMemoryService(
      redis as never,
      { invoke: jest.fn().mockRejectedValue(new Error('model down')) } as never,
      {
        findOne: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(undefined),
      } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
    );

    const result = await service.trimAndSummarize('thread-2', 6);

    expect(result?.status).toBe('failed');
    expect(storedSummary).toBe('');
    expect(redis.zremRequired).not.toHaveBeenCalled();
  });

  it('Redis 不可用时读取 PostgreSQL 持久化摘要', async () => {
    const summary = JSON.stringify({
      schemaVersion: 1,
      changes: [],
      decisions: ['已确认周年庆页面结构'],
      openIssues: [],
      sourceDigest: '早期会话摘要',
    });
    const service = new ShortTermMemoryService(
      { isEnabled: () => false } as never,
      {} as never,
      {
        findOne: jest.fn().mockResolvedValue({ contextSummary: summary }),
      } as never,
      {
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          addOrderBy: jest.fn().mockReturnThis(),
          take: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        })),
      } as never,
    );

    const context = await service.getContext('thread-persisted');

    expect(context.recentTurns).toEqual([]);
    expect(context.truncatedHistory).toBe(true);
    expect(context.systemMessage?.content).toContain('已确认周年庆页面结构');
  });

  it('旧会话没有持久化摘要时，从 PostgreSQL 早期消息重建一次', async () => {
    const messageRepo = {
      count: jest.fn().mockResolvedValue(212),
      find: jest.fn().mockResolvedValue(
        Array.from({ length: 12 }, (_, index) => ({
          role: index % 2 === 0 ? 'human' : 'ai',
          content: `历史第${index}条消息`,
          createdAt: new Date(2026, 0, index + 1),
          id: `message-${index}`,
        })),
      ),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(
          Array.from({ length: 12 }, (_, index) => ({
            role: index % 2 === 0 ? 'human' : 'ai',
            content: `历史第${index}条消息`,
            createdAt: new Date(2026, 0, index + 1),
            id: `message-${index}`,
          })),
        ),
      })),
    };
    const conversationRepo = {
      findOne: jest.fn().mockResolvedValue({ contextSummary: null }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const service = new ShortTermMemoryService(
      { isEnabled: () => false } as never,
      {
        invoke: jest.fn().mockResolvedValue(
          JSON.stringify({
            schemaVersion: 1,
            changes: [],
            decisions: ['周年庆活动采用抽奖玩法'],
            openIssues: [],
            sourceDigest: '旧会话恢复摘要',
          }),
        ),
      } as never,
      conversationRepo as never,
      messageRepo as never,
    );

    const context = await service.getContext('thread-legacy');

    expect(messageRepo.createQueryBuilder).toHaveBeenCalledWith('message');
    expect(conversationRepo.update).toHaveBeenCalledWith(
      { id: 'thread-legacy', contextSummary: IsNull() },
      expect.objectContaining({ contextSummaryVersion: 1 }),
    );
    expect(context.systemMessage?.content).toContain('周年庆活动采用抽奖玩法');
  });
});
