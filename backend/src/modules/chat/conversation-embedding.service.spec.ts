import { ConversationEmbeddingService } from './conversation-embedding.service';

describe('ConversationEmbeddingService', () => {
  const createService = () => {
    const service = new ConversationEmbeddingService(
      { get: jest.fn().mockReturnValue(undefined) } as never,
      { embedQuery: jest.fn().mockResolvedValue([0.1, 0.2]) } as never,
    );
    return service;
  };

  it('stores a versioned timestamp and supersedes the same query in a thread', async () => {
    const service = createService();
    const client = {
      deleteEntities: jest.fn().mockResolvedValue({}),
      insert: jest.fn().mockResolvedValue({}),
      flushSync: jest.fn().mockResolvedValue({}),
    };
    (service as any).client = client;
    (service as any).initialized = true;

    await service.indexConversation('thread-1', '那它吃什么？', '回答', 'user-1');

    expect(client.deleteEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: 'thread_id == $threadId && query_key == $queryKey',
        exprValues: {
          threadId: 'thread-1',
          queryKey: '那它吃什么？',
        },
      }),
    );
    const row = client.insert.mock.calls[0][0].data[0];
    expect(row).toEqual(
      expect.objectContaining({
        thread_id: 'thread-1',
        query_key: '那它吃什么？',
        user_id: 'user-1',
      }),
    );
    expect(typeof row.created_at).toBe('number');
    expect(row.version).toBe(row.created_at);
  });

  it('combines semantic similarity with recency so newer history wins near a tie', async () => {
    const service = createService();
    const now = Date.now();
    const client = {
      search: jest.fn().mockResolvedValue({
        results: [
          {
            content: 'old answer',
            thread_id: 'thread-1',
            score: 0.91,
            created_at: now - 180 * 86_400_000,
          },
          {
            content: 'new answer',
            thread_id: 'thread-1',
            score: 0.89,
            created_at: now - 86_400_000,
          },
        ],
      }),
    };
    (service as any).client = client;
    (service as any).initialized = true;

    const result = await service.searchHistory('问题', 1, 'user-1');

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('new answer');
    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, output_fields: expect.arrayContaining(['created_at']) }),
    );
  });
});
