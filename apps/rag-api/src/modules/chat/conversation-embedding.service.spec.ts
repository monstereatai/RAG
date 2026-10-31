import { ConversationEmbeddingService } from './conversation-embedding.service';

function setMilvusClient(
  service: ConversationEmbeddingService,
  client: object,
): void {
  const internals = service as unknown as {
    client: object | null;
    initialized: boolean;
  };
  internals.client = client;
  internals.initialized = true;
}

describe('ConversationEmbeddingService', () => {
  const createService = () => {
    const service = new ConversationEmbeddingService(
      { get: jest.fn().mockReturnValue(undefined) } as never,
      { embedQuery: jest.fn().mockResolvedValue([0.1, 0.2]) } as never,
      {
        find: jest.fn().mockResolvedValue([{ id: 'thread-1' }]),
      } as never,
      {
        find: jest.fn().mockResolvedValue([]),
      } as never,
      {
        registerInternalHandler: jest.fn(),
      } as never,
    );
    return service;
  };

  it('stores a versioned assistant-message record for a conversation turn', async () => {
    const service = createService();
    let upsertedRows: Array<Record<string, unknown>> = [];
    const client = {
      insert: jest
        .fn()
        .mockResolvedValue({ status: { error_code: 'Success' } }),
      query: jest.fn().mockResolvedValue({
        status: { error_code: 'Success' },
        data: [],
      }),
      upsert: jest.fn((input: { data: Array<Record<string, unknown>> }) => {
        upsertedRows = input.data;
        return Promise.resolve({
          status: { error_code: 'Success' },
          upsert_cnt: 1,
        });
      }),
      flushSync: jest.fn().mockResolvedValue({
        status: { error_code: 'Success' },
      }),
      closeConnection: jest.fn().mockResolvedValue(undefined),
    };
    setMilvusClient(service, client);

    await service.indexConversation(
      'thread-1',
      '那它吃什么？',
      '回答',
      'user-1',
      new Date(),
      'assistant-message-1',
    );

    const row = upsertedRows[0];
    expect(row).toBeDefined();
    if (!row) throw new Error('Expected conversation record to be upserted.');
    expect(row.thread_id).toBe('thread-1');
    expect(row.query_key).toBe('那它吃什么？');
    expect(row.user_id).toBe('user-1');
    expect(typeof row.created_at).toBe('number');
    expect(row.version).toBe(row.created_at);
  });

  it('combines semantic similarity with recency so newer history wins near a tie', async () => {
    const service = createService();
    const now = Date.now();
    let searchInput: Record<string, unknown> | undefined;
    const client = {
      search: jest.fn((input: Record<string, unknown>) => {
        searchInput = input;
        return Promise.resolve({
          results: [
            {
              query: 'old question',
              query_key: 'old-question',
              thread_id: 'thread-1',
              score: 0.91,
            },
            {
              query: 'new question',
              query_key: 'new-question',
              thread_id: 'thread-1',
              score: 0.89,
            },
          ],
        });
      }),
      query: jest.fn().mockResolvedValue({
        status: { error_code: 'Success' },
        data: [{ 'count(*)': 2 }],
      }),
      queryIterator: jest.fn().mockReturnValue({
        [Symbol.asyncIterator]: () => ({
          next: jest
            .fn()
            .mockResolvedValueOnce({
              done: false,
              value: [
                {
                  id: 'old-message',
                  thread_id: 'thread-1',
                  query_key: 'old-question',
                  created_at: now - 180 * 86_400_000,
                  version: now - 180 * 86_400_000,
                },
                {
                  id: 'new-message',
                  thread_id: 'thread-1',
                  query_key: 'new-question',
                  created_at: now - 86_400_000,
                  version: now - 86_400_000,
                },
              ],
            })
            .mockResolvedValueOnce({ done: true, value: undefined }),
        }),
      }),
      get: jest.fn().mockResolvedValue({
        status: { error_code: 'Success' },
        data: [
          {
            id: 'old-message',
            content: 'old answer',
            thread_id: 'thread-1',
            query_key: 'old-question',
            created_at: now - 180 * 86_400_000,
            version: now - 180 * 86_400_000,
            user_id: 'user-1',
            vector: [0.777, 0.629],
          },
          {
            id: 'new-message',
            content: 'new answer',
            thread_id: 'thread-1',
            query_key: 'new-question',
            created_at: now - 86_400_000,
            version: now - 86_400_000,
            user_id: 'user-1',
            vector: [0.806, 0.592],
          },
        ],
      }),
    };
    setMilvusClient(service, client);

    const result = await service.searchHistory('问题', 1, 'user-1');

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('new answer');
    expect(searchInput?.limit).toBe(50);
    const outputFields = searchInput?.output_fields;
    expect(Array.isArray(outputFields)).toBe(true);
    if (!Array.isArray(outputFields)) {
      throw new Error('Expected conversation search output fields.');
    }
    expect(outputFields).toEqual(
      expect.arrayContaining(['thread_id', 'query', 'query_key']),
    );
  });
});
