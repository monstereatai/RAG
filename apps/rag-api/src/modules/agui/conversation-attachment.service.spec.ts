import { createHash } from 'node:crypto';
import { ConversationAttachmentService } from './conversation-attachment.service';

class MemoryRedis {
  readonly values = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();

  isEnabled() {
    return true;
  }

  getRequired(key: string) {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  setRequiredOrThrow(key: string, value: string) {
    this.values.set(key, value);
    return Promise.resolve();
  }

  smembersRequired(key: string) {
    return Promise.resolve([...this.getSet(key)]);
  }

  saddRequired(key: string, ...members: string[]) {
    for (const member of members) this.getSet(key).add(member);
    return Promise.resolve();
  }

  sremRequired(key: string, ...members: string[]) {
    for (const member of members) this.getSet(key).delete(member);
    return Promise.resolve();
  }

  expireRequired() {
    return Promise.resolve();
  }

  delRequired(key: string) {
    this.values.delete(key);
    this.sets.delete(key);
    return Promise.resolve();
  }

  seedSet(key: string, member: string) {
    this.getSet(key).add(member);
  }

  private getSet(key: string) {
    let value = this.sets.get(key);
    if (!value) {
      value = new Set<string>();
      this.sets.set(key, value);
    }
    return value;
  }
}

function ownerKey(userId: string) {
  return createHash('sha256').update(userId).digest('hex').slice(0, 24);
}

function createService(redis: MemoryRedis, queryVector = [1, 0, 0]) {
  const embedding = {
    embedDocuments: jest.fn().mockResolvedValue([[1, 0, 0]]),
    embedQuery: jest.fn().mockResolvedValue(queryVector),
  };
  const metrics = { observeAttachmentRetrievalHits: jest.fn() };
  const service = new ConversationAttachmentService(
    redis as never,
    {} as never,
    embedding as never,
    metrics as never,
  );
  return { service, embedding, metrics };
}

function originalQuery(text: string) {
  return [{ text, kind: 'original' as const, weight: 1 }];
}

function addV1(
  redis: MemoryRedis,
  userId: string,
  threadId: string,
  attachment: {
    id: string;
    filename: string;
    content: string;
  },
) {
  const prefix = `qa:conversation-attachments:v1:${ownerKey(userId)}:${threadId}`;
  redis.seedSet(`${prefix}:index`, attachment.id);
  redis.values.set(
    `${prefix}:${attachment.id}`,
    JSON.stringify({
      ...attachment,
      mimeType: 'text/markdown',
      size: attachment.content.length,
      truncated: false,
      createdAt: '2026-10-17T00:00:00.000Z',
    }),
  );
}

describe('ConversationAttachmentService', () => {
  it('stores v2 chunks with compact Float32 base64 vectors', async () => {
    const redis = new MemoryRedis();
    const { service } = createService(redis);

    const uploaded = await service.upload(
      {
        originalname: 'policy.md',
        mimetype: 'text/markdown',
        size: 18,
        buffer: Buffer.from('# Policy\n\nrefund rule'),
      } as Express.Multer.File,
      'user-1',
      'thread-1',
    );

    const storedRaw = [...redis.values.entries()].find(([key]) =>
      key.endsWith(`:${uploaded.id}`),
    )?.[1];
    const stored = JSON.parse(storedRaw ?? '{}') as {
      schemaVersion?: number;
      chunks?: Array<{ vectorBase64?: string; vector?: number[] }>;
    };
    expect(stored.schemaVersion).toBe(2);
    expect(stored.chunks?.[0]?.vectorBase64).toBe(
      Buffer.from(new Float32Array([1, 0, 0]).buffer).toString('base64'),
    );
    expect(stored.chunks?.[0]?.vector).toBeUndefined();

    const result = await service.retrieve(
      'user-1',
      'thread-1',
      [uploaded.id],
      originalQuery('return policy'),
    );
    expect(result.evidence[0]?.cosineScore).toBeCloseTo(1);
  });

  it('uses token occurrences for BM25 term frequency', async () => {
    const redis = new MemoryRedis();
    const { service } = createService(redis);
    addV1(redis, 'user-1', 'thread-1', {
      id: 'frequent',
      filename: 'frequent.md',
      content: 'refund refund refund',
    });
    addV1(redis, 'user-1', 'thread-1', {
      id: 'single',
      filename: 'single.md',
      content: 'refund unrelated words',
    });

    const result = await service.retrieve(
      'user-1',
      'thread-1',
      undefined,
      originalQuery('refund'),
    );
    expect(result.evidence[0]?.docId).toBe('frequent.md');
    expect(result.evidence[0]?.bm25Score).toBeGreaterThan(
      result.evidence[1]?.bm25Score ?? 0,
    );
  });

  it('keeps a recent explicitly named attachment scoped for follow-up', async () => {
    const redis = new MemoryRedis();
    const { service } = createService(redis);
    addV1(redis, 'user-1', 'thread-1', {
      id: 'alpha',
      filename: 'alpha.pdf',
      content: '# 第 2 页\nalpha details',
    });
    addV1(redis, 'user-1', 'thread-1', {
      id: 'beta',
      filename: 'beta.pdf',
      content: '# 第 2 页\nbeta details',
    });

    const result = await service.retrieve(
      'user-1',
      'thread-1',
      undefined,
      originalQuery('第2页呢'),
      ['先看 alpha.pdf'],
      'follow_up',
    );
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.every((item) => item.docId === 'alpha.pdf')).toBe(
      true,
    );
  });

  it('does not return attachment chunks for an unrelated query', async () => {
    const redis = new MemoryRedis();
    const { service } = createService(redis, [0, 1, 0]);
    const uploaded = await service.upload(
      {
        originalname: 'policy.md',
        mimetype: 'text/markdown',
        size: 18,
        buffer: Buffer.from('# Policy\n\nrefund rule'),
      } as Express.Multer.File,
      'user-1',
      'thread-1',
    );

    const result = await service.retrieve(
      'user-1',
      'thread-1',
      [uploaded.id],
      originalQuery('今天上海天气如何'),
    );

    expect(result).toEqual({ content: '', evidence: [] });
  });

  it('ignores low-similarity vector matches without lexical overlap', async () => {
    const redis = new MemoryRedis();
    const { service } = createService(redis, [0.2, 0.98, 0]);
    const uploaded = await service.upload(
      {
        originalname: 'policy.md',
        mimetype: 'text/markdown',
        size: 18,
        buffer: Buffer.from('# Policy\n\nrefund rule'),
      } as Express.Multer.File,
      'user-1',
      'thread-1',
    );

    const result = await service.retrieve(
      'user-1',
      'thread-1',
      [uploaded.id],
      originalQuery('今天上海天气如何'),
    );

    expect(result).toEqual({ content: '', evidence: [] });
  });

  it('returns a directly named attachment', async () => {
    const redis = new MemoryRedis();
    const { service } = createService(redis, [0, 1, 0]);
    const uploaded = await service.upload(
      {
        originalname: 'policy.md',
        mimetype: 'text/markdown',
        size: 18,
        buffer: Buffer.from('# Policy\n\nrefund rule'),
      } as Express.Multer.File,
      'user-1',
      'thread-1',
    );

    const result = await service.retrieve(
      'user-1',
      'thread-1',
      [uploaded.id],
      originalQuery('请读取 policy.md'),
    );

    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.every((item) => item.docId === 'policy.md')).toBe(
      true,
    );
  });

  it('merges original, standalone and sub-query retrieval without duplicates', async () => {
    const redis = new MemoryRedis();
    const { service, embedding } = createService(redis);
    await service.upload(
      {
        originalname: 'policy.md',
        mimetype: 'text/markdown',
        size: 24,
        buffer: Buffer.from('退款期限是七天，审批人为财务负责人。'),
      } as Express.Multer.File,
      'user-1',
      'thread-1',
    );

    const result = await service.retrieve(
      'user-1',
      'thread-1',
      undefined,
      [
        { text: '这个期限呢', kind: 'original', weight: 1 },
        { text: '退款期限', kind: 'standalone', weight: 0.85 },
        { text: '退款审批人', kind: 'sub_query', weight: 0.7 },
      ],
      ['请看 policy.md'],
      'follow_up',
    );

    expect(embedding.embedQuery).toHaveBeenCalledTimes(3);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.docId).toBe('policy.md');
  });

  it('does not inherit a previously named file for an independent query', async () => {
    const redis = new MemoryRedis();
    const { service } = createService(redis);
    addV1(redis, 'user-1', 'thread-1', {
      id: 'alpha',
      filename: 'alpha.pdf',
      content: '项目蓝色预算',
    });
    addV1(redis, 'user-1', 'thread-1', {
      id: 'beta',
      filename: 'beta.pdf',
      content: '项目红色预算',
    });

    const result = await service.retrieve(
      'user-1',
      'thread-1',
      undefined,
      originalQuery('红色预算'),
      ['先看 alpha.pdf'],
      'independent',
    );

    expect(result.evidence.some((item) => item.docId === 'beta.pdf')).toBe(
      true,
    );
  });

  it('keeps requested attachment content available for file generation', async () => {
    const redis = new MemoryRedis();
    const { service } = createService(redis, [0, 1, 0]);
    const uploaded = await service.upload(
      {
        originalname: 'release.md',
        mimetype: 'text/markdown',
        size: 18,
        buffer: Buffer.from('发布说明原文'),
      } as Express.Multer.File,
      'user-1',
      'thread-1',
    );

    const result = await service.retrieve(
      'user-1',
      'thread-1',
      [uploaded.id],
      originalQuery('生成 Word'),
      [],
      'independent',
      true,
    );

    expect(result.content).toContain('发布说明原文');
  });
});
