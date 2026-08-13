import { ShortTermMemoryService } from './short-term-memory.service';

describe('ShortTermMemoryService structured compression', () => {
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
      set: jest.fn().mockImplementation((_key, value) => {
        storedSummary = value;
        return Promise.resolve('OK');
      }),
      zremrangebyrank: jest.fn().mockResolvedValue(4),
      zadd: jest.fn().mockResolvedValue(undefined),
      expire: jest.fn().mockResolvedValue(undefined),
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
    const service = new ShortTermMemoryService(redis as never, llm as never);

    await service.trimAndSummarize('thread-1');

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
    expect(redis.zremrangebyrank).toHaveBeenCalledWith(
      'stm:thread-1:turns',
      0,
      3,
    );
  });

  it('keeps a source digest when structured parsing fails', async () => {
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
      set: jest.fn().mockImplementation((_key, value) => {
        storedSummary = value;
        return Promise.resolve('OK');
      }),
      zremrangebyrank: jest.fn().mockResolvedValue(2),
      zadd: jest.fn().mockResolvedValue(undefined),
      expire: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ShortTermMemoryService(
      redis as never,
      { invoke: jest.fn().mockRejectedValue(new Error('model down')) } as never,
    );

    await service.trimAndSummarize('thread-2');

    const parsed = JSON.parse(storedSummary) as {
      openIssues: string[];
      sourceDigest: string;
    };
    expect(parsed.openIssues[0]).toContain('结构化压缩失败');
    expect(parsed.sourceDigest).toContain('原始规则');
  });
});
